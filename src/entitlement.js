// Entitlement: race billing API + Supabase (guest always Free)
import { CONFIG } from './config.js';
import { isProPlan, normalizePlan, expiryMs } from './pro.js';
import { log } from './logger.js';

const CACHE_KEY = 'stt_entitlement';
const REVALIDATE_MS = 12 * 3600 * 1000; // Pro: 12h
const FREE_REVALIDATE_MS = 3 * 60 * 1000; // Free: 3m — avoid slow re-check every popup open
const OFFLINE_GRACE_MS = 72 * 3600 * 1000;
const FETCH_MS = 2800; // fail fast; parallel sources cover each other

function functionsBase() {
  return (CONFIG.supabase?.functionsUrl || `${CONFIG.supabase.url}/functions/v1`).replace(/\/$/, '');
}

function supabaseHeaders(accessToken) {
  return {
    apikey: CONFIG.supabase.anonKey,
    Authorization: `Bearer ${accessToken || CONFIG.supabase.anonKey}`,
    'Content-Type': 'application/json',
  };
}

export async function getStoredUser() {
  const { stt_user } = await chrome.storage.local.get(['stt_user']);
  return stt_user || null;
}

async function getAccessToken(user) {
  const { supabaseSession } = await chrome.storage.local.get(['supabaseSession']);
  return (
    supabaseSession?.access_token ||
    user?.supabaseAccessToken ||
    user?.jwt ||
    null
  );
}

export async function getCachedEntitlement() {
  const data = await chrome.storage.local.get([CACHE_KEY, 'settings']);
  const cache = data[CACHE_KEY] || data.settings?.entitlementCache || {
    plan: 'free',
    verifiedAt: 0,
    expiresAt: null,
  };
  return {
    ...cache,
    expiresAt: expiryMs(cache.expiresAt),
  };
}

export async function setCachedEntitlement(ent) {
  const payload = {
    plan: normalizePlan(ent.plan || 'free'),
    cycle: ent.cycle || null,
    provider: ent.provider || null,
    expiresAt: expiryMs(ent.expiresAt),
    verifiedAt: Date.now(),
    email: ent.email || null,
    is_pro: isProPlan(ent.plan),
  };
  const { settings } = await chrome.storage.local.get(['settings']);
  const next = {
    ...(settings || {}),
    entitlementCache: payload,
    subscription: {
      plan: payload.plan,
      status: isProPlan(payload.plan) ? 'active' : 'active',
      provider: payload.provider,
      cycle: payload.cycle,
      expiresAt: payload.expiresAt,
      updatedAt: Date.now(),
    },
  };
  await chrome.storage.local.set({ [CACHE_KEY]: payload, settings: next });
  try {
    chrome.runtime.sendMessage({ type: 'ENTITLEMENT_UPDATED', entitlement: payload }).catch(() => {});
  } catch {}
  return payload;
}

function applyApiPlan(data, email) {
  let plan = normalizePlan(data.plan || (data.is_pro || data.pro ? 'yearly' : 'free'));
  const exp = expiryMs(data.expires_at || data.expiresAt || null);
  if (isProPlan(plan) && plan !== 'lifetime' && exp && Date.now() > exp) {
    plan = 'free';
  }
  return {
    plan,
    cycle: data.cycle || plan,
    provider: data.provider || null,
    expiresAt: plan === 'free' ? null : exp,
    email,
  };
}

function cacheStillFresh(cached) {
  if (!cached?.verifiedAt) return false;
  const age = Date.now() - cached.verifiedAt;
  if (isProPlan(cached.plan)) {
    if (age >= REVALIDATE_MS) return false;
    if (cached.plan !== 'lifetime') {
      const exp = expiryMs(cached.expiresAt);
      if (exp && Date.now() > exp) return false;
    }
    return true;
  }
  return age < FREE_REVALIDATE_MS;
}

async function fetchJson(url, headers, ms = FETCH_MS) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Parallel probe — first definitive Pro wins; else first Free/ok response. */
async function raceEntitlementSources(user, token) {
  const email = String(user.email || '').toLowerCase().trim();
  const probes = [];

  // 1) Hosted billing API (usually fastest when Vercel is warm)
  if (CONFIG.billingApiUrl && !CONFIG.billingApiUrl.includes('YOUR_')) {
    probes.push(
      (async () => {
        const url = new URL(CONFIG.billingApiUrl);
        if (!token) url.searchParams.set('email', email);
        url.searchParams.set('product', 'stt');
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const data = await fetchJson(url.toString(), headers);
        if (!data) return null;
        return { ...applyApiPlan(data, email), source: 'api' };
      })().catch(() => null),
    );
  }

  // 2) Direct Supabase — entitlements + profiles in parallel
  probes.push(
    (async () => {
      const base = CONFIG.supabase.url.replace(/\/$/, '');
      const access = token || CONFIG.supabase.anonKey;
      const headers = { ...supabaseHeaders(access), Prefer: 'return=representation' };

      const entQs = [];
      if (user.id) {
        entQs.push(
          new URLSearchParams({
            user_id: `eq.${user.id}`,
            select: 'plan,cycle,provider,expires_at,status',
            limit: '1',
          }).toString(),
        );
      }
      if (email) {
        entQs.push(
          new URLSearchParams({
            email: `eq.${email}`,
            select: 'plan,cycle,provider,expires_at,status',
            limit: '1',
          }).toString(),
        );
      }

      const profileQs = user.id
        ? `id=eq.${encodeURIComponent(user.id)}&select=plan,plan_expires_at,plan_provider&limit=1`
        : `email=eq.${encodeURIComponent(email)}&select=plan,plan_expires_at,plan_provider&limit=1`;

      const [entRows, profileRows] = await Promise.all([
        Promise.all(
          entQs.map(q =>
            fetchJson(`${base}/rest/v1/stt_entitlements?${q}`, headers).catch(() => null),
          ),
        ).then(results => results.find(r => Array.isArray(r) && r[0])?.[0] || null),
        fetchJson(`${base}/rest/v1/stt_profiles?${profileQs}`, headers).catch(() => null),
      ]);

      if (entRows) {
        return {
          ...applyApiPlan(
            {
              plan: entRows.plan,
              cycle: entRows.cycle,
              provider: entRows.provider,
              expires_at: entRows.expires_at,
              is_pro: entRows.status === 'active' || entRows.status === 'paid',
            },
            email,
          ),
          source: 'supabase',
        };
      }

      const prow = Array.isArray(profileRows) ? profileRows[0] : null;
      if (prow?.plan) {
        return {
          ...applyApiPlan(
            {
              plan: prow.plan,
              cycle: prow.plan,
              provider: prow.plan_provider,
              expires_at: prow.plan_expires_at,
              is_pro: String(prow.plan).toLowerCase() !== 'free',
            },
            email,
          ),
          source: 'supabase-profile',
        };
      }
      return null;
    })().catch(() => null),
  );

  // 3) Edge function — short timeout, only if signed in (often cold)
  if (token) {
    probes.push(
      (async () => {
        const data = await fetchJson(
          `${functionsBase()}/entitlement`,
          { ...supabaseHeaders(token), Accept: 'application/json' },
          2000,
        );
        if (!data) return null;
        return { ...applyApiPlan(data, email), source: 'edge' };
      })().catch(() => null),
    );
  }

  const settled = await Promise.all(probes);
  const hits = settled.filter(Boolean);
  const proHit = hits.find(h => isProPlan(h.plan));
  return proHit || hits[0] || null;
}

/** Fetch plan from billing API / Supabase. Never trust query params alone. */
export async function refreshEntitlement({ force = false } = {}) {
  const user = await getStoredUser();
  if (!user?.email) {
    await setCachedEntitlement({ plan: 'free' });
    return { plan: 'free', source: 'guest' };
  }

  const cached = await getCachedEntitlement();
  if (!force && cacheStillFresh(cached)) {
    return { ...cached, source: 'cache' };
  }

  const token = await getAccessToken(user);

  try {
    const hit = await raceEntitlementSources(user, token);
    if (hit) {
      const ent = await setCachedEntitlement(hit);
      return { ...ent, source: hit.source };
    }
  } catch (e) {
    log.warn('[STT] entitlement race', e.message);
  }

  // Offline grace — don't hard-lock paying users on a network blip
  if (isProPlan(cached.plan) && cached.verifiedAt && Date.now() - cached.verifiedAt < OFFLINE_GRACE_MS) {
    const exp = expiryMs(cached.expiresAt);
    if (cached.plan === 'lifetime' || !exp || Date.now() <= exp + OFFLINE_GRACE_MS) {
      return { ...cached, source: 'offline-grace' };
    }
  }

  await setCachedEntitlement({ plan: 'free', email: user.email });
  return { plan: 'free', source: 'default' };
}

export async function clearEntitlementOnLogout() {
  await chrome.storage.local.remove([CACHE_KEY]);
  const { settings } = await chrome.storage.local.get(['settings']);
  if (settings) {
    settings.subscription = { plan: 'free', status: 'active', provider: null, cycle: null };
    settings.entitlementCache = { plan: 'free', verifiedAt: 0, expiresAt: null };
    await chrome.storage.local.set({ settings });
  }
}
