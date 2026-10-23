// Screen Time Tracker — Background Service Worker (MV3) v4
import { CONFIG } from './config.js';
import { enforceFreeCaps, getEffectivePlan, isPro, canUse, historyDaysForPlan, normalizePlan } from './pro.js';
import { refreshEntitlement, clearEntitlementOnLogout } from './entitlement.js';
import { createCheckout } from './payments.js';
import { syncSettingsToCloud } from './supabase-auth.js';
import { pushFullSync, getOrCreateGuest, publishGuestScore, summarizeDay, pushLocalNotification } from './cloud.js';
import { runFeatureNudges, maybeDomainAward } from './nudges.js';
import { calcScore, setDailyResetHour, todayKey, dateKey, dayKeyFromMs, nextDayBoundaryMs, safeHttpUrl } from './utils.js';
import { log } from './logger.js';

/** Focus score floor for scoreDays streak (matches Goals checklist). */
const SCORE_STREAK_MIN = 70;

/** Increment a day-counter once per calendar day when `ok` becomes true. */
function bumpDayStreak(streaks, countKey, lastKey, ok, dk, yesterday) {
  if (!ok) return false;
  if (streaks[lastKey] === dk) return false;
  const prev = Number(streaks[countKey]) || 0;
  streaks[countKey] = streaks[lastKey] === yesterday ? prev + 1 : 1;
  streaks[lastKey] = dk;
  return true;
}

/** Domain → category maps. Matching is subdomain-aware (chat.openai.com → openai.com)
 *  and longest-suffix wins so gemini.google.com → coding beats google.com → search.
 *  User `settings.categoryOverrides[domain]` always wins. */
const CATEGORIES = {
  social: [
    'facebook.com','twitter.com','x.com','instagram.com','tiktok.com','snapchat.com','reddit.com',
    'pinterest.com','linkedin.com','discord.com','telegram.org','whatsapp.com','threads.net',
    'tumblr.com','vk.com','mastodon.social','messenger.com','groups.google.com',
  ],
  productivity: [
    'notion.so','notion.site','trello.com','asana.com','monday.com','clickup.com','todoist.com',
    'airtable.com','jira.atlassian.com','atlassian.com','slack.com','zoom.us','teams.microsoft.com',
    'meet.google.com','calendar.google.com','docs.google.com','sheets.google.com','slides.google.com',
    'drive.google.com','office.com','outlook.com','outlook.office.com','outlook.office365.com',
    'gmail.com','mail.google.com','figma.com','miro.com','linear.app','basecamp.com','canva.com',
    'dropbox.com','box.com','onedrive.live.com','sharepoint.com','evernote.com','coda.io',
    'craft.do','height.app','intercom.com','hubspot.com','salesforce.com','zoho.com',
    'calendly.com','typeform.com','loom.com','grain.com',
  ],
  coding: [
    // AI assistants / coding copilots (prefer coding over other/productivity)
    'chatgpt.com','openai.com','claude.ai','anthropic.com','gemini.google.com','bard.google.com',
    'aistudio.google.com','perplexity.ai','copilot.microsoft.com','poe.com','character.ai',
    'cursor.com','cursor.sh','phind.com','grok.x.ai','x.ai','deepseek.com','mistral.ai',
    'huggingface.co','meta.ai','pi.ai','chat.mistral.ai','notebooklm.google.com',
    // Dev platforms / docs / local
    'github.com','gitlab.com','bitbucket.org','stackoverflow.com','stackexchange.com','codepen.io',
    'replit.com','codesandbox.io','stackblitz.com','jsfiddle.net','jsbin.com','glitch.com',
    'leetcode.com','hackerrank.com','codeforces.com','atcoder.jp','dev.to','hashnode.dev',
    'npmjs.com','pypi.org','crates.io','packagist.org','nuget.org','pkg.go.dev',
    'developer.mozilla.org','w3schools.com','css-tricks.com','vercel.com','netlify.com',
    'heroku.com','railway.app','render.com','fly.io','aws.amazon.com','console.cloud.google.com',
    'firebase.google.com','colab.research.google.com','kaggle.com','supabase.com','neon.tech',
    'cloudflare.com','digitalocean.com','docker.com','kubernetes.io','postman.com','swagger.io',
    'vscode.dev','github.dev','gitpod.io','jetbrains.com','visualstudio.com','localhost','127.0.0.1',
    'bolt.new','v0.dev','lovable.dev',
  ],
  entertainment: [
    'youtube.com','netflix.com','hulu.com','disneyplus.com','twitch.tv','spotify.com','soundcloud.com',
    '9gag.com','imgur.com','vimeo.com','dailymotion.com','crunchyroll.com','primevideo.com',
    'music.apple.com','deezer.com','tidal.com','pandora.com',
  ],
  news: [
    'cnn.com','bbc.com','bbc.co.uk','nytimes.com','theguardian.com','reuters.com','apnews.com',
    'washingtonpost.com','techcrunch.com','wired.com','theverge.com','arstechnica.com',
    'news.ycombinator.com','bloomberg.com','forbes.com','cnbc.com','wsj.com',
  ],
  shopping: [
    'amazon.com','ebay.com','walmart.com','etsy.com','aliexpress.com','shopify.com','target.com',
    'bestbuy.com','newegg.com','flipkart.com',
  ],
  education: [
    'coursera.org','udemy.com','khanacademy.org','edx.org','pluralsight.com','skillshare.com',
    'duolingo.com','wikipedia.org','britannica.com','scholar.google.com','arxiv.org','medium.com',
    'substack.com','freecodecamp.org',
  ],
  search: ['google.com','bing.com','duckduckgo.com','yahoo.com','ecosia.org','startpage.com'],
};

const IDLE_SEC = 60;
/** Cap credited gap after SW sleep so overnight resume doesn't invent hours. */
const GAP_CREDIT_CAP_MS = 12 * 60 * 1000;
const CHECKPOINT_KEY = 'sttTrackingCheckpoint';
let activeTabId = null, activeUrl = null, activeTitle = null, activeStart = null, isIdle = false;
let mediaPlaying = false;
/** Count visits once per continuous domain session (not every flush). */
let sessionVisitCounted = false;
/** Last logical day key we flushed into — detect rollover for sync. */
let lastFlushDayKey = null;
let _syncAfterFlushTimer = null;
/** Last known mediaPlaying for end-of-session sync nudge. */
let _prevMediaPlaying = false;

async function currentPlan() {
  const d = await chrome.storage.local.get(['settings', 'stt_user']);
  return getEffectivePlan(mergeSettings(d.settings || {}), d.stt_user);
}

function getDomain(url) {
  try {
    if (!url) return null;
    const u = new URL(url);
    if (['chrome:', 'chrome-extension:', 'about:', 'edge:', 'devtools:'].includes(u.protocol)) return null;
    // Strip common vanity/mobile prefixes; subdomains otherwise kept for suffix match
    return u.hostname.toLowerCase().replace(/^(www|m|mobile|amp)\./, '');
  } catch {
    return null;
  }
}

function categorize(domain, settings = {}) {
  if (!domain) return 'other';
  const ov = settings.categoryOverrides || {};
  if (ov[domain]) return ov[domain];
  // Longest registered suffix wins (gemini.google.com → coding over google.com → search)
  let bestCat = null;
  let bestLen = -1;
  for (const [cat, list] of Object.entries(CATEGORIES)) {
    for (const d of list) {
      if (!d) continue;
      if (domain === d || domain.endsWith('.' + d)) {
        if (d.length > bestLen) {
          bestLen = d.length;
          bestCat = cat;
        }
      }
    }
  }
  return bestCat || 'other';
}

function mergeSettings(raw = {}) {
  const d = CONFIG.DEFAULT_SETTINGS;
  const merged = {
    ...d,
    ...raw,
    emailReports: { ...d.emailReports, ...(raw.emailReports || {}) },
    focusSchedule: { ...d.focusSchedule, ...(raw.focusSchedule || {}), dayHours: { ...(d.focusSchedule?.dayHours || {}), ...(raw.focusSchedule?.dayHours || {}) } },
    cleaner: { ...d.cleaner, ...(raw.cleaner || {}) },
    goals: { ...d.goals, ...(raw.goals || {}) },
    settingsLock: { ...d.settingsLock, ...(raw.settingsLock || {}) },
    hardLock: { ...d.hardLock, ...(raw.hardLock || {}) },
    focusProfiles: { ...d.focusProfiles, ...(raw.focusProfiles || {}), presets: { ...d.focusProfiles?.presets, ...(raw.focusProfiles?.presets || {}) } },
    streaks: { ...d.streaks, ...(raw.streaks || {}) },
    entitlementCache: { ...d.entitlementCache, ...(raw.entitlementCache || {}) },
    coach: { ...d.coach, ...(raw.coach || {}) },
    theme: raw.theme || d.theme || 'auto',
    themeMode: raw.themeMode || d.themeMode || 'auto',
    subscription: raw.subscription || d.subscription || { plan: 'free', status: 'active' },
    dismissedUpdate: raw.dismissedUpdate ?? d.dismissedUpdate ?? null,
    keywordBlock: raw.keywordBlock || d.keywordBlock || [],
    blockedPatterns: raw.blockedPatterns || d.blockedPatterns || [],
    sessionCaps: raw.sessionCaps || d.sessionCaps || {},
    categoryBudgets: raw.categoryBudgets || d.categoryBudgets || {},
    categoryOverrides: raw.categoryOverrides || d.categoryOverrides || {},
    whitelistSites: raw.whitelistSites || d.whitelistSites || [],
    bwMode: raw.bwMode ?? d.bwMode ?? false,
    focusTint: raw.focusTint ?? d.focusTint ?? false,
    liveBanner: raw.liveBanner ?? d.liveBanner ?? true,
    newTabDashboard: raw.newTabDashboard ?? d.newTabDashboard ?? false,
    whitelistMode: raw.whitelistMode ?? d.whitelistMode ?? false,
    mediaAwareTracking: raw.mediaAwareTracking ?? d.mediaAwareTracking ?? true,
    redirectOnBlock: raw.redirectOnBlock ?? d.redirectOnBlock ?? '',
    dailyResetHour: raw.dailyResetHour ?? d.dailyResetHour ?? 0,
    overUseRemindAt: raw.overUseRemindAt ?? d.overUseRemindAt ?? 80,
  };
  setDailyResetHour(merged.dailyResetHour);
  return merged;
}

function urlMatchesPattern(url, pattern) {
  const p = String(pattern || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!p) return false;
  const u = String(url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  return u.includes(p);
}

function isIgnored(domain, settings) {
  return (settings.ignoreList || []).some(d => domain === d || domain.endsWith('.' + d));
}

function scheduleActive(settings) {
  const sch = settings.focusSchedule;
  if (!sch?.enabled) return true;
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (!(sch.days || []).includes(day)) return false;
  const dayOv = sch.dayHours?.[String(day)] || sch.dayHours?.[day];
  const start = dayOv?.start ?? sch.startHour ?? 9;
  const end = dayOv?.end ?? sch.endHour ?? 18;
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function nuclearActive(settings) {
  return !!(settings.nuclearUntil && Date.now() < settings.nuclearUntil);
}

function hardLockActive(settings) {
  const h = settings.hardLock;
  if (!h?.enabled) return false;
  if (h.until && Date.now() < h.until) return true;
  return !!h.enabled && nuclearActive(settings);
}

function blockRedirectUrl(settings, domain, reason, extra = '') {
  if (settings.redirectOnBlock && reason !== 'keyword') {
    try {
      const raw = String(settings.redirectOnBlock || '').trim();
      const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const safe = safeHttpUrl(candidate);
      if (safe) return safe;
    } catch {}
  }
  return (
    chrome.runtime.getURL('pages/blocked.html') +
    '?site=' +
    encodeURIComponent(domain) +
    '&reason=' +
    encodeURIComponent(reason) +
    extra
  );
}

async function hydrateActiveTab() {
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t?.id) {
      activeTabId = t.id;
      activeUrl = t.url || null;
      activeTitle = t.title || null;
      if (!activeStart) activeStart = Date.now();
    }
  } catch {}
}

async function queryAudibleTabs() {
  try {
    return await chrome.tabs.query({ audible: true });
  } catch {
    return [];
  }
}

/** True when content reported media OR any tab is audible (Brave/Chrome keep-alive). */
async function hasMediaOrAudibleKeepAlive() {
  if (mediaPlaying) return true;
  const tabs = await queryAudibleTabs();
  return tabs.length > 0;
}

/**
 * Restore in-memory session from an audible tab (or active tab if mediaPlaying).
 * Keeps overnight YouTube / background audio tracking alive across idle/lock/SW sleep.
 */
async function restoreTrackingFromAudibleTabs() {
  try {
    let tabs = await queryAudibleTabs();
    if (!tabs.length) {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active && (mediaPlaying || active.audible)) tabs = [active];
    }
    if (!tabs.length) return false;
    const t = tabs.find(x => x.id === activeTabId) || tabs[0];
    const url = t.url || null;
    if (!getDomain(url)) return false;
    isIdle = false;
    activeTabId = t.id;
    activeUrl = url;
    activeTitle = t.title || null;
    if (!activeStart) activeStart = Date.now();
    return true;
  } catch {
    return false;
  }
}

async function persistTrackingCheckpoint() {
  const payload = {
    activeUrl,
    activeStart,
    mediaPlaying: !!mediaPlaying,
    lastFlushAt: Date.now(),
    activeTitle,
    activeTabId,
  };
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ [CHECKPOINT_KEY]: payload });
      return;
    }
  } catch {}
  try {
    await chrome.storage.local.set({ [CHECKPOINT_KEY]: payload });
  } catch {}
}

async function loadTrackingCheckpoint() {
  try {
    if (chrome.storage.session) {
      const d = await chrome.storage.session.get([CHECKPOINT_KEY]);
      if (d[CHECKPOINT_KEY]) return d[CHECKPOINT_KEY];
    }
  } catch {}
  try {
    const d = await chrome.storage.local.get([CHECKPOINT_KEY]);
    return d[CHECKPOINT_KEY] || null;
  } catch {
    return null;
  }
}

/**
 * Rehydrate after SW wake. If still audible/media and there is a gap since lastFlush,
 * credit elapsed time capped at GAP_CREDIT_CAP_MS (no invented overnight hours).
 */
async function rehydrateTrackingSession() {
  const cp = await loadTrackingCheckpoint();
  const memoryEmpty = !activeUrl || !activeStart;
  if (memoryEmpty && cp?.activeUrl && cp?.activeStart) {
    activeUrl = cp.activeUrl;
    activeTitle = cp.activeTitle || null;
    activeTabId = cp.activeTabId || null;
    activeStart = cp.activeStart;
    mediaPlaying = !!cp.mediaPlaying;
  }

  const data = await chrome.storage.local.get(['settings']);
  const settings = mergeSettings(data.settings || {});
  if (!settings.mediaAwareTracking) return cp;

  const restored = await restoreTrackingFromAudibleTabs();
  const keepAlive = restored || mediaPlaying || (await hasMediaOrAudibleKeepAlive());
  if (!keepAlive) return cp;

  isIdle = false;
  const lastFlush = cp?.lastFlushAt || null;
  if (memoryEmpty && lastFlush) {
    const gapMs = Date.now() - lastFlush;
    if (gapMs > 2000) {
      const creditMs = Math.min(gapMs, GAP_CREDIT_CAP_MS);
      activeStart = Date.now() - creditMs;
      await flush(true);
    }
  }
  return cp;
}

/** Alarm / sync path: hydrate → audible restore → clear idle if media → flush. */
async function flushWithMediaKeepAlive() {
  await rehydrateTrackingSession();
  await restoreTrackingFromAudibleTabs();
  const data = await chrome.storage.local.get(['settings']);
  const settings = mergeSettings(data.settings || {});
  if (settings.mediaAwareTracking && (mediaPlaying || (await hasMediaOrAudibleKeepAlive()))) {
    isIdle = false;
    await flush(true);
  } else {
    await flush();
  }
  await persistTrackingCheckpoint();
}

/** Merge in-progress session into today's data (live, not yet flushed). */
async function getTodayLive() {
  const data = await chrome.storage.local.get(['screentime', 'settings']);
  const settings = mergeSettings(data.settings || {});
  const st = data.screentime || {};
  const dk = todayKey();
  const today = JSON.parse(JSON.stringify(st[dk] || {}));

  if (!settings.ghostMode && !isIdle && activeUrl && activeStart) {
    const domain = getDomain(activeUrl);
    if (domain && !isIgnored(domain, settings)) {
      const duration = Math.max(0, Math.round((Date.now() - activeStart) / 1000));
      if (duration >= 1) {
        const category = categorize(domain, settings);
        const e = today[domain] || {
          totalTime: 0,
          visits: 0,
          category,
          title: activeTitle || domain,
          lastVisit: Date.now(),
        };
        e.totalTime += duration;
        e.category = category;
        e.title = activeTitle || domain;
        e.live = true;
        today[domain] = e;
      }
    }
  }

  return {
    data: today,
    live: {
      domain: getDomain(activeUrl),
      title: activeTitle,
      url: activeUrl,
      elapsed: activeStart && !isIdle ? Math.max(0, Math.round((Date.now() - activeStart) / 1000)) : 0,
      tracking: !!(activeUrl && activeStart && !isIdle && !settings.ghostMode),
      ghostMode: !!settings.ghostMode,
      idle: !!isIdle,
    },
  };
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 1,
    });
  } catch {}
}

function safeSendTab(tabId, payload) {
  try {
    chrome.tabs.sendMessage(tabId, payload, () => void chrome.runtime.lastError);
  } catch {}
}

/** tabs.update that ignores transient drag / invalidated races */
function safeTabsUpdate(tabId, props) {
  if (!tabId || !props) return Promise.resolve(false);
  try {
    return chrome.tabs.update(tabId, props).then(() => true).catch(err => {
      const m = String(err?.message || err || '');
      if (/cannot be edited|dragging|invalid|No tab/i.test(m)) return false;
      return false;
    });
  } catch {
    return Promise.resolve(false);
  }
}

function minutesUntilHour(hour) {
  const now = new Date();
  const t = new Date();
  t.setHours(hour, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return Math.max(1, (t - now) / 60000);
}

async function flush(force = false) {
  if (!activeUrl || !activeStart || (isIdle && !force)) return;
  const data = await chrome.storage.local.get(['screentime', 'heatmap', 'settings']);
  const settings = mergeSettings(data.settings || {});
  if (settings.ghostMode) {
    activeStart = Date.now();
    return;
  }

  const endMs = Date.now();
  const startMs = activeStart;
  const duration = Math.round((endMs - startMs) / 1000);
  if (duration < 2) {
    activeStart = Date.now();
    return;
  }
  const domain = getDomain(activeUrl);
  if (!domain || isIgnored(domain, settings)) {
    activeStart = Date.now();
    return;
  }
  const category = categorize(domain, settings);
  const st = data.screentime || {};
  const hm = data.heatmap || {};
  const countVisit = !sessionVisitCounted;
  sessionVisitCounted = true;

  // Split across logical day boundaries (midnight or dailyResetHour) so overnight
  // sessions don't dump all seconds into a single day key.
  let cursor = startMs;
  let crossedDay = false;
  while (cursor < endMs) {
    const boundary = nextDayBoundaryMs(cursor);
    const sliceEnd = Math.min(endMs, boundary);
    const secs = Math.max(0, Math.round((sliceEnd - cursor) / 1000));
    if (secs >= 1) {
      const dk = dayKeyFromMs(cursor);
      if (!st[dk]) st[dk] = {};
      const e = st[dk][domain] || {
        totalTime: 0,
        visits: 0,
        category,
        title: activeTitle || domain,
        lastVisit: Date.now(),
      };
      e.totalTime = (Number(e.totalTime) || 0) + secs;
      if (countVisit && dk === dayKeyFromMs(startMs)) e.visits = (Number(e.visits) || 0) + 1;
      e.title = activeTitle || domain;
      e.category = category;
      e.lastVisit = Date.now();
      st[dk][domain] = e;

      const hd = new Date(cursor);
      const hour = hd.getHours();
      const dow = hd.getDay();
      hm[`${dow}_${hour}`] = (hm[`${dow}_${hour}`] || 0) + secs;

      if (lastFlushDayKey && lastFlushDayKey !== dk) crossedDay = true;
      lastFlushDayKey = dk;
    }
    cursor = sliceEnd;
  }

  await chrome.storage.local.set({ screentime: st, heatmap: hm });

  // Quick session caps — accumulate use after cap starts
  const caps = { ...(settings.sessionCaps || {}) };
  let capsChanged = false;
  for (const [d, cap] of Object.entries(caps)) {
    if (!(domain === d || domain.endsWith('.' + d))) continue;
    if (!cap || !cap.limitMin) continue;
    const dk = todayKey();
    if (cap.dayKey && cap.dayKey !== dk) {
      caps[d] = { ...cap, usedSec: 0, dayKey: dk };
      capsChanged = true;
    }
    const next = { ...(caps[d] || cap), dayKey: dk, usedSec: (caps[d]?.usedSec || 0) + duration };
    caps[d] = next;
    capsChanged = true;
  }
  if (capsChanged) {
    settings.sessionCaps = caps;
    await chrome.storage.local.set({ settings });
  }

  // Guests: keep ~90 local days. Signed-in: never prune — cloud is forever source of truth.
  const { stt_user } = await chrome.storage.local.get(['stt_user']);
  if (!stt_user?.email) {
    const cutoff = dateKey(90);
    let pruned = false;
    for (const k of Object.keys(st)) {
      if (k < cutoff) {
        delete st[k];
        pruned = true;
      }
    }
    if (pruned) await chrome.storage.local.set({ screentime: st });
  }

  const todayBucket = st[todayKey()] || {};
  if (settings.notifications !== false) {
    await checkAlerts(todayBucket, category, settings);
    await checkSiteLimits(todayBucket, domain, settings);
    const usedNow = todayBucket?.[domain]?.totalTime || 0;
    if (usedNow >= 2 * 3600) await maybeDomainAward(domain, usedNow);
  }

  // Push live banner update to active tab
  if (activeTabId && settings.liveBanner !== false) {
    const limits = settings.siteLimits || {};
    let limitMin = null;
    for (const [d, m] of Object.entries(limits)) {
      if (domain === d || domain.endsWith('.' + d)) {
        limitMin = m;
        break;
      }
    }
    if (limitMin != null) {
      const used = todayBucket[domain]?.totalTime || 0;
      safeSendTab(activeTabId, {
        type: 'LIVE_BANNER',
        domain,
        used,
        limitSec: limitMin * 60,
      });
    }
  }

  await updateStreak(st, settings);
  activeStart = Date.now();
  await persistTrackingCheckpoint();
  scheduleCloudSyncAfterFlush({ force: crossedDay || duration >= 60 });
}

/** Signed-in: pull+merge+push automatically — no dashboard / tap required. */
let _autoSyncInFlight = null;
let _lastAutoSyncAt = 0;
async function autoCloudSync({ force = false } = {}) {
  const d = await chrome.storage.local.get(['settings', 'stt_user']);
  if (!d.stt_user?.email) return { skipped: true, reason: 'guest' };
  const now = Date.now();
  // Egress diet (2026-10-23): each sync downloads and re-uploads the user's data, and Supabase blocked the project for
  // going over the free egress quota. Background syncs now run at most every 15 min; a user action (force) still syncs
  // at once but never more than once a minute.
  if (now - _lastAutoSyncAt < (force ? 60_000 : 15 * 60_000)) return { skipped: true, reason: 'throttle' };
  if (_autoSyncInFlight) return _autoSyncInFlight;
  _autoSyncInFlight = (async () => {
    try {
      const { pullAndMergeCloud } = await import('./cloud.js');
      await pullAndMergeCloud().catch(() => {});
      const plan = await getEffectivePlan(mergeSettings(d.settings || {}), d.stt_user);
      const r = await pushFullSync({ full: canUse('cloudSync', plan) });
      _lastAutoSyncAt = Date.now();
      return r;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    } finally {
      _autoSyncInFlight = null;
    }
  })();
  return _autoSyncInFlight;
}

/** Debounced cloud sync after local flush — merge-before-push keeps Chrome/Brave aligned. */
function scheduleCloudSyncAfterFlush({ force = false } = {}) {
  clearTimeout(_syncAfterFlushTimer);
  const delay = force ? 600 : 4_000;
  _syncAfterFlushTimer = setTimeout(() => {
    autoCloudSync({ force }).catch(() => {});
  }, delay);
}

async function checkAlerts(todayData, category, settings) {
  const LIMITS = {
    social: (settings.socialLimit || 60) * 60,
    entertainment: (settings.entLimit || 120) * 60,
  };
  if (!LIMITS[category]) return;
  const catTotal = Object.values(todayData)
    .filter(e => e.category === category)
    .reduce((s, e) => s + e.totalTime, 0);
  if (catTotal < LIMITS[category]) return;
  const key = `alert_${category}_${todayKey()}`;
  const prev = await chrome.storage.local.get([key]);
  if (prev[key]) return;
  await chrome.storage.local.set({ [key]: true });
  notify('Screen Time Tracker', `You've spent ${Math.round(catTotal / 60)}min on ${category} today!`);
}

async function checkSiteLimits(todayData, domain, settings) {
  const limits = settings.siteLimits || {};
  let match = null;
  let limitMin = null;
  for (const [d, m] of Object.entries(limits)) {
    if (domain === d || domain.endsWith('.' + d)) {
      match = d;
      limitMin = m;
      break;
    }
  }
  if (!match || !limitMin) return;
  const used = todayData[domain]?.totalTime || 0;
  const limitSec = limitMin * 60;
  const remindAt = Math.min(95, Math.max(50, Number(settings.overUseRemindAt) || 80)) / 100;
  if (used >= limitSec * remindAt && used < limitSec) {
    const softKey = `limit_soft_${domain}_${todayKey()}`;
    const softPrev = await chrome.storage.local.get([softKey]);
    if (!softPrev[softKey]) {
      await chrome.storage.local.set({ [softKey]: true });
      notify('Almost at your limit', `${domain} is at ${Math.round((used / limitSec) * 100)}% of today's cap.`);
    }
  }
  if (used < limitSec) return;
  const key = `limit_warn_${domain}_${todayKey()}`;
  const prev = await chrome.storage.local.get([key]);
  if (prev[key]) return;
  await chrome.storage.local.set({ [key]: true });
  notify('Limit reached', `${domain} hit ${limitMin}m. +5 min grace available once.`);
  await maybeDomainAward(domain, used);
}

async function updateStreak(st, settings) {
  const dk = todayKey();
  const day = st[dk] || {};
  let prod = 0;
  let social = 0;
  let ent = 0;
  let total = 0;
  for (const e of Object.values(day)) {
    const t = Number(e.totalTime) || 0;
    total += t;
    if (['productivity', 'coding', 'education'].includes(e.category)) prod += t;
    if (e.category === 'social') social += t;
    if (e.category === 'entertainment') ent += t;
  }
  if (total <= 0) return;

  // Align with Goals UI keys; keep legacy settings.goals.* as fallback only.
  const goals = settings.goals || {};
  const focusGoalMins = Number(settings.focusGoalMins ?? goals.minProdMin) || 120;
  const socialMax = Number(settings.socialLimit ?? goals.maxSocialMin) || 60;
  const entMax = Number(settings.entLimit) || 120;

  const focusHit = prod >= focusGoalMins * 60;
  const limitOk = social <= socialMax * 60 && ent <= entMax * 60;
  const scoreOk = calcScore(day) >= SCORE_STREAK_MIN;
  // Overall streak = focus goal hit + under social/entertainment budgets
  const goodDay = focusHit && limitOk;

  const streaks = {
    current: 0,
    best: 0,
    lastDate: null,
    focusDays: 0,
    limitOkDays: 0,
    scoreDays: 0,
    focusLastDate: null,
    limitLastDate: null,
    scoreLastDate: null,
    ...(settings.streaks || {}),
  };
  streaks.current = Number(streaks.current) || 0;
  streaks.best = Number(streaks.best) || 0;
  streaks.focusDays = Number(streaks.focusDays) || 0;
  streaks.limitOkDays = Number(streaks.limitOkDays) || 0;
  streaks.scoreDays = Number(streaks.scoreDays) || 0;

  const yesterday = dateKey(1);
  let changed = false;

  if (goodDay && streaks.lastDate !== dk) {
    streaks.current = streaks.lastDate === yesterday ? streaks.current + 1 : 1;
    streaks.best = Math.max(streaks.best, streaks.current);
    streaks.lastDate = dk;
    changed = true;
  }

  if (bumpDayStreak(streaks, 'focusDays', 'focusLastDate', focusHit, dk, yesterday)) changed = true;
  if (bumpDayStreak(streaks, 'limitOkDays', 'limitLastDate', limitOk, dk, yesterday)) changed = true;
  if (bumpDayStreak(streaks, 'scoreDays', 'scoreLastDate', scoreOk, dk, yesterday)) changed = true;

  if (!changed) return;
  settings.streaks = streaks;
  await chrome.storage.local.set({ settings });
}

async function checkBlock(url) {
  if (!url || !activeTabId) return;
  const data = await chrome.storage.local.get(['settings', 'screentime', 'stt_user']);
  const s = mergeSettings(data.settings || {});
  const plan = await getEffectivePlan(s, data.stt_user);
  const domain = getDomain(url);
  if (!domain) return;

  // Keyword block — URL + title (body via content script KEYWORD_HIT)
  const keywords = s.keywordBlock || [];
  if (canUse('keywordBlock', plan) && keywords.length) {
    const title = (activeTitle || '').toLowerCase();
    const urlL = (url || '').toLowerCase();
    for (const raw of keywords) {
      const item = typeof raw === 'string' ? { term: raw, matchUrl: true, matchTitle: true } : raw;
      const term = String(item.term || '').toLowerCase().trim();
      if (!term) continue;
      const hit =
        (item.matchTitle !== false && title.includes(term)) ||
        (item.matchUrl !== false && urlL.includes(term));
      if (hit) {
        safeTabsUpdate(activeTabId, {
          url: blockRedirectUrl(s, domain, 'keyword', '&kw=' + encodeURIComponent(term)),
        });
        return;
      }
    }
  }

  // Path / partial URL patterns (enhanced block granularity)
  const patterns = s.blockedPatterns || [];
  if (patterns.length) {
    for (const pat of patterns) {
      if (urlMatchesPattern(url, pat)) {
        safeTabsUpdate(activeTabId, {
          url: blockRedirectUrl(s, domain, 'pattern'),
        });
        return;
      }
    }
  }

  // Whitelist / allow-only (Pro)
  if (canUse('whitelist', plan) && s.whitelistMode) {
    const allow = s.whitelistSites || [];
    const ok = allow.some(b => domain === b || domain.endsWith('.' + b));
    if (!ok) {
      safeTabsUpdate(activeTabId, {
        url: blockRedirectUrl(s, domain, 'whitelist'),
      });
      return;
    }
  }

  const nuclear = canUse('nuclear', plan) && nuclearActive(s);
  const hard = canUse('hardLock', plan) && hardLockActive(s);
  const focusOn = (s.focusMode && scheduleActive(s)) || nuclear || hard;
  const blocked = s.blockedSites || [];
  const isBlockedSite = blocked.some(b => domain === b || domain.endsWith('.' + b));

  const today = (data.screentime || {})[todayKey()] || {};
  const limits = s.siteLimits || {};
  let overLimit = false;
  let limitMin = 0;
  const graceUntil = (s.graceUntil || {})[domain] || 0;
  if (graceUntil <= Date.now()) {
    for (const [d, m] of Object.entries(limits)) {
      if ((domain === d || domain.endsWith('.' + d)) && (today[domain]?.totalTime || 0) >= m * 60) {
        overLimit = true;
        limitMin = m;
        break;
      }
    }
    // Quick session caps
    if (!overLimit) {
      const caps = s.sessionCaps || {};
      for (const [d, cap] of Object.entries(caps)) {
        if (!(domain === d || domain.endsWith('.' + d))) continue;
        if (!cap?.limitMin) continue;
        const used = cap.dayKey === todayKey() ? (cap.usedSec || 0) : 0;
        if (used >= cap.limitMin * 60) {
          overLimit = true;
          limitMin = cap.limitMin;
          break;
        }
      }
    }
    // Category budgets (Pro)
    if (!overLimit && canUse('categoryBudgets', plan)) {
      const budgets = s.categoryBudgets || {};
      const cat = categorize(domain, s);
      if (budgets[cat]) {
        let used = 0;
        for (const e of Object.values(today)) {
          if (e.category === cat) used += e.totalTime;
        }
        if (used >= budgets[cat] * 60) {
          overLimit = true;
          limitMin = budgets[cat];
        }
      }
    }
  }

  if ((focusOn && isBlockedSite) || overLimit) {
    if (overLimit) {
      s.limitHitCount = (s.limitHitCount || 0) + 1;
      await chrome.storage.local.set({ settings: s });
    }
    const reason = overLimit ? `limit:${limitMin}` : hard || nuclear ? 'nuclear' : 'focus';
    safeTabsUpdate(activeTabId, {
      url: blockRedirectUrl(s, domain, reason),
    });
  }
}

async function scheduleReportAlarms() {
  try {
    await chrome.alarms.clear('daily-report');
    await chrome.alarms.clear('weekly-report');
    await chrome.alarms.clear('daily-summary-notify');
    const data = await chrome.storage.local.get(['settings']);
    const s = mergeSettings(data.settings || {});
    const er = s.emailReports || {};
    // Chrome forbids combining `when` + `periodInMinutes` — use delayInMinutes
    if (er.daily !== false) {
      const delay = minutesUntilHour(er.dailyHour ?? 21);
      chrome.alarms.create('daily-report', { delayInMinutes: delay, periodInMinutes: 24 * 60 });
      chrome.alarms.create('daily-summary-notify', {
        delayInMinutes: delay,
        periodInMinutes: 24 * 60,
      });
    }
    if (er.weekly !== false) {
      chrome.alarms.create('weekly-report', {
        delayInMinutes: minutesUntilHour(er.weeklyHour ?? 9),
        periodInMinutes: 24 * 60,
      });
    }
  } catch (e) {
    log.warn('scheduleReportAlarms', e);
  }
}

async function sendDailySummaryNotification() {
  const d = await chrome.storage.local.get(['screentime']);
  const today = (d.screentime || {})[todayKey()] || {};
  let total = 0;
  for (const e of Object.values(today)) total += e.totalTime;
  notify(
    'Daily Screen Time Summary',
    `You spent ${Math.round(total / 60)} minutes browsing today across ${Object.keys(today).length} sites.`
  );
}

try {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await flush();
    try {
      const t = await chrome.tabs.get(tabId);
      activeTabId = tabId;
      activeUrl = t.url;
      activeTitle = t.title;
      activeStart = Date.now();
      sessionVisitCounted = false;
      await checkBlock(t.url);
    } catch {}
  });

  chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (tabId !== activeTabId || info.status !== 'complete') return;
    const prevDomain = getDomain(activeUrl);
    const nextDomain = getDomain(tab.url);
    await flush();
    activeUrl = tab.url;
    activeTitle = tab.title;
    activeStart = Date.now();
    if (prevDomain !== nextDomain) sessionVisitCounted = false;
    await checkBlock(tab.url);
  });

  // Paid handoff: only after success page verifies (verified=1 / handoff=1), or recover invalid://
  const _paidHandoff = new Set();

  function isVerifiedHandoffUrl(u) {
    const x = String(u || '');
    if (!x) return false;
    if (/^chrome-extension:\/\/invalid\//i.test(x)) return true;
    const onSite =
      /screen-time-tracker.*\.vercel\.app/i.test(x) ||
      /localhost(?::\d+)?/i.test(x);
    if (!onSite) return false;
    // Do NOT handoff on bare /success.html — page must finish provider verify first
    return (
      (/\/success\.html/i.test(x) && /[?&](verified|handoff)=1/i.test(x)) ||
      /[?&]sim=1/i.test(x)
    );
  }

  function dashboardProUrl() {
    try {
      const u = chrome.runtime.getURL('pages/dashboard.html') + '#pro';
      if (!u || /:\/\/invalid\//i.test(u)) return null;
      return u;
    } catch {
      return null;
    }
  }

  async function handoffPaidTab(tabId, { forceOpen = true } = {}) {
    if (!tabId || _paidHandoff.has(tabId)) return false;
    _paidHandoff.add(tabId);
    setTimeout(() => _paidHandoff.delete(tabId), 90_000);
    try {
      await refreshEntitlement({ force: true });
      const d = await chrome.storage.local.get(['settings', 'stt_user']);
      const plan = await getEffectivePlan(mergeSettings(d.settings || {}), d.stt_user);
      const { settings: capped } = enforceFreeCaps(mergeSettings(d.settings || {}), plan);
      await chrome.storage.local.set({ settings: capped });
      if (!forceOpen) return true;
      const dash = dashboardProUrl();
      if (!dash) return false;
      await chrome.tabs.update(tabId, { url: dash, active: true });
      return true;
    } catch (e) {
      _paidHandoff.delete(tabId);
      log.warn('[STT] paid handoff', e.message);
      return false;
    }
  }

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    const u = info.url || (info.status === 'loading' || info.status === 'complete' ? tab?.url : null);
    if (!u || !isVerifiedHandoffUrl(u)) return;
    handoffPaidTab(tabId).catch(() => {});
  });

  // Website → extension handoff (never navigate chrome-extension:// from the web — Chrome blocks it)
  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    const origin = String(sender?.url || sender?.origin || '');
    const allowed =
      /screen-time-tracker.*\.vercel\.app/i.test(origin) ||
      /^https:\/\/[^/]+\.vercel\.app/i.test(origin) ||
      /^http:\/\/localhost(?::\d+)?\//i.test(origin);
    if (!allowed) {
      sendResponse({ ok: false, error: 'origin_denied' });
      return false;
    }
    (async () => {
      try {
        if (msg?.type === 'STT_CHECKOUT_SUCCESS' || msg?.type === 'STT_OPEN_DASHBOARD') {
          const shouldOpen =
            msg.type === 'STT_OPEN_DASHBOARD' || msg.open === true || msg.replaceTab === true;
          if (shouldOpen && sender.tab?.id) {
            const ok = await handoffPaidTab(sender.tab.id, { forceOpen: true });
            sendResponse({ ok, opened: ok, via: 'tab-update' });
            return;
          }
          if (msg.type === 'STT_CHECKOUT_SUCCESS' || msg.refresh) {
            try {
              await refreshEntitlement({ force: true });
            } catch {}
          }
          if (shouldOpen) {
            const dash = dashboardProUrl();
            if (dash) {
              await chrome.tabs.create({ url: dash, active: true });
              sendResponse({ ok: true, opened: true, via: 'tab-create' });
              return;
            }
          }
          sendResponse({ ok: true, opened: false });
          return;
        }
        sendResponse({ ok: false, error: 'unknown' });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'failed' });
      }
    })();
    return true;
  });

  chrome.tabs.onRemoved.addListener(async tabId => {
    if (tabId === activeTabId) {
      await flush(true);
      activeTabId = null;
      activeUrl = null;
      activeStart = null;
    }
  });

  chrome.windows.onFocusChanged.addListener(async wId => {
    if (wId === chrome.windows.WINDOW_ID_NONE) {
      const d = await chrome.storage.local.get(['settings']);
      const s = mergeSettings(d.settings || {});
      // Keep tracking when media/audible — do not force idle on focus loss
      if (s.mediaAwareTracking && (mediaPlaying || (await hasMediaOrAudibleKeepAlive()))) {
        await persistTrackingCheckpoint();
        return;
      }
      await flush(true);
      isIdle = true;
      await persistTrackingCheckpoint();
      // Push what this browser tracked before losing focus
      scheduleCloudSyncAfterFlush({ force: true });
    } else {
      isIdle = false;
      activeStart = Date.now();
      // Same continuous session — do not inflate visits
      try {
        const [t] = await chrome.tabs.query({ active: true, windowId: wId });
        if (t) {
          activeTabId = t.id;
          activeUrl = t.url;
          activeTitle = t.title;
        }
      } catch {}
      await persistTrackingCheckpoint();
      // Pull other browsers' totals as soon as this window is used
      autoCloudSync({ force: false }).catch(() => {});
    }
  });

  chrome.idle.setDetectionInterval(IDLE_SEC);
  chrome.idle.onStateChanged.addListener(async state => {
    if (state === 'idle' || state === 'locked') {
      const d = await chrome.storage.local.get(['settings']);
      const s = mergeSettings(d.settings || {});
      // Media-aware: keep tracking for both idle AND locked when media/audible
      if (s.mediaAwareTracking && (mediaPlaying || (await hasMediaOrAudibleKeepAlive()))) {
        isIdle = false;
        await persistTrackingCheckpoint();
        return;
      }
      await flush(true);
      isIdle = true;
      await persistTrackingCheckpoint();
    } else {
      isIdle = false;
      activeStart = Date.now();
      await persistTrackingCheckpoint();
    }
  });

  chrome.alarms.create('flush', { periodInMinutes: 1 });
  chrome.alarms.create('stt-entitlement-daily', { periodInMinutes: 12 * 60 });
  chrome.alarms.create('stt-feature-nudge', { periodInMinutes: 24 * 60 });
  chrome.alarms.create('stt-guest-score', { periodInMinutes: 180 });
  // Auto cross-browser sync every minute while signed in (no dashboard open needed)
  chrome.alarms.create('stt-light-sync', { periodInMinutes: 15 });
  chrome.alarms.create('stt-token-refresh', { periodInMinutes: 25 });
  chrome.alarms.onAlarm.addListener(async a => {
    try {
      if (a.name === 'flush') return flushWithMediaKeepAlive();
      if (a.name === 'stt-token-refresh') {
        try {
          const { ensureCloudSession } = await import('./cloud.js');
          if (typeof ensureCloudSession === 'function') await ensureCloudSession();
        } catch {}
        return;
      }
      if (a.name === 'stt-revalidate-entitlement' || a.name === 'stt-revalidate-entitlement-2' || a.name === 'stt-revalidate-entitlement-3' || a.name === 'stt-entitlement-daily') {
        const ent = await refreshEntitlement({ force: a.name !== 'stt-entitlement-daily' });
        const d = await chrome.storage.local.get(['settings', 'stt_user']);
        const plan = await getEffectivePlan(mergeSettings(d.settings || {}), d.stt_user);
        const { settings: capped } = enforceFreeCaps(mergeSettings(d.settings || {}), plan);
        if (JSON.stringify(capped) !== JSON.stringify(mergeSettings(d.settings || {}))) {
          await chrome.storage.local.set({ settings: capped });
        }
        return ent;
      }
      if (a.name === 'stt-feature-nudge') {
        const d = await chrome.storage.local.get(['settings', 'stt_user']);
        const s = mergeSettings(d.settings || {});
        const plan = await getEffectivePlan(s, d.stt_user);
        return runFeatureNudges(s, isPro(plan));
      }
      if (a.name === 'stt-guest-score') {
        const d = await chrome.storage.local.get(['screentime', 'stt_user']);
        if (d.stt_user?.email) return;
        const today = (d.screentime || {})[dateKey(0)] || {};
        const sum = summarizeDay(today);
        const top = (sum.top_sites || [])[0];
        return publishGuestScore({
          ...sum,
          top_domain: top?.domain || null,
          top_domain_sec: top?.sec || 0,
        });
      }
      if (a.name === 'stt-light-sync') {
        await flush(true);
        await persistTrackingCheckpoint();
        return autoCloudSync();   // background: the 15-minute throttle applies
      }
      if (a.name === 'daily-summary-notify') return sendDailySummaryNotification();
      if (a.name === 'daily-report') {
        await chrome.storage.local.set({ pendingReport: { type: 'daily', at: Date.now() } });
        notify('Daily report ready', 'Open Screen Time Tracker to email or download your PDF summary.');
      }
      if (a.name === 'weekly-report') {
        const data = await chrome.storage.local.get(['settings']);
        const s = mergeSettings(data.settings || {});
        const want = s.emailReports?.weeklyDay ?? 1;
        if (new Date().getDay() !== want) return;
        await chrome.storage.local.set({ pendingReport: { type: 'weekly', at: Date.now() } });
        notify('Weekly report ready', 'Open the extension to email your weekly PDF summary.');
      }
    } catch (e) {
      log.warn('alarm handler', e);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === 'FLUSH') {
          await flush(true);
          await persistTrackingCheckpoint();
          sendResponse({ ok: true });
        } else if (msg.type === 'GET_TODAY') {
          await hydrateActiveTab();
          await restoreTrackingFromAudibleTabs();
          // Persist current slice often so live time is durable
          await flush();
          await persistTrackingCheckpoint();
          const live = await getTodayLive();
          sendResponse({ data: live.data, live: live.live });
        } else if (msg.type === 'GET_LIVE') {
          await hydrateActiveTab();
          await restoreTrackingFromAudibleTabs();
          const live = await getTodayLive();
          sendResponse(live);
        } else if (msg.type === 'GET_RANGE') {
          const d = await chrome.storage.local.get(['screentime', 'settings', 'stt_user']);
          const plan = await getEffectivePlan(mergeSettings(d.settings || {}), d.stt_user);
          const maxDays = historyDaysForPlan(plan);
          const days = Math.min(Number(msg.days) || 7, maxDays);
          const st = d.screentime || {};
          const r = {};
          for (let i = 0; i < days; i++) {
            const k = dateKey(i);
            if (st[k]) r[k] = st[k];
          }
          sendResponse({ data: r, cappedTo: maxDays, plan });
        } else if (msg.type === 'GET_HEATMAP') {
          const d = await chrome.storage.local.get(['heatmap']);
          sendResponse({ data: d.heatmap || {} });
        } else if (msg.type === 'GET_SETTINGS') {
          const d = await chrome.storage.local.get(['settings']);
          sendResponse({ settings: mergeSettings(d.settings || {}) });
        } else if (msg.type === 'SAVE_SETTINGS') {
          const d = await chrome.storage.local.get(['stt_user']);
          const plan = await getEffectivePlan(mergeSettings(msg.settings || {}), d.stt_user);
          const { settings: capped, violations } = enforceFreeCaps(mergeSettings(msg.settings || {}), plan);
          await chrome.storage.local.set({ settings: capped });
          await scheduleReportAlarms();
          // newTabDashboard setting is retained for storage compat only — no chrome_url_overrides / New Tab page.
          chrome.tabs.query({}, tabs => {
            for (const t of tabs || []) {
              if (t.id) safeSendTab(t.id, { type: 'SETTINGS_UPDATED', settings: capped });
            }
          });
          if (canUse('cloudSync', plan)) {
            pushFullSync({ full: true }).catch(() => syncSettingsToCloud(capped).catch(() => {}));
          } else if (d.stt_user?.email) {
            pushFullSync({ full: false }).catch(() => {});
          }
          sendResponse({ ok: true, violations, plan });
        } else if (msg.type === 'CLOUD_SYNC_NOW') {
          try {
            await flush(true);
            await persistTrackingCheckpoint();
            const d = await chrome.storage.local.get(['settings', 'stt_user']);
            const plan = await getEffectivePlan(mergeSettings(d.settings || {}), d.stt_user);
            const r = await pushFullSync({ full: canUse('cloudSync', plan) });
            sendResponse(r);
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
        } else if (msg.type === 'CLOUD_PULL') {
          try {
            const r = await autoCloudSync({ force: true });
            sendResponse(r);
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
        } else if (msg.type === 'CLOUD_SYNC') {
          try {
            const r = await autoCloudSync({ force: !!msg.force });
            sendResponse(r);
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
        } else if (msg.type === 'PUBLISH_GUEST_SCORE') {
          try {
            await getOrCreateGuest();
            const d = await chrome.storage.local.get(['screentime']);
            const today = (d.screentime || {})[dateKey(0)] || {};
            const sum = summarizeDay(today);
            const top = (sum.top_sites || [])[0];
            const r = await publishGuestScore({
              ...sum,
              top_domain: top?.domain || null,
              top_domain_sec: top?.sec || 0,
            });
            sendResponse(r);
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
        } else if (msg.type === 'IMPORT_BACKUP') {
          const payload = msg.payload || {};
          const d = await chrome.storage.local.get(['settings', 'stt_user', 'screentime', 'heatmap', 'tasks']);
          const plan = await getEffectivePlan(mergeSettings(d.settings || {}), d.stt_user);
          const next = {};
          if (payload.settings) {
            const { settings: capped } = enforceFreeCaps(mergeSettings({ ...d.settings, ...payload.settings }), plan);
            next.settings = capped;
          }
          if (payload.screentime && typeof payload.screentime === 'object') next.screentime = payload.screentime;
          if (payload.heatmap && typeof payload.heatmap === 'object') next.heatmap = payload.heatmap;
          if (Array.isArray(payload.tasks)) next.tasks = payload.tasks;
          await chrome.storage.local.set(next);
          sendResponse({ ok: true });
        } else if (msg.type === 'GET_PLAN') {
          // Soft revalidate (respects short Free / long Pro cache). force=true after checkout.
          const d0 = await chrome.storage.local.get(['settings', 'stt_user', 'stt_entitlement']);
          if (d0.stt_user?.email) {
            try {
              await refreshEntitlement({ force: !!msg.force });
            } catch {}
          }
          const d = await chrome.storage.local.get(['settings', 'stt_user', 'stt_entitlement']);
          const settings = mergeSettings(d.settings || {});
          const plan = await getEffectivePlan(settings, d.stt_user);
          const cache = d.stt_entitlement || settings.entitlementCache || {};
          sendResponse({
            plan,
            isPro: isPro(plan),
            historyDays: historyDaysForPlan(plan),
            expiresAt: cache.expiresAt ?? null,
            cycle: cache.cycle || null,
            provider: cache.provider || null,
            guest: !d.stt_user?.email,
          });
        } else if (msg.type === 'DELETE_ACCOUNT') {
          try {
            const { deleteAccountCloud, signOutCloud } = await import('./cloud.js');
            const r = await deleteAccountCloud({ confirm: msg.confirm !== false });
            await signOutCloud();
            sendResponse({ ok: true, ...r });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
        } else if (msg.type === 'REFRESH_ENTITLEMENT') {
          const ent = await refreshEntitlement({ force: !!msg.force });
          sendResponse({ ok: true, ...ent });
        } else if (msg.type === 'START_CHECKOUT') {
          const r = await createCheckout({
            cycle: msg.cycle || 'yearly',
            provider: msg.provider || 'paypal',
            currency: msg.currency,
          });
          sendResponse(r);
        } else if (msg.type === 'MEDIA_STATE') {
          const wasPlaying = _prevMediaPlaying;
          mediaPlaying = !!msg.playing;
          _prevMediaPlaying = mediaPlaying;
          if (mediaPlaying) isIdle = false;
          await persistTrackingCheckpoint();
          // Nudge sync soon after a media session ends so cloud mirrors accurate local totals
          if (wasPlaying && !mediaPlaying) {
            try {
              await flush(true);
              const d = await chrome.storage.local.get(['settings', 'stt_user']);
              if (d.stt_user?.email) {
                const plan = await getEffectivePlan(mergeSettings(d.settings || {}), d.stt_user);
                pushFullSync({ full: canUse('cloudSync', plan) }).catch(() => {});
              }
            } catch {}
          }
          sendResponse({ ok: true });
        } else if (msg.type === 'KEYWORD_HIT') {
          const domain = msg.domain || getDomain(activeUrl);
          if (domain && activeTabId) {
            const d = await chrome.storage.local.get(['settings']);
            const s = mergeSettings(d.settings || {});
            safeTabsUpdate(activeTabId, {
              url: blockRedirectUrl(s, domain, 'keyword', '&kw=' + encodeURIComponent(msg.kw || '')),
            });
          }
          sendResponse({ ok: true });
        } else if (msg.type === 'START_HARD_LOCK') {
          const d = await chrome.storage.local.get(['settings', 'stt_user']);
          const settings = mergeSettings(d.settings || {});
          const plan = await getEffectivePlan(settings, d.stt_user);
          if (!canUse('hardLock', plan)) {
            sendResponse({ ok: false, error: 'pro_required' });
            return;
          }
          const minutes = Math.max(15, Math.min(480, Number(msg.minutes) || 60));
          settings.hardLock = {
            enabled: true,
            until: Date.now() + minutes * 60 * 1000,
            challenge: true,
            delaySec: Number(msg.delaySec) || 30,
          };
          settings.focusMode = true;
          settings.nuclearUntil = settings.hardLock.until;
          await chrome.storage.local.set({ settings });
          sendResponse({ ok: true, until: settings.hardLock.until });
        } else if (msg.type === 'APPLY_FOCUS_PROFILE') {
          const d = await chrome.storage.local.get(['settings', 'stt_user']);
          const settings = mergeSettings(d.settings || {});
          const plan = await getEffectivePlan(settings, d.stt_user);
          const id = msg.profileId || 'deep';
          if (id !== 'deep' && !canUse('focusProfilesExtra', plan)) {
            sendResponse({ ok: false, error: 'pro_required' });
            return;
          }
          const preset = settings.focusProfiles?.presets?.[id];
          if (!preset) {
            sendResponse({ ok: false, error: 'unknown_profile' });
            return;
          }
          settings.focusProfiles.active = id;
          settings.blockedSites = [...(preset.blocked || [])];
          settings.focusMode = true;
          const { settings: capped } = enforceFreeCaps(settings, plan);
          await chrome.storage.local.set({ settings: capped });
          sendResponse({ ok: true, settings: capped });
        } else if (msg.type === 'GET_USER') {
          const d = await chrome.storage.local.get(['stt_user']);
          sendResponse({ user: d.stt_user || null });
        } else if (msg.type === 'SET_USER') {
          await chrome.storage.local.set({ stt_user: msg.user });
          await refreshEntitlement({ force: true }).catch(() => {});
          sendResponse({ ok: true });
        } else if (msg.type === 'LOGOUT') {
          await chrome.storage.local.remove(['stt_user', 'supabaseSession']);
          await clearEntitlementOnLogout();
          sendResponse({ ok: true });
        } else if (msg.type === 'GET_TASKS') {
          const d = await chrome.storage.local.get(['tasks']);
          sendResponse({ tasks: d.tasks || [] });
        } else if (msg.type === 'SAVE_TASKS') {
          await chrome.storage.local.set({ tasks: msg.tasks });
          sendResponse({ ok: true });
        } else if (msg.type === 'CLEAR_TODAY') {
          const d = await chrome.storage.local.get(['screentime']);
          const st = d.screentime || {};
          delete st[todayKey()];
          await chrome.storage.local.set({ screentime: st });
          sendResponse({ ok: true });
        } else if (msg.type === 'START_NUCLEAR') {
          const d = await chrome.storage.local.get(['settings', 'stt_user']);
          const settings = mergeSettings(d.settings || {});
          const plan = await getEffectivePlan(settings, d.stt_user);
          if (!canUse('nuclear', plan)) {
            sendResponse({ ok: false, error: 'pro_required' });
            return;
          }
          const hours = Math.max(1, Math.min(12, Number(msg.hours) || 2));
          settings.nuclearUntil = Date.now() + hours * 3600 * 1000;
          settings.focusMode = true;
          settings.hardLock = {
            ...(settings.hardLock || {}),
            enabled: true,
            until: settings.nuclearUntil,
            challenge: true,
            delaySec: 30,
          };
          await chrome.storage.local.set({ settings });
          sendResponse({ ok: true, until: settings.nuclearUntil });
        } else if (msg.type === 'USE_GRACE') {
          const d = await chrome.storage.local.get(['settings']);
          const settings = mergeSettings(d.settings || {});
          const key = `${msg.domain}_${todayKey()}`;
          if ((settings.graceUsed || {})[key]) {
            sendResponse({ ok: false, error: 'Grace already used today' });
            return;
          }
          settings.graceUsed = { ...(settings.graceUsed || {}), [key]: true };
          settings.graceUntil = {
            ...(settings.graceUntil || {}),
            [msg.domain]: Date.now() + 5 * 60 * 1000,
          };
          await chrome.storage.local.set({ settings });
          sendResponse({ ok: true, until: settings.graceUntil[msg.domain] });
        } else if (msg.type === 'GET_OPEN_TABS') {
          const tabs = await chrome.tabs.query({});
          sendResponse({
            tabs: tabs
              .filter(t => t.url && !t.url.startsWith('chrome'))
              .map(t => ({ id: t.id, title: t.title, url: t.url, domain: getDomain(t.url) })),
          });
        } else if (msg.type === 'CLOSE_TAB') {
          try {
            await chrome.tabs.remove(msg.tabId);
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
        } else if (msg.type === 'GET_PENDING_REPORT') {
          const d = await chrome.storage.local.get(['pendingReport']);
          sendResponse({ pending: d.pendingReport || null });
        } else if (msg.type === 'CLEAR_PENDING_REPORT') {
          await chrome.storage.local.remove(['pendingReport']);
          sendResponse({ ok: true });
        } else if (msg.type === 'GET_ACTIVE_INFO') {
          sendResponse({
            domain: getDomain(activeUrl),
            title: activeTitle,
            url: activeUrl,
          });
        } else {
          sendResponse({ ok: false, error: 'unknown' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  });

  chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    try {
      // Retire Digital Pet storage on update/install
      await chrome.storage.local.remove(['stt_pet', 'stt_pet_desktop', 'stt_pet_desktop_view']).catch(() => {});
      if (reason === 'install') {
        await chrome.storage.local.set({ settings: CONFIG.DEFAULT_SETTINGS });
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html') });
      }
      await scheduleReportAlarms();
      // Recreate 1-min sync alarm after update
      chrome.alarms.create('stt-light-sync', { periodInMinutes: 15 });
      autoCloudSync({ force: true }).catch(() => {});
    } catch (e) {
      log.warn('onInstalled', e);
    }
  });

  chrome.runtime.onStartup.addListener(() => {
    rehydrateTrackingSession().catch(() => hydrateActiveTab().catch(() => {}));
    scheduleReportAlarms().catch(() => {});
    // Browser launch → sync immediately (Chrome + Brave, same email)
    autoCloudSync({ force: true }).catch(() => {});
  });

  rehydrateTrackingSession().catch(() => hydrateActiveTab().catch(() => {}));
  scheduleReportAlarms().catch(() => {});
  // Service worker wake → keep cloud totals current without opening UI
  autoCloudSync({ force: false }).catch(() => {});
} catch (e) {
  log.error('Screen Time Tracker SW init failed', e);
}
