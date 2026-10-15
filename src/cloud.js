// Screen Time Tracker — cloud pipeline (Supabase Auth + sync + social + leaderboard)
import { CONFIG } from './config.js';
import { refreshEntitlement, clearEntitlementOnLogout } from './entitlement.js';
import { dateKey, calcScore, setDailyResetHour } from './utils.js';
import { log } from './logger.js';

function base() {
  return (CONFIG.supabase?.url || '').replace(/\/$/, '');
}
function anon() {
  return CONFIG.supabase?.anonKey || '';
}

async function session() {
  const { stt_user, supabaseSession } = await chrome.storage.local.get(['stt_user', 'supabaseSession']);
  return {
    user: stt_user || null,
    access: supabaseSession?.access_token || stt_user?.supabaseAccessToken || null,
    refresh: supabaseSession?.refresh_token || stt_user?.supabaseRefreshToken || null,
    expiresAt: supabaseSession?.expires_at || supabaseSession?.expires_at_ms || null,
  };
}

/** Keep one login forever — refresh JWT before expiry / on 401. Never wipe local usage. */
async function ensureFreshAccess() {
  const s = await session();
  if (!s.refresh) return s.access;
  const now = Math.floor(Date.now() / 1000);
  let exp = Number(s.expiresAt) || 0;
  // Supabase sometimes stores expires_at as ISO string
  if (!exp && typeof s.expiresAt === 'string' && s.expiresAt.includes('T')) {
    exp = Math.floor(new Date(s.expiresAt).getTime() / 1000) || 0;
  }
  const { stt_token_refreshed_at: refreshedAt } = await chrome.storage.local.get(['stt_token_refreshed_at']);
  const lastRefresh = Number(refreshedAt) || 0;
  const staleUnknown = exp <= 0 && (!lastRefresh || now - lastRefresh > 45 * 60);
  const needsRefresh = !s.access || (exp > 0 && exp - now < 300) || staleUnknown;
  if (!needsRefresh && s.access) return s.access;

  try {
    const res = await fetch(`${base()}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: anon(),
        Authorization: `Bearer ${anon()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: s.refresh }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) return s.access;
    const nextExp = data.expires_at
      || (now + (Number(data.expires_in) || 3600));
    const nextSession = {
      ...(await chrome.storage.local.get(['supabaseSession']).then((x) => x.supabaseSession || {})),
      ...data,
      expires_at: nextExp,
      refresh_token: data.refresh_token || s.refresh,
    };
    const user = {
      ...(s.user || {}),
      jwt: data.access_token,
      supabaseAccessToken: data.access_token,
      supabaseRefreshToken: nextSession.refresh_token,
    };
    await chrome.storage.local.set({
      supabaseSession: nextSession,
      stt_user: user,
      stt_token_refreshed_at: now,
    });
    try { await chrome.runtime.sendMessage({ type: 'SET_USER', user }); } catch {}
    return data.access_token;
  } catch {
    return s.access;
  }
}

/** Public: keep Supabase session alive across days (one login). */
export async function ensureCloudSession() {
  return ensureFreshAccess();
}

async function api(path, { method = 'GET', body, token, prefer, query = '' } = {}) {
  const headers = {
    apikey: anon(),
    Authorization: `Bearer ${token || anon()}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${base()}${path}${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.error_description || data?.msg || data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function getOrCreateGuest() {
  const { stt_guest } = await chrome.storage.local.get(['stt_guest']);
  if (stt_guest?.deviceId) return stt_guest;
  const deviceId = crypto.randomUUID();
  const guest = {
    deviceId,
    displayName: `Guest-${deviceId.slice(0, 4).toUpperCase()}`,
    region: 'global',
    createdAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ stt_guest: guest });
  return guest;
}

function apiSiteBase() {
  return String(CONFIG.checkoutBaseUrl || '')
    .replace(/\/checkout\.html.*$/i, '')
    .replace(/\/$/, '');
}

/**
 * Secure guest → account handoff on signup/login.
 * Local history already stays in chrome.storage; this claims guest LB row,
 * stamps profile, and marks guest claimed so we never duplicate identities.
 */
export async function migrateGuestToAccount({ user, access } = {}) {
  const sess = user && access ? { user, access } : await session();
  const u = sess.user;
  const token = sess.access;
  if (!u?.id || !token) return { skipped: true, reason: 'auth' };

  const guest = await getOrCreateGuest();
  if (guest.claimedBy && guest.claimedBy === u.id) {
    return { ok: true, already: true, deviceId: guest.deviceId };
  }

  // Tag profile (works even if migrate API is down)
  try {
    await api(`/rest/v1/stt_profiles?id=eq.${u.id}`, {
      method: 'PATCH',
      token,
      body: {
        guest_claimed_from: guest.deviceId,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {}

  let claimed = false;
  try {
    const res = await fetch(`${apiSiteBase()}/api/stt/migrate-guest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_id: guest.deviceId }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      claimed = !!data.claimed || data.ok === true;
    }
  } catch (e) {
    log.warn('[STT] migrate-guest API', e.message);
  }

  await chrome.storage.local.set({
    stt_guest: {
      ...guest,
      claimedBy: u.id,
      claimedAt: new Date().toISOString(),
    },
  });

  return { ok: true, claimed, deviceId: guest.deviceId };
}

/** Prefer cloud prefs when local still looks like factory defaults (new device / reinstall). */
function mergeAccountSettings(local = {}, cloud = {}) {
  const defaults = CONFIG.DEFAULT_SETTINGS || {};
  const out = { ...cloud, ...local };

  const preferCloudIfLocalDefault = [
    'blockedSites',
    'blockedPatterns',
    'siteLimits',
    'sessionCaps',
    'categoryBudgets',
    'focusSchedule',
    'cleaner',
    'theme',
    'themeMode',
    'visualTheme',
    'socialLimit',
    'entLimit',
    'focusGoalMins',
    'whitelistMode',
    'whitelistSites',
    'keywordBlock',
    'redirectOnBlock',
    'dailyResetHour',
    'region',
    'regionChosen',
    'goals',
    'notifications',
    'overUseRemindAt',
  ];

  const isEmptyish = (v) =>
    v == null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

  for (const key of preferCloudIfLocalDefault) {
    if (cloud[key] === undefined) continue;
    const loc = local[key];
    const def = defaults[key];
    const localIsDefault =
      loc === undefined ||
      JSON.stringify(loc) === JSON.stringify(def) ||
      (isEmptyish(loc) && !isEmptyish(cloud[key]));
    if (localIsDefault && !isEmptyish(cloud[key])) {
      out[key] = cloud[key];
    }
  }

  // Streaks: max-wins (handled by caller usually) — keep stronger here as safety
  const ls = local.streaks || {};
  const cs = cloud.streaks || {};
  out.streaks = {
    ...cs,
    ...ls,
    current: Math.max(Number(ls.current) || 0, Number(cs.current) || 0),
    best: Math.max(Number(ls.best) || 0, Number(cs.best) || 0),
    focusDays: Math.max(Number(ls.focusDays) || 0, Number(cs.focusDays) || 0),
    limitOkDays: Math.max(Number(ls.limitOkDays) || 0, Number(cs.limitOkDays) || 0),
    scoreDays: Math.max(Number(ls.scoreDays) || 0, Number(cs.scoreDays) || 0),
    lastDate: ls.lastDate || cs.lastDate || null,
  };

  out.settingsSyncedAt = Date.now();
  return out;
}

function mergeHabitBoard(local, cloud) {
  if (!cloud || typeof cloud !== 'object') return local || null;
  if (!local || typeof local !== 'object') return cloud;
  return { ...cloud, ...local, habits: local.habits?.length ? local.habits : cloud.habits };
}

function authErrorMessage(err, fallback = 'Something went wrong') {
  const raw = String(err?.message || err || '').trim();
  const lower = raw.toLowerCase();
  if (/already registered|already been registered|user already exists|email.*exist|duplicate/i.test(raw)) {
    return 'That email already has an account. Sign in instead.';
  }
  if (/invalid login|invalid credentials|invalid email or password|invalid_grant/i.test(raw)) {
    return 'Wrong email or password.';
  }
  if (/email not confirmed|confirm your email|email_not_confirmed/i.test(raw)) {
    return 'Confirm your email first — check your inbox, then sign in.';
  }
  if (/password.*at least|weak password|password should|least 6/i.test(raw)) {
    return 'Password must be at least 6 characters.';
  }
  if (/unable to validate email|invalid email|email address.*invalid/i.test(raw)) {
    return 'Enter a valid email address.';
  }
  if (/rate limit|too many|over_email_send_rate_limit/i.test(raw)) {
    return 'Too many tries. Wait a minute and try again.';
  }
  if (/network|failed to fetch|load failed/i.test(raw)) {
    return 'Network error. Check your connection and try again.';
  }
  if (/signup.?disabled|signups.?not.?allowed/i.test(raw)) {
    return 'Email sign-up is temporarily unavailable. Try Google or contact support.';
  }
  return raw || fallback;
}

function normalizeAuthSession(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.access_token) {
    return {
      ...data,
      user: data.user || data.session?.user || null,
    };
  }
  if (data.session?.access_token) {
    return {
      ...data.session,
      user: data.user || data.session.user || null,
    };
  }
  return null;
}

async function fetchAuthUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${base()}/auth/v1/user`, {
      headers: {
        apikey: anon(),
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function emailSignUp({ name, email, password, region } = {}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  const cleanName = String(name || '').trim() || cleanEmail.split('@')[0] || 'User';
  if (!cleanEmail.includes('@')) throw new Error('Enter a valid email address.');
  if (cleanPassword.length < 6) throw new Error('Password must be at least 6 characters.');

  let data;
  try {
    data = await api('/auth/v1/signup', {
      method: 'POST',
      body: {
        email: cleanEmail,
        password: cleanPassword,
        data: {
          full_name: cleanName,
          ...(region ? { region, country: region } : {}),
        },
      },
    });
  } catch (e) {
    const msg = authErrorMessage(e, 'Could not create account');
    // Existing account + same password → just sign them in
    if (/already has an account|already registered|already been registered/i.test(msg)) {
      try {
        return await emailSignIn({ email: cleanEmail, password: cleanPassword });
      } catch {
        throw new Error(msg);
      }
    }
    throw new Error(msg);
  }

  let session = normalizeAuthSession(data);
  if (session?.access_token && !session.user) {
    session.user = await fetchAuthUser(session.access_token);
  }
  if (session?.access_token) {
    return finalizeSession(session, 'email', { region });
  }

  // Email confirmation may be on — try password login (works if confirm is off / auto-confirm)
  try {
    return await emailSignIn({ email: cleanEmail, password: cleanPassword });
  } catch (loginErr) {
    const tip = authErrorMessage(loginErr, '');
    if (/confirm your email|not confirmed/i.test(tip)) {
      return { needsConfirm: true, email: cleanEmail };
    }
    // User row may exist without a session yet
    if (data?.user?.id || data?.id) {
      return { needsConfirm: true, email: cleanEmail };
    }
    throw new Error(tip || 'Account created, but sign-in failed. Try Sign in.');
  }
}

export async function emailSignIn({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (!cleanEmail.includes('@')) throw new Error('Enter a valid email address.');
  if (!cleanPassword) throw new Error('Enter your password.');

  const res = await fetch(`${base()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anon(),
      Authorization: `Bearer ${anon()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: cleanEmail, password: cleanPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      authErrorMessage(
        data.error_description || data.msg || data.error || data.message || 'Sign-in failed',
        'Sign-in failed',
      ),
    );
  }
  let session = normalizeAuthSession(data);
  if (!session?.access_token) {
    throw new Error('Sign-in failed — no session returned. Try again.');
  }
  if (!session.user) {
    session.user = await fetchAuthUser(session.access_token);
  }
  return finalizeSession(session, 'email');
}

async function finalizeSession(sessionData, provider, opts = {}) {
  let u = sessionData.user || {};
  if (!u?.id && sessionData.access_token) {
    u = (await fetchAuthUser(sessionData.access_token)) || u;
    sessionData.user = u;
  }
  if (!u?.id || !sessionData.access_token) {
    throw new Error('Sign-in incomplete — try again.');
  }
  const user = {
    id: u.id,
    name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'User',
    email: u.email,
    picture: u.user_metadata?.avatar_url || null,
    provider,
    jwt: sessionData.access_token,
    supabaseAccessToken: sessionData.access_token,
    supabaseRefreshToken: sessionData.refresh_token,
    signedInAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ stt_user: user, supabaseSession: sessionData });
  try { await chrome.runtime.sendMessage({ type: 'SET_USER', user }); } catch {}

  // Persist region/country from signup or existing settings so regional boards work immediately
  const regionPick =
    opts.region ||
    u.user_metadata?.region ||
    u.user_metadata?.country ||
    null;
  if (regionPick && regionPick !== 'global') {
    try {
      const { settings: cur } = await chrome.storage.local.get(['settings']);
      const settings = { ...(cur || {}), region: regionPick, regionChosen: true };
      await chrome.storage.local.set({ settings });
    } catch {}
  }

  const handle = (user.name || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || `u${user.id.slice(0, 6)}`;
  // Minimal profile first (works on base schema), then enrich if v5 columns exist
  // New accounts are Private by default (Instagram-style). Existing rows keep their setting via merge.
  try {
    await api('/rest/v1/stt_profiles', {
      method: 'POST',
      token: sessionData.access_token,
      prefer: 'resolution=merge-duplicates',
      body: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        is_private: true,
        is_public: false,
        ...(regionPick ? { region: regionPick } : {}),
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      },
    });
  } catch {}
  try {
    await api(`/rest/v1/stt_profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      token: sessionData.access_token,
      body: {
        handle,
        ...(regionPick ? { region: regionPick } : {}),
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      },
    });
  } catch {}

  // Guest → account: claim guest ID/score, then pull cloud (never wipe), then push local
  await migrateGuestToAccount({ user, access: sessionData.access_token }).catch(() => {});
  await refreshEntitlement({ force: true });
  await pullAndMergeCloud().catch(() => {});
  await pushFullSync({ full: false }).catch(() => {});
  // Immediate board presence (honest zeros until browse sync fills stats)
  await syncProfileViaBackend(regionPick ? { region: regionPick } : {}).catch(() => {});
  return user;
}

export async function signOutCloud() {
  // Flush latest stats before clearing session so next login restores correctly.
  // Cloud remains source-of-truth — logout never deletes stt_sync / usage / profile.
  try {
    await pushFullSync({ full: false });
  } catch {}
  const { access } = await session();
  if (access) {
    try {
      await fetch(`${base()}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: anon(), Authorization: `Bearer ${access}` },
      });
    } catch {}
  }
  await clearEntitlementOnLogout();
  // Keep screentime / settings / heatmap / pet / habits local — only clear auth
  await chrome.storage.local.remove(['stt_user', 'supabaseSession']);
  try { await chrome.runtime.sendMessage({ type: 'LOGOUT' }); } catch {}
}

/** Delete product data in cloud (auth required). Local data untouched until caller clears. */
export async function deleteAccountCloud({ confirm = true } = {}) {
  const { access } = await session();
  if (!access) throw new Error('Sign in required');
  const res = await fetch(`${apiSiteBase()}/api/stt/delete-account`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirm }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not delete account');
  return data;
}

/** Hard caps — reject corrupt ms/runaway totals before they become fake leaderboard hours */
const PERIOD_MAX_SEC = {
  today: 24 * 3600,
  week: 7 * 24 * 3600,
  month: 31 * 24 * 3600,
  year: 366 * 24 * 3600,
};

/** Short category codes for compact cloud JSON (same data, less bytes). */
const CAT_TO_CODE = {
  social: 's',
  entertainment: 'e',
  productivity: 'p',
  coding: 'c',
  education: 'u',
  search: 'q',
  news: 'n',
  shopping: 'h',
  other: 'o',
};
const CODE_TO_CAT = Object.fromEntries(Object.entries(CAT_TO_CODE).map(([k, v]) => [v, k]));

/**
 * Pack day sites for Supabase — same totals/categories, ~60–70% smaller JSON.
 * Formats supported on read:
 *   legacy: [{domain, sec, category, visits, lastVisit}]
 *   compact: [[domain, sec, catCode?, visits?], ...]
 */
function packSitesFromDay(dayObj) {
  if (!dayObj || typeof dayObj !== 'object') return [];
  const dayMax = PERIOD_MAX_SEC.today;
  const sites = [];
  for (const [domain, e] of Object.entries(dayObj)) {
    let t = Math.round(Number(e?.totalTime) || 0);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (t > dayMax * 2 && t / 1000 <= dayMax * 1.5) t = Math.round(t / 1000);
    if (t > dayMax) t = dayMax;
    const cat = e?.category || 'other';
    const visits = Math.max(0, Math.round(Number(e?.visits) || 0));
    const code = CAT_TO_CODE[cat] || 'o';
    // [domain, sec] | [domain, sec, cat] | [domain, sec, cat, visits]
    if (code === 'o' && visits <= 1) sites.push([domain, t]);
    else if (visits <= 1) sites.push([domain, t, code]);
    else sites.push([domain, t, code, visits]);
  }
  sites.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  return sites;
}

function unpackSitesToDay(packed) {
  if (!packed) return null;
  // Legacy object map { domain: { totalTime, ... } }
  if (!Array.isArray(packed) && typeof packed === 'object') {
    return packed;
  }
  if (!Array.isArray(packed) || !packed.length) return null;
  const bucket = {};
  for (const item of packed) {
    if (Array.isArray(item)) {
      const domain = String(item[0] || '').toLowerCase().replace(/^www\./, '');
      if (!domain) continue;
      const sec = Math.round(Number(item[1]) || 0);
      if (sec <= 0) continue;
      const cat = CODE_TO_CAT[item[2]] || (typeof item[2] === 'string' && item[2].length > 1 ? item[2] : 'other');
      const visits = Math.round(Number(item[3]) || 0) || 1;
      bucket[domain] = { totalTime: sec, category: cat, visits };
      continue;
    }
    if (item && typeof item === 'object') {
      const domain = String(item.domain || item.d || '').toLowerCase().replace(/^www\./, '');
      if (!domain) continue;
      const sec = Math.round(Number(item.sec ?? item.t ?? item.totalTime) || 0);
      if (sec <= 0) continue;
      const catRaw = item.category || item.c || 'other';
      const cat = CODE_TO_CAT[catRaw] || catRaw || 'other';
      bucket[domain] = {
        totalTime: sec,
        category: cat,
        visits: Math.round(Number(item.visits ?? item.v) || 0) || 1,
        lastVisit: Number(item.lastVisit) || 0,
      };
    }
  }
  return Object.keys(bucket).length ? bucket : null;
}

function summarizeDay(dayObj) {
  if (!dayObj || typeof dayObj !== 'object') {
    return { total_sec: 0, focus_sec: 0, social_sec: 0, score: 0, top_sites: [] };
  }
  let total = 0, focus = 0, social = 0;
  const dayMax = PERIOD_MAX_SEC.today;
  for (const [, e] of Object.entries(dayObj)) {
    let t = Number(e?.totalTime) || 0;
    if (!Number.isFinite(t) || t <= 0) continue;
    if (t > dayMax * 2 && t / 1000 <= dayMax * 1.5) t = Math.round(t / 1000);
    if (t > dayMax) t = dayMax;
    total += t;
    if (['productivity', 'coding', 'education'].includes(e?.category)) focus += t;
    if (e?.category === 'social') social += t;
  }
  if (total > dayMax) {
    const scale = dayMax / total;
    total = dayMax;
    focus = Math.round(focus * scale);
    social = Math.round(social * scale);
  }
  return {
    total_sec: total,
    focus_sec: focus,
    social_sec: social,
    score: calcScore(dayObj),
    // Compact packed sites for cloud (expand on pull)
    top_sites: packSitesFromDay(dayObj),
  };
}

/** Leaderboard / profile: only top 8 verbose-ish compact rows (tiny). */
function topSitesForProfile(dayOrPacked, limit = 8) {
  const packed = Array.isArray(dayOrPacked)
    ? dayOrPacked
    : packSitesFromDay(dayOrPacked || {});
  return packed.slice(0, limit).map(row => {
    if (Array.isArray(row)) {
      return {
        domain: row[0],
        sec: row[1],
        category: CODE_TO_CAT[row[2]] || 'other',
      };
    }
    return {
      domain: row.domain || row.d,
      sec: row.sec ?? row.t,
      category: row.category || CODE_TO_CAT[row.c] || 'other',
    };
  });
}

/** Keep only non-zero heatmap cells — same chart, far less JSON. */
function compactHeatmap(heatmap = {}) {
  if (!heatmap || typeof heatmap !== 'object') return {};
  const out = {};
  for (const [day, hours] of Object.entries(heatmap)) {
    if (!hours || typeof hours !== 'object') continue;
    const slim = {};
    for (const [h, v] of Object.entries(hours)) {
      const n = Math.round(Number(v) || 0);
      if (n > 0) slim[h] = n;
    }
    if (Object.keys(slim).length) out[day] = slim;
  }
  return out;
}

/** Hot cache only — full history lives in stt_usage_days (avoids storing everything twice). */
const SYNC_HOT_DAYS = 14;

function packScreentimeHot(screentime = {}, hotDays = SYNC_HOT_DAYS) {
  const keys = Object.keys(screentime || {}).sort();
  const sliceKeys = keys.slice(-hotDays);
  const out = {};
  for (const day of sliceKeys) {
    const packed = packSitesFromDay(screentime[day]);
    if (packed.length) out[day] = packed;
  }
  return out;
}

function unpackScreentimeHot(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [day, val] of Object.entries(raw)) {
    if (Array.isArray(val)) {
      const bucket = unpackSitesToDay(val);
      if (bucket) out[day] = bucket;
    } else if (val && typeof val === 'object') {
      // Legacy verbose map or already domain→entry
      const first = Object.values(val)[0];
      if (first && typeof first === 'object' && ('totalTime' in first || 'sec' in first)) {
        out[day] = val;
      } else {
        const bucket = unpackSitesToDay(val);
        if (bucket) out[day] = bucket;
        else out[day] = val;
      }
    }
  }
  return out;
}

export const LB_REGIONS = [
  { id: 'global', label: 'Global' },
  { id: 'in', label: 'India' },
  { id: 'us', label: 'United States' },
  { id: 'uk', label: 'United Kingdom' },
  { id: 'eu', label: 'Europe' },
  { id: 'sea', label: 'SE Asia' },
  { id: 'other', label: 'Other' },
];

export function detectRegion() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Kolkata|Calcutta|Colombo/.test(tz)) return 'in';
    if (/London/.test(tz)) return 'uk';
    if (tz.startsWith('Europe/')) return 'eu';
    if (tz.startsWith('America/')) return 'us';
    if (tz.startsWith('Asia/') || tz.startsWith('Pacific/') || tz.startsWith('Australia/')) return 'sea';
  } catch {}
  return 'other';
}

/** Prefer real period usage — never treat explicit 0 as blocking a richer fallback. */
function sanitizeUsageSec(raw, period = 'week') {
  let n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const max = PERIOD_MAX_SEC[period] || PERIOD_MAX_SEC.week;
  if (n > max * 2 && n / 1000 <= max * 1.5) n = Math.round(n / 1000);
  if (n > max * 1.25) return 0;
  return Math.round(n);
}

function periodBrowseFromProfile(p, period = 'week') {
  // Trust API rollup only when positive; 0 may mean "flat columns empty, check other fields"
  const apiBrowse = p?._period_browse;
  if (apiBrowse != null && Number.isFinite(Number(apiBrowse)) && Number(apiBrowse) > 0) {
    return sanitizeUsageSec(apiBrowse, period);
  }
  const flat = {
    today: p?.usage_today_sec,
    week: p?.usage_week_sec,
    month: p?.usage_month_sec,
    year: p?.usage_year_sec,
  };
  const flatVal = sanitizeUsageSec(flat[period], period);
  if (flatVal > 0) return flatVal;

  const win = (p?.period_stats && typeof p.period_stats === 'object') ? p.period_stats[period] : null;
  if (win?.browse != null && Number(win.browse) > 0) {
    return sanitizeUsageSec(win.browse, period);
  }

  const total = sanitizeUsageSec(p?.total_browse_sec, period === 'today' ? 'today' : 'week');
  if (total > 0 && (period === 'week' || period === 'today')) {
    return period === 'today' ? Math.min(total, PERIOD_MAX_SEC.today) : total;
  }
  if (apiBrowse != null && Number.isFinite(Number(apiBrowse))) return sanitizeUsageSec(apiBrowse, period);
  return 0;
}

function mapLbRow(p, user, period = 'week') {
  const periods = (p.period_stats && typeof p.period_stats === 'object') ? p.period_stats : null;
  const win = periods?.[period] || null;
  const totalSec = periodBrowseFromProfile(p, period);
  const focusSec = sanitizeUsageSec(
    (p._period_focus != null && Number(p._period_focus) > 0)
      ? Number(p._period_focus)
      : (win?.focus != null && Number(win.focus) > 0
        ? Number(win.focus)
        : (Number(p.total_focus_sec) || 0)),
    period
  );
  const score = Math.min(100, Math.max(0,
    (p._period_score != null && Number(p._period_score) > 0)
      ? Number(p._period_score)
      : (win?.score != null && Number(win.score) > 0
        ? Number(win.score)
        : (p.public_score != null ? Number(p.public_score) : 0))
  ));
  const rawSites = Array.isArray(win?.sites) ? win.sites
    : (Array.isArray(p.public_top_sites) ? p.public_top_sites : []);
  const topSites = rawSites
    .map((s) => ({ ...s, sec: sanitizeUsageSec(s.sec, period) }))
    .filter((s) => s.sec > 0 && s.domain)
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 12);
  return {
    kind: 'user',
    id: p.id,
    name: p.handle || p.name || (p.email ? String(p.email).split('@')[0] : 'User'),
    picture: p.picture,
    region: p.region || 'global',
    totalSec,
    focusSec,
    score,
    streak: Number(p.streak_days ?? win?.streak ?? 0) || 0,
    topSites,
    isYou: !!(user?.id && p.id === user.id),
    period,
    siteSec: p.site_sec != null ? sanitizeUsageSec(p.site_sec, period) : undefined,
  };
}

/** Build profile aggregate payload from local store (leaderboard + Overview restore). */
function buildProfileAggregates(screentime = {}, settings = {}, user = {}) {
  const streakObj = settings.streaks || {};
  const streakDays = Number(streakObj.current) || 0;
  const streakBest = Number(streakObj.best) || streakDays;
  const period_stats = buildPeriodStats(screentime, streakDays);
  const todaySum = summarizeDay(screentime[dateKey(0)] || {});
  const week = period_stats.week || { browse: 0, focus: 0, sites: [] };
  const boardScore = Math.min(100, Math.round(
    (todaySum.score || 0) * 0.85 + Math.min(streakDays * 2, 15)
  ));
  const weekSites = (week.sites || []).slice(0, 12);
  const payload = {
    name: user.name,
    picture: user.picture,
    total_browse_sec: week.browse || 0,
    total_focus_sec: week.focus || 0,
    public_score: boardScore,
    public_top_sites: weekSites.length
      ? weekSites.slice(0, 8)
      : topSitesForProfile(screentime[dateKey(0)] || {}, 8),
    streak_days: streakDays,
    streak_best: streakBest,
    streaks: {
      current: streakDays,
      best: streakBest,
      lastDate: streakObj.lastDate || null,
      focusDays: Number(streakObj.focusDays) || 0,
      limitOkDays: Number(streakObj.limitOkDays) || 0,
      scoreDays: Number(streakObj.scoreDays) || 0,
    },
    usage_today_sec: period_stats.today?.browse || 0,
    usage_week_sec: period_stats.week?.browse || 0,
    usage_month_sec: period_stats.month?.browse || 0,
    usage_year_sec: period_stats.year?.browse || 0,
    period_stats,
  };
  if (settings.regionChosen && settings.region) {
    payload.region = settings.region;
    payload.country = settings.region;
  }
  return payload;
}

/** Direct REST upsert of leaderboard fields (works offline-of-Vercel when RLS allows). */
async function upsertProfileAggregates(access, userId, aggregates) {
  if (!access || !userId || !aggregates) return { ok: false };
  const body = {
    ...aggregates,
    id: userId,
    last_active_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Never overwrite privacy from score sync
  delete body.is_public;
  delete body.is_private;
  // Drop undefined
  Object.keys(body).forEach(k => {
    if (body[k] === undefined) delete body[k];
  });

  // Granular fallbacks — never strip usage/score on first failure (column may be missing)
  const attempts = [
    body,
    (() => {
      const m = { ...body };
      delete m.period_stats;
      delete m.streaks;
      return m;
    })(),
    (() => {
      const m = { ...body };
      delete m.period_stats;
      delete m.streaks;
      delete m.usage_today_sec;
      delete m.usage_week_sec;
      delete m.usage_month_sec;
      delete m.usage_year_sec;
      return m;
    })(),
    (() => {
      const m = { ...body };
      delete m.period_stats;
      delete m.streaks;
      delete m.usage_today_sec;
      delete m.usage_week_sec;
      delete m.usage_month_sec;
      delete m.usage_year_sec;
      delete m.streak_days;
      delete m.streak_best;
      return m;
    })(),
    {
      id: userId,
      name: body.name,
      picture: body.picture,
      total_browse_sec: body.total_browse_sec,
      total_focus_sec: body.total_focus_sec,
      public_score: body.public_score,
      public_top_sites: body.public_top_sites,
      last_active_at: body.last_active_at,
      updated_at: body.updated_at,
    },
  ];

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const payload = attempts[i];
    Object.keys(payload).forEach(k => {
      if (payload[k] === undefined) delete payload[k];
    });
    try {
      await api('/rest/v1/stt_profiles?on_conflict=id', {
        method: 'POST',
        token: access,
        prefer: 'resolution=merge-duplicates',
        body: payload,
      });
      return { ok: true, partial: i > 0 };
    } catch (err) {
      lastErr = err;
    }
  }
  log.warn('[STT] upsertProfileAggregates', lastErr);
  return { ok: false, error: String(lastErr?.message || lastErr) };
}

/** Aggregate local screentime into today/week/month/year windows (+ top sites) */
export function buildPeriodStats(screentime = {}, streakDays = 0) {
  const windows = { today: 1, week: 7, month: 30, year: 365 };
  const out = {};
  for (const [key, days] of Object.entries(windows)) {
    let browse = 0, focus = 0;
    let lastDay = null;
    const siteMap = new Map();
    for (let i = 0; i < days; i++) {
      const dk = dateKey(i);
      const dayObj = screentime[dk] || {};
      const s = summarizeDay(dayObj);
      browse += s.total_sec;
      focus += s.focus_sec;
      if (i === 0) lastDay = s;
      for (const [domain, e] of Object.entries(dayObj)) {
        const sec = Number(e?.totalTime) || 0;
        if (sec <= 0) continue;
        const prev = siteMap.get(domain) || { domain, sec: 0, category: e?.category || 'other' };
        prev.sec += sec;
        prev.category = e?.category || prev.category;
        siteMap.set(domain, prev);
      }
    }
    const sites = [...siteMap.values()].sort((a, b) => b.sec - a.sec).slice(0, 12);
    out[key] = {
      browse,
      focus,
      score: lastDay?.score || 0,
      streak: streakDays || 0,
      sites,
    };
  }
  return out;
}

function apiBase() {
  return String(CONFIG.checkoutBaseUrl || '').replace(/\/checkout\.html$/, '').replace(/\/$/, '');
}

/** Push my profile+score — Vercel service role first, then direct REST (offline-tolerant). */
export async function syncProfileViaBackend(extra = {}) {
  const access = await ensureFreshAccess();
  const { user } = await session();
  if (!user?.id || !access) return { skipped: true };
  try {
    const store = await chrome.storage.local.get(['settings', 'screentime']);
    const settings = store.settings || {};
    const screentime = store.screentime || {};
    const payload = { ...buildProfileAggregates(screentime, settings, user), ...extra };

    let viaApi = null;
    try {
      const res = await fetch(`${apiBase()}/api/stt/sync-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      viaApi = { ok: res.ok, ...j };
      if (res.ok) return viaApi;
    } catch (e) {
      log.warn('[STT] sync-profile API', e);
    }

    // Direct upsert so leaderboard still updates when Vercel is down / unmigrated
    const direct = await upsertProfileAggregates(access, user.id, payload);
    return { ok: !!direct.ok, via: 'rest', api: viaApi, ...direct };
  } catch (e) {
    log.warn('[STT] syncProfileViaBackend', e);
    return { ok: false, error: e.message };
  }
}

/** Members-only leaderboard — period filter ranks by tracked usage time for that window. */
export async function fetchLeaderboard({
  scope = 'global',
  region = 'global',
  period = 'week',
  limit = 100,
  skipSync = false,
} = {}) {
  const access = await ensureFreshAccess();
  const { user } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');

  const lim = Math.min(200, Math.max(limit, 50));
  const periodKey = ['today', 'week', 'month', 'year'].includes(period) ? period : 'week';

  // Soft leaderboard polls skip inline sync — dashboard debounces prompt sync separately
  if (!skipSync) await syncProfileViaBackend().catch(() => {});

  let profiles = [];
  let apiError = null;
  try {
    const q = new URLSearchParams({
      limit: String(lim),
      region: scope === 'global' ? 'global' : (region || 'global'),
      period: periodKey,
    });
    const res = await fetch(`${apiBase()}/api/stt/leaderboard?${q}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(j.users)) {
      profiles = j.users;
      if (j.error) {
        apiError = j.error;
        log.warn('[STT] leaderboard API warning', j.error);
      }
    } else {
      apiError = j.error || `HTTP ${res.status}`;
      log.warn('[STT] leaderboard fetch failed', apiError);
    }
  } catch (e) {
    apiError = e.message;
    log.warn('[STT] leaderboard network', e);
  }

  if (!profiles.length) {
    const orderCol = {
      today: 'usage_today_sec',
      week: 'usage_week_sec',
      month: 'usage_month_sec',
      year: 'usage_year_sec',
    }[periodKey] || 'usage_week_sec';
    const selects = [
      `id,name,handle,picture,email,region,total_browse_sec,total_focus_sec,public_score,public_top_sites,streak_days,period_stats,usage_today_sec,usage_week_sec,usage_month_sec,usage_year_sec`,
      'id,name,handle,picture,email,region,total_browse_sec,total_focus_sec,public_score,public_top_sites,streak_days,period_stats',
      'id,name,handle,picture,email,region,total_browse_sec,total_focus_sec,public_score,public_top_sites',
      'id,name,picture,email,total_browse_sec,total_focus_sec',
    ];
    for (const select of selects) {
      try {
        const order = select.includes(orderCol)
          ? `${orderCol}.desc.nullslast`
          : 'total_browse_sec.desc.nullslast';
        const rows = await api('/rest/v1/stt_profiles', {
          token: access,
          query: `?select=${select}&order=${order}&limit=${lim}`,
        });
        if (Array.isArray(rows) && rows.length) {
          profiles = rows;
          break;
        }
      } catch {}
    }
  }

  let users = (Array.isArray(profiles) ? profiles : []).map(p => mapLbRow(p, user, periodKey));

  // ALL signed-up members stay on the board (honest 0s OK). Only drop nameless junk.
  users = users.filter(u => u.id && (u.name || u.isYou));

  // Dedupe by id
  {
    const seen = new Map();
    for (const u of users) {
      const prev = seen.get(u.id);
      if (!prev || (u.totalSec || 0) > (prev.totalSec || 0)) seen.set(u.id, u);
    }
    users = [...seen.values()];
  }
  if (user?.id && !users.some(u => u.id === user.id)) {
    const store = await chrome.storage.local.get(['screentime', 'settings']);
    const period_stats = buildPeriodStats(store.screentime || {}, store.settings?.streaks?.current || 0);
    const win = period_stats[periodKey] || {};
    users.push({
      kind: 'user',
      id: user.id,
      name: user.name || 'You',
      picture: user.picture,
      region: store.settings?.region || null,
      totalSec: win.browse || 0,
      focusSec: win.focus || 0,
      score: win.score || 0,
      streak: Number(store.settings?.streaks?.current) || 0,
      topSites: [],
      isYou: true,
      period: periodKey,
    });
  } else if (user?.id) {
    // Prefer freshest local period stats for "you"
    try {
      const store = await chrome.storage.local.get(['screentime', 'settings']);
      const period_stats = buildPeriodStats(store.screentime || {}, store.settings?.streaks?.current || 0);
      const win = period_stats[periodKey] || {};
      users = users.map(u => {
        if (!u.isYou) return u;
        return {
          ...u,
          totalSec: win.browse ?? u.totalSec,
          focusSec: win.focus ?? u.focusSec,
          score: win.score ?? u.score,
          streak: Number(store.settings?.streaks?.current) || u.streak || 0,
        };
      });
    } catch {}
  }

  const regionKey = scope === 'global' ? 'global' : (region || scope);
  if (regionKey && regionKey !== 'global' && regionKey !== 'sites') {
    users = users.filter(r => r.region && r.region === regionKey);
  }

  // Primary: total tracked usage for the selected period
  users.sort((a, b) => {
    if ((b.totalSec || 0) !== (a.totalSec || 0)) return (b.totalSec || 0) - (a.totalSec || 0);
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    if ((b.streak || 0) !== (a.streak || 0)) return (b.streak || 0) - (a.streak || 0);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const ranked = users.slice(0, lim).map((r, i) => ({ ...r, rank: i + 1 }));
  if (apiError && ranked.length <= 1) {
    ranked._apiError = apiError;
  }
  return ranked;
}

/** Rank users who share a website — by seconds on that domain in the selected period */
export async function fetchSiteLeaderboard(domain, { limit = 40, period = 'week', skipSync = false } = {}) {
  const access = await ensureFreshAccess();
  const { user } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  if (!domain) return [];

  const needle = String(domain).toLowerCase().replace(/^www\./, '');
  const periodKey = ['today', 'week', 'month', 'year'].includes(period) ? period : 'week';
  if (!skipSync) await syncProfileViaBackend().catch(() => {});

  let profiles = [];
  try {
    const q = new URLSearchParams({
      limit: String(Math.min(100, limit)),
      domain: needle,
      period: periodKey,
      region: 'global',
    });
    const res = await fetch(`${apiBase()}/api/stt/leaderboard?${q}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(j.users)) profiles = j.users;
  } catch (e) {
    log.warn('[STT] site leaderboard API', e);
  }

  if (!profiles.length) {
    const select = 'id,name,handle,picture,region,total_browse_sec,total_focus_sec,public_score,public_top_sites,period_stats,streak_days';
    profiles = await api('/rest/v1/stt_profiles', {
      token: access,
      query: `?select=${select}&limit=100`,
    }).catch(() => []);
  }

  const rows = (Array.isArray(profiles) ? profiles : [])
    .map(p => {
      const siteSec = p.site_sec != null
        ? sanitizeUsageSec(p.site_sec, periodKey)
        : (() => {
            const ps = p.period_stats?.[periodKey];
            if (Array.isArray(ps?.sites)) {
              const hit = ps.sites.find(s => String(s.domain || '').toLowerCase().replace(/^www\./, '') === needle);
              if (hit) return sanitizeUsageSec(hit.sec, periodKey);
            }
            const sites = Array.isArray(p.public_top_sites) ? p.public_top_sites : [];
            const hit = sites.find(s => String(s.domain || '').toLowerCase().replace(/^www\./, '') === needle);
            return hit ? sanitizeUsageSec(hit.sec, periodKey) : 0;
          })();
      if (siteSec <= 0) return null;
      const base = mapLbRow(p, user, periodKey);
      return {
        ...base,
        siteSec,
        siteCategory: 'other',
        domain: needle,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.siteSec - a.siteSec)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // Ensure local user appears with freshest period site seconds
  if (user?.id && !rows.some(r => r.isYou)) {
    try {
      const store = await chrome.storage.local.get(['screentime', 'settings']);
      const period_stats = buildPeriodStats(store.screentime || {}, store.settings?.streaks?.current || 0);
      const hit = (period_stats[periodKey]?.sites || []).find(
        s => String(s.domain || '').toLowerCase().replace(/^www\./, '') === needle
      );
      if (hit && hit.sec > 0) {
        rows.push({
          kind: 'user',
          id: user.id,
          name: user.name || 'You',
          picture: user.picture,
          region: store.settings?.region || null,
          totalSec: period_stats[periodKey]?.browse || 0,
          focusSec: period_stats[periodKey]?.focus || 0,
          score: period_stats[periodKey]?.score || 0,
          streak: Number(store.settings?.streaks?.current) || 0,
          topSites: [],
          isYou: true,
          period: periodKey,
          siteSec: sanitizeUsageSec(hit.sec, periodKey),
          domain: needle,
          rank: rows.length + 1,
        });
        rows.sort((a, b) => b.siteSec - a.siteSec);
        rows.forEach((r, i) => { r.rank = i + 1; });
      }
    } catch {}
  } else if (user?.id) {
    try {
      const store = await chrome.storage.local.get(['screentime', 'settings']);
      const period_stats = buildPeriodStats(store.screentime || {}, store.settings?.streaks?.current || 0);
      const hit = (period_stats[periodKey]?.sites || []).find(
        s => String(s.domain || '').toLowerCase().replace(/^www\./, '') === needle
      );
      if (hit) {
        rows.forEach(r => {
          if (r.isYou) r.siteSec = sanitizeUsageSec(hit.sec, periodKey);
        });
        rows.sort((a, b) => b.siteSec - a.siteSec);
        rows.forEach((r, i) => { r.rank = i + 1; });
      }
    } catch {}
  }

  return rows;
}

/** For each of my top sites: my rank among everyone who uses that site */
export async function fetchMySiteRanks(mySites = [], { period = 'week', skipSync = false } = {}) {
  const access = await ensureFreshAccess();
  const { user } = await session();
  if (!user?.id || !access) return [];
  const periodKey = ['today', 'week', 'month', 'year'].includes(period) ? period : 'week';

  // Prefer caller list; else rebuild from local screentime for the selected period
  let list = (mySites || []).filter((s) => s?.domain).slice(0, 12);
  if (!list.length) {
    try {
      const store = await chrome.storage.local.get(['screentime', 'settings']);
      const period_stats = buildPeriodStats(store.screentime || {}, store.settings?.streaks?.current || 0);
      list = (period_stats[periodKey]?.sites || []).slice(0, 12);
    } catch {
      list = [];
    }
  }
  if (!list.length) return [];

  if (!skipSync) await syncProfileViaBackend().catch(() => {});

  let profiles = [];
  try {
    const q = new URLSearchParams({ limit: '100', period: periodKey, region: 'global' });
    const res = await fetch(`${apiBase()}/api/stt/leaderboard?${q}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(j.users)) profiles = j.users;
  } catch {}

  if (!profiles.length) {
    const select = 'id,public_top_sites,period_stats';
    profiles = await api('/rest/v1/stt_profiles', {
      token: access,
      query: `?select=${select}&limit=100`,
    }).catch(() => []);
  }

  const rows = list.map(site => {
    const needle = String(site.domain || '').toLowerCase().replace(/^www\./, '');
    const competitors = [];
    for (const p of (profiles || [])) {
      const ps = p.period_stats?.[periodKey];
      let sec = 0;
      if (Array.isArray(ps?.sites)) {
        const hit = ps.sites.find(s => String(s.domain || '').toLowerCase().replace(/^www\./, '') === needle);
        if (hit) sec = sanitizeUsageSec(hit.sec, periodKey);
      }
      if (!sec && Array.isArray(p.public_top_sites)) {
        const hit = p.public_top_sites.find(s => String(s.domain || '').toLowerCase().replace(/^www\./, '') === needle);
        if (hit) sec = sanitizeUsageSec(hit.sec, periodKey);
      }
      if (sec > 0) competitors.push({ id: p.id, sec });
    }
    const myLocal = sanitizeUsageSec(site.sec, periodKey);
    if (myLocal > 0 && !competitors.some(c => c.id === user.id)) {
      competitors.push({ id: user.id, sec: myLocal });
    } else if (myLocal > 0) {
      const mine = competitors.find(c => c.id === user.id);
      if (mine) mine.sec = Math.max(mine.sec, myLocal);
    }
    competitors.sort((a, b) => b.sec - a.sec);
    const myIdx = competitors.findIndex(c => c.id === user.id);
    const mySec = myIdx >= 0 ? competitors[myIdx].sec : myLocal;
    return {
      domain: needle,
      category: site.category || 'other',
      mySec,
      rank: myIdx >= 0 ? myIdx + 1 : (mySec > 0 ? competitors.length + 1 : 0),
      of: Math.max(competitors.length, myIdx >= 0 ? competitors.length : (mySec > 0 ? competitors.length + 1 : 0)),
      topSec: competitors[0]?.sec || mySec,
    };
  }).filter((r) => r.domain && r.mySec > 0);

  // Best ranks first: all #1 sites, then #2, then #3… (within same rank: more of your time first)
  rows.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if ((b.mySec || 0) !== (a.mySec || 0)) return (b.mySec || 0) - (a.mySec || 0);
    return String(a.domain || '').localeCompare(String(b.domain || ''));
  });
  return rows;
}

/** Paginate every usage day for this user (no 90-day cap). */
async function fetchAllUsageDays(userId, access) {
  const pageSize = 500;
  const all = [];
  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    // hard stop ~20k days
    try {
      const rows = await api('/rest/v1/stt_usage_days', {
        token: access,
        query: `?user_id=eq.${encodeURIComponent(userId)}&select=day,total_sec,focus_sec,social_sec,score,top_sites&order=day.asc&limit=${pageSize}&offset=${offset}`,
      });
      if (!Array.isArray(rows) || !rows.length) break;
      all.push(...rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    } catch {
      break;
    }
  }
  return all;
}

async function upsertUsageDaysBatched(userId, access, screentime) {
  const days = Object.keys(screentime || {}).sort();
  const rows = [];
  for (const day of days) {
    const sum = summarizeDay(screentime[day] || {});
    if (!sum.total_sec && !(sum.top_sites || []).length) continue; // skip empty days
    rows.push({
      user_id: userId,
      day,
      total_sec: sum.total_sec,
      focus_sec: sum.focus_sec,
      social_sec: sum.social_sec,
      score: sum.score,
      top_sites: sum.top_sites, // compact packed arrays
      updated_at: new Date().toISOString(),
    });
  }
  const chunk = 80;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await api('/rest/v1/stt_usage_days?on_conflict=user_id,day', {
      method: 'POST',
      token: access,
      prefer: 'resolution=merge-duplicates',
      body: slice,
    }).catch(() => {});
  }
  return rows.length;
}

/**
 * Push sync to Supabase.
 * Always merge cloud first so Chrome / Brave / any Chromium install on the same
 * email keep a unified total (max per domain/day) instead of last-write wiping.
 * Stores forever history only in stt_usage_days (compact). stt_sync keeps settings +
 * last 14 hot days — same restore behavior, much less Supabase storage.
 * @param {{ full?: boolean }} opts — full=true: richer settings (Pro); history is always full for signed-in.
 */
export async function pushFullSync({ full = true } = {}) {
  const { user, access } = await session();
  if (!user?.id || !access) return { skipped: true, reason: 'auth' };

  const store = await chrome.storage.local.get(['settings', 'screentime', 'heatmap', 'habitBoard']);
  const settings = store.settings || {};
  try { setDailyResetHour(settings.dailyResetHour); } catch {}
  let screentime = store.screentime || {};
  let heatmap = store.heatmap || {};

  // Merge remote blob before upload — same email, any browser
  const cloudRow = await fetchCloudSyncRow(user.id, access);
  if (cloudRow?.screentime && typeof cloudRow.screentime === 'object') {
    screentime = mergeScreentimeMaps(screentime, unpackScreentimeHot(cloudRow.screentime));
  }
  if (cloudRow?.heatmap && typeof cloudRow.heatmap === 'object') {
    heatmap = mergeHeatmapMaps(heatmap, cloudRow.heatmap);
  }
  // Fold ALL usage_days (full history) into local before push
  try {
    const usageRows = await fetchAllUsageDays(user.id, access);
    for (const ur of usageRows) {
      const day = String(ur.day || '').slice(0, 10);
      if (!day) continue;
      const rebuilt = dayFromUsageRow(ur);
      if (!rebuilt) continue;
      screentime[day] = mergeDayBuckets(screentime[day], rebuilt);
    }
  } catch {}

  // Persist merged view locally so Overview matches cloud totals immediately
  await chrome.storage.local.set({ screentime, heatmap }).catch(() => {});

  const usageCount = await upsertUsageDaysBatched(user.id, access, screentime);

  const aggregates = buildProfileAggregates(screentime, settings, user);

  // Ensure profile row exists, then write full leaderboard aggregates (never reset on login)
  await api('/rest/v1/stt_profiles?on_conflict=id', {
    method: 'POST',
    token: access,
    prefer: 'resolution=merge-duplicates',
    body: {
      id: user.id,
      email: user.email || undefined,
      name: user.name || user.email?.split('@')[0] || 'Member',
      picture: user.picture || null,
      updated_at: new Date().toISOString(),
    },
  }).catch(() => {});

  const up = await upsertProfileAggregates(access, user.id, aggregates);
  if (!up.ok) log.warn('[STT] pushFullSync aggregate upsert failed', up.error);

  // Lean stt_sync: settings + compact heatmap + last 14 days only.
  // Full forever history is ONLY in stt_usage_days (no double storage).
  const todaySum = summarizeDay(screentime[dateKey(0)] || {});
  const syncBody = {
    user_id: user.id,
    screentime: packScreentimeHot(screentime, SYNC_HOT_DAYS),
    heatmap: compactHeatmap(heatmap),
    streaks: settings.streaks || {},
    daily: {
      total_sec: todaySum.total_sec,
      focus_sec: todaySum.focus_sec,
      social_sec: todaySum.social_sec,
      score: todaySum.score,
      top_sites: (todaySum.top_sites || []).slice(0, 8),
    },
    updated_at: new Date().toISOString(),
    version: 9,
  };
  if (full) {
    syncBody.settings = {
      blockedSites: settings.blockedSites,
      blockedPatterns: settings.blockedPatterns,
      siteLimits: settings.siteLimits,
      sessionCaps: settings.sessionCaps,
      focusSchedule: settings.focusSchedule,
      focusMode: settings.focusMode,
      theme: settings.theme,
      themeMode: settings.themeMode,
      visualTheme: settings.visualTheme,
      cleaner: settings.cleaner,
      socialLimit: settings.socialLimit,
      entLimit: settings.entLimit,
      focusGoalMins: settings.focusGoalMins,
      whitelistMode: settings.whitelistMode,
      whitelistSites: settings.whitelistSites,
      streaks: settings.streaks,
      region: settings.region,
      regionChosen: settings.regionChosen,
      dailyResetHour: settings.dailyResetHour,
      keywordBlock: settings.keywordBlock,
      redirectOnBlock: settings.redirectOnBlock,
      categoryBudgets: settings.categoryBudgets,
      goals: settings.goals,
      _stt_habitBoard: store.habitBoard || null,
    };
  } else {
    // Light: still keep streaks + region so board/Overview restore
    syncBody.settings = {
      streaks: settings.streaks,
      region: settings.region,
      regionChosen: settings.regionChosen,
      dailyResetHour: settings.dailyResetHour,
      focusGoalMins: settings.focusGoalMins,
      theme: settings.theme,
      themeMode: settings.themeMode,
      visualTheme: settings.visualTheme,
      _stt_habitBoard: store.habitBoard || null,
    };
  }

  await api('/rest/v1/stt_sync?on_conflict=user_id', {
    method: 'POST',
    token: access,
    prefer: 'resolution=merge-duplicates',
    body: syncBody,
  }).catch(() => {});

  await syncProfileViaBackend().catch(() => {});

  // Optional DB-side rollup from usage_days (no-op if migration not applied yet)
  try {
    await api('/rest/v1/rpc/stt_refresh_profile_leaderboard', {
      method: 'POST',
      token: access,
      body: { p_user_id: user.id },
    });
  } catch {}

  return { ok: true, mode: full ? 'full' : 'light', days: Object.keys(screentime).length, usageDays: usageCount };
}

/** Max-merge one day's domain buckets (Chrome + Brave same email → union, no wipe). */
export function mergeDayBuckets(a = {}, b = {}) {
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [dom, ent] of Object.entries(b && typeof b === 'object' ? b : {})) {
    if (!ent || typeof ent !== 'object') continue;
    const localEnt = out[dom];
    const cur = Number(localEnt?.totalTime) || 0;
    const remote = Number(ent?.totalTime) || 0;
    if (!localEnt) {
      out[dom] = { ...ent };
    } else if (remote > cur) {
      out[dom] = {
        ...localEnt,
        ...ent,
        totalTime: remote,
        visits: Math.max(Number(localEnt.visits) || 0, Number(ent.visits) || 0),
        lastVisit: Math.max(Number(localEnt.lastVisit) || 0, Number(ent.lastVisit) || 0),
      };
    } else {
      out[dom] = {
        ...ent,
        ...localEnt,
        totalTime: cur,
        visits: Math.max(Number(localEnt.visits) || 0, Number(ent.visits) || 0),
        lastVisit: Math.max(Number(localEnt.lastVisit) || 0, Number(ent.lastVisit) || 0),
      };
    }
  }
  return out;
}

/** Max-merge full screentime maps by day → domain. */
export function mergeScreentimeMaps(local = {}, cloud = {}) {
  const days = new Set([
    ...Object.keys(local && typeof local === 'object' ? local : {}),
    ...Object.keys(cloud && typeof cloud === 'object' ? cloud : {}),
  ]);
  const out = {};
  for (const day of days) {
    out[day] = mergeDayBuckets(local[day], cloud[day]);
  }
  return out;
}

function mergeHeatmapMaps(local = {}, cloud = {}) {
  const out = { ...(local && typeof local === 'object' ? local : {}) };
  for (const [k, v] of Object.entries(cloud && typeof cloud === 'object' ? cloud : {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const cur = out[k] && typeof out[k] === 'object' ? out[k] : {};
      const merged = { ...cur };
      for (const [hk, hv] of Object.entries(v)) {
        merged[hk] = Math.max(Number(cur[hk]) || 0, Number(hv) || 0);
      }
      out[k] = merged;
    } else {
      out[k] = Math.max(Number(out[k]) || 0, Number(v) || 0);
    }
  }
  return out;
}

/** Fetch cloud screentime for this user (same email / user_id). */
async function fetchCloudSyncRow(userId, access) {
  try {
    const rows = await api('/rest/v1/stt_sync', {
      token: access,
      query: `?user_id=eq.${userId}&select=screentime,heatmap,settings,streaks,updated_at,version`,
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch {
    return null;
  }
}

/** Reconstruct domain buckets from usage_days top_sites (compact or legacy). */
function dayFromUsageRow(row) {
  const packed = row?.top_sites;
  const fromSites = unpackSitesToDay(packed);
  if (fromSites) return fromSites;
  const total = Number(row?.total_sec) || 0;
  if (total <= 0) return null;
  return {
    _aggregate: {
      totalTime: total,
      category: 'other',
      visits: 1,
    },
  };
}

/** Pull cloud and merge into local (max time wins; never wipe local with empty cloud) */
export async function pullAndMergeCloud() {
  const { user, access } = await session();
  if (!user?.id || !access) return { skipped: true };

  const local = await chrome.storage.local.get(['settings', 'screentime', 'heatmap', 'habitBoard']);
  const mergedTime = { ...(local.screentime || {}) };
  let mergedHeat = { ...(local.heatmap || {}) };
  let settings = { ...(local.settings || {}) };
  let mergedHabits = local.habitBoard || null;
  try { setDailyResetHour(settings.dailyResetHour); } catch {}
  let mergedDays = 0;

  // 1) Full sync blob
  let row = null;
  try {
    const rows = await api('/rest/v1/stt_sync', {
      token: access,
      query: `?user_id=eq.${user.id}&select=*`,
    });
    row = Array.isArray(rows) ? rows[0] : rows;
  } catch {}

  if (row) {
    const cloudTime = unpackScreentimeHot(row.screentime || {});
    const beforeKeys = Object.keys(mergedTime).length;
    Object.assign(mergedTime, mergeScreentimeMaps(mergedTime, cloudTime));
    mergedDays += Math.max(0, Object.keys(mergedTime).length - beforeKeys);
    if (row.heatmap && typeof row.heatmap === 'object') {
      mergedHeat = mergeHeatmapMaps(mergedHeat, row.heatmap);
    }
    if (row.settings && typeof row.settings === 'object') {
      // Cloud restores prefs on new device; local wins when user has customized beyond defaults
      const cloudSettings = { ...row.settings };
      const cloudHabits = cloudSettings._stt_habitBoard;
      delete cloudSettings._stt_pet;
      delete cloudSettings._stt_habitBoard;
      settings = mergeAccountSettings(settings, cloudSettings);
      if (cloudHabits) mergedHabits = mergeHabitBoard(mergedHabits, cloudHabits);
    } else if (row.streaks && typeof row.streaks === 'object') {
      const ls = settings.streaks || {};
      const cs = row.streaks;
      settings.streaks = {
        ...cs,
        ...ls,
        current: Math.max(Number(ls.current) || 0, Number(cs.current) || 0),
        best: Math.max(Number(ls.best) || 0, Number(cs.best) || 0),
        focusDays: Math.max(Number(ls.focusDays) || 0, Number(cs.focusDays) || 0),
        limitOkDays: Math.max(Number(ls.limitOkDays) || 0, Number(cs.limitOkDays) || 0),
        scoreDays: Math.max(Number(ls.scoreDays) || 0, Number(cs.scoreDays) || 0),
        lastDate: ls.lastDate || cs.lastDate || null,
      };
    }
    // Legacy top-level columns if a future migration adds them
    if (row.habitBoard) mergedHabits = mergeHabitBoard(mergedHabits, row.habitBoard);
  }

  // 2) Profile streaks + period totals (authoritative when local empty)
  try {
    const profiles = await api('/rest/v1/stt_profiles', {
      token: access,
      query: `?id=eq.${user.id}&select=streak_days,streak_best,streaks,usage_today_sec,usage_week_sec,usage_month_sec,usage_year_sec,period_stats,region`,
    });
    const prof = Array.isArray(profiles) ? profiles[0] : profiles;
    if (prof) {
      const ls = settings.streaks || {};
      const fromProf = (prof.streaks && typeof prof.streaks === 'object') ? prof.streaks : {};
      settings.streaks = {
        ...fromProf,
        ...ls,
        current: Math.max(Number(ls.current) || 0, Number(fromProf.current) || Number(prof.streak_days) || 0),
        best: Math.max(Number(ls.best) || 0, Number(fromProf.best) || Number(prof.streak_best) || 0),
        focusDays: Math.max(Number(ls.focusDays) || 0, Number(fromProf.focusDays) || 0),
        limitOkDays: Math.max(Number(ls.limitOkDays) || 0, Number(fromProf.limitOkDays) || 0),
        scoreDays: Math.max(Number(ls.scoreDays) || 0, Number(fromProf.scoreDays) || 0),
        lastDate: ls.lastDate || fromProf.lastDate || null,
      };
      if (!settings.region && prof.region) settings.region = prof.region;
    }
  } catch {}

  // 3) usage_days → merge FULL history (every day ever stored for this email)
  try {
    const usageRows = await fetchAllUsageDays(user.id, access);
    for (const ur of usageRows) {
      const day = String(ur.day || '').slice(0, 10);
      if (!day) continue;
      const rebuilt = dayFromUsageRow(ur);
      if (!rebuilt) continue;
      const before = mergedTime[day] ? Object.keys(mergedTime[day]).length : 0;
      mergedTime[day] = mergeDayBuckets(mergedTime[day], rebuilt);
      if (!before) mergedDays += 1;
    }
  } catch {}

  const toSet = {
    settings,
    screentime: mergedTime,
    heatmap: mergedHeat,
  };
  if (mergedHabits) toSet.habitBoard = mergedHabits;
  await chrome.storage.local.set(toSet);
  // Drop retired Digital Pet keys if still present locally
  await chrome.storage.local.remove(['stt_pet', 'stt_pet_desktop', 'stt_pet_desktop_view']).catch(() => {});
  try { await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }); } catch {}
  return { ok: true, mergedDays, hasSync: !!row };
}

/** Guest opt-in score for leaderboard (via billing API or direct if RLS allows) */
export async function publishGuestScore(summary) {
  const guest = await getOrCreateGuest();
  // After signup/login, guest identity is claimed — do not re-publish (avoids LB duplicates)
  if (guest.claimedBy) return { ok: true, skipped: true, reason: 'claimed' };

  const payload = {
    device_id: guest.deviceId,
    display_name: guest.displayName,
    region: guest.region || 'global',
    total_sec: summary.total_sec || 0,
    focus_sec: summary.focus_sec || 0,
    top_domain: summary.top_domain || null,
    top_domain_sec: summary.top_domain_sec || 0,
    updated_at: new Date().toISOString(),
  };
  // Prefer website API (service role) when available
  try {
    const res = await fetch(`${apiSiteBase()}/api/stt/guest-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true, via: 'api' };
  } catch {}
  return { ok: false, queued: true, payload };
}

export async function updateProfile(patch) {
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  const safe = { ...patch };
  // Keep is_public mirrored when privacy toggles
  if (typeof safe.is_private === 'boolean') {
    safe.is_public = !safe.is_private;
  }
  Object.keys(safe).forEach(k => {
    if (safe[k] === undefined || safe[k] === null || safe[k] === '') delete safe[k];
  });
  // Prefer social API for privacy/bio/handle
  if (typeof safe.is_private === 'boolean' || safe.bio != null || safe.handle != null || safe.name != null) {
    const via = await socialApiPost({ action: 'update_profile', ...safe }).catch(() => null);
    if (via?.ok) return via.profile || via;
  }
  const body = { ...safe, updated_at: new Date().toISOString() };
  try {
    return await api(`/rest/v1/stt_profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      token: access,
      body,
    });
  } catch (e) {
    const msg = String(e.message || e);
    if (/is_private|public_score|public_top_sites|schema cache|column|bio|posts_count/i.test(msg)) {
      const core = {};
      for (const k of ['name', 'handle', 'picture', 'region', 'is_public', 'is_private', 'bio', 'total_browse_sec', 'total_focus_sec']) {
        if (body[k] !== undefined) core[k] = body[k];
      }
      core.updated_at = body.updated_at;
      if (Object.keys(core).length <= 1) {
        log.warn('[STT] profile schema incomplete', msg);
        throw new Error('Could not save profile right now. Try again in a moment.');
      }
      try {
        return await api(`/rest/v1/stt_profiles?id=eq.${user.id}`, {
          method: 'PATCH',
          token: access,
          body: core,
        });
      } catch (err) {
        log.warn('[STT] profile patch fallback failed', err);
        throw new Error('Could not save profile right now. Try again in a moment.');
      }
    }
    throw e;
  }
}

function socialBase() {
  return (CONFIG.socialApiUrl || '').replace(/\/$/, '')
    || (CONFIG.billingApiUrl || '').replace(/\/api\/stt\/access$/, '/api/stt/social');
}

async function socialApiPost(payload) {
  const access = await ensureFreshAccess();
  if (!access) throw new Error('Sign in required');
  const url = socialBase();
  if (!url) throw new Error('Social API not configured');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function socialApiGet(action, params = {}) {
  const access = await ensureFreshAccess();
  if (!access) throw new Error('Sign in required');
  const url = socialBase();
  if (!url) throw new Error('Social API not configured');
  const q = new URLSearchParams({ action, ...params });
  const res = await fetch(`${url}?${q}`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

/** Friendly errors — never show raw PostgREST / schema strings in UI */
export function socialUserError(e, fallback = 'Something went wrong. Try again.') {
  const m = String(e?.message || e || '');
  if (/sign in|401|jwt|session/i.test(m)) return 'Sign in required';
  if (/HTTP 404|NOT_FOUND|page could not be found/i.test(m)) {
    return 'Messaging API is deploying — message will retry via secure backup, or reload after host redeploys website.';
  }
  if (/stt_post_views|views_count/i.test(m)) {
    return 'Thought views need a database update. Ask the host to run schema-post-views.sql.';
  }
  if (/stt_posts|stt_messages|stt_friendships|schema cache|column|relation|PGRST/i.test(m)) {
    return 'Social needs a database update. Ask the host to run schema-social-network.sql.';
  }
  if (m.length && m.length < 140 && !/supabase|postgres|stack/i.test(m)) return m;
  return fallback;
}

export async function getMyProfile() {
  const { user, access } = await session();
  if (!user?.id || !access) return null;
  const rows = await api('/rest/v1/stt_profiles', {
    token: access,
    query: `?id=eq.${user.id}&select=*`,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function searchProfiles(q) {
  const raw = String(q || '')
    .trim()
    .slice(0, 64)
    .replace(/[%_,"\\()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw.length < 1) return [];

  const { access } = await session();
  // PostgREST: * is LIKE wildcard; quote values so spaces/specials don't break or=(...)
  const pattern = `"*${raw}*"`;
  const enc = encodeURIComponent(pattern);
  const select =
    'id,name,handle,picture,bio,is_private,total_browse_sec,public_score,followers_count,following_count,posts_count';
  const queries = [
    `?or=(handle.ilike.${enc},name.ilike.${enc})&select=${select}&limit=24`,
    `?name=ilike.${enc}&select=${select}&limit=24`,
    `?handle=ilike.${enc}&select=id,name,handle,picture,bio,is_private&limit=24`,
  ];

  for (const query of queries) {
    try {
      const rows = await api('/rest/v1/stt_profiles', {
        token: access || undefined,
        query,
      });
      if (Array.isArray(rows)) return rows;
    } catch {}
  }
  return [];
}

/** Discover people for Explore (signed-in free) */
export async function explorePeople(limit = 24) {
  const { access } = await session();
  const selects = [
    `?select=id,name,handle,picture,bio,is_private,total_browse_sec,total_focus_sec,public_score,followers_count,following_count,posts_count,public_top_sites&order=total_browse_sec.desc.nullslast&limit=${limit}`,
    `?select=id,name,handle,picture,bio,is_private,total_browse_sec,public_score,followers_count,following_count&order=total_browse_sec.desc.nullslast&limit=${limit}`,
    `?select=id,name,handle,picture,total_browse_sec,public_score&order=total_browse_sec.desc.nullslast&limit=${limit}`,
    `?select=id,name,picture,email&limit=${limit}`,
  ];
  for (const query of selects) {
    try {
      const rows = await api('/rest/v1/stt_profiles', { token: access || undefined, query });
      if (Array.isArray(rows)) return rows;
    } catch {}
  }
  return [];
}

async function refreshFollowCounts(userId, access) {
  const followers = await api('/rest/v1/stt_friendships', {
    token: access,
    query: `?friend_id=eq.${userId}&status=eq.accepted&select=user_id`,
  }).catch(() => []);
  const following = await api('/rest/v1/stt_friendships', {
    token: access,
    query: `?user_id=eq.${userId}&status=eq.accepted&select=friend_id`,
  }).catch(() => []);
  const followers_count = Array.isArray(followers) ? followers.length : 0;
  const following_count = Array.isArray(following) ? following.length : 0;
  // RLS: can only PATCH own profile — other user's counts need API/triggers
  await api(`/rest/v1/stt_profiles?id=eq.${userId}`, {
    method: 'PATCH',
    token: access,
    body: {
      followers_count,
      following_count,
      updated_at: new Date().toISOString(),
    },
  }).catch(() => {});
  return { followers_count, following_count };
}

/** Live recount for display (and PATCH when RLS allows — usually self only). */
async function liveProfileCounts(userId, access, profile = {}) {
  const [followers, following, posts] = await Promise.all([
    api('/rest/v1/stt_friendships', {
      token: access,
      query: `?friend_id=eq.${userId}&status=eq.accepted&select=user_id`,
    }).catch(() => []),
    api('/rest/v1/stt_friendships', {
      token: access,
      query: `?user_id=eq.${userId}&status=eq.accepted&select=friend_id`,
    }).catch(() => []),
    api('/rest/v1/stt_posts', {
      token: access,
      query: `?user_id=eq.${userId}&select=id`,
    }).catch(() => []),
  ]);
  const followers_count = Array.isArray(followers) ? followers.length : Number(profile.followers_count) || 0;
  const following_count = Array.isArray(following) ? following.length : Number(profile.following_count) || 0;
  const posts_count = Array.isArray(posts) ? posts.length : Number(profile.posts_count) || 0;
  const drifted =
    Number(profile.followers_count) !== followers_count ||
    Number(profile.following_count) !== following_count ||
    Number(profile.posts_count) !== posts_count;
  if (drifted) {
    await api(`/rest/v1/stt_profiles?id=eq.${userId}`, {
      method: 'PATCH',
      token: access,
      body: {
        followers_count,
        following_count,
        posts_count,
        updated_at: new Date().toISOString(),
      },
    }).catch(() => {});
  }
  return { followers_count, following_count, posts_count };
}

export async function getFollowRelation(targetId) {
  const { user, access } = await session();
  if (!user?.id || !access || !targetId) return { status: null, incoming: null };
  const out = await api('/rest/v1/stt_friendships', {
    token: access,
    query: `?user_id=eq.${user.id}&friend_id=eq.${targetId}&select=*`,
  }).catch(() => []);
  const inn = await api('/rest/v1/stt_friendships', {
    token: access,
    query: `?user_id=eq.${targetId}&friend_id=eq.${user.id}&select=*`,
  }).catch(() => []);
  return {
    status: Array.isArray(out) && out[0] ? out[0].status : null,
    incoming: Array.isArray(inn) && inn[0] ? inn[0].status : null,
  };
}

/**
 * Messaging rules (Instagram-like):
 * - Public accounts: any signed-in member may message
 * - Private accounts: only if you follow them (accepted) OR they follow you (accepted)
 * - Self: never
 */
export function canMessageUser({ isSelf, isPrivate, outStatus, inStatus }) {
  if (isSelf) return { ok: false, reason: 'self' };
  if (!isPrivate) return { ok: true, reason: 'public' };
  if (outStatus === 'accepted' || inStatus === 'accepted') {
    return {
      ok: true,
      reason: outStatus === 'accepted' && inStatus === 'accepted' ? 'mutual' : 'follow',
    };
  }
  return { ok: false, reason: 'private_no_follow' };
}

/** Follow or request (private → pending). Free for signed-in. */
export async function followUser(targetId) {
  try {
    const r = await socialApiPost({ action: 'follow', user_id: targetId });
    return { status: r.status };
  } catch {
    /* fall through to direct REST */
  }
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  if (targetId === user.id) throw new Error('Cannot follow yourself');

  let target = null;
  try {
    const rows = await api('/rest/v1/stt_profiles', {
      token: access,
      query: `?id=eq.${targetId}&select=id,is_private,handle,name`,
    });
    target = Array.isArray(rows) ? rows[0] : rows;
  } catch {}

  // Missing is_private → treat as private (safe default)
  const status = target?.is_private !== false ? 'pending' : 'accepted';
  await api('/rest/v1/stt_friendships', {
    method: 'POST',
    token: access,
    prefer: 'resolution=merge-duplicates',
    body: {
      user_id: user.id,
      friend_id: targetId,
      status,
      updated_at: new Date().toISOString(),
    },
  });

  await api('/rest/v1/stt_notifications', {
    method: 'POST',
    token: access,
    body: {
      user_id: targetId,
      type: status === 'pending' ? 'follow_request' : 'follow',
      title: status === 'pending' ? 'Follow request' : 'New follower',
      body: `${user.name || 'Someone'} ${status === 'pending' ? 'requested to follow you' : 'started following you'}`,
      payload: { from: user.id },
    },
  }).catch(() => {});

  if (status === 'accepted') {
    await refreshFollowCounts(targetId, access);
    await refreshFollowCounts(user.id, access);
  }
  return { status };
}

export async function unfollowUser(targetId) {
  try {
    await socialApiPost({ action: 'unfollow', user_id: targetId });
    return { ok: true };
  } catch {
    /* fall through */
  }
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  await api(`/rest/v1/stt_friendships?user_id=eq.${user.id}&friend_id=eq.${targetId}`, {
    method: 'DELETE',
    token: access,
  });
  await refreshFollowCounts(targetId, access);
  await refreshFollowCounts(user.id, access);
  return { ok: true };
}

export async function acceptFollowRequest(fromUserId) {
  try {
    await socialApiPost({ action: 'accept_follow', user_id: fromUserId });
    return { ok: true };
  } catch (e) {
    const msg = String(e?.message || e || '');
    // Only fall through when API is missing/unavailable — not for real request errors
    if (/request not found|could not confirm|user required/i.test(msg)) throw e;
  }
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  const patched = await api(`/rest/v1/stt_friendships?user_id=eq.${fromUserId}&friend_id=eq.${user.id}&status=eq.pending`, {
    method: 'PATCH',
    token: access,
    prefer: 'return=representation',
    body: { status: 'accepted', updated_at: new Date().toISOString() },
  });
  const rows = Array.isArray(patched) ? patched : patched ? [patched] : [];
  if (!rows.length) throw new Error('Request not found');
  await api('/rest/v1/stt_notifications', {
    method: 'POST',
    token: access,
    body: {
      user_id: fromUserId,
      type: 'follow_accept',
      title: 'Follow accepted',
      body: `${user.name || 'Someone'} accepted your follow request`,
      payload: { from: user.id },
    },
  }).catch(() => {});
  await refreshFollowCounts(user.id, access);
  await refreshFollowCounts(fromUserId, access);
  return { ok: true };
}

export async function rejectFollowRequest(fromUserId) {
  try {
    await socialApiPost({ action: 'reject_follow', user_id: fromUserId });
    return { ok: true };
  } catch {
    /* fall through */
  }
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  await api(`/rest/v1/stt_friendships?user_id=eq.${fromUserId}&friend_id=eq.${user.id}&status=eq.pending`, {
    method: 'DELETE',
    token: access,
  });
  return { ok: true };
}

export async function listFollowRequests() {
  try {
    const r = await socialApiGet('requests');
    if (Array.isArray(r.requests)) return r.requests;
  } catch {}
  const { user, access } = await session();
  if (!user?.id || !access) return [];
  const rows = await api('/rest/v1/stt_friendships', {
    token: access,
    query: `?friend_id=eq.${user.id}&status=eq.pending&select=*`,
  }).catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return [];
  const ids = rows.map(r => r.user_id).join(',');
  const people = await api('/rest/v1/stt_profiles', {
    token: access,
    query: `?id=in.(${ids})&select=id,name,handle,picture`,
  }).catch(() => []);
  const map = Object.fromEntries((people || []).map(p => [p.id, p]));
  return rows.map(r => ({ ...r, profile: map[r.user_id] || { id: r.user_id, name: 'User' } }));
}

export async function listFollowers(userId) {
  try {
    const r = await socialApiGet('followers', { user_id: userId });
    if (Array.isArray(r.people)) return r.people;
  } catch {}
  const { access } = await session();
  const rows = await api('/rest/v1/stt_friendships', {
    token: access || undefined,
    query: `?friend_id=eq.${userId}&status=eq.accepted&select=user_id`,
  }).catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return [];
  const ids = rows.map(r => r.user_id).join(',');
  return api('/rest/v1/stt_profiles', {
    token: access || undefined,
    query: `?id=in.(${ids})&select=id,name,handle,picture,public_score,is_private`,
  }).catch(() => []);
}

export async function listFollowing(userId) {
  try {
    const r = await socialApiGet('following', { user_id: userId });
    if (Array.isArray(r.people)) return r.people;
  } catch {}
  const { access } = await session();
  const rows = await api('/rest/v1/stt_friendships', {
    token: access || undefined,
    query: `?user_id=eq.${userId}&status=eq.accepted&select=friend_id`,
  }).catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return [];
  const ids = rows.map(r => r.friend_id).join(',');
  return api('/rest/v1/stt_profiles', {
    token: access || undefined,
    query: `?id=in.(${ids})&select=id,name,handle,picture,public_score,is_private`,
  }).catch(() => []);
}

/** Full public profile payload for Explore sheet */
export async function getUserProfileView(targetId) {
  try {
    const r = await socialApiGet('profile', { user_id: targetId });
    if (r?.profile) {
      const posts = Array.isArray(r.posts) ? r.posts : [];
      const p = r.profile;
      // Never trust a zero posts_count when thoughts are present
      const posts_count = Math.max(Number(p.posts_count) || 0, posts.length);
      return {
        profile: { ...p, posts_count },
        relation: r.relation || { status: null, incoming: null },
        isSelf: !!r.isSelf,
        canSee: !!r.canSee,
        canMessage: !!r.canMessage,
        messageReason: r.messageReason || null,
        posts,
        topSites: Array.isArray(r.topSites) ? r.topSites : [],
      };
    }
  } catch {}

  const { user, access } = await session();
  if (!access) throw new Error('Sign in required');

  const rows = await api('/rest/v1/stt_profiles', {
    token: access,
    query: `?id=eq.${targetId}&select=id,name,handle,picture,bio,is_private,is_public,total_browse_sec,total_focus_sec,public_score,public_top_sites,followers_count,following_count,posts_count`,
  }).catch(() => []);
  let profile = Array.isArray(rows) ? rows[0] : rows;
  if (!profile) throw new Error('Profile not found');

  const counts = await liveProfileCounts(targetId, access, profile);
  profile = { ...profile, ...counts };

  const rel = await getFollowRelation(targetId);
  const isSelf = user?.id === targetId;
  const isPrivate = profile.is_private === true || (profile.is_private == null && profile.is_public === false);
  const canSee = isSelf || !isPrivate || rel.status === 'accepted';
  const msgGate = canMessageUser({
    isSelf,
    isPrivate,
    outStatus: rel.status,
    inStatus: rel.incoming,
  });

  let posts = [];
  let topSites = [];
  if (canSee) {
    posts = await api('/rest/v1/stt_posts', {
      token: access,
      query: `?user_id=eq.${targetId}&select=id,body,kind,created_at,updated_at,likes_count,comments_count,views_count,user_id&order=created_at.desc&limit=30`,
    }).catch(() =>
      api('/rest/v1/stt_posts', {
        token: access,
        query: `?user_id=eq.${targetId}&select=id,body,kind,created_at,updated_at,likes_count,comments_count,user_id&order=created_at.desc&limit=30`,
      }).catch(() =>
        api('/rest/v1/stt_posts', {
          token: access,
          query: `?user_id=eq.${targetId}&select=id,body,kind,created_at,user_id&order=created_at.desc&limit=30`,
        }).catch(() => [])
      )
    );
    topSites = Array.isArray(profile.public_top_sites) ? profile.public_top_sites : [];
  }

  const postList = Array.isArray(posts) ? posts : [];
  const posts_count = Math.max(Number(profile.posts_count) || 0, postList.length);

  return {
    profile: { ...profile, is_private: isPrivate, posts_count },
    relation: rel,
    isSelf,
    canSee,
    canMessage: msgGate.ok,
    messageReason: msgGate.reason,
    posts: postList,
    topSites,
  };
}

export async function sendFriendRequest(friendId) {
  return followUser(friendId);
}

export async function listFriends() {
  const { user, access } = await session();
  if (!user?.id || !access) return [];
  return api('/rest/v1/stt_friendships', {
    token: access,
    query: `?or=(user_id.eq.${user.id},friend_id.eq.${user.id})&select=*`,
  }).catch(() => []);
}

export async function createPost(body, kind = 'thought') {
  try {
    const r = await socialApiPost({ action: 'create_post', body });
    return r.post || r;
  } catch (apiErr) {
    // If API says schema missing, surface clean message; else try REST
    if (/database update|schema-social/i.test(String(apiErr.message))) throw apiErr;
  }
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  const text = String(body || '').trim().slice(0, 500);
  if (!text) throw new Error('Write a thought first');
  try {
    return await api('/rest/v1/stt_posts', {
      method: 'POST',
      token: access,
      body: { user_id: user.id, body: text, kind: 'thought' },
    });
  } catch (e) {
    throw new Error(socialUserError(e, 'Could not post thought'));
  }
}

export async function updatePost(postId, body) {
  try {
    const r = await socialApiPost({ action: 'update_post', post_id: postId, body });
    return r.post || r;
  } catch {}
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  const text = String(body || '').trim().slice(0, 500);
  if (!text) throw new Error('Thought cannot be empty');
  return api(`/rest/v1/stt_posts?id=eq.${postId}&user_id=eq.${user.id}`, {
    method: 'PATCH',
    token: access,
    body: { body: text, updated_at: new Date().toISOString() },
  });
}

export async function deletePost(postId) {
  try {
    await socialApiPost({ action: 'delete_post', post_id: postId });
    return { ok: true };
  } catch {}
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  await api(`/rest/v1/stt_posts?id=eq.${postId}&user_id=eq.${user.id}`, {
    method: 'DELETE',
    token: access,
  });
  return { ok: true };
}

export async function likePost(postId) {
  try {
    return await socialApiPost({ action: 'like_post', post_id: postId });
  } catch {}
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  await api('/rest/v1/stt_post_likes', {
    method: 'POST',
    token: access,
    prefer: 'resolution=merge-duplicates',
    body: { post_id: Number(postId), user_id: user.id },
  });
  return { liked: true };
}

export async function unlikePost(postId) {
  try {
    return await socialApiPost({ action: 'unlike_post', post_id: postId });
  } catch {}
  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  await api(`/rest/v1/stt_post_likes?post_id=eq.${postId}&user_id=eq.${user.id}`, {
    method: 'DELETE',
    token: access,
  });
  return { liked: false };
}

export async function commentOnPost(postId, body) {
  try {
    return await socialApiPost({ action: 'comment_post', post_id: postId, body });
  } catch (e) {
    throw new Error(socialUserError(e, 'Could not comment'));
  }
}

/** Unique view — one per signed-in viewer; author does not count. Session debounce on client. */
export async function recordPostView(postId) {
  try {
    return await socialApiPost({ action: 'view_post', post_id: postId });
  } catch (e) {
    if (/views|schema-post-views|database update/i.test(String(e?.message || e))) {
      return { views_count: null, counted: false };
    }
    const { user, access } = await session();
    if (!user?.id || !access || !postId) return { views_count: null, counted: false };
    try {
      const rows = await api('/rest/v1/stt_posts', {
        token: access,
        query: `?id=eq.${postId}&select=id,user_id,views_count&limit=1`,
      }).catch(() => []);
      const post = Array.isArray(rows) ? rows[0] : rows;
      if (!post) return { views_count: null, counted: false };
      const current = Number(post.views_count) || 0;
      if (post.user_id === user.id) return { views_count: current, counted: false };
      await api('/rest/v1/stt_post_views', {
        method: 'POST',
        token: access,
        prefer: 'resolution=ignore-duplicates',
        body: { post_id: Number(postId), user_id: user.id },
      }).catch(() => {});
      const views = await api('/rest/v1/stt_post_views', {
        token: access,
        query: `?post_id=eq.${postId}&select=user_id`,
      }).catch(() => []);
      const count = Array.isArray(views) ? views.length : current;
      await api(`/rest/v1/stt_posts?id=eq.${postId}`, {
        method: 'PATCH',
        token: access,
        body: { views_count: count },
      }).catch(() => {});
      return { views_count: count, counted: count !== current };
    } catch {
      return { views_count: null, counted: false };
    }
  }
}

export async function listPostComments(postId) {
  try {
    const r = await socialApiGet('comments', { post_id: postId });
    return Array.isArray(r.comments) ? r.comments : [];
  } catch {
    return [];
  }
}

export async function fetchFeed(limit = 30) {
  try {
    return await api('/rest/v1/stt_posts', {
      query: `?select=id,body,kind,created_at,updated_at,user_id,likes_count,comments_count,views_count&order=created_at.desc&limit=${limit}`,
    });
  } catch (e) {
    if (/stt_posts|schema cache/i.test(String(e.message || e))) return [];
    try {
      return await api('/rest/v1/stt_posts', {
        query: `?select=id,body,kind,created_at,updated_at,user_id,likes_count,comments_count&order=created_at.desc&limit=${limit}`,
      });
    } catch {
      try {
        return await api('/rest/v1/stt_posts', {
          query: `?select=id,body,kind,created_at,user_id&order=created_at.desc&limit=${limit}`,
        });
      } catch {
        return [];
      }
    }
  }
}

export async function fetchFeedWithAuthors(limit = 40) {
  try {
    const r = await socialApiGet('feed', { limit: String(limit) });
    if (Array.isArray(r.feed)) return r.feed;
  } catch {}

  const { user, access } = await session();
  const posts = await fetchFeed(limit);
  if (!posts?.length) return [];
  const ids = [...new Set(posts.map(p => p.user_id).filter(Boolean))];
  if (!ids.length) return posts;
  const people = await api('/rest/v1/stt_profiles', {
    token: access || undefined,
    query: `?id=in.(${ids.join(',')})&select=id,name,handle,picture,is_private`,
  }).catch(() => []);
  const map = Object.fromEntries((people || []).map(p => [p.id, p]));

  // Hide private authors unless self or accepted follower
  let allowedPrivate = new Set();
  const privateIds = ids.filter(id => map[id]?.is_private === true && id !== user?.id);
  if (privateIds.length && user?.id && access) {
    const friendships = await api('/rest/v1/stt_friendships', {
      token: access,
      query: `?user_id=eq.${user.id}&friend_id=in.(${privateIds.join(',')})&status=eq.accepted&select=friend_id`,
    }).catch(() => []);
    allowedPrivate = new Set((friendships || []).map(f => f.friend_id));
  }

  let likedSet = new Set();
  if (user?.id && access) {
    const postIds = posts.map(p => p.id).filter(Boolean);
    if (postIds.length) {
      const likes = await api('/rest/v1/stt_post_likes', {
        token: access,
        query: `?user_id=eq.${user.id}&post_id=in.(${postIds.join(',')})&select=post_id`,
      }).catch(() => []);
      likedSet = new Set((likes || []).map(l => l.post_id));
    }
  }

  return posts
    .filter(p => {
      if (p.user_id === user?.id) return true;
      const author = map[p.user_id];
      if (!author) return false;
      if (author.is_private !== true) return true;
      return allowedPrivate.has(p.user_id);
    })
    .map(p => ({
      ...p,
      author: map[p.user_id] || null,
      liked_by_me: likedSet.has(p.id),
      likes_count: p.likes_count || 0,
      comments_count: p.comments_count || 0,
      views_count: p.views_count || 0,
    }));
}

export async function sendDirectMessage(recipientId, body) {
  const text = String(body || '').trim().slice(0, 1000);
  if (!text) throw new Error('Write a message first');
  try {
    return await socialApiPost({
      action: 'send_message',
      user_id: recipientId,
      body: text,
    });
  } catch (apiErr) {
    if (/database update|schema-social|Cannot message|Follow each other|Write a message|Invalid recipient|Profile not found/i.test(String(apiErr.message))) {
      throw new Error(socialUserError(apiErr, 'Could not send message'));
    }
    /* API 404 / unreachable → REST + RLS fallback */
  }

  const { user, access } = await session();
  if (!user?.id || !access) throw new Error('Sign in required');
  if (!recipientId || recipientId === user.id) throw new Error('Invalid recipient');

  const rows = await api('/rest/v1/stt_profiles', {
    token: access,
    query: `?id=eq.${recipientId}&select=id,is_private,is_public,name,handle`,
  }).catch(() => []);
  const target = Array.isArray(rows) ? rows[0] : rows;
  if (!target) throw new Error('Profile not found');

  const rel = await getFollowRelation(recipientId);
  const isPrivate = target.is_private === true || (target.is_private == null && target.is_public === false);
  const gate = canMessageUser({
    isSelf: false,
    isPrivate,
    outStatus: rel.status,
    inStatus: rel.incoming,
  });
  if (!gate.ok) {
    throw new Error(
      gate.reason === 'private_no_follow'
        ? 'Follow each other or wait for acceptance before messaging private accounts'
        : 'Cannot message this user',
    );
  }

  const saved = await api('/rest/v1/stt_messages', {
    method: 'POST',
    token: access,
    prefer: 'return=representation',
    body: {
      sender_id: user.id,
      recipient_id: recipientId,
      body: text,
    },
  });
  const message = Array.isArray(saved) ? saved[0] : saved;
  await api('/rest/v1/stt_notifications', {
    method: 'POST',
    token: access,
    body: {
      user_id: recipientId,
      type: 'message',
      title: 'New message',
      body: text.slice(0, 80),
      payload: { from: user.id },
    },
  }).catch(() => {});
  return { ok: true, message };
}

export async function fetchMessageThread(peerId) {
  try {
    const r = await socialApiGet('thread', { user_id: peerId });
    return Array.isArray(r.messages) ? r.messages : [];
  } catch {}
  const { user, access } = await session();
  if (!user?.id || !access || !peerId) return [];
  return api('/rest/v1/stt_messages', {
    token: access,
    query: `?or=(and(sender_id.eq.${user.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${user.id}))&select=*&order=created_at.asc&limit=100`,
  }).catch(() => []);
}

export async function fetchMessageInbox() {
  try {
    const r = await socialApiGet('inbox');
    if (Array.isArray(r.conversations)) {
      return {
        conversations: r.conversations,
        unread_total: Number(r.unread_total) || 0,
      };
    }
  } catch {}
  const { user, access } = await session();
  if (!user?.id || !access) return { conversations: [], unread_total: 0 };
  const messages = await api('/rest/v1/stt_messages', {
    token: access,
    query: `?or=(sender_id.eq.${user.id},recipient_id.eq.${user.id})&select=id,sender_id,recipient_id,body,read_at,created_at&order=created_at.desc&limit=200`,
  }).catch(() => []);
  if (!Array.isArray(messages) || !messages.length) return { conversations: [], unread_total: 0 };

  const latestByPeer = new Map();
  let unreadTotal = 0;
  for (const m of messages) {
    const peerId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
    if (!peerId || peerId === user.id) continue;
    if (m.recipient_id === user.id && !m.read_at) unreadTotal += 1;
    if (!latestByPeer.has(peerId)) latestByPeer.set(peerId, m);
  }
  const peerIds = [...latestByPeer.keys()];
  let map = {};
  if (peerIds.length) {
    const people = await api('/rest/v1/stt_profiles', {
      token: access,
      query: `?id=in.(${peerIds.join(',')})&select=id,name,handle,picture,is_private`,
    }).catch(() => []);
    map = Object.fromEntries((Array.isArray(people) ? people : []).map(p => [p.id, p]));
  }
  const conversations = peerIds.map(peerId => {
    const last = latestByPeer.get(peerId);
    const unread = messages.filter(
      m => m.sender_id === peerId && m.recipient_id === user.id && !m.read_at,
    ).length;
    return {
      peer_id: peerId,
      peer: map[peerId] || { id: peerId, name: 'Member' },
      last_message: last,
      unread,
    };
  });
  return { conversations, unread_total: unreadTotal };
}

export async function markMessagesRead(peerId) {
  try {
    await socialApiPost({ action: 'mark_messages_read', user_id: peerId });
    return;
  } catch {}
  const { user, access } = await session();
  if (!user?.id || !access || !peerId) return;
  await api(
    `/rest/v1/stt_messages?recipient_id=eq.${user.id}&sender_id=eq.${peerId}&read_at=is.null`,
    {
      method: 'PATCH',
      token: access,
      body: { read_at: new Date().toISOString() },
    },
  ).catch(() => {});
}

export async function listNotifications() {
  const { user, access } = await session();
  if (!user?.id || !access) return [];
  return api('/rest/v1/stt_notifications', {
    token: access,
    query: `?user_id=eq.${user.id}&order=created_at.desc&limit=40`,
  }).catch(() => {});
}

export async function markNotificationsRead() {
  const { user, access } = await session();
  if (!user?.id || !access) return;
  await api(`/rest/v1/stt_notifications?user_id=eq.${user.id}&read_at=is.null`, {
    method: 'PATCH',
    token: access,
    body: { read_at: new Date().toISOString() },
  }).catch(() => {});
}

export async function pushLocalNotification(type, title, body, payload = {}) {
  const { user, access } = await session();
  if (!user?.id || !access) {
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title,
        message: body,
      });
    } catch {}
    return;
  }
  await api('/rest/v1/stt_notifications', {
    method: 'POST',
    token: access,
    body: { user_id: user.id, type, title, body, payload },
  }).catch(() => {});
}

export { session as getCloudSession, summarizeDay };
