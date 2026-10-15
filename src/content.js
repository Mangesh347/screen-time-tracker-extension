// Screen Time Tracker — Content Script v4
// activity + deep cleaner + keyword body scan + live banner + focus tint

let _tornDown = false;
const _intervals = [];
const _timeouts = [];
const _docListeners = [];

/** True while this content-script instance can still talk to the extension. */
function extAlive() {
  if (_tornDown) return false;
  try {
    // Accessing .id throws when the extension was reloaded and this script is orphaned
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

/**
 * sendMessage that never surfaces "Extension context invalidated".
 * MV3 sendMessage returns a Promise even when a callback is passed — that Promise
 * must be caught or Chrome logs Uncaught Error at the sendMessage call site.
 */
function sendRuntime(msg) {
  if (!extAlive()) {
    teardownContentScript();
    return Promise.resolve(null);
  }
  let settled = false;
  const finish = value => {
    if (settled) return value;
    settled = true;
    return value;
  };
  return new Promise(resolve => {
    let maybePromise;
    try {
      // Callback consumes lastError; returned Promise must also be caught (dual API).
      maybePromise = chrome.runtime.sendMessage(msg, response => {
        try {
          const err = chrome.runtime.lastError;
          if (err) {
            const m = String(err.message || '');
            if (/invalidated|extension context/i.test(m)) teardownContentScript();
            resolve(finish(null));
            return;
          }
          resolve(finish(response ?? null));
        } catch {
          teardownContentScript();
          resolve(finish(null));
        }
      });
    } catch {
      teardownContentScript();
      resolve(finish(null));
      return;
    }
    // Critical: swallow the Promise Chrome also returns alongside the callback
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(
        response => resolve(finish(response ?? null)),
        err => {
          const m = String(err?.message || err || '');
          if (/invalidated|extension context/i.test(m)) teardownContentScript();
          resolve(finish(null));
        },
      );
    }
  });
}

function trackInterval(fn, ms) {
  const id = setInterval(() => {
    if (!extAlive()) {
      teardownContentScript();
      return;
    }
    try { fn(); } catch {}
  }, ms);
  _intervals.push(id);
  return id;
}

function trackTimeout(fn, ms) {
  const id = setTimeout(() => {
    if (!extAlive()) return;
    try { fn(); } catch {}
  }, ms);
  _timeouts.push(id);
  return id;
}

function onDoc(type, handler, opts) {
  document.addEventListener(type, handler, opts);
  _docListeners.push({ type, handler, opts });
}

function teardownContentScript() {
  if (_tornDown) return;
  _tornDown = true;
  for (const id of _intervals) clearInterval(id);
  for (const id of _timeouts) clearTimeout(id);
  _intervals.length = 0;
  _timeouts.length = 0;
  try { clearTimeout(t); } catch {}
  for (const { type, handler, opts } of _docListeners) {
    try { document.removeEventListener(type, handler, opts); } catch {}
  }
  _docListeners.length = 0;
}

let t = null;
const onActivity = () => {
  if (!extAlive()) {
    teardownContentScript();
    return;
  }
  clearTimeout(t);
  t = setTimeout(() => sendRuntime({ type: 'FLUSH' }), 5000);
};
const evs = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
evs.forEach(e => onDoc(e, onActivity, { passive: true }));

function isMediaActivelyPlaying() {
  try {
    return [...document.querySelectorAll('video, audio')].some(
      m => !m.paused && m.readyState > 2
    );
  } catch {
    return false;
  }
}

function sendFlushIfNeeded() {
  if (!extAlive()) return;
  if (!document.hidden || isMediaActivelyPlaying()) {
    sendRuntime({ type: 'FLUSH' });
  }
}

onDoc('visibilitychange', () => {
  sendFlushIfNeeded();
});
trackInterval(sendFlushIfNeeded, 15000);

// Media-aware: tell SW if media is playing (keeps tracking while idle/locked).
// Include muted playback (overnight YouTube often mutes or uses tab audio).
let lastMediaPlaying = false;
function sendMediaState(force = false) {
  if (!extAlive()) return;
  try {
    const playing = isMediaActivelyPlaying();
    if (!force && playing === lastMediaPlaying && !playing) return;
    lastMediaPlaying = playing;
    sendRuntime({ type: 'MEDIA_STATE', playing });
  } catch {}
}

trackInterval(() => sendMediaState(true), 4000);

['play', 'playing', 'pause', 'ended', 'emptied'].forEach(evt => {
  onDoc(
    evt,
    e => {
      if (!(e.target instanceof HTMLMediaElement)) return;
      // Re-check shortly so multi-player pages stay accurate
      trackTimeout(() => sendMediaState(true), evt === 'play' || evt === 'playing' ? 50 : 120);
    },
    true
  );
});
sendMediaState(true);

const STYLE_ID = 'stt-cleaner-style';
const BW_ID = 'stt-bw-style';
const BANNER_ID = 'stt-live-banner';

function host() {
  return location.hostname.replace(/^www\./, '');
}

function fmtShort(sec) {
  const m = Math.max(0, Math.floor(sec / 60));
  const s = Math.max(0, Math.floor(sec % 60));
  return `${m}:${String(s).padStart(2, '0')}`;
}

function cleanerCSS(settings) {
  const c = settings?.cleaner || {};
  if (!c.enabled) return '';
  const h = host();
  let css = '';

  if (c.youtube && (h === 'youtube.com' || h.endsWith('.youtube.com'))) {
    css += `
      ytd-mini-guide-entry-renderer[aria-label*="Shorts"],
      a[title="Shorts"], ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts],
      #shorts-container, ytd-guide-entry-renderer:has(a[title="Shorts"]) { display:none!important; }
    `;
    if (c.youtubeComments) css += `#comments, ytd-comments { display:none!important; }`;
    if (c.youtubeHome) css += `ytd-browse[page-subtype="home"] #contents { display:none!important; }`;
    if (c.youtubeRelated) css += `#related, ytd-watch-next-secondary-results-renderer { display:none!important; }`;
    if (c.youtubeSearch) css += `#search-input, ytd-searchbox, #masthead-search { opacity:.25!important; pointer-events:none!important; }`;
    if (c.youtubeAutoplay) css += `.ytp-autonav-toggle-button[aria-checked="true"] { filter:grayscale(1)!important; }`;
  }
  if (c.instagram && (h === 'instagram.com' || h.endsWith('.instagram.com'))) {
    css += `a[href="/explore/"], a[href*="/reels/"] { display:none!important; }`;
    if (c.instagramStories) css += `div[role="menu"] canvas, section > div > div > div > div > div > div[style*="story"] { opacity:.15!important; pointer-events:none!important; }`;
  }
  if (c.tiktok && (h === 'tiktok.com' || h.endsWith('.tiktok.com'))) {
    css += `a[href*="/explore"], a[href*="/live"], [data-e2e="explore-icon"], [data-e2e="live-icon"] { display:none!important; }`;
  }
  if (c.twitter && (h === 'x.com' || h === 'twitter.com' || h.endsWith('.x.com') || h.endsWith('.twitter.com'))) {
    css += `a[href="/explore"], div[aria-label="Timeline: Trending now"], a[href="/i/lists"], a[href="/i/communities"] { display:none!important; }`;
  }
  if (c.facebook && (h === 'facebook.com' || h.endsWith('.facebook.com'))) {
    css += `a[href*="/reel"], a[href*="/stories"], a[href*="/marketplace"], div[aria-label="Stories"] { display:none!important; }`;
  }
  if (c.reddit && (h === 'reddit.com' || h.endsWith('.reddit.com'))) {
    css += `a[href="/r/popular/"], shreddit-ad-post { display:none!important; }`;
  }
  if (c.snapchat && (h === 'snapchat.com' || h === 'web.snapchat.com' || h.endsWith('.snapchat.com'))) {
    css += `a[href*="spotlight"], a[href*="stories"], [data-testid*="Spotlight"] { display:none!important; }`;
  }
  return css;
}

function applyCleaner(settings) {
  const css = cleanerCSS(settings);
  let el = document.getElementById(STYLE_ID);
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(el);
  }
  el.textContent = css;
}

function applyBw(settings) {
  const socialHosts = [
    'youtube.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com',
    'reddit.com', 'facebook.com', 'netflix.com', 'snapchat.com',
  ];
  const h = host();
  const socialHit = socialHosts.some(d => h === d || h.endsWith('.' + d));
  const on =
    ((settings?.bwMode || settings?.focusTint) && socialHit) ||
    (!!settings?.cleaner?.grayscaleSocial && settings?.cleaner?.enabled && socialHit);
  let el = document.getElementById(BW_ID);
  if (!on) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = BW_ID;
    (document.head || document.documentElement).appendChild(el);
  }
  const tint = settings?.focusTint
    ? `html{filter:grayscale(1) brightness(.92)!important;transition:filter .35s ease}`
    : `html{filter:grayscale(1)!important;transition:filter .35s ease}`;
  el.textContent = tint;
}

function bannerPalette(settings) {
  if (settings?.visualTheme === 'editorial') {
    return {
      bg: 'rgba(26,26,24,.94)',
      fg: '#F3EDE3',
      accent: '#3DBDB5',
      warn: '#FF8A7A',
      muted: '#9A9286',
      border: 'rgba(61,189,181,.45)',
      radius: '12px',
    };
  }
  if (settings?.visualTheme === 'minimal') {
    return {
      bg: 'rgba(12,12,12,.94)',
      fg: '#EDEDED',
      accent: '#4A6270',
      warn: '#A88888',
      muted: '#888884',
      border: 'rgba(74,98,112,.5)',
      radius: '6px',
    };
  }
  return {
    bg: 'rgba(10,16,20,.94)',
    fg: '#eef6f8',
    accent: '#3dd6c6',
    warn: '#ff7a9a',
    muted: '#93aab4',
    border: 'rgba(61,214,198,.4)',
    radius: '12px',
  };
}

function ensureBanner() {
  let el = document.getElementById(BANNER_ID);
  if (el) return el;
  const p = bannerPalette(cachedSettings);
  el = document.createElement('div');
  el.id = BANNER_ID;
  el.style.cssText = `
    position:fixed;top:12px;right:12px;z-index:2147483645;display:none;
    font-family:system-ui,sans-serif;min-width:180px;
    background:${p.bg};color:${p.fg};border:1px solid ${p.border};
    border-radius:${p.radius};padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.45);
    backdrop-filter:blur(10px);`;
  el.innerHTML = `
    <div id="stt-banner-lbl" style="font-size:10px;font-weight:700;color:${p.accent};letter-spacing:.4px;text-transform:uppercase;margin-bottom:4px">Time left</div>
    <div id="stt-banner-time" style="font-family:ui-monospace,monospace;font-size:18px;font-weight:700">--:--</div>
    <div id="stt-banner-sub" style="font-size:10px;color:${p.muted};margin-top:3px"></div>`;
  document.documentElement.appendChild(el);
  return el;
}

function showBanner(used, limitSec, domain) {
  const el = ensureBanner();
  const p = bannerPalette(cachedSettings);
  const left = Math.max(0, limitSec - used);
  el.style.display = 'block';
  const lbl = el.querySelector('#stt-banner-lbl');
  const time = el.querySelector('#stt-banner-time');
  const sub = el.querySelector('#stt-banner-sub');
  if (lbl) lbl.style.color = p.accent;
  if (time) {
    time.textContent = fmtShort(left);
    time.style.color = left < 120 ? p.warn : p.accent;
  }
  if (sub) {
    sub.style.color = p.muted;
    sub.textContent = `${domain} · ${Math.round((used / Math.max(limitSec, 1)) * 100)}% used`;
  }
}

function hideBanner() {
  const el = document.getElementById(BANNER_ID);
  if (el) el.style.display = 'none';
}

/** Local-only keyword body scan — never uploads page text */
function checkKeywordBody(settings) {
  const list = settings?.keywordBlock || [];
  if (!list.length) return;
  const url = (location.href || '').toLowerCase();
  const title = (document.title || '').toLowerCase();
  let bodySnippet = '';
  try {
    bodySnippet = (document.body?.innerText || '').slice(0, 8000).toLowerCase();
  } catch {}

  for (const raw of list) {
    const item = typeof raw === 'string' ? { term: raw, matchUrl: true, matchTitle: true, matchBody: false } : raw;
    const term = String(item.term || '').toLowerCase().trim();
    if (!term) continue;
    const hitUrl = item.matchUrl !== false && url.includes(term);
    const hitTitle = item.matchTitle !== false && title.includes(term);
    const hitBody = !!item.matchBody && bodySnippet.includes(term);
    if (hitUrl || hitTitle || hitBody) {
      sendRuntime({
        type: 'KEYWORD_HIT',
        domain: host(),
        kw: term,
        via: hitUrl ? 'url' : hitTitle ? 'title' : 'body',
      });
      return;
    }
  }
}

let cachedSettings = null;

function applyAll(settings) {
  cachedSettings = settings;
  applyCleaner(settings);
  applyBw(settings);
  // Rebuild banner shell so Material/Editorial palette can refresh
  const existing = document.getElementById(BANNER_ID);
  if (existing) existing.remove();
  if (settings?.liveBanner === false) hideBanner();
  checkKeywordBody(settings);
}

sendRuntime({ type: 'GET_SETTINGS' })
  .then(r => {
    if (_tornDown || !r?.settings) return;
    applyAll(r.settings);
  })
  .catch(() => {});

try {
  chrome.runtime.onMessage.addListener(msg => {
    if (!extAlive()) {
      teardownContentScript();
      return;
    }
    try {
      if (msg.type === 'SETTINGS_UPDATED') applyAll(msg.settings);
      if (msg.type === 'LIVE_BANNER') {
        if (cachedSettings?.liveBanner === false) {
          hideBanner();
          return;
        }
        showBanner(msg.used || 0, msg.limitSec || 0, msg.domain || host());
      }
    } catch {
      teardownContentScript();
    }
  });
} catch {
  teardownContentScript();
}

// Re-check keywords on SPA navigations
let lastHref = location.href;
trackInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    if (cachedSettings) checkKeywordBody(cachedSettings);
  }
}, 2000);

