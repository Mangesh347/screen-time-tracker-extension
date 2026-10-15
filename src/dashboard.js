// Screen Time Tracker — full-feature dashboard
import {
  fmt, catColor, catSoft, scoreColor, scoreLabel, calcScore,
  aggregateRange, msg, faviconUrl, sliceRange, weeklyDigest, dayTotal, compareDelta, dateKey, toCSV,
  fmtMetric, catColorForVisual, setDailyResetHour,
  previousPeriodRange, aggregateDailyLayers, heatmapHourSeries, siteActivityWave,
  deriveSessionStats, focusWindowsFromHeatmap, buildTodayInsight,
  digitalFingerprintAxes, isDistractCategory,
  escapeHtml, safeImgSrc,
} from './utils.js';
import { log } from './logger.js';
import {
  renderAreaChart, renderCompareBars, renderPetalChart, renderBentoMetrics,
  renderMiniWaveform, renderMultiLayerWave, renderActivityRiver, renderFocusBalance,
  renderUsageRhythm, renderActivityFlow, renderSessionDNA, renderSwitchAnalytics,
  renderFocusWindows, renderDigitalFingerprint, renderWavyCategoryCircle, renderFocusWavyThin,
  renderTodayVsYesterdayDuel,
} from './charts.js';
import { renderHabitBoard, wireHabitBoard } from './habits.js';
import { applyTheme, themeList } from './themes.js';
import { VISUAL_THEMES, normalizeVisualTheme, visualThemeLabel } from './visual-theme.js';
import { icon, catIconSvg } from './icons.js';
import { CONFIG } from './config.js';
import { mountLogo, restagger, flashMetric, showSectionLoading, hideSectionLoading } from './motion.js';
import { suggestedProvider } from './payments.js';
import {
  fetchLeaderboard, fetchSiteLeaderboard, fetchMySiteRanks,
  syncProfileViaBackend,
  getMyProfile, updateProfile, LB_REGIONS, detectRegion,
  searchProfiles, explorePeople, getUserProfileView,
  followUser, unfollowUser, acceptFollowRequest, rejectFollowRequest,
  listFollowRequests, createPost, fetchFeedWithAuthors,
  updatePost, deletePost, likePost, unlikePost, commentOnPost, listPostComments,
  recordPostView,
  listFollowers, listFollowing,
  sendDirectMessage, fetchMessageThread, fetchMessageInbox, markMessagesRead,
  socialUserError,
  listNotifications, markNotificationsRead, signOutCloud, deleteAccountCloud, summarizeDay,
  buildPeriodStats,
} from './cloud.js';
import { canUse, isPro as isProPlan, isVisualThemeAllowed, planBadgeHtml, proTagHtml, expiryMs } from './pro.js';
import { checkFeature } from './entitlements.js';
import {
  listLocalNotifications, unreadLocalCount, markLocalNotificationsRead,
  refreshActivityFeed, mergeNotificationFeeds,
} from './notifications-local.js';
import { createSocialLive } from './social-live.js';

let rangeData = {}, heatmapData = {}, user = null, settings = {}, currentDays = 1;
let saveDeb = null;
let planInfo = { plan: 'free', isPro: false, expiresAt: null };
let _entitlementPoll = null;
let payProvider = 'paypal';
let lbScope = 'global';
let lbRegion = 'global';
let lbSiteDomain = null;
let lbPeriod = 'week';
let _lbRefreshTimer = null;
let _lbRefreshing = false;
let _lbHasPainted = false;
let _socialHasPainted = false;
let _socialTab = 'feed';
let _socialLive = null;
let _socialLiveOn = false;
let _socialRefreshing = false;
let _socialFeedPaintKey = '';
let _profileSheetUserId = null;
let _chatPeerId = null;
let _chatPeerName = '';
let _chatConversations = [];
const STT_CHAT_WELCOME = {
  id: 'stt-system-welcome',
  system: true,
  from: 'Screen Time Tracker',
  body: 'Welcome to Community chat. Profiles are private by default — follow requests need approval. Be kind, and keep screen-time goals in mind.',
};
let _lbLastPaintKey = '';
let _lbLive = false; // true while Leaderboard section is active
let _lbSyncTimer = null;
let _lbSyncInFlight = false;
let _lbSyncBackoffMs = 0;
let _lbSyncFailStreak = 0;
/** Soft rank poll while Leaderboard is open + tab visible (was 8s). */
const LB_SOFT_REFRESH_MS = 2500;
/** Calm poll only used if tab stays on LB but we want a slower fallback (hidden uses none). */
const LB_CALM_REFRESH_MS = 8000;
/** Debounce prompt profile upsert while watching ranks. */
const LB_SYNC_DEBOUNCE_MS = 1500;
const LB_SYNC_BACKOFF_MAX_MS = 12000;
let _anaSitesCache = [];
let _anaSitesFilter = { q: '', cat: 'all', sort: 'time' };
let _hmapCatFilter = 'all';
const FREE_TOP_SITES = 10;
const FREE_ALL_SITES = 15;
const LB_PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
];
function lbPeriodLabel(id = lbPeriod) {
  return (LB_PERIODS.find(p => p.id === id) || {}).label || 'Last week';
}
const esc = escapeHtml;
const $ = id => document.getElementById(id);

function dsave() {
  clearTimeout(saveDeb);
  saveDeb = setTimeout(() => msg('SAVE_SETTINGS', { settings }).catch(() => {}), 250);
}

function activateSection(section) {
  if (!section) return;
  document.querySelectorAll('.sb-link, .dash-comm-link').forEach(x => {
    const on = x.dataset.section === section;
    x.classList.toggle('active', on);
    if (on) x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  $('section-' + section)?.classList.add('active');
  if (section === 'dashboard') startOverviewSoftRefresh();
  else stopOverviewSoftRefresh();
  if (section === 'insights') renderInsights();
  if (section === 'analytics') loadAnalytics(currentDays);
  if (['limits', 'focus', 'cleaner', 'settings'].includes(section)) renderControls();
  if (section === 'pro') renderPro();
  if (section === 'goals') renderGoals();
  if (section === 'habits') renderHabitBoard();
  if (section === 'schedule') renderSchedule();
  if (section === 'streaks') renderStreaks();
  if (section === 'profile') {
    renderProfile();
    startSocialLiveSync();
  }
  if (section === 'leaderboard') {
    _lbLive = true;
    renderLeaderboard();
    startLeaderboardAutoRefresh();
    scheduleLbPromptSync({ flush: true, immediate: true });
    startSocialLiveSync();
    document.documentElement.classList.add('lb-nav-seen');
    chrome.storage.local.set({ lbNavVisited: true }).catch(() => {});
  } else {
    _lbLive = false;
    stopLeaderboardAutoRefresh();
    stopLbPromptSync();
  }
  if (section === 'social') {
    renderSocial();
    startSocialLiveSync();
  } else if (section !== 'profile' && section !== 'leaderboard') {
    stopSocialLiveSync();
  }
  if (section === 'notifications') renderNotifications();
}

document.querySelectorAll('.sb-link, .dash-comm-link').forEach(l => {
  l.addEventListener('click', () => activateSection(l.dataset.section));
});

$('dash-filters')?.addEventListener('click', e => {
  const b = e.target.closest('.fb'); if (!b) return;
  const days = +b.dataset.days;
  if (!canUseRangeDays(days)) {
    showSoftRangeCta('dash-filters');
    return;
  }
  document.querySelectorAll('#dash-filters .fb').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  currentDays = days;
  loadDashboard(currentDays);
});
$('ana-filters')?.addEventListener('click', e => {
  const b = e.target.closest('.fb'); if (!b) return;
  const days = +b.dataset.days;
  if (!canUseRangeDays(days)) {
    showSoftRangeCta('ana-filters');
    return;
  }
  document.querySelectorAll('#ana-filters .fb').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  loadAnalytics(days);
});

const THEME_IDS = ['auto', 'violet', 'rose', 'sage', 'ember', 'teal', 'plum', 'sand', 'coral', 'indigo', 'mint', 'amber', 'slate', 'fuchsia', 'ocean'];

function currentThemeId() {
  const t = settings.theme;
  if (THEME_IDS.includes(t)) return t;
  return 'auto';
}

function currentMode() {
  return settings.themeMode === 'dark' || settings.themeMode === 'light' ? settings.themeMode : 'auto';
}

function paintTheme() {
  applyTheme(currentThemeId(), currentMode(), document.documentElement, {
    animate: true,
    visualSkin: settings.visualTheme || 'material',
  });
  const skin = normalizeVisualTheme(settings.visualTheme);
  const lbl = $('sb-skin-lbl');
  if (lbl) lbl.textContent = visualThemeLabel(skin);
  renderThemeBar();
  renderVisualThemeBar();
  remountChromeIcons();
}

function renderThemeBar() {
  const bar = $('theme-bar');
  if (!bar) return;
  const cur = currentThemeId();
  const mode = currentMode();
  const freeOnly = CONFIG.ALLOWED_FREE_THEMES || [];
  const chips = themeList().map(t => {
    const locked = !planInfo.isPro && !freeOnly.includes(t.id);
    const bg = typeof t.swatch === 'string' && t.swatch.startsWith('linear')
      ? `background:${t.swatch}`
      : `background:${t.swatch || 'var(--m3-primary)'}`;
    const cls = t.id === 'auto' ? 'theme-chip auto' : 'theme-chip';
    return `<button type="button" class="${cls}${t.id === cur ? ' on' : ''}${locked ? ' locked' : ''}" data-theme="${t.id}" data-locked="${locked ? '1' : '0'}" title="${esc(t.label)}${locked ? ' (Pro)' : ''}" style="${t.id === 'auto' ? '' : bg};${locked ? 'opacity:.45' : ''}" aria-label="${esc(t.label)}"></button>`;
  }).join('');
  bar.innerHTML = `
    <div class="theme-seeds-scroller" data-at-start="1" data-at-end="0">
      <div class="theme-seeds-fade theme-seeds-fade--left" aria-hidden="true"></div>
      <div class="theme-seeds" role="group" aria-label="Color seeds">${chips}</div>
      <div class="theme-seeds-fade theme-seeds-fade--right" aria-hidden="true"></div>
      <div class="theme-seeds-hint" aria-hidden="true">
        <span class="theme-seeds-dot"></span>
        <span class="theme-seeds-dot"></span>
        <span class="theme-seeds-dot on"></span>
      </div>
      <button type="button" class="theme-seeds-chevron theme-seeds-chevron--next" aria-label="More color seeds" tabindex="-1">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <div class="mode-pill" role="group" aria-label="Light or dark">
      <button type="button" data-mode="auto" class="${mode === 'auto' ? 'on' : ''}">Auto</button>
      <button type="button" data-mode="light" class="${mode === 'light' ? 'on' : ''}">Light</button>
      <button type="button" data-mode="dark" class="${mode === 'dark' ? 'on' : ''}">Dark</button>
    </div>`;
  bar.querySelectorAll('[data-theme]').forEach(b => {
    b.onclick = () => {
      if (b.dataset.locked === '1') {
        document.querySelector('.sb-link[data-section="pro"]')?.click();
        return;
      }
      settings.theme = b.dataset.theme;
      settings.m3YouApplied = true;
      paintTheme();
      dsave();
      loadDashboard(currentDays);
    };
  });
  bar.querySelectorAll('[data-mode]').forEach(b => {
    b.onclick = () => {
      settings.themeMode = b.dataset.mode;
      paintTheme();
      dsave();
    };
  });
  // Color seeds only apply in Material You skin (mode pill stays usable)
  const skin = normalizeVisualTheme(settings.visualTheme);
  const seeds = bar.querySelector('.theme-seeds');
  if (seeds) {
    seeds.style.opacity = skin === 'material' ? '1' : '0.4';
    seeds.title = skin === 'material' ? '' : 'Color seeds apply in Material You skin';
  }
  wireThemeSeedsScroller(bar);
  bar.style.opacity = '1';
  bar.removeAttribute('title');
}

function wireThemeSeedsScroller(bar) {
  const wrap = bar?.querySelector('.theme-seeds-scroller');
  const seeds = wrap?.querySelector('.theme-seeds');
  if (!wrap || !seeds) return;

  const update = () => {
    const max = Math.max(0, seeds.scrollWidth - seeds.clientWidth);
    const atStart = seeds.scrollLeft <= 2;
    const atEnd = max <= 2 || seeds.scrollLeft >= max - 2;
    wrap.dataset.atStart = atStart ? '1' : '0';
    wrap.dataset.atEnd = atEnd ? '1' : '0';
    wrap.dataset.canScroll = max > 4 ? '1' : '0';
    const dots = wrap.querySelectorAll('.theme-seeds-dot');
    if (dots.length === 3 && max > 4) {
      const t = seeds.scrollLeft / max;
      const idx = t < 0.33 ? 0 : t < 0.66 ? 1 : 2;
      dots.forEach((d, i) => d.classList.toggle('on', i === idx));
    }
  };

  seeds.addEventListener('scroll', update, { passive: true });
  wrap.querySelector('.theme-seeds-chevron--next')?.addEventListener('click', (e) => {
    e.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    seeds.scrollBy({
      left: Math.max(48, seeds.clientWidth * 0.55),
      behavior: reduce ? 'auto' : 'smooth',
    });
  });
  // Peek: nudge slightly if overflow exists so the next chip is half-cut
  requestAnimationFrame(() => {
    update();
    if (seeds.scrollWidth > seeds.clientWidth + 4 && seeds.scrollLeft < 1) {
      // Keep at start — CSS padding-end creates the peek of the next chip
      update();
    }
  });
}

function dismissVisualProGate(restore = true) {
  $('stt-pro-gate')?.remove();
  if (restore) paintTheme();
}

function showVisualProGate(themeId) {
  const id = normalizeVisualTheme(themeId);
  const meta = VISUAL_THEMES.find(v => v.id === id) || { label: id, blurb: '' };
  // Preview locked skin under blur (not persisted)
  applyTheme(currentThemeId(), currentMode(), document.documentElement, {
    animate: false,
    visualSkin: id,
  });
  $('stt-pro-gate')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'stt-pro-gate';
  overlay.className = 'stt-pro-gate';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Upgrade for ${meta.label}`);
  const swatches = id === 'minimal'
    ? ['#F5F5F4', '#1A1A1A', '#4A6270', '#0C0C0C']
    : id === 'editorial'
      ? ['#FAF6EF', '#0B7A75', '#E85D4C', '#1E1B16']
      : ['#fdf8ff', '#6750a4', '#c45c7a', '#1c1b1f'];
  overlay.innerHTML = `<div class="stt-pro-gate-card">
    <div class="stt-pro-gate-eyebrow">Pro skin</div>
    <h2 class="stt-pro-gate-title">${esc(meta.label)}</h2>
    <p class="stt-pro-gate-copy">${esc(meta.blurb)}. Previewing now — unlock with Pro to keep this look across popup and dashboard.</p>
    <div class="stt-pro-gate-swatches" aria-hidden="true">${swatches.map(c => `<i style="background:${c}"></i>`).join('')}</div>
    <div class="stt-pro-gate-actions">
      <button type="button" class="btn" id="stt-gate-dismiss">Keep browsing</button>
      <button type="button" class="btn primary" id="stt-gate-upgrade">Upgrade to Pro</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) dismissVisualProGate(true); });
  $('stt-gate-dismiss')?.addEventListener('click', () => dismissVisualProGate(true));
  $('stt-gate-upgrade')?.addEventListener('click', () => {
    dismissVisualProGate(true);
    document.querySelector('.sb-link[data-section="pro"]')?.click();
  });
  document.addEventListener('keydown', function onEsc(ev) {
    if (ev.key === 'Escape') {
      dismissVisualProGate(true);
      document.removeEventListener('keydown', onEsc);
    }
  });
}

const VISUAL_CHIP_SHORT = { material: 'Material', editorial: 'Editorial', minimal: 'Minimal' };

function renderVisualThemeBar() {
  const hosts = [$('visual-theme-bar'), $('visual-theme-settings')].filter(Boolean);
  const cur = normalizeVisualTheme(settings.visualTheme);
  hosts.forEach(host => {
    const compact = host.id === 'visual-theme-bar';
    host.classList.toggle('visual-theme-bar--compact', compact);
    host.innerHTML = VISUAL_THEMES.map(v => {
      const locked = !isVisualThemeAllowed(v.id, planInfo.isPro ? planInfo.plan : 'free');
      const tip = `${v.label} — ${v.blurb}${locked ? ' (Pro)' : ''}`;
      const label = compact ? (VISUAL_CHIP_SHORT[v.id] || v.label) : v.label;
      return `<button type="button" class="visual-chip ${v.id === cur ? 'on' : ''}${locked ? ' locked' : ''}" data-visual="${v.id}" data-locked="${locked ? '1' : '0'}" title="${esc(tip)}" aria-label="${esc(v.label)}${locked ? ' (Pro)' : ''}" aria-pressed="${v.id === cur ? 'true' : 'false'}">
        <strong>${esc(label)}</strong>
      </button>`;
    }).join('');
    host.querySelectorAll('[data-visual]').forEach(b => {
      b.onclick = () => {
        const id = b.dataset.visual;
        if (b.dataset.locked === '1') {
          showVisualProGate(id);
          return;
        }
        settings.visualTheme = id;
        paintTheme();
        dsave();
        loadDashboard(currentDays);
      };
    });
  });
}

function remountChromeIcons() {
  document.querySelectorAll('[data-ico]').forEach(el => {
    const sz = Number(el.dataset.icoSize) || 15;
    el.innerHTML = icon(el.dataset.ico, sz);
  });
  if ($('sb-logo')) mountLogo($('sb-logo'), 36);
}

function wireWavySliders(root = document) {
  root.querySelectorAll('input.sl[type="range"]').forEach(el => {
    const sync = () => {
      const min = Number(el.min) || 0;
      const max = Number(el.max) || 100;
      const v = Number(el.value) || 0;
      const pct = max === min ? 0 : ((v - min) / (max - min)) * 100;
      el.style.setProperty('--sl-pct', `${Math.max(0, Math.min(100, pct))}%`);
    };
    if (!el.dataset.wavyBound) {
      el.dataset.wavyBound = '1';
      el.addEventListener('input', sync);
    }
    sync();
  });
}

async function init() {
  const [range, heat, ur, st, plan] = await Promise.all([
    msg('GET_RANGE', { days: 90 }).then(r => r.data || {}),
    msg('GET_HEATMAP').then(r => r.data || {}),
    msg('GET_USER').then(r => r.user || null),
    msg('GET_SETTINGS').then(r => r.settings || {}),
    msg('GET_PLAN').then(r => r || { plan: 'free', isPro: false }),
  ]);
  rangeData = range; heatmapData = heat; user = ur; settings = st;
  planInfo = { plan: plan.plan || 'free', isPro: !!plan.isPro, expiresAt: plan.expiresAt ?? null };
  paintRangeFilterLocks('dash-filters');
  paintRangeFilterLocks('ana-filters');
  if (!canUseRangeDays(currentDays)) {
    currentDays = 7;
    document.querySelectorAll('#dash-filters .fb').forEach(x => {
      x.classList.toggle('active', +x.dataset.days === 7);
    });
  }
  try { setDailyResetHour(settings.dailyResetHour); } catch {}
  payProvider = suggestedProvider();
  if (!settings.m3YouApplied) {
    settings.theme = 'auto';
    settings.themeMode = 'auto';
    settings.m3YouApplied = true;
    settings.skyThemeApplied = true;
    await msg('SAVE_SETTINGS', { settings });
  }
  // Soft refresh entitlement (cached Free ≤3m / Pro ≤12h — force only after checkout)
  if (user?.email) {
    syncPlanFromBackground({ force: false }).catch(() => {});
  }
  paintTheme();
  mountLogo($('sb-logo'), 36);
  document.querySelectorAll('[data-ico]').forEach(el => {
    const sz = Number(el.dataset.icoSize) || 15;
    el.innerHTML = icon(el.dataset.ico, sz);
  });
  chrome.storage.local.get(['lbNavVisited']).then(r => {
    if (r.lbNavVisited) document.documentElement.classList.add('lb-nav-seen');
  }).catch(() => {});
  renderSidebarUser();
  ensureProWatermark();
  loadDashboard(1);
  startOverviewSoftRefresh();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.screentime) return;
      if (!isOverviewVisible() || currentDays !== 1) return;
      softRefreshOverviewToday().catch(() => {});
    });
  } catch {}
  wireControls();
  wireCommunity();
  wireNotifBell();
  wireHabitBoard();
  wireWavySliders();
  refreshActivityFeed({ rangeData, settings }).then(() => refreshNotifDot()).catch(() => refreshNotifDot());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user?.email) {
      syncPlanFromBackground({ force: false }).catch(() => {});
    }
    if (document.visibilityState === 'visible' && isOverviewVisible()) {
      startOverviewSoftRefresh();
    } else if (document.visibilityState !== 'visible') {
      stopOverviewSoftRefresh();
    }
    if (_socialLiveOn && document.visibilityState === 'visible') {
      softRefreshSocialSurfaces().catch(() => {});
    }
    if (!_lbLive) return;
    if (document.visibilityState === 'visible') {
      startLeaderboardAutoRefresh();
      scheduleLbPromptSync({ flush: true });
      renderLeaderboard({ soft: true });
    } else {
      // Tab hidden — pause fast polls (battery); leave calm resume on visible
      stopLeaderboardAutoRefresh();
    }
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === 'ENTITLEMENT_UPDATED') {
      syncPlanFromBackground({ force: false }).catch(() => {});
    }
  });
  // Soft cloud pull for signed-in users
  if (user?.email) {
    msg('CLOUD_PULL').then(() => msg('GET_RANGE', { days: 90 }).then(r => {
      if (r?.data) { rangeData = r.data; loadDashboard(currentDays); }
    })).catch(() => {});
  } else {
    msg('PUBLISH_GUEST_SCORE').catch(() => {});
  }
}

function renderSidebarUser() {
  const foot = $('sb-foot');
  if (!foot) return;
  if (user) {
    const badge = planBadgeHtml({
      isPro: planInfo.isPro,
      plan: planInfo.plan,
      expiresAt: planInfo.expiresAt,
      interactive: true,
    });
    foot.innerHTML = `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;background:var(--c3);border-radius:var(--radius-squircle,14px);border:1px solid var(--c4)">
      <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:var(--c4);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--m3-primary)">${user.picture ? `<img src="${safeImgSrc(user.picture)}" style="width:100%;height:100%;object-fit:cover"/>` : esc((user.name || '?')[0])}</div>
      <div style="min-width:0;flex:1"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(user.name || '')}</div><div style="font-size:10px;color:var(--t3);display:flex;align-items:center;gap:6px;margin-top:3px">${badge}<span>synced</span></div></div>
    </div>`;
    wirePlanBadgeClicks(foot);
  } else {
    const badge = planBadgeHtml({ isPro: false, interactive: true });
    foot.innerHTML = `<div style="display:flex;justify-content:center;margin-bottom:8px">${badge}</div>
      <button class="btn primary" id="sb-login" style="width:100%;margin-bottom:6px">Sign in</button>
      <div style="font-size:10px;color:var(--t3);text-align:center">Guest mode</div>`;
    $('sb-login')?.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') }));
    wirePlanBadgeClicks(foot);
  }
  ensureProWatermark();
}

async function syncPlanFromBackground({ force = false } = {}) {
  // Single path: GET_PLAN soft-refreshes; force=true after checkout / focus return
  const plan = await msg('GET_PLAN', { force: !!force }).then(r => r || {}).catch(() => ({}));
  const wasPro = planInfo.isPro;
  planInfo = {
    plan: plan.plan || 'free',
    isPro: !!plan.isPro,
    expiresAt: plan.expiresAt ?? null,
  };
  if (wasPro !== planInfo.isPro || force) {
    paintTheme();
    renderSidebarUser();
    ensureProWatermark();
    paintRangeFilterLocks('dash-filters');
    paintRangeFilterLocks('ana-filters');
    try { renderPro(); } catch {}
  }
  ensureProWatermark();
  return planInfo;
}

function startEntitlementWatch() {
  if (_entitlementPoll) return;
  let ticks = 0;
  _entitlementPoll = setInterval(async () => {
    ticks += 1;
    const p = await syncPlanFromBackground({ force: true });
    if (p.isPro || ticks >= 24) {
      clearInterval(_entitlementPoll);
      _entitlementPoll = null;
    }
  }, 15000);
}

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function goProSection() {
  document.querySelector('.sb-link[data-section="pro"]')?.click();
}

/** Free: Today + 7 Days. Pro: 30 + 90. Soft CTA — no hard block of the page. */
function canUseRangeDays(days) {
  const n = Number(days) || 1;
  if (n <= 7) return true;
  return !!planInfo.isPro || canUse('history30', planInfo.plan) || canUse('history90', planInfo.plan);
}

function messagingAllowed() {
  return !!planInfo.isPro || canUse('messaging', planInfo.plan);
}

function softProCtaHtml({ title, copy, btnId = 'stt-soft-pro-cta' }) {
  return `<div class="stt-soft-cta card" style="margin:12px 0;padding:16px 18px;border-color:color-mix(in srgb,var(--m3-primary) 32%,var(--c4))">
    <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(title)}</div>
    <div class="pg-sub" style="margin:0 0 12px;font-size:12px">${esc(copy)}</div>
    <button type="button" class="btn primary" id="${esc(btnId)}" style="width:auto;padding:8px 16px">Upgrade to Pro</button>
  </div>`;
}

function paintRangeFilterLocks(rootId) {
  const root = $(rootId);
  if (!root) return;
  root.querySelectorAll('.fb[data-days]').forEach(b => {
    const days = +b.dataset.days;
    const locked = !canUseRangeDays(days);
    b.classList.toggle('pro-locked', locked);
    b.title = locked ? 'Pro — 30 & 90 day ranges' : '';
    if (locked && !b.querySelector('.stt-pro-tag')) {
      b.insertAdjacentHTML('beforeend', ` ${proTagHtml('30 & 90-day analytics are Pro')}`);
    } else if (!locked) {
      b.querySelector('.stt-pro-tag')?.remove();
    }
  });
}

function showSoftRangeCta(hostId) {
  const host = $(hostId);
  if (!host) return;
  let el = document.getElementById(`${hostId}-pro-cta`);
  if (!el) {
    el = document.createElement('div');
    el.id = `${hostId}-pro-cta`;
    host.insertAdjacentElement('afterend', el);
  }
  el.innerHTML = softProCtaHtml({
    title: '30 & 90-day analytics are Pro',
    copy: 'Today and 7 Days stay free. Upgrade for longer ranges and deeper history.',
    btnId: `${hostId}-pro-btn`,
  });
  $(`${hostId}-pro-btn`)?.addEventListener('click', goProSection);
  setTimeout(() => { el?.remove(); }, 8000);
}

function applyDeepAnalyticsSoftGate() {
  const grid = document.querySelector('#section-analytics .ana-extra-grid');
  if (!grid) return;
  let banner = $('ana-deep-pro-cta');
  if (planInfo.isPro) {
    banner?.remove();
    grid.querySelectorAll('.card').forEach(c => c.classList.remove('ana-soft-preview'));
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'ana-deep-pro-cta';
    grid.parentNode?.insertBefore(banner, grid);
  }
  banner.innerHTML = softProCtaHtml({
    title: 'Deep analytics preview',
    copy: 'Flow, Session DNA, fingerprint, and full site lists unlock with Pro. Core trend & petals stay free.',
    btnId: 'ana-deep-pro-btn',
  });
  $('ana-deep-pro-btn')?.addEventListener('click', goProSection);
}

function messagingUpgradePaneHtml() {
  return softProCtaHtml({
    title: 'Direct messages are Pro',
    copy: 'Feed, follows, thoughts, and requests stay free when signed in. Upgrade to open your inbox and chat privately.',
    btnId: 'msg-pro-upgrade',
  });
}

function deltaTone(pct) {
  if (!Number.isFinite(pct) || pct === 0) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

function countUpStat(el, targetSec, isCount = false) {
  if (!el) return;
  if (prefersReducedMotion() || (!targetSec && targetSec !== 0)) {
    el.textContent = isCount ? String(targetSec) : fmtMetric(targetSec);
    return;
  }
  const start = performance.now();
  const dur = 520;
  const from = 0;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const cur = from + (targetSec - from) * eased;
    el.textContent = isCount ? String(Math.round(cur)) : fmtMetric(cur);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let _overviewRefreshTimer = null;
let _overviewSoftBusy = false;
let _overviewLastPaintKey = '';

function isOverviewVisible() {
  const sec = document.getElementById('section-dashboard');
  return !!sec?.classList.contains('active') && document.visibilityState === 'visible';
}

function stopOverviewSoftRefresh() {
  if (_overviewRefreshTimer) {
    clearInterval(_overviewRefreshTimer);
    _overviewRefreshTimer = null;
  }
}

function startOverviewSoftRefresh() {
  stopOverviewSoftRefresh();
  if (!isOverviewVisible()) return;
  _overviewRefreshTimer = setInterval(() => {
    softRefreshOverviewToday().catch(() => {});
  }, 6000);
  softRefreshOverviewToday().catch(() => {});
}

async function softRefreshOverviewToday() {
  if (!isOverviewVisible() || currentDays !== 1 || _overviewSoftBusy) return;
  _overviewSoftBusy = true;
  try {
    const live = await msg('GET_TODAY');
    if (!live?.data) return;
    const dk = dateKey(0);
    rangeData = { ...rangeData, [dk]: live.data };
    const paintKey = JSON.stringify({
      data: live.data,
      elapsed: live.live?.elapsed || 0,
      domain: live.live?.domain || '',
    });
    if (paintKey === _overviewLastPaintKey) return;
    _overviewLastPaintKey = paintKey;
    loadDashboard(1, { soft: true });
  } catch {}
  finally {
    _overviewSoftBusy = false;
  }
}

function loadDashboard(days, opts = {}) {
  const soft = !!opts.soft;
  currentDays = days;
  const sl = sliceRange(rangeData, days);
  const { total, topSites, catBreakdown, daily, score } = aggregateRange(sl);
  const social = catBreakdown.find(c => c.category === 'social')?.time || 0;
  const prod = ['productivity', 'coding', 'education'].reduce((s, c) => s + (catBreakdown.find(x => x.category === c)?.time || 0), 0);
  const ent = catBreakdown.find(c => c.category === 'entertainment')?.time || 0;
  const distract = social + ent;
  const other = Math.max(0, total - prod - distract);

  const prev = previousPeriodRange(rangeData, days);
  const prevAgg = aggregateRange(prev);
  const prevSocial = prevAgg.catBreakdown.find(c => c.category === 'social')?.time || 0;
  const prevProd = ['productivity', 'coding', 'education'].reduce((s, c) => s + (prevAgg.catBreakdown.find(x => x.category === c)?.time || 0), 0);

  const todayT = dayTotal(rangeData[dateKey(0)] || {});
  const yestT = dayTotal(rangeData[dateKey(1)] || {});
  const vsY = compareDelta(todayT, yestT);

  $('dash-sub').textContent = days === 1
    ? new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : `Last ${days} days · ${topSites.length} sites`;

  const metricDefs = [
    { ico: 'clock', key: 'Total', sec: total, prev: prevAgg.total, isCount: false },
    { ico: 'laptop', key: 'Focus', sec: prod, prev: prevProd, isCount: false },
    { ico: 'users', key: 'Social', sec: social, prev: prevSocial, isCount: false },
    { ico: 'globe', key: 'Sites', sec: topSites.length, prev: prevAgg.topSites.length, isCount: true },
  ];

  const statsEl = $('dash-stats');
  const canSoftStats = soft && statsEl?.querySelectorAll('.ov-metric .stat-val').length === metricDefs.length;
  if (canSoftStats) {
    metricDefs.forEach((m, i) => {
      const val = statsEl.children[i]?.querySelector('.stat-val');
      if (val) val.textContent = m.isCount ? String(m.sec) : fmtMetric(m.sec);
    });
  } else {
    statsEl.innerHTML = metricDefs.map((m, i) => {
      const d = compareDelta(m.sec, m.prev);
      const showDelta = days === 1 ? (m.key !== 'Sites' ? compareDelta(
        m.key === 'Total' ? todayT : m.key === 'Focus' ? prod : social,
        m.key === 'Total' ? yestT : m.prev
      ) : d) : d;
      const hasPrev = m.prev > 0 || (days === 1 && yestT > 0);
      const deltaHtml = hasPrev && Number.isFinite(showDelta.pct)
        ? `<div class="stat-delta ${deltaTone(showDelta.pct)}">${showDelta.label} vs prior</div>`
        : '';
      return `<div class="card ov-metric" style="--i:${i}">
      <div class="stat-ico" style="background:var(--m3-tonal);color:var(--m3-primary)">${icon(m.ico, 18)}</div>
      <div class="stat-val" data-metric="${i}" style="color:var(--m3-primary)">${m.isCount ? '0' : '0s'}</div>
      <div class="stat-key">${m.key}</div>${deltaHtml}</div>`;
    }).join('');
    if (!soft) restagger($('dash-stats'), 'stagger');
    metricDefs.forEach((m, i) => {
      const card = $('dash-stats')?.children[i];
      const val = card?.querySelector('.stat-val');
      if (soft) {
        if (val) val.textContent = m.isCount ? String(m.sec) : fmtMetric(m.sec);
      } else {
        countUpStat(val, m.sec, m.isCount);
        if (!prefersReducedMotion()) {
          requestAnimationFrame(() => card?.classList.add('is-pulse'));
          setTimeout(() => card?.classList.remove('is-pulse'), 900);
        }
      }
    });
  }

  renderScoreRing(days === 1 ? calcScore(sl[dateKey(0)] || {}) : score);
  const skin = normalizeVisualTheme(settings.visualTheme);
  const pieColor = (c) => catColorForVisual(c, skin);
  renderWavyCategoryCircle('dash-pie', catBreakdown, total, {
    catColor: pieColor, fmt, legendId: 'dash-leg', soft,
  });
  const trend = $('trend-wrap');
  if (trend) {
    trend.classList.add('chart-shell');
    trend.classList.remove('anim-wave');
    trend.style.height = '160px';
  }
  renderAreaChart('trend-wrap', daily, { fmt, soft: true });
  if (soft) {
    softUpdateTopSitesWave('dash-sites', topSites, total, sl);
  } else {
    renderTopSitesWave('dash-sites', topSites, total, sl);
  }

  const insight = buildTodayInsight({
    total: days === 1 ? todayT : total,
    topSites,
    catBreakdown,
    score: days === 1 ? calcScore(sl[dateKey(0)] || {}) : score,
    heatmap: heatmapData,
    comparePct: vsY.pct,
  });
  const insightEl = $('dash-insight');
  if (insightEl) {
    const card = insightEl.querySelector('.insight-card');
    if (soft && card) {
      card.className = `insight-card tone-${insight.tone || 'neutral'}`;
      const title = card.querySelector('.insight-title');
      const body = card.querySelector('.insight-body');
      if (title) title.textContent = insight.title;
      if (body) body.textContent = insight.body;
    } else {
      insightEl.innerHTML = `<div class="insight-card tone-${esc(insight.tone || 'neutral')}">
        <div class="insight-orb">${icon('bot', 18)}</div>
        <div><div class="insight-title">${esc(insight.title)}</div>
        <div class="insight-body">${esc(insight.body)}</div></div></div>`;
    }
  }

  const hours = heatmapHourSeries(heatmapData, {
    dow: days === 1 ? new Date().getDay() : null,
    aggregate: days > 1,
  });
  renderActivityRiver('dash-river', hours, { fmt, soft });
  renderFocusBalance('dash-balance', { focus: prod, distract, other, fmt, soft });
  renderUsageRhythm('dash-rhythm', hours, { fmt, soft });

  renderTodayVsYesterdayDuel('dash-compare', todayT, yestT, { fmt, soft });
}

function softUpdateTopSitesWave(id, sites, total, rangeSlice) {
  const el = $(id);
  if (!el) return;
  const rows = el.querySelectorAll('.wave-row');
  const sl = rangeSlice || sliceRange(rangeData, currentDays);
  if (!rows.length || !sites.length) {
    // Fall back to full paint when empty → populated
    if (!rows.length && sites.length) renderTopSitesWave(id, sites, total, sl);
    return;
  }
  const visible = sites.slice(0, FREE_TOP_SITES);
  visible.forEach((s, i) => {
    const row = rows[i];
    if (!row) return;
    const pct = total > 0 ? Math.round((s.totalTime / total) * 100) : 0;
    const timeEl = row.querySelector('.wave-time');
    const pctEl = row.querySelector('.wave-pct');
    const catEl = row.querySelector('.wave-cat');
    const domainEl = row.querySelector('.wave-domain');
    if (timeEl) timeEl.textContent = fmt(s.totalTime);
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (catEl) {
      catEl.textContent = s.category;
      catEl.style.color = catColor(s.category);
    }
    if (domainEl && domainEl.textContent !== s.domain) domainEl.textContent = s.domain;
    row.title = `${s.domain} · ${fmt(s.totalTime)} · ${pct}% · ${s.category}`;
    const waveHost = row.querySelector('.mini-wave')?.parentElement;
    if (waveHost) {
      const wave = siteActivityWave(sl, s.domain, heatmapData, 12);
      const col = catColor(s.category);
      softPatchMiniWaveform(waveHost, wave, col);
    }
  });
}

/** In-place mini-wave path update (keeps CSS animation classes). */
function softPatchMiniWaveform(host, values, color) {
  const svg = host.querySelector('.mini-wave');
  if (!svg) {
    host.innerHTML = renderMiniWaveform(values, { color });
    return;
  }
  const pts = (values || []).map(v => Math.max(0, Math.min(1, Number(v) || 0)));
  const w = Number(svg.getAttribute('width')) || 72;
  const h = Number(svg.getAttribute('height')) || 22;
  // Rebuild path geometry via the same helper string, then copy d/fill onto existing nodes
  const tmp = document.createElement('div');
  tmp.innerHTML = renderMiniWaveform(pts, { color, width: w, height: h });
  const next = tmp.querySelector('.mini-wave');
  if (!next) return;
  const area = svg.querySelector('path[fill]:not(.mini-wave-stroke)');
  const stroke = svg.querySelector('.mini-wave-stroke, path:last-of-type');
  const nextArea = next.querySelector('path[fill]:not(.mini-wave-stroke)');
  const nextStroke = next.querySelector('.mini-wave-stroke, path:last-of-type');
  if (area && nextArea) {
    area.setAttribute('d', nextArea.getAttribute('d') || '');
    area.setAttribute('fill', color || nextArea.getAttribute('fill'));
  }
  if (stroke && nextStroke) {
    stroke.setAttribute('d', nextStroke.getAttribute('d') || '');
    stroke.setAttribute('stroke', color || nextStroke.getAttribute('stroke'));
  }
}

function renderTopSitesWave(id, sites, total, rangeSlice) {
  const el = $(id);
  if (!el) return;
  if (!sites.length) {
    el.innerHTML = `<div class="prem-empty"><div class="prem-empty-orb"></div>
      <div class="prem-empty-title">No sites yet</div>
      <div class="prem-empty-sub">Top sites and activity waves appear as you browse.</div></div>`;
    return;
  }
  const isPro = !!planInfo.isPro;
  const visible = sites.slice(0, FREE_TOP_SITES);
  const rows = visible.map((s, i) => {
    const pct = total > 0 ? Math.round((s.totalTime / total) * 100) : 0;
    const wave = siteActivityWave(rangeSlice, s.domain, heatmapData, 12);
    const col = catColor(s.category);
    return `<div class="wave-row" style="--i:${i}" title="${esc(s.domain)} · ${fmt(s.totalTime)} · ${pct}% · ${esc(s.category)}">
      <div class="wave-rank">${i + 1}</div>
      <div class="wave-fav"><img src="${faviconUrl(s.domain)}" alt="" loading="lazy"/></div>
      <div class="wave-meta">
        <a class="wave-domain" href="https://${esc(s.domain)}" target="_blank" rel="noopener">${esc(s.domain)}</a>
        <div class="wave-cat" style="color:${col}">${esc(s.category)}</div>
      </div>
      <div class="wave-time">${fmt(s.totalTime)}</div>
      <div class="wave-pct">${pct}%</div>
      <div style="--i:${i}">${renderMiniWaveform(wave, { color: col })}</div>
    </div>`;
  }).join('');
  const more = sites.length > FREE_TOP_SITES;
  const foot = (!isPro && more)
    ? `<div class="wave-sites-foot"><button type="button" class="wave-pro-cta" id="dash-sites-pro">View all sites · Pro</button></div>`
    : (isPro && more
      ? `<div class="wave-sites-foot"><button type="button" class="btn" id="dash-sites-more" style="width:auto;padding:8px 14px;font-size:12px">View more</button></div>`
      : '');
  el.innerHTML = `<div class="wave-sites">${rows}</div>${foot}`;
  $('dash-sites-pro')?.addEventListener('click', goProSection);
  $('dash-sites-more')?.addEventListener('click', () => {
    document.querySelector('.sb-link[data-section="analytics"]')?.click();
  });
}

function renderScoreRing(score) {
  // Ring follows active theme primary (Material You / Editorial / Minimal + light/dark)
  const themeCol = getComputedStyle(document.documentElement).getPropertyValue('--m3-primary').trim() || '#6750a4';
  const scoreCol = scoreColor(score) || themeCol;
  renderFocusWavyThin('dash-focus-ring', score, themeCol);
  if ($('drg-num')) {
    $('drg-num').textContent = score;
    $('drg-num').style.color = scoreCol;
  }
  if ($('drg-lbl')) $('drg-lbl').textContent = scoreLabel(score);
  const meter = $('dash-wavy-meter');
  if (meter) {
    const p = Math.max(0.06, Math.min(1, (Number(score) || 0) / 100));
    meter.style.setProperty('--wavy-progress', String(p));
    meter.style.setProperty('--wavy-color', themeCol);
  }
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
  if ($('score-meta')) {
    $('score-meta').innerHTML = `Grade <b style="color:${scoreCol}">${grade}</b> · ${scoreLabel(score)}`;
  }
}

function loadAnalytics(days, opts = {}) {
  const soft = opts.soft !== false; // default soft — first paint remounts when no instance
  const sl = sliceRange(rangeData, days);
  const { total, topSites, catBreakdown, daily, score } = aggregateRange(sl);
  const social = catBreakdown.find(c => c.category === 'social')?.time || 0;
  const prod = ['productivity', 'coding', 'education'].reduce((s, c) => s + (catBreakdown.find(x => x.category === c)?.time || 0), 0);
  const ent = catBreakdown.find(c => c.category === 'entertainment')?.time || 0;
  const prev = previousPeriodRange(rangeData, days);
  const prevAgg = aggregateRange(prev);
  const prevSocial = prevAgg.catBreakdown.find(c => c.category === 'social')?.time || 0;
  const prevProd = ['productivity', 'coding', 'education'].reduce((s, c) => s + (prevAgg.catBreakdown.find(x => x.category === c)?.time || 0), 0);
  const dTotal = compareDelta(total, prevAgg.total);
  const dFocus = compareDelta(prod, prevProd);
  const dScore = compareDelta(score, prevAgg.score);

  const sum = $('ana-summary');
  if (sum) {
    const periodLabel = days === 1 ? 'yesterday' : `prior ${days} days`;
    if (prevAgg.total > 0 || total > 0) {
      sum.hidden = false;
      sum.innerHTML = `<div class="ana-summary-main">Period summary</div>
        <div class="ana-summary-delta ${deltaTone(dTotal.pct)}">${dTotal.label}</div>
        <div class="ana-summary-note">vs ${periodLabel}${prevAgg.total ? ` · was ${fmt(prevAgg.total)}` : ''}</div>`;
    } else {
      sum.hidden = true;
    }
  }

  const sub = document.querySelector('#section-analytics .pg-sub');
  if (sub) {
    sub.textContent = prevAgg.total
      ? `${dTotal.label} vs prior period · ${topSites.length} sites`
      : `Deeper view · ${topSites.length} sites tracked`;
  }

  const bentoHost = $('ana-bento');
  const bentoTiles = [
    {
      value: fmt(total), label: 'Total time', tone: 'primary',
      deltaLabel: prevAgg.total ? `${dTotal.label} vs prior` : '',
      deltaTone: deltaTone(dTotal.pct),
    },
    {
      value: fmt(prod), label: 'Focus', tone: 'secondary',
      deltaLabel: prevProd ? `${dFocus.label} vs prior` : '',
      deltaTone: deltaTone(dFocus.pct),
    },
    {
      value: String(score ?? '—'), label: 'Focus score', tone: 'tertiary',
      deltaLabel: prevAgg.score ? `${dScore.label} vs prior` : '',
      deltaTone: deltaTone(dScore.pct),
    },
  ];
  if (soft && bentoHost?.querySelectorAll('.bento-tile').length === 3) {
    bentoTiles.forEach((t, i) => {
      const tile = bentoHost.children[i];
      if (!tile) return;
      const val = tile.querySelector('.bento-val');
      const delta = tile.querySelector('.bento-delta');
      if (val) val.textContent = String(t.value ?? '—');
      if (delta) {
        delta.textContent = t.deltaLabel || '';
        delta.className = `bento-delta ${t.deltaTone || ''}`;
      } else if (t.deltaLabel) {
        const d = document.createElement('div');
        d.className = `bento-delta ${t.deltaTone || ''}`;
        d.textContent = t.deltaLabel;
        tile.appendChild(d);
      }
    });
  } else {
    renderBentoMetrics('ana-bento', bentoTiles);
    if (!soft) {
      $('ana-bento')?.querySelectorAll('.bento-val').forEach((node, i) => {
        if (i === 2 && typeof score === 'number') countUpStat(node, score, true);
      });
    }
  }

  const layers = aggregateDailyLayers(sl);
  const el = $('ana-trend');
  if (el) {
    el.classList.add('chart-shell');
    el.classList.remove('anim-wave');
    el.style.height = '220px';
  }
  if (layers.length > 1 || (layers.length === 1 && layers[0].total > 0)) {
    renderMultiLayerWave('ana-trend', layers, { fmt, soft: true });
  } else {
    renderAreaChart('ana-trend', daily, { fmt, soft: true });
  }

  const skin = normalizeVisualTheme(settings.visualTheme);
  renderPetalChart('ana-petal', (catBreakdown || []).slice(0, 8).map(c => ({
    label: c.category,
    value: c.time,
    color: catColorForVisual(c.category, skin),
  })), {
    soft: true,
    total,
    fmt,
    onSelect: (cat) => {
      const list = topSites.filter(s => s.category === cat).slice(0, 8);
      const host = $('ana-petal-sites');
      if (!host) return;
      if (!list.length) {
        host.innerHTML = `<div class="pg-sub" style="font-size:12px">No sites in ${esc(cat)}</div>`;
        return;
      }
      host.innerHTML = `<div class="pg-sub" style="font-size:12px;margin-bottom:6px">Sites in ${esc(cat)}</div>` +
        list.map(s => `<div class="site-row" style="padding:6px 0">
          <div class="site-fav"><img src="${faviconUrl(s.domain)}" alt="" loading="lazy"/></div>
          <div style="min-width:0;flex:1"><span class="site-link">${esc(s.domain)}</span></div>
          <span class="site-tv">${fmt(s.totalTime)}</span></div>`).join('');
    },
  });

  _anaSitesCache = topSites;
  renderAnaSitesToolbar(catBreakdown);
  renderAnaSitesTable();
  renderCatBars('ana-cats', catBreakdown, total);

  renderActivityFlow('ana-flow', {
    total,
    catBreakdown: catBreakdown.map(c => ({ ...c, color: catColor(c.category) })),
    topSites,
    fmt,
    soft,
  });
  const sessions = deriveSessionStats(sl);
  renderSessionDNA('ana-dna', sessions.segments.map(s => ({ ...s, color: catColor(s.category) })), { fmt, soft });
  renderSwitchAnalytics('ana-switch', sessions, { fmt, soft });
  renderFocusWindows('ana-windows', focusWindowsFromHeatmap(heatmapData, catBreakdown), { soft });
  renderDigitalFingerprint('ana-fingerprint', digitalFingerprintAxes(
    { total, topSites, catBreakdown, score },
    sessions,
    heatmapData,
  ), { soft });
  renderBehaviorInsights('ana-behavior', {
    total, topSites, catBreakdown, score, social, prod, ent, sessions, dTotal, days,
  }, { soft });

  const week = sliceRange(rangeData, 7);
  const last = {};
  for (let i = 7; i < 14; i++) if (rangeData[dateKey(i)]) last[dateKey(i)] = rangeData[dateKey(i)];
  const a = aggregateRange(week), b = aggregateRange(last);
  const wc = $('week-compare');
  if (wc) {
    wc.classList.add('chart-shell');
    wc.classList.remove('anim-wave');
    if (!wc.querySelector('#week-compare-chart')) {
      wc.innerHTML = '<div class="chart-shell" id="week-compare-chart" style="height:120px"></div>';
    }
    renderCompareBars('week-compare-chart', 'This week', a.total, 'Last week', b.total, { fmt, soft: true });
  }
  renderFullHeatmap();
  applyDeepAnalyticsSoftGate();
}

function renderBehaviorInsights(id, ctx, opts = {}) {
  const soft = !!opts.soft;
  const el = $(id); if (!el) return;
  const items = [];
  if (!ctx.total) {
    if (soft && el.querySelector('.bi-item')) return; // keep last paint on soft empty blip
    el.innerHTML = `<div class="prem-empty"><div class="prem-empty-orb"></div>
      <div class="prem-empty-title">Insights warming up</div>
      <div class="prem-empty-sub">Behavior notes appear from real browsing patterns.</div></div>`;
    return;
  }
  const top = ctx.topSites?.[0];
  if (top) {
    items.push({
      title: 'Dominant site',
      body: `${top.domain} takes ${Math.round((top.totalTime / ctx.total) * 100)}% of this period (${fmt(top.totalTime)}).`,
    });
  }
  if (ctx.sessions?.avgSession) {
    items.push({
      title: 'Session depth',
      body: `Average visit lasts ${fmt(ctx.sessions.avgSession)} across ${Math.round(ctx.sessions.switches)} switches.`,
    });
  }
  if (ctx.prod + ctx.social + ctx.ent > 0) {
    const focusPct = Math.round((ctx.prod / ctx.total) * 100);
    items.push({
      title: 'Focus share',
      body: focusPct >= 45
        ? `Focus categories are ${focusPct}% — solid signal.`
        : `Focus is ${focusPct}% of time — protect a deep-work block.`,
    });
  }
  if (Number.isFinite(ctx.dTotal?.pct) && ctx.dTotal.pct !== 0) {
    items.push({
      title: 'Period shift',
      body: ctx.dTotal.pct < 0
        ? `Usage is ${Math.abs(ctx.dTotal.pct)}% lighter than the prior window.`
        : `Usage is ${ctx.dTotal.pct}% heavier than the prior window.`,
    });
  }
  const nightish = (ctx.topSites || []).filter(s => isDistractCategory(s.category)).slice(0, 2);
  if (nightish.length) {
    items.push({
      title: 'Watch list',
      body: `${nightish.map(s => s.domain).join(' · ')} lead distraction categories.`,
    });
  }
  const slice = items.slice(0, 5);
  const existing = el.querySelectorAll('.bi-item');
  if (soft && existing.length && slice.length) {
    slice.forEach((it, i) => {
      const row = existing[i];
      if (!row) return;
      const strong = row.querySelector('strong');
      const span = row.querySelector('span');
      if (strong) strong.textContent = it.title;
      if (span) span.textContent = it.body;
    });
    // Add missing / remove extras without full wipe when count changes slightly
    if (existing.length !== slice.length) {
      el.innerHTML = slice.map(it => `
        <div class="bi-item"><div class="bi-mark"></div>
          <div><strong>${esc(it.title)}</strong><span>${esc(it.body)}</span></div></div>`).join('');
    }
    return;
  }
  el.innerHTML = slice.map(it => `
    <div class="bi-item"><div class="bi-mark"></div>
      <div><strong>${esc(it.title)}</strong><span>${esc(it.body)}</span></div></div>`).join('')
    || `<div class="prem-empty"><div class="prem-empty-title">Not enough contrast yet</div></div>`;
}

function renderAnaSitesToolbar(catBreakdown) {
  const tb = $('ana-sites-toolbar');
  if (!tb) return;
  const cats = ['all', ...new Set((catBreakdown || []).map(c => c.category))];
  const isPro = !!planInfo.isPro;
  tb.innerHTML = `
    <input type="search" id="ana-sites-q" placeholder="Search sites" value="${esc(_anaSitesFilter.q)}" aria-label="Search sites"/>
    <select id="ana-sites-cat" aria-label="Filter category">
      ${cats.map(c => `<option value="${esc(c)}" ${c === _anaSitesFilter.cat ? 'selected' : ''}>${c === 'all' ? 'All categories' : c}</option>`).join('')}
    </select>
    <select id="ana-sites-sort" aria-label="Sort sites">
      <option value="time" ${_anaSitesFilter.sort === 'time' ? 'selected' : ''}>Time</option>
      <option value="visits" ${_anaSitesFilter.sort === 'visits' ? 'selected' : ''}>Visits</option>
      <option value="name" ${_anaSitesFilter.sort === 'name' ? 'selected' : ''}>Name</option>
    </select>
    ${isPro ? '' : `<span class="sites-pro-note">Free · top ${FREE_ALL_SITES}</span>`}`;
  $('ana-sites-q')?.addEventListener('input', e => {
    _anaSitesFilter.q = e.target.value || '';
    renderAnaSitesTable();
  });
  $('ana-sites-cat')?.addEventListener('change', e => {
    _anaSitesFilter.cat = e.target.value || 'all';
    renderAnaSitesTable();
  });
  $('ana-sites-sort')?.addEventListener('change', e => {
    _anaSitesFilter.sort = e.target.value || 'time';
    renderAnaSitesTable();
  });
}

function renderAnaSitesTable() {
  let list = [...(_anaSitesCache || [])];
  const q = (_anaSitesFilter.q || '').trim().toLowerCase();
  if (q) list = list.filter(s => s.domain.toLowerCase().includes(q));
  if (_anaSitesFilter.cat && _anaSitesFilter.cat !== 'all') {
    list = list.filter(s => s.category === _anaSitesFilter.cat);
  }
  if (_anaSitesFilter.sort === 'visits') list.sort((a, b) => (b.visits || 0) - (a.visits || 0));
  else if (_anaSitesFilter.sort === 'name') list.sort((a, b) => a.domain.localeCompare(b.domain));
  else list.sort((a, b) => b.totalTime - a.totalTime);

  const isPro = !!planInfo.isPro;
  const limited = !isPro && list.length > FREE_ALL_SITES;
  const shown = isPro ? list : list.slice(0, FREE_ALL_SITES);
  renderSiteList('ana-sites', shown);
  const el = $('ana-sites');
  if (el && limited) {
    const cta = document.createElement('div');
    cta.className = 'wave-sites-foot';
    cta.innerHTML = `<button type="button" class="wave-pro-cta" id="ana-sites-pro">Unlock full site list · Pro</button>`;
    el.appendChild(cta);
    $('ana-sites-pro')?.addEventListener('click', goProSection);
  }
}

function renderSiteList(id, sites) {
  const el = $(id);
  if (!el) return;
  if (!sites.length) {
    el.innerHTML = `<div class="prem-empty"><div class="prem-empty-orb"></div>
      <div class="prem-empty-title">No sites match</div>
      <div class="prem-empty-sub">Try another filter or browse a bit more.</div></div>`;
    return;
  }
  const max = sites[0]?.totalTime || 1;
  el.innerHTML = sites.map(s => {
    const pct = Math.max(4, Math.round((s.totalTime / max) * 100));
    return `<div class="site-row">
      <div class="site-fav"><img src="${faviconUrl(s.domain)}" alt="" loading="lazy"/></div>
      <div style="min-width:0">
        <a class="site-link" href="https://${esc(s.domain)}" target="_blank" rel="noopener">${esc(s.domain)}</a>
        <div class="site-bar-w"><div class="site-bar-f" style="width:${pct}%;background:${catColor(s.category)}"></div></div>
      </div>
      <span class="site-tv">${fmt(s.totalTime)}</span>
    </div>`;
  }).join('');
  el.classList.add('site-list');
  restagger(el, 'stagger');
}

function renderCatBars(id, cats, total) {
  const el = $(id); if (!el) return;
  const max = cats[0]?.time || 1;
  el.innerHTML = cats.map(c => {
    const pct = total > 0 ? Math.round((c.time / total) * 100) : 0;
    const w = Math.max(2, Math.round((c.time / max) * 100));
    const col = catColor(c.category);
    return `<div class="cat-bar-row" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
        <span style="display:inline-flex;align-items:center;gap:8px;text-transform:capitalize;font-weight:600">
          <span class="cat-dot" style="background:${col};box-shadow:0 0 0 3px ${catSoft(c.category)}"></span>
          ${catIconSvg(c.category, 14)} ${esc(c.category)}
        </span>
        <span style="font-family:var(--font-mono),monospace;font-size:11px;color:${col};font-weight:700">${fmt(c.time)} · ${pct}%</span>
      </div>
      <div class="site-bar-w cat-track" style="margin-top:6px;background:${catSoft(c.category)}">
        <div class="site-bar-f" style="width:${w}%;background:${col}"></div>
      </div>
    </div>`;
  }).join('') || '<div class="empty">No categories</div>';
  restagger(el, 'stagger');
}

function renderFullHeatmap() {
  const el = $('hmap-full'); if (!el) return;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const tools = $('hmap-tools');
  if (tools) {
    const cats = ['all', ...new Set(
      Object.values(rangeData || {}).flatMap(day => Object.values(day || {}).map(e => e.category)).filter(Boolean)
    )];
    tools.innerHTML = `
      <div class="hmap-legend"><span>Low</span><div class="hmap-legend-bar" aria-hidden="true"></div><span>High</span></div>
      <select id="hmap-cat" aria-label="Category intensity filter" style="border:1px solid var(--c4);background:var(--c2);color:var(--t1);border-radius:12px;padding:6px 10px;font-size:12px">
        ${cats.map(c => `<option value="${esc(c)}" ${c === _hmapCatFilter ? 'selected' : ''}>${c === 'all' ? 'All activity' : c}</option>`).join('')}
      </select>
      <span class="pg-sub" style="font-size:11px;margin:0">${_hmapCatFilter === 'all' ? 'Hour × day intensity' : `Scaled by ${_hmapCatFilter} share (approx)`}</span>`;
    $('hmap-cat')?.addEventListener('change', e => {
      _hmapCatFilter = e.target.value || 'all';
      renderFullHeatmap();
    });
  }

  // Optional category filter: scale cell by category share of that weekday's data (approx — heatmap is total-only)
  let catShareByDow = Array(7).fill(1);
  if (_hmapCatFilter !== 'all') {
    catShareByDow = Array(7).fill(0);
    for (let i = 0; i < 90; i++) {
      const k = dateKey(i);
      const day = rangeData[k];
      if (!day) continue;
      const dow = new Date(k + 'T12:00:00').getDay();
      let t = 0, c = 0;
      for (const e of Object.values(day)) {
        t += e.totalTime || 0;
        if (e.category === _hmapCatFilter) c += e.totalTime || 0;
      }
      if (t > 0) catShareByDow[dow] = Math.max(catShareByDow[dow], c / t);
    }
  }

  const max = Math.max(...Object.values(heatmapData), 1);
  let html = '<div class="hmap-grid stagger"><div class="hm-lbl"></div>';
  for (let h = 0; h < 24; h++) html += `<div class="hm-lbl" style="justify-content:center">${h % 4 === 0 ? h : ''}</div>`;
  let i = 0;
  for (let d = 0; d < 7; d++) {
    html += `<div class="hm-lbl">${DAYS[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      let v = heatmapData[`${d}_${h}`] || 0;
      if (_hmapCatFilter !== 'all') v = Math.round(v * (catShareByDow[d] || 0));
      const pct = v > 0 ? Math.round(12 + (v / max) * 88) : 6;
      const tip = `${DAYS[d]} ${h}:00 — ${fmt(v)}`;
      html += `<div class="hm-cell" tabindex="0" style="--i:${i};--delay:${Math.min(i * 3, 360)}ms;background:color-mix(in srgb, var(--m3-primary) ${pct}%, transparent)" aria-label="${tip}">
        <span class="hm-tooltip">${tip}</span></div>`;
      i++;
    }
  }
  el.innerHTML = html + '</div>';
}

function setTog(id, on) {
  const el = $(id); if (!el) return;
  el.className = 'toggle ' + (on ? 'on' : 'off');
}

function renderControls() {
  setTog('d-tog-focus', !!settings.focusMode);
  setTog('d-tog-schedule', !!settings.focusSchedule?.enabled);
  setTog('d-tog-cleaner', !!settings.cleaner?.enabled);
  setTog('d-tog-bw', !!settings.bwMode);
  setTog('d-tog-banner', settings.liveBanner !== false);
  setTog('d-tog-notif', settings.notifications !== false);
  setTog('d-tog-ghost', !!settings.ghostMode);
  if ($('d-sl-social')) $('d-sl-social').value = settings.socialLimit || 60;
  if ($('d-sl-sv')) $('d-sl-sv').textContent = (settings.socialLimit || 60) + 'm';
  if ($('d-sl-ent')) $('d-sl-ent').value = settings.entLimit || 120;
  if ($('d-sl-ev')) $('d-sl-ev').textContent = (settings.entLimit || 120) + 'm';
  if ($('d-sl-pw')) $('d-sl-pw').value = settings.pomodoroWork || 25;
  if ($('d-pwv')) $('d-pwv').textContent = (settings.pomodoroWork || 25) + 'm';
  if ($('d-sl-pb')) $('d-sl-pb').value = settings.pomodoroBreak || 5;
  if ($('d-pbv')) $('d-pbv').textContent = (settings.pomodoroBreak || 5) + 'm';
  if ($('d-reset-hour')) $('d-reset-hour').value = settings.dailyResetHour ?? 0;
  renderTagList('d-bl-tags', settings.blockedSites || [], i => { settings.blockedSites.splice(i, 1); renderControls(); dsave(); },
    '<div class="empty-cta"><strong>Add sites to block</strong><span>They stay blocked while Focus mode is on</span></div>');
  renderTagList('d-ignore-list', settings.ignoreList || [], i => { settings.ignoreList.splice(i, 1); renderControls(); dsave(); },
    '<div class="empty-cta"><strong>Optional ignore list</strong><span>Sites you never want tracked</span></div>');
  renderTagList('d-pattern-list', settings.blockedPatterns || [], i => { settings.blockedPatterns.splice(i, 1); renderControls(); dsave(); },
    '<div class="empty-cta"><strong>Add a path pattern</strong><span>e.g. youtube.com/shorts</span></div>');
  renderMapList('d-site-limits', settings.siteLimits || {}, (k) => { delete settings.siteLimits[k]; renderControls(); dsave(); }, 'm',
    '<div class="empty-cta"><strong>Add a site limit</strong><span>Cap minutes per day for one domain</span></div>');
  renderSessionCaps();
}

function renderTagList(id, arr, onRemove, emptyHtml) {
  const el = $(id); if (!el) return;
  el.innerHTML = arr.map((s, i) => `<span class="bl-tag">${esc(s)} <button type="button" data-i="${i}">×</button></span>`).join('')
    || (emptyHtml || '<div class="empty-cta">Nothing here yet</div>');
  el.querySelectorAll('button').forEach(b => { b.onclick = () => onRemove(+b.dataset.i); });
}

function renderMapList(id, map, onRemove, unit, emptyHtml) {
  const el = $(id); if (!el) return;
  el.innerHTML = Object.entries(map).map(([k, v]) => `
    <div class="srow"><div class="srow-lbl">${esc(k)}</div>
      <div style="display:flex;gap:8px;align-items:center"><span class="sl-val">${v}${unit || ''}</span>
      <button type="button" data-k="${esc(k)}" style="border:none;background:transparent;cursor:pointer;color:var(--t2)">×</button></div></div>`).join('')
    || (emptyHtml || '<div class="empty-cta">None yet</div>');
  el.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => onRemove(b.dataset.k); });
}

function renderSessionCaps() {
  const el = $('d-session-caps'); if (!el) return;
  const caps = settings.sessionCaps || {};
  el.innerHTML = Object.entries(caps).map(([d, cap]) => `
    <div class="srow"><div><div class="srow-lbl">${esc(d)}</div><div class="srow-sub">${Math.round((cap.usedSec || 0) / 60)}m / ${cap.limitMin}m</div></div>
    <button type="button" data-k="${esc(d)}" style="border:none;background:transparent;cursor:pointer">×</button></div>`).join('')
    || '<div class="empty-cta"><strong>Add a session cap</strong><span>Short burst limit — resets each day</span></div>';
  el.querySelectorAll('[data-k]').forEach(b => {
    b.onclick = () => { delete settings.sessionCaps[b.dataset.k]; renderControls(); dsave(); };
  });
}

function wireControls() {
  const tog = (id, fn) => $(id)?.addEventListener('click', () => { fn(); dsave(); renderControls(); });
  tog('d-tog-focus', () => { settings.focusMode = !settings.focusMode; });
  tog('d-tog-schedule', () => { settings.focusSchedule = { ...(settings.focusSchedule || {}), enabled: !settings.focusSchedule?.enabled }; });
  tog('d-tog-cleaner', () => { settings.cleaner = { ...(settings.cleaner || {}), enabled: !settings.cleaner?.enabled }; });
  tog('d-tog-bw', () => { settings.bwMode = !settings.bwMode; });
  tog('d-tog-banner', () => { settings.liveBanner = !(settings.liveBanner !== false); });
  tog('d-tog-notif', () => { settings.notifications = !(settings.notifications !== false); });
  tog('d-tog-ghost', () => { settings.ghostMode = !settings.ghostMode; });

  $('d-bl-add')?.addEventListener('click', () => {
    const s = $('d-bl-inp')?.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!s) return;
    settings.blockedSites = [...new Set([...(settings.blockedSites || []), s])];
    $('d-bl-inp').value = ''; renderControls(); dsave();
  });
  $('d-ignore-add')?.addEventListener('click', () => {
    const s = $('d-ignore-inp')?.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!s) return;
    settings.ignoreList = [...new Set([...(settings.ignoreList || []), s])];
    $('d-ignore-inp').value = ''; renderControls(); dsave();
  });
  $('d-pattern-add')?.addEventListener('click', () => {
    const s = $('d-pattern-inp')?.value.trim().toLowerCase().replace(/^https?:\/\//, '');
    if (!s) return;
    settings.blockedPatterns = [...new Set([...(settings.blockedPatterns || []), s])];
    $('d-pattern-inp').value = ''; renderControls(); dsave();
  });
  $('d-slimit-add')?.addEventListener('click', () => {
    const d = $('d-slimit-domain')?.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const m = parseInt($('d-slimit-mins')?.value || '60', 10);
    if (!d || !m) return;
    settings.siteLimits = { ...(settings.siteLimits || {}), [d]: m };
    $('d-slimit-domain').value = ''; renderControls(); dsave();
  });
  $('d-scap-add')?.addEventListener('click', () => {
    const d = $('d-scap-domain')?.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const m = parseInt($('d-scap-mins')?.value || '15', 10);
    if (!d || !m) return;
    settings.sessionCaps = { ...(settings.sessionCaps || {}), [d]: { limitMin: m, usedSec: 0, dayKey: dateKey(0) } };
    $('d-scap-domain').value = ''; renderControls(); dsave();
  });

  $('d-sl-social')?.addEventListener('input', e => { settings.socialLimit = +e.target.value; $('d-sl-sv').textContent = settings.socialLimit + 'm'; dsave(); });
  $('d-sl-ent')?.addEventListener('input', e => { settings.entLimit = +e.target.value; $('d-sl-ev').textContent = settings.entLimit + 'm'; dsave(); });
  $('d-sl-pw')?.addEventListener('input', e => { settings.pomodoroWork = +e.target.value; $('d-pwv').textContent = settings.pomodoroWork + 'm'; dsave(); });
  $('d-sl-pb')?.addEventListener('input', e => { settings.pomodoroBreak = +e.target.value; $('d-pbv').textContent = settings.pomodoroBreak + 'm'; dsave(); });
  $('d-reset-hour')?.addEventListener('change', () => {
    settings.dailyResetHour = Math.min(23, Math.max(0, parseInt($('d-reset-hour').value || '0', 10)));
    dsave();
  });

  $('d-btn-nuclear')?.addEventListener('click', async () => {
    const hours = parseFloat(prompt('Hard Lock hours:', '1') || '0');
    if (!hours) return;
    const r = await msg('START_NUCLEAR', { hours });
    alert(r?.ok ? 'Hard Lock active' : (r?.error || 'Pro required'));
  });

  $('d-btn-clr')?.addEventListener('click', async () => {
    if (!confirm('Clear today’s data?')) return;
    await msg('CLEAR_TODAY');
    rangeData = await msg('GET_RANGE', { days: 90 }).then(r => r.data || {});
    loadDashboard(currentDays);
  });
  $('d-btn-exp')?.addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify({ screentime: rangeData, heatmap: heatmapData, settings, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `screen-time-${dateKey(0)}.json`; a.click();
  });
  $('d-btn-csv')?.addEventListener('click', () => {
    const blob = new Blob([toCSV(rangeData)], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `screen-time-${dateKey(0)}.csv`; a.click();
  });
  $('d-btn-imp')?.addEventListener('click', () => $('d-imp-file')?.click());
  $('d-imp-file')?.addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      await msg('IMPORT_BACKUP', { payload });
      location.reload();
    } catch (err) { alert(err.message || 'Invalid backup'); }
    e.target.value = '';
  });
}

function renderPro() {
  const plans = CONFIG.PLANS || [];
  const free = plans.find(p => p.id === 'free');
  const monthly = plans.find(p => p.id === 'monthly');
  const yearly = plans.find(p => p.id === 'yearly');
  const lifetime = plans.find(p => p.id === 'lifetime');
  const cmp = $('pro-compare');
  if (cmp) {
    cmp.innerHTML = `<div class="grid g2">
      <div>
        <div style="font-weight:700;margin-bottom:8px">Free feels good</div>
        <ul class="plan-feats">${(free?.feats || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      </div>
      <div>
        <div style="font-weight:700;margin-bottom:8px;color:var(--m3-primary)">Pro feels unstoppable</div>
        <ul class="plan-feats">
          ${(monthly?.feats || []).map(f => `<li>${esc(f)}</li>`).join('')}
        </ul>
        <div style="margin-top:12px;font-size:12px;color:var(--t2);line-height:1.45">
          <strong>Monthly</strong> from ${esc(monthly?.price || '$3.99')} (tax included at checkout).
          <strong> Yearly</strong> at ${esc(yearly?.price || '$29.99')} is the smart pick.
          <strong> Lifetime</strong> at ${esc(lifetime?.price || '$79.99')} if you never want to renew.
          PayPal (USD) and Razorpay (INR) both charge the tax-inclusive total.
        </div>
      </div>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--t3)">Signed in as ${user?.email ? esc(user.email) : 'guest — sign in before checkout'}</div>`;
  }
  if ($('pro-sub')) {
    const exp = expiryMs(planInfo.expiresAt);
    const expNote = planInfo.isPro && planInfo.plan === 'lifetime'
      ? 'Lifetime · yours forever'
      : planInfo.isPro && exp
        ? `Active until ${new Date(exp).toLocaleDateString()}`
        : planInfo.isPro
          ? `You are on ${planInfo.plan}`
          : '';
    $('pro-sub').innerHTML = planInfo.isPro
      ? `${planBadgeHtml({ ...planInfo, interactive: true })} <span style="margin-left:8px">${esc(expNote)}</span>`
      : 'Free forever core. Pro unlocks Hard Lock, longer analytics, full sync, and the cleaner tools you will actually use.';
    wirePlanBadgeClicks($('pro-sub'));
  }
  const el = $('pro-plans'); if (!el) return;
  el.innerHTML = plans.map(p => {
    const feats = Array.isArray(p.feats) ? p.feats : String(p.feats || '').split(/[·•|/]/).filter(Boolean);
    const isFree = p.id === 'free';
    const cycle = p.cycle || p.id;
    const isCurrent = planInfo.isPro ? planInfo.plan === cycle : isFree;
    const badge = p.featured
      ? `<span class="plan-badge pulse">${esc(p.savings || 'Smart pick')}</span>`
      : (p.savings && !isFree ? `<span class="plan-badge">${esc(p.savings)}</span>` : '');
    const cta = isFree
      ? `<button type="button" class="btn ghost plan-cta-free" disabled>${isCurrent ? 'Your plan' : 'Free forever'}</button>`
      : `<button type="button" class="btn primary plan-buy" data-cycle="${esc(cycle)}">
           ${isCurrent ? 'Current plan' : (p.featured ? 'Get Yearly' : 'Upgrade')}
         </button>`;
    return `<article class="plan-card ${p.featured ? 'feat' : ''} ${isFree ? 'plan-free' : ''}">
      ${badge}
      <div class="plan-name">${esc(p.name)}</div>
      <div class="plan-price-row">
        <div class="plan-price-usd">${esc(p.price)}<small>${esc(p.period || '')}</small></div>
        <div class="plan-price-inr">${esc(p.priceInr || '')}${isFree ? '' : ''}</div>
        ${isFree ? '' : `<div class="plan-pay-logos" aria-label="Pay with PayPal or Razorpay">
          <span class="pay-chip"><img src="../icons/pay/paypal.png" alt="PayPal" width="70" height="18" decoding="async" title="PayPal · USD" /></span>
          <span class="pay-chip"><img src="../icons/pay/razorpay.svg" alt="Razorpay" width="80" height="16" decoding="async" title="Razorpay · INR" /></span>
        </div>`}
      </div>
      ${p.savings && !isFree ? `<div class="plan-savings">${esc(p.savings)}</div>` : ''}
      <div class="plan-billing">${esc(p.billing || '')}</div>
      <ul class="plan-feats">${feats.map(f => `<li>${esc(String(f).trim())}</li>`).join('')}</ul>
      ${cta}
    </article>`;
  }).join('');

  document.querySelectorAll('#pro-pay-provider .pro-pay-btn').forEach(b => {
    const on = b.dataset.provider === payProvider;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.onclick = () => {
      payProvider = b.dataset.provider;
      document.querySelectorAll('#pro-pay-provider .pro-pay-btn').forEach(x => {
        const active = x === b;
        x.classList.toggle('active', active);
        x.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };
  });

  const restoreBtn = $('pro-restore');
  if (restoreBtn) {
    restoreBtn.onclick = async () => {
      const msgEl = $('pro-checkout-msg');
      if (!user?.email) {
        if (msgEl) msgEl.textContent = 'Sign in first, then restore.';
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
        return;
      }
      if (msgEl) msgEl.textContent = 'Checking your purchase…';
      await syncPlanFromBackground({ force: true });
      renderPro();
      if (msgEl) {
        msgEl.textContent = planInfo.isPro
          ? `Pro is back · you are on ${planInfo.plan}.`
          : 'No Pro found for this email yet. Finish checkout, then tap Restore.';
      }
    };
  }

  el.querySelectorAll('.plan-buy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const msgEl = $('pro-checkout-msg');
      if (!user?.email) {
        if (msgEl) msgEl.textContent = 'Sign in first, then come back here.';
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
        return;
      }
      if (msgEl) msgEl.textContent = 'Opening secure checkout…';
      const r = await msg('START_CHECKOUT', { cycle: btn.dataset.cycle, provider: payProvider });
      if (!r?.ok) {
        if (msgEl) msgEl.textContent = r?.message || r?.error || 'Checkout failed';
        return;
      }
      if (msgEl) msgEl.textContent = 'Checkout opened. Pro unlocks when payment clears.';
      startEntitlementWatch();
    });
  });
}

function pfHandleAt(handle, name) {
  const raw = (handle || name || '').replace(/^@/, '').trim();
  return raw ? `@${raw.toLowerCase().replace(/\s+/g, '_')}` : '@member';
}

function pfDisplayName(profile, fallbackName) {
  return profile?.name || profile?.handle || fallbackName || 'Member';
}

function pfAvatarHtml(picture, name, cls = 'pf-ig-av') {
  const initial = esc((name || '?')[0] || '?');
  const src = safeImgSrc(picture);
  return `<div class="${cls}" aria-hidden="true">${src ? `<img src="${src}" alt=""/>` : initial}</div>`;
}

function pfThoughtGridHtml(posts, { isSelf = false } = {}) {
  if (!posts?.length) {
    return isSelf
      ? `<div class="social-empty"><strong>No thoughts yet</strong>Share one from Community → Feed.</div>`
      : `<div class="social-empty"><strong>No thoughts yet</strong></div>`;
  }
  return `<div class="pf-ig-grid">${posts.map(t => `
    <div class="pf-ig-cell" data-post="${esc(String(t.id))}" data-uid="${esc(t.user_id || (isSelf && user?.id) || '')}">
      <div class="body">${esc(t.body || '')}</div>
      <div class="meta">${esc(relativeTime(t.created_at))} · ♥ ${t.likes_count || 0} · <span class="views" data-views="${esc(String(t.id))}" aria-label="Views">${VIEW_ICO} <span>${t.views_count || 0}</span></span></div>
    </div>`).join('')}</div>`;
}

function effectivePostCount(profile, posts) {
  return Math.max(Number(profile?.posts_count) || 0, Array.isArray(posts) ? posts.length : 0);
}

function pfStatsRowHtml(p, idPrefix) {
  const posts = effectivePostCount(p, null);
  const followers = Number(p?.followers_count) || 0;
  const following = Number(p?.following_count) || 0;
  return `<div class="pf-ig-stats" data-pf-stats="${idPrefix}">
    <div class="stat-static" data-stat="posts"><strong>${posts}</strong><span>posts</span></div>
    <button type="button" class="stat-btn" id="${idPrefix}-followers" data-stat="followers"><strong>${followers}</strong><span>followers</span></button>
    <button type="button" class="stat-btn" id="${idPrefix}-following" data-stat="following"><strong>${following}</strong><span>following</span></button>
  </div>`;
}

function softPatchPfStats(root, profile, posts) {
  if (!root) return;
  const postsN = effectivePostCount(profile, posts);
  const map = {
    posts: postsN,
    followers: Number(profile?.followers_count) || 0,
    following: Number(profile?.following_count) || 0,
  };
  root.querySelectorAll('[data-stat]').forEach((el) => {
    const key = el.getAttribute('data-stat');
    const strong = el.querySelector('strong');
    if (strong && map[key] != null) strong.textContent = String(map[key]);
  });
}

function softMergeThoughtGrid(host, posts, { isSelf = false } = {}) {
  if (!host) return;
  const list = Array.isArray(posts) ? posts : [];
  const hasCells = !!host.querySelector('.pf-ig-cell');
  if (!list.length) {
    // Don't flash empty during soft refetch if thoughts already showing
    if (hasCells) return;
    host.innerHTML = pfThoughtGridHtml([], { isSelf });
    return;
  }
  const grid = host.querySelector('.pf-ig-grid');
  if (!grid || !hasCells) {
    host.innerHTML = pfThoughtGridHtml(list, { isSelf });
    observeThoughtViews(host);
    return;
  }
  const nextIds = list.map((t) => String(t.id));
  const curIds = [...grid.querySelectorAll('.pf-ig-cell')].map((c) => c.dataset.post);
  const same =
    nextIds.length === curIds.length && nextIds.every((id, i) => id === curIds[i]);
  if (!same) {
    const scrollParent = host.closest('.pf-ig') || host;
    const y = scrollParent.scrollTop;
    host.innerHTML = pfThoughtGridHtml(list, { isSelf });
    observeThoughtViews(host);
    scrollParent.scrollTop = y;
    return;
  }
  list.forEach((t) => {
    const cell = grid.querySelector(`.pf-ig-cell[data-post="${CSS.escape(String(t.id))}"]`);
    if (!cell) return;
    const body = cell.querySelector('.body');
    const meta = cell.querySelector('.meta');
    if (body && body.textContent !== (t.body || '')) body.textContent = t.body || '';
    if (meta) {
      meta.innerHTML = `${esc(relativeTime(t.created_at))} · ♥ ${t.likes_count || 0} · <span class="views" data-views="${esc(String(t.id))}" aria-label="Views">${VIEW_ICO} <span>${t.views_count || 0}</span></span>`;
    }
  });
}

async function renderProfile(opts = {}) {
  const soft = !!opts.soft;
  const el = $('profile-panel'); if (!el) return;
  const today = summarizeDay(rangeData[dateKey(0)] || {});

  if (!user) {
    el.innerHTML = `<div class="pf-ig">
      <div class="pf-ig-head">
        ${pfAvatarHtml(null, 'G')}
        <div class="pf-ig-meta">
          <div class="pf-ig-name">Guest</div>
          <div class="pf-ig-handle">@guest</div>
          ${pfStatsRowHtml({ posts_count: 0, followers_count: 0, following_count: 0 }, 'pf')}
        </div>
      </div>
      <div class="pf-ig-bio empty">Tracking locally · sign in to sync and join Community</div>
      <div class="pf-ig-actions">
        <button class="btn primary grow" id="pf-signin" type="button">Sign in</button>
      </div>
      <div class="pf-ig-score">
        <div><div class="sv">${fmt(today.total_sec)}</div><div class="sk">Today</div></div>
      </div>
    </div>`;
    $('pf-signin')?.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') }));
    return;
  }

  let profile = null;
  let view = null;
  try { profile = await getMyProfile(); } catch {}
  try { view = await getUserProfileView(user.id); } catch {}
  if (view?.profile) profile = { ...profile, ...view.profile };

  const display = pfDisplayName(profile, user.name);
  const handleAt = pfHandleAt(profile?.handle, display);
  const picture = profile?.picture || user.picture;
  const isPrivate = profile?.is_private !== false;
  const posts = view?.posts || [];
  const postCount = effectivePostCount(profile, posts);
  const topSites = (view?.topSites?.length ? view.topSites : (today.top_sites || [])).slice(0, 8);

  // Soft refresh: mutate stats + thoughts in place (keep edit panel / scroll)
  if (soft && el.querySelector('.pf-ig-stats[data-pf-stats="pf"]')) {
    softPatchPfStats(el, { ...profile, posts_count: postCount }, posts);
    softMergeThoughtGrid($('pf-tab-thoughts'), posts, { isSelf: true });
    const nameEl = el.querySelector('.pf-ig-name');
    if (nameEl) {
      nameEl.innerHTML = `${esc(display)}${isPrivate ? ' <span class="privacy-lock">Private</span>' : ''} ${planBadgeHtml({ ...planInfo, interactive: true })}`;
      wirePlanBadgeClicks(el);
    }
    const bioEl = el.querySelector('.pf-ig-bio');
    if (bioEl) {
      bioEl.textContent = profile?.bio || 'Add a bio in Edit profile';
      bioEl.classList.toggle('empty', !profile?.bio);
    }
    return;
  }

  const sitesHtml = topSites.length
    ? topSites.map(s => `
      <div class="site-row" style="margin-bottom:8px">
        <div class="site-fav"><img src="${faviconUrl(s.domain)}" alt="" loading="lazy"/></div>
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:13px">${esc(s.domain)}</div>
          <div style="font-size:11px;color:var(--t3);text-transform:capitalize">${esc(s.category || 'other')}</div>
        </div>
        <span class="site-tv">${fmt(s.sec)}</span>
      </div>`).join('')
    : `<div class="social-empty" style="padding:16px"><strong>No sites yet</strong>Browse a bit and sync.</div>`;

  el.innerHTML = `<div class="pf-ig">
    <div class="pf-ig-head">
      <button type="button" class="pf-av-btn" id="pf-av-change" title="Change photo" aria-label="Change profile photo">
        ${pfAvatarHtml(picture, display)}
        <span class="pf-av-edit">Change</span>
      </button>
      <input type="file" id="pf-av-file" accept="image/*" hidden />
      <div class="pf-ig-meta">
        <div class="pf-ig-name">${esc(display)}${isPrivate ? ' <span class="privacy-lock">Private</span>' : ''} ${planBadgeHtml({ ...planInfo, interactive: true })}</div>
        <div class="pf-ig-handle">${esc(handleAt)}</div>
        ${pfStatsRowHtml({ posts_count: postCount, followers_count: profile?.followers_count, following_count: profile?.following_count }, 'pf')}
      </div>
    </div>
    <div class="pf-ig-bio ${profile?.bio ? '' : 'empty'}">${esc(profile?.bio || 'Add a bio in Edit profile')}</div>
    <div class="pf-ig-actions">
      <button class="btn grow" id="pf-edit-toggle" type="button">Edit profile</button>
      <button class="btn" id="pf-privacy-jump" type="button" title="Account privacy">${isPrivate ? 'Private' : 'Public'}</button>
    </div>
    <div class="pf-ig-score">
      <div><div class="sv">${fmt(today.total_sec)}</div><div class="sk">Today</div></div>
      <div><div class="sv">${fmt(profile?.total_browse_sec || today.total_sec)}</div><div class="sk">Board</div></div>
      <div><div class="sv">${profile?.public_score ?? today.score ?? '—'}</div><div class="sk">Focus</div></div>
    </div>
    <div class="pf-ig-edit" id="pf-edit" hidden>
      <div class="card-hd">Profile settings</div>
      <div class="task-row">
        <input class="task-inp" id="pf-handle" placeholder="Public name" maxlength="16" value="${esc(profile?.handle || user.name || '')}"/>
        <button class="btn primary" id="pf-save" type="button" style="width:auto;padding:10px 16px">Save</button>
      </div>
      <textarea id="pf-bio" class="task-inp" rows="2" maxlength="160" placeholder="Short bio (optional)" style="width:100%;margin-top:10px;border-radius:16px;resize:vertical;padding:10px">${esc(profile?.bio || '')}</textarea>
      <div class="srow" style="margin-top:12px" id="pf-privacy-row">
        <div><div class="srow-lbl">Private account</div><div class="srow-sub">Followers must request when private</div></div>
        <button class="toggle ${isPrivate ? 'on' : ''}" id="pf-private" type="button" aria-label="Private account"><div class="tthumb"></div></button>
      </div>
      <div style="margin-top:12px">
        <div class="srow-lbl" style="margin-bottom:8px">Leaderboard region</div>
        <div class="filter-row" id="pf-regions"></div>
      </div>
      <div class="pf-ig-actions" style="padding:12px 0 0">
        <button class="btn" id="pf-sync" type="button">Update score</button>
        <button class="btn" id="pf-lb" type="button">Leaderboard</button>
      </div>
      <button type="button" class="btn" id="pf-delete" style="margin-top:10px;width:100%;font-size:12px;opacity:.75">Delete account data…</button>
      <div style="font-size:11px;color:var(--t3);margin-top:8px">${esc(user.email || '')}</div>
    </div>
    <div class="card pf-logout-card" style="margin-top:14px;padding:14px 16px">
      <div class="srow-lbl" style="margin-bottom:4px">Log out</div>
      <div class="srow-sub" style="margin-bottom:10px">Sign out of cloud sync on this device. Local tracking stays until you clear extension data.</div>
      <button class="btn danger" id="pf-out" type="button" style="width:100%">Log out</button>
    </div>
    <div class="pf-ig-list-panel" id="pf-list-panel"></div>
    <div class="pf-ig-section">
      <div class="pf-ig-tabs" role="tablist">
        <button type="button" class="pf-ig-tab on" data-pf-tab="thoughts" role="tab" aria-selected="true">Thoughts</button>
        <button type="button" class="pf-ig-tab" data-pf-tab="sites" role="tab" aria-selected="false">Sites</button>
      </div>
      <div id="pf-tab-thoughts">${pfThoughtGridHtml(posts, { isSelf: true })}</div>
      <div id="pf-tab-sites" hidden>${sitesHtml}</div>
    </div>
  </div>`;

  wirePlanBadgeClicks(el);
  observeThoughtViews($('pf-tab-thoughts'));

  $('pf-av-change')?.addEventListener('click', () => $('pf-av-file')?.click());
  $('pf-av-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 900_000) {
      alert('Choose a smaller image (under about 900 KB).');
      e.target.value = '';
      return;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(file);
      });
      await updateProfile({ picture: String(dataUrl) });
      if (user) user.picture = String(dataUrl);
      renderProfile();
      renderSidebarUser();
    } catch (err) {
      alert(err.message || 'Could not update photo');
    }
    e.target.value = '';
  });

  el.querySelectorAll('[data-pf-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const which = tab.dataset.pfTab;
      el.querySelectorAll('[data-pf-tab]').forEach(t => {
        const on = t.dataset.pfTab === which;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const th = $('pf-tab-thoughts');
      const si = $('pf-tab-sites');
      if (th) th.hidden = which !== 'thoughts';
      if (si) si.hidden = which !== 'sites';
    });
  });

  const edit = $('pf-edit');
  const openEdit = (focusPrivacy = false) => {
    if (!edit) return;
    edit.hidden = false;
    if (focusPrivacy) $('pf-privacy-row')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    else edit.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $('pf-edit-toggle')?.addEventListener('click', () => {
    if (!edit) return;
    if (edit.hidden) openEdit(false);
    else edit.hidden = true;
  });
  $('pf-privacy-jump')?.addEventListener('click', () => openEdit(true));

  $('pf-save')?.addEventListener('click', async () => {
    const handle = $('pf-handle')?.value.trim().replace(/[^a-zA-Z0-9_ ]/g, '').slice(0, 16);
    const bio = ($('pf-bio')?.value || '').trim().slice(0, 160);
    if (!handle) return;
    try {
      await updateProfile({ name: handle, handle: handle.toLowerCase().replace(/\s+/g, '_'), bio });
      renderProfile();
    } catch (e) {
      try {
        await updateProfile({ name: handle, bio });
        renderProfile();
      } catch (err) {
        alert(socialUserError(err, err.message || e.message || 'Save failed'));
      }
    }
  });
  $('pf-private')?.addEventListener('click', async () => {
    const btn = $('pf-private');
    const next = !btn.classList.contains('on');
    btn.classList.toggle('on', next);
    try {
      await updateProfile({ is_private: next });
      await renderProfile();
      const ed = $('pf-edit');
      if (ed) ed.hidden = false;
    } catch (e) {
      btn.classList.toggle('on', !next);
      alert(socialUserError(e, 'Could not update privacy. Try again in a moment.'));
    }
  });
  const showList = async (kind) => {
    const panel = $('pf-list-panel');
    if (!panel) return;
    panel.innerHTML = `<div style="padding:10px;color:var(--t3);font-size:12px">Loading…</div>`;
    try {
      const people = kind === 'followers'
        ? await listFollowers(user.id)
        : await listFollowing(user.id);
      panel.innerHTML = people.length
        ? `<div class="card-hd" style="margin-bottom:8px">${kind === 'followers' ? 'Followers' : 'Following'}</div>
           <div class="explore-grid">${people.map(personCard).join('')}</div>`
        : `<div class="social-empty" style="padding:16px"><strong>No one here yet</strong></div>`;
      panel.querySelectorAll('[data-uid]').forEach(b => {
        b.addEventListener('click', () => openUserProfile(b.dataset.uid));
      });
    } catch (e) {
      panel.innerHTML = `<div style="padding:10px;color:var(--t2);font-size:12px">${esc(socialUserError(e))}</div>`;
    }
  };
  $('pf-followers')?.addEventListener('click', () => showList('followers'));
  $('pf-following')?.addEventListener('click', () => showList('following'));
  const myRegion = settings.regionChosen ? (settings.region || profile?.region) : null;
  const pfReg = $('pf-regions');
  if (pfReg) {
    pfReg.innerHTML = LB_REGIONS.filter(r => r.id !== 'global').map(r =>
      `<button class="fb ${myRegion === r.id ? 'active' : ''}" data-region="${r.id}" type="button">${esc(r.label)}</button>`
    ).join('') + (!myRegion ? `<div style="width:100%;font-size:12px;color:var(--t3);margin-top:6px">Optional — needed only for regional boards.</div>` : '');
    pfReg.querySelectorAll('[data-region]').forEach(b => {
      b.addEventListener('click', async () => {
        settings.region = b.dataset.region;
        settings.regionChosen = true;
        dsave();
        try { await updateProfile({ region: settings.region }); } catch (e) {
          alert(e.message || 'Could not save region. Try again in a moment.');
        }
        renderProfile().then(() => {
          const ed = $('pf-edit');
          if (ed) ed.hidden = false;
        });
      });
    });
  }
  $('pf-sync')?.addEventListener('click', async () => {
    const btn = $('pf-sync');
    if (btn) btn.textContent = 'Updating…';
    await msg('CLOUD_SYNC_NOW').catch(() => {});
    if (btn) btn.textContent = 'Update score';
    renderProfile().then(() => {
      const ed = $('pf-edit');
      if (ed) ed.hidden = false;
    });
  });
  $('pf-lb')?.addEventListener('click', () => {
    document.querySelector('.sb-link[data-section="leaderboard"]')?.click();
  });
  $('pf-out')?.addEventListener('click', async () => {
    await signOutCloud();
    location.reload();
  });
  $('pf-delete')?.addEventListener('click', async () => {
    const ok = confirm(
      'Delete your Screen Time Tracker cloud data (profile, posts, sync, social)?\n\nThis cannot be undone. Local tracking on this device stays until you clear extension data. Sign out afterward.',
    );
    if (!ok) return;
    const ok2 = confirm('Really delete account product data permanently?');
    if (!ok2) return;
    try {
      await deleteAccountCloud({ confirm: true });
      await signOutCloud();
      alert('Account data deleted. You are signed out.');
      location.reload();
    } catch (e) {
      alert(e.message || 'Could not delete account');
    }
  });
}

function lbMemberRow(r) {
  const top = (r.topSites || [])[0];
  const reg = r.region
    ? ((LB_REGIONS.find(x => x.id === r.region) || {}).label || r.region)
    : 'Global';
  const streak = Number(r.streak) || 0;
  return `<div class="lb-row ${r.rank === 1 ? 'top1' : ''} ${r.isYou ? 'you' : ''}" data-uid="${esc(r.id || '')}">
    <div class="lb-rank">${r.rank}</div>
    <div class="avatar-lg" style="width:36px;height:36px;font-size:14px">${r.picture ? `<img src="${safeImgSrc(r.picture)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : esc((r.name || '?')[0])}</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:600">${esc(r.name)}${r.isYou ? ' · you' : ''}</div>
      <div style="font-size:11px;color:var(--t3)">${esc(reg)}${top ? ` · top ${esc(top.domain)}` : ''}${streak ? ` · ${streak}d streak` : ''}</div>
    </div>
    <div class="lb-metrics">
      <div class="lb-metric"><span class="lb-metric-val">${fmt(r.totalSec)}</span><span class="lb-metric-key">Usage</span></div>
      <div class="lb-metric"><span class="lb-metric-val">${r.score ?? 0}</span><span class="lb-metric-key">Score</span></div>
      <div class="lb-metric"><span class="lb-metric-val">${streak || '—'}</span><span class="lb-metric-key">Streak</span></div>
    </div>
  </div>`;
}

function updateLbCriteria() {
  const el = $('lb-criteria');
  if (!el) return;
  const scopeTxt = lbScope === 'region' ? 'your region' : lbScope === 'sites' ? 'shared websites' : 'everyone';
  el.textContent = `Ranked by total tracked time for ${lbPeriodLabel()} · Focus Score & streak shown for context · ${scopeTxt}`;
}

function lbGuestPlaceholderRows() {
  // Decorative placeholders only — never real member stats for guests
  const names = ['Member', 'Tracker', 'Focus', 'Streak', 'Browse', 'Score'];
  return names.map((n, i) => `
    <div class="lb-row" aria-hidden="true">
      <div class="lb-rank">${i + 1}</div>
      <div class="avatar-lg" style="width:36px;height:36px;font-size:14px">${n[0]}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${n} · · ·</div>
        <div style="font-size:11px;color:var(--t3)">Region · top site</div>
      </div>
      <div class="lb-metrics">
        <div class="lb-metric"><span class="lb-metric-val">––</span><span class="lb-metric-key">Usage</span></div>
        <div class="lb-metric"><span class="lb-metric-val">––</span><span class="lb-metric-key">Score</span></div>
        <div class="lb-metric"><span class="lb-metric-val">––</span><span class="lb-metric-key">Streak</span></div>
      </div>
    </div>`).join('');
}

async function renderLeaderboard(opts = {}) {
  const soft = !!opts.soft;
  const el = $('lb-list'); if (!el) return;
  const youBox = $('lb-you');
  const gate = $('lb-gate');
  const wrap = $('lb-wrap');
  const body = $('lb-body');
  const regionsEl = $('lb-regions');
  const siteDetail = $('lb-site-detail');
  const periodsEl = $('lb-periods');

  if (periodsEl && !soft) {
    periodsEl.innerHTML = LB_PERIODS.map(p =>
      `<button class="fb ${lbPeriod === p.id ? 'active' : ''}" data-period="${p.id}" type="button">${esc(p.label)}</button>`
    ).join('');
  }
  updateLbCriteria();

  if (!user) {
    wrap?.classList.add('is-guest');
    if (gate) gate.setAttribute('aria-hidden', 'false');
    if (body) body.style.display = 'block';
    if (youBox) {
      youBox.style.display = 'block';
      youBox.innerHTML = `<div style="font-weight:700">Your rank awaits</div>
        <div style="font-size:13px;color:var(--t2);margin-top:4px">Sign in to sync real usage, score &amp; streak.</div>`;
    }
    if (regionsEl) regionsEl.style.display = 'none';
    if (siteDetail) siteDetail.style.display = 'none';
    el.innerHTML = lbGuestPlaceholderRows();
    _lbHasPainted = false;
    return;
  }
  wrap?.classList.remove('is-guest');
  if (gate) gate.setAttribute('aria-hidden', 'true');
  if (body) body.style.display = 'block';

  // Soft refresh: keep current rows visible (no loading wipe / flicker)
  if (!soft || !_lbHasPainted) {
    showSectionLoading(el, 'Refreshing ranks…');
    if (youBox) youBox.style.display = 'none';
  }
  if (siteDetail && !soft) siteDetail.style.display = 'none';

  const hasRegion = !!(settings.regionChosen && settings.region && settings.region !== 'global');

  if (lbScope === 'region' && !hasRegion) {
    hideSectionLoading(el);
    if (regionsEl) regionsEl.style.display = 'none';
    if (youBox) {
      youBox.style.display = 'block';
      youBox.innerHTML = `<div class="card-hd" style="margin:0 0 8px">Choose your region first</div>
        <div style="font-size:13px;color:var(--t2);margin-bottom:12px">Global already lists every signed-up member. Pick a region to see the regional board.</div>
        <div class="filter-row" id="lb-pick-region"></div>`;
      const pick = $('lb-pick-region');
      if (pick) {
        pick.innerHTML = LB_REGIONS.filter(r => r.id !== 'global').map(r =>
          `<button class="fb" data-region="${r.id}" type="button">${esc(r.label)}</button>`
        ).join('');
        pick.querySelectorAll('[data-region]').forEach(b => {
          b.addEventListener('click', async () => {
            settings.region = b.dataset.region;
            settings.regionChosen = true;
            dsave();
            lbRegion = settings.region;
            try { await updateProfile({ region: settings.region }); } catch {}
            renderLeaderboard();
          });
        });
      }
    }
    el.innerHTML = `<div style="padding:12px;color:var(--t3)">Select a region above to continue.</div>`;
    return;
  }

  lbRegion = hasRegion ? settings.region : (lbRegion || 'global');

  if (regionsEl && !soft) {
    if (lbScope === 'region') {
      regionsEl.style.display = 'flex';
      regionsEl.innerHTML = LB_REGIONS.filter(r => r.id !== 'global').map(r =>
        `<button class="fb ${lbRegion === r.id ? 'active' : ''}" data-region="${r.id}" type="button">${esc(r.label)}</button>`
      ).join('');
    } else {
      regionsEl.style.display = 'none';
    }
  }

  if (_lbRefreshing) return;
  _lbRefreshing = true;
  try {
  // Hard open: full cloud push. Soft poll: skip heavy push — debounced profile sync runs separately.
  if (!soft) {
    await msg('CLOUD_SYNC_NOW').catch(() => {});
  } else if (_lbLive) {
    scheduleLbPromptSync({ flush: false });
  }
  const regionLabel = (LB_REGIONS.find(r => r.id === lbRegion) || {}).label || 'Global';

  if (lbScope === 'sites') {
    // Sites for the selected period (Today / Week / Month / Year) — not only today
    let mySites = [];
    try {
      const store = await chrome.storage.local.get(['screentime', 'settings']);
      const period_stats = buildPeriodStats(store.screentime || {}, store.settings?.streaks?.current || 0);
      mySites = (period_stats[lbPeriod]?.sites || []).slice(0, 12);
    } catch {
      const today = summarizeDay(rangeData[dateKey(0)] || {});
      mySites = today.top_sites || [];
    }

    if (lbSiteDomain) {
      let rows = [];
      try {
        rows = await fetchSiteLeaderboard(lbSiteDomain, { limit: 40, period: lbPeriod, skipSync: soft });
      } catch { rows = []; }
      hideSectionLoading(el);
      if (siteDetail) {
        siteDetail.style.display = 'block';
        siteDetail.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div><div class="card-hd" style="margin:0">${esc(lbSiteDomain)}</div>
          <div style="font-size:12px;color:var(--t2)">Ranked by time on this site vs other members</div></div>
          <button class="btn" type="button" id="lb-site-back">All my sites</button>
        </div>`;
        $('lb-site-back')?.addEventListener('click', () => { lbSiteDomain = null; renderLeaderboard(); });
      }
      const me = rows.find(r => r.isYou);
      if (youBox) {
        youBox.style.display = 'block';
        youBox.innerHTML = me
          ? `<div style="display:flex;align-items:center;gap:12px">
              <div class="lb-rank" style="background:var(--m3-primary);color:var(--m3-on-primary)">${me.rank}</div>
              <div style="flex:1"><div style="font-weight:700">You on ${esc(lbSiteDomain)}</div>
              <div style="font-size:12px;color:var(--t2)">#${me.rank} of ${rows.length} members who use this site</div></div>
              <div style="font-family:var(--font-mono),monospace;font-weight:700;color:var(--m3-primary);font-size:18px">${fmt(me.siteSec)}</div>
            </div>`
          : `<div style="font-size:13px;color:var(--t2)">You’re not ranked on this site yet — browse a bit, then reopen.</div>`;
      }
      el.innerHTML = rows.length
        ? rows.map(r => `
        <div class="lb-row ${r.rank === 1 ? 'top1' : ''} ${r.isYou ? 'you' : ''}" data-uid="${esc(r.id || '')}">
          <div class="lb-rank">${r.rank}</div>
          <div class="avatar-lg" style="width:36px;height:36px;font-size:14px">${r.picture ? `<img src="${safeImgSrc(r.picture)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : esc((r.name || '?')[0])}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(r.name)}${r.isYou ? ' · you' : ''}</div>
            <div style="font-size:11px;color:var(--t3)">${esc(r.region || '—')} · score ${r.score ?? '—'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--font-mono),monospace;font-weight:600;color:var(--m3-primary)">${fmt(r.siteSec)}</div>
            <div style="font-size:10px;color:var(--t3)">on site</div>
          </div>
        </div>`).join('')
        : `<div style="padding:12px;color:var(--t3)">No other members share this site yet.</div>`;
      el.querySelectorAll('.lb-row[data-uid]').forEach(row => {
        row.addEventListener('click', () => openUserProfile(row.dataset.uid));
      });
      _lbHasPainted = true;
      return;
    }

    let ranks = [];
    try {
      ranks = await fetchMySiteRanks(mySites, { period: lbPeriod, skipSync: soft });
    } catch { ranks = []; }
    // Ensure #1 sites first, then #2, etc. (API already sorts; keep stable here too)
    ranks.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (b.mySec || 0) - (a.mySec || 0);
    });
    hideSectionLoading(el);
    if (youBox) {
      youBox.style.display = 'block';
      youBox.innerHTML = `<div style="font-weight:700;margin-bottom:4px">Website battles</div>
        <div style="font-size:13px;color:var(--t2)">Best ranks first — all #1 sites, then #2, then #3. Tap a site for the full board.</div>`;
    }
    if (!ranks.length) {
      el.innerHTML = `<div style="padding:12px;color:var(--t3)">No activity in this period yet — browse a bit, then come back.</div>`;
      return;
    }
    el.innerHTML = ranks.map(s => `
      <div class="lb-row" data-domain="${esc(s.domain)}" style="cursor:pointer">
        <div class="lb-rank">${s.rank}</div>
        <div class="site-fav"><img src="${faviconUrl(s.domain)}" alt="" loading="lazy"/></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${esc(s.domain)}</div>
          <div style="font-size:11px;color:var(--t3)">You #${s.rank} of ${s.of} · ${esc(s.category)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--font-mono),monospace;font-weight:600;color:var(--m3-primary)">${fmt(s.mySec)}</div>
          <div style="font-size:10px;color:var(--t3)">top ${fmt(s.topSec)}</div>
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-domain]').forEach(row => {
      row.addEventListener('click', () => { lbSiteDomain = row.dataset.domain; renderLeaderboard(); });
    });
    _lbHasPainted = true;
    return;
  }

  let rows = [];
  try {
    rows = await fetchLeaderboard({
      scope: lbScope === 'region' ? lbRegion : 'global',
      region: lbScope === 'region' ? lbRegion : 'global',
      period: lbPeriod,
      limit: 100,
      skipSync: soft,
    });
  } catch (e) {
    log.warn('[STT] leaderboard', e);
    rows = [];
  }
  hideSectionLoading(el);

  const me = rows.find(r => r.isYou);
  const streak = settings.streaks?.current || me?.streak || 0;
  if (youBox) {
    youBox.style.display = 'block';
    if (me) {
      youBox.innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="lb-rank" style="background:var(--m3-primary);color:var(--m3-on-primary)">${me.rank}</div>
        <div style="flex:1;min-width:140px">
          <div style="font-weight:700">You · ${esc(me.name)}</div>
          <div style="font-size:12px;color:var(--t2)">${lbScope === 'region' ? esc(regionLabel) : 'Global'} · ${lbPeriodLabel()} · ${rows.length} on board</div>
        </div>
        <div class="lb-metrics">
          <div class="lb-metric"><span class="lb-metric-val">${fmt(me.totalSec)}</span><span class="lb-metric-key">Usage</span></div>
          <div class="lb-metric"><span class="lb-metric-val">${me.score ?? 0}</span><span class="lb-metric-key">Score</span></div>
          <div class="lb-metric"><span class="lb-metric-val">${streak || '—'}</span><span class="lb-metric-key">Streak</span></div>
        </div>
      </div>`;
    } else {
      youBox.innerHTML = `<div style="font-weight:700;margin-bottom:6px">You’re on the board</div>
        <div style="font-size:13px;color:var(--t2)">Browse a bit so real usage syncs — then you’ll rank with everyone else.</div>`;
    }
  }

  if (!rows.length) {
    if (!soft || !_lbHasPainted) {
      el.innerHTML = `<div style="padding:12px;color:var(--t3)">No synced usage on this board yet. Keep browsing — ranks update automatically.</div>`;
    }
    return;
  }

  const aloneHint = rows.length === 1 && rows[0].isYou
    ? `<div class="lb-alone-hint">You’re first on the board. Others appear when they sync real usage.</div>`
    : '';

  const nextHtml = aloneHint + rows.map(lbMemberRow).join('');
  const paintKey = rows.map(r => `${r.id}:${r.rank}:${r.totalSec}:${r.score}:${r.streak}`).join('|');
  if (soft && paintKey === _lbLastPaintKey && _lbHasPainted) {
    // Same data — skip DOM rewrite (no flicker)
  } else {
    el.innerHTML = nextHtml;
    el.querySelectorAll('.lb-row[data-uid]').forEach(row => {
      row.addEventListener('click', () => openUserProfile(row.dataset.uid));
    });
    _lbLastPaintKey = paintKey;
  }
  _lbHasPainted = true;
  } finally {
    _lbRefreshing = false;
  }
}

function stopLbPromptSync() {
  if (_lbSyncTimer) {
    clearTimeout(_lbSyncTimer);
    _lbSyncTimer = null;
  }
}

/** Debounced light profile upsert while Leaderboard is live — avoids hammering pushFullSync. */
function scheduleLbPromptSync({ flush = false, immediate = false } = {}) {
  if (!_lbLive || !user) return;
  stopLbPromptSync();
  const delay = immediate
    ? 0
    : Math.max(LB_SYNC_DEBOUNCE_MS, _lbSyncBackoffMs);
  _lbSyncTimer = setTimeout(async () => {
    _lbSyncTimer = null;
    if (!_lbLive || !user || document.hidden || _lbSyncInFlight) return;
    _lbSyncInFlight = true;
    try {
      if (flush) await msg('FLUSH').catch(() => {});
      const r = await syncProfileViaBackend();
      if (r?.ok === false || r?.skipped) {
        _lbSyncFailStreak = Math.min(6, _lbSyncFailStreak + 1);
        _lbSyncBackoffMs = Math.min(
          LB_SYNC_BACKOFF_MAX_MS,
          LB_SYNC_DEBOUNCE_MS * (2 ** _lbSyncFailStreak),
        );
      } else {
        _lbSyncFailStreak = 0;
        _lbSyncBackoffMs = 0;
      }
    } catch {
      _lbSyncFailStreak = Math.min(6, _lbSyncFailStreak + 1);
      _lbSyncBackoffMs = Math.min(
        LB_SYNC_BACKOFF_MAX_MS,
        LB_SYNC_DEBOUNCE_MS * (2 ** _lbSyncFailStreak),
      );
    } finally {
      _lbSyncInFlight = false;
    }
  }, delay);
}

function lbRefreshIntervalMs() {
  // Aggressive only while Leaderboard is active and the dashboard tab is visible
  if (_lbLive && !document.hidden) return LB_SOFT_REFRESH_MS;
  return LB_CALM_REFRESH_MS;
}

function startLeaderboardAutoRefresh() {
  stopLeaderboardAutoRefresh();
  if (!_lbLive) return;
  const tick = () => {
    const sec = document.getElementById('section-leaderboard');
    if (!sec || sec.style.display === 'none' || sec.hidden) return;
    if (!_lbLive || !user) return;
    if (document.hidden) return;
    scheduleLbPromptSync();
    renderLeaderboard({ soft: true });
  };
  _lbRefreshTimer = setInterval(tick, lbRefreshIntervalMs());
}

function stopLeaderboardAutoRefresh() {
  if (_lbRefreshTimer) {
    clearInterval(_lbRefreshTimer);
    _lbRefreshTimer = null;
  }
}

async function softRefreshSocialSurfaces() {
  if (!user || document.hidden) return;
  const socialSec = $('section-social');
  const profileSec = $('section-profile');
  const socialOpen = socialSec?.classList.contains('active');
  const profileOpen = profileSec?.classList.contains('active');
  if (socialOpen) await renderSocial({ soft: true }).catch(() => {});
  if (profileOpen) await renderProfile({ soft: true }).catch(() => {});
  if (_profileSheetUserId && $('profile-sheet')?.classList.contains('open')) {
    await openUserProfile(_profileSheetUserId, { soft: true }).catch(() => {});
  }
  if (_lbLive) renderLeaderboard({ soft: true }).catch(() => {});
  // Keep Alerts badge fresh without remounting
  refreshNotifDot().catch(() => {});
}

function stopSocialLiveSync() {
  _socialLiveOn = false;
  try { _socialLive?.stop(); } catch {}
  _socialLive = null;
}

function startSocialLiveSync() {
  if (!user) {
    stopSocialLiveSync();
    return;
  }
  if (_socialLiveOn && _socialLive) return;
  stopSocialLiveSync();
  _socialLiveOn = true;
  _socialLive = createSocialLive({
    getAccessToken: async () => {
      const { supabaseSession, stt_user } = await chrome.storage.local.get(['supabaseSession', 'stt_user']);
      return supabaseSession?.access_token || stt_user?.supabaseAccessToken || null;
    },
    onTick: () => {
      softRefreshSocialSurfaces().catch(() => {});
    },
  });
  _socialLive.start().catch(() => {});
}

function personCard(p) {
  const name = p.handle || p.name || 'Member';
  return `<button type="button" class="explore-tile" data-uid="${esc(p.id)}">
    <div style="display:flex;gap:10px;align-items:center">
      <div class="avatar-lg" style="width:40px;height:40px;font-size:15px">${p.picture ? `<img src="${safeImgSrc(p.picture)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : esc(name[0])}</div>
      <div style="min-width:0;flex:1">
        <div class="handle">${esc(name)} ${p.is_private ? '<span class="privacy-lock">Private</span>' : ''}</div>
        <div class="meta">${fmt(p.total_browse_sec || 0)} synced · score ${p.public_score ?? '—'}</div>
      </div>
    </div>
  </button>`;
}

function discoverPersonHtml(p) {
  const name = p.handle || p.name || 'Member';
  return `<div class="discover-row" data-discover-id="${esc(p.id)}">
    <button type="button" class="discover-main" data-uid="${esc(p.id)}">
      <div class="avatar-lg" style="width:40px;height:40px;font-size:15px">${p.picture ? `<img src="${safeImgSrc(p.picture)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : esc(name[0])}</div>
      <div style="min-width:0;flex:1">
        <div class="handle">${esc(name)} ${p.is_private ? '<span class="privacy-lock">Private</span>' : ''}</div>
        <div class="meta">score ${p.public_score ?? '—'}</div>
      </div>
    </button>
    <button type="button" class="btn primary discover-follow" data-follow="${esc(p.id)}" data-private="${p.is_private ? '1' : '0'}">Follow</button>
  </div>`;
}

function wireDiscoverPeople(root) {
  if (!root) return;
  root.querySelectorAll('[data-uid]').forEach(b => {
    b.addEventListener('click', () => openUserProfile(b.dataset.uid));
  });
  root.querySelectorAll('[data-follow]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!user) return chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
      const id = btn.dataset.follow;
      const wasPrivate = btn.dataset.private === '1';
      btn.disabled = true;
      try {
        const r = await followUser(id);
        const pending = r?.status === 'pending' || (wasPrivate && r?.status !== 'accepted');
        btn.textContent = pending ? 'Requested' : 'Following';
        btn.classList.remove('primary');
        btn.disabled = true;
      } catch (err) {
        btn.disabled = false;
        alert(socialUserError(err, 'Follow failed'));
      }
    });
  });
}

function setSocialTab(tab) {
  const next = ['feed', 'discover', 'requests', 'messages'].includes(tab) ? tab : 'feed';
  _socialTab = next;
  document.querySelectorAll('#social-segs .social-seg').forEach(b => {
    b.classList.toggle('on', b.dataset.socialTab === next);
  });
  document.querySelectorAll('[data-social-pane]').forEach(pane => {
    pane.hidden = pane.dataset.socialPane !== next;
  });
  const main = $('social-main');
  if (main) main.classList.toggle('has-rail', next === 'feed');
  if (next === 'messages') {
    if (!messagingAllowed()) {
      const listEl = $('social-chat-list');
      const paneEl = $('social-chat-pane');
      if (listEl) listEl.innerHTML = '';
      if (paneEl) {
        paneEl.innerHTML = messagingUpgradePaneHtml();
        $('msg-pro-upgrade')?.addEventListener('click', goProSection);
      }
      return;
    }
    renderChatHub({ soft: true, keepPeer: true }).catch(() => {});
  }
}

function updateSocialBadges(reqCount = 0, msgUnread = 0) {
  const reqBadge = $('social-req-badge');
  if (reqBadge) {
    const n = Number(reqCount) || 0;
    reqBadge.hidden = n < 1;
    if (n >= 1) reqBadge.textContent = n > 99 ? '99+' : String(n);
  }
  const msgBadge = $('social-msg-badge');
  if (msgBadge) {
    const n = Number(msgUnread) || 0;
    msgBadge.hidden = n < 1;
    if (n >= 1) msgBadge.textContent = n > 99 ? '99+' : String(n);
  }
}

function paintSocialSignedIn(profile) {
  const el = $('social-signed');
  const av = $('social-compose-av');
  const segs = $('social-segs');
  if (segs) segs.hidden = !user;
  const msgSeg = document.querySelector('#social-segs [data-social-tab="messages"]');
  if (msgSeg) {
    const locked = !messagingAllowed();
    msgSeg.classList.toggle('pro-locked', locked);
    if (locked && !msgSeg.querySelector('.stt-pro-tag')) {
      msgSeg.insertAdjacentHTML('beforeend', ` ${proTagHtml('Direct messages are Pro')}`);
    } else if (!locked) {
      msgSeg.querySelector('.stt-pro-tag')?.remove();
    }
  }
  if (!user) {
    if (el) el.textContent = '';
    return;
  }
  const name = profile?.handle || profile?.name || user.email || 'Signed in';
  const initial = String(name).replace(/^@/, '')[0] || '?';
  const pic = profile?.picture;
  if (el) {
    el.innerHTML = `${pic
      ? `<span class="avatar-lg"><img src="${safeImgSrc(pic)}" alt=""/></span>`
      : `<span class="avatar-lg">${esc(initial)}</span>`}<span>${esc(name.startsWith('@') || !profile?.handle ? name : '@' + name)}</span>`;
  }
  if (av) {
    av.innerHTML = pic
      ? `<img src="${safeImgSrc(pic)}" alt="" style="width:100%;height:100%;object-fit:cover"/>`
      : esc(initial);
  }
}

function relativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return String(iso).slice(0, 16);
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return String(iso).slice(0, 10);
}

const VIEW_ICO = `<svg class="feed-view-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const _viewedPosts = new Set();

function applyViewsCount(postId, count) {
  if (count == null) return;
  const id = String(postId);
  document.querySelectorAll('[data-views]').forEach((el) => {
    if (el.getAttribute('data-views') !== id) return;
    const span = el.querySelector('span');
    if (span) span.textContent = String(count);
  });
}

/** Unique view per signed-in viewer; skips own posts; session Set avoids API spam. */
function markThoughtViewed(postId, el) {
  const id = String(postId || '');
  if (!id || !user?.id || _viewedPosts.has(id)) return;
  const uid = el?.dataset?.uid || el?.closest?.('[data-uid]')?.dataset?.uid;
  if (uid && uid === user.id) {
    _viewedPosts.add(id);
    return;
  }
  _viewedPosts.add(id);
  recordPostView(id)
    .then((r) => {
      if (r?.views_count != null) applyViewsCount(id, r.views_count);
    })
    .catch(() => {});
}

function observeThoughtViews(root) {
  if (!root || typeof IntersectionObserver === 'undefined') return;
  if (root._sttViewIo) {
    try { root._sttViewIo.disconnect(); } catch {}
  }
  const nodes = root.querySelectorAll('[data-post]');
  if (!nodes.length) return;
  const dwell = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const id = e.target.dataset.post;
      if (!id) continue;
      if (e.isIntersecting && e.intersectionRatio >= 0.45) {
        if (dwell.has(id) || _viewedPosts.has(id)) continue;
        const t = setTimeout(() => {
          dwell.delete(id);
          markThoughtViewed(id, e.target);
        }, 400);
        dwell.set(id, t);
      } else if (dwell.has(id)) {
        clearTimeout(dwell.get(id));
        dwell.delete(id);
      }
    }
  }, { threshold: [0.45] });
  root._sttViewIo = io;
  nodes.forEach((n) => io.observe(n));
}

function softPatchFeedRow(row, p) {
  if (!row || !p) return;
  const bodyEl = row.querySelector('.feed-body');
  if (bodyEl && bodyEl.textContent !== (p.body || '')) bodyEl.textContent = p.body || '';
  const likeBtn = row.querySelector('[data-like]');
  if (likeBtn) {
    const liked = !!p.liked_by_me;
    likeBtn.classList.toggle('on', liked);
    const span = likeBtn.querySelector('span');
    if (span) span.textContent = String(p.likes_count || 0);
    likeBtn.innerHTML = `${liked ? '♥' : '♡'} <span>${p.likes_count || 0}</span>`;
  }
  const cmtBtn = row.querySelector('[data-comments]');
  if (cmtBtn) {
    const span = cmtBtn.querySelector('span');
    if (span) span.textContent = String(p.comments_count || 0);
  }
  if (p.views_count != null) applyViewsCount(p.id, p.views_count);
}

function softMergeFeed(feedEl, feed, { soft = false } = {}) {
  if (!feedEl) return;
  const list = Array.isArray(feed) ? feed : [];
  if (!list.length) {
    if (soft && _socialHasPainted && feedEl.querySelector('.feed-post')) return;
    feedEl.innerHTML = `<div class="social-empty"><strong>No thoughts yet</strong>Share the first one above.</div>`;
    _socialFeedPaintKey = '';
    return;
  }
  const paintKey = list
    .map((p) => `${p.id}:${p.likes_count}:${p.comments_count}:${p.views_count}:${p.updated_at || p.created_at}:${p.liked_by_me ? 1 : 0}:${(p.body || '').length}`)
    .join('|');
  if (soft && paintKey === _socialFeedPaintKey && _socialHasPainted) return;

  const scrollTop = feedEl.scrollTop;
  const existing = new Map();
  feedEl.querySelectorAll('.feed-post[data-post]').forEach((el) => {
    existing.set(el.dataset.post, el);
  });
  const nextIds = list.map((p) => String(p.id));
  const curIds = [...existing.keys()];
  const sameOrder =
    soft &&
    _socialHasPainted &&
    nextIds.length === curIds.length &&
    nextIds.every((id, i) => id === curIds[i]);

  if (sameOrder) {
    list.forEach((p) => softPatchFeedRow(existing.get(String(p.id)), p));
  } else {
    feedEl.innerHTML = list.map(feedPostHtml).join('');
    wireFeedActions(feedEl);
    feedEl.scrollTop = scrollTop;
  }
  _socialFeedPaintKey = paintKey;
}

function softMergeDiscover(root, list) {
  if (!root) return;
  const people = Array.isArray(list) ? list : [];
  if (!people.length) {
    if (root.querySelector('[data-discover-id]')) return;
    root.innerHTML = `<div class="social-empty"><strong>No members yet</strong>Invite a friend to sign up.</div>`;
    return;
  }
  const cur = [...root.querySelectorAll('[data-discover-id]')].map((el) => el.dataset.discoverId);
  const next = people.map((p) => String(p.id));
  const same = cur.length === next.length && cur.every((id, i) => id === next[i]);
  if (same && cur.length) return;
  root.innerHTML = people.map(discoverPersonHtml).join('');
  wireDiscoverPeople(root);
}

function softMergeRequests(reqEl, reqs, soft) {
  if (!reqEl) return;
  const list = Array.isArray(reqs) ? reqs : [];
  const reqCount = list.length;
  if (!reqCount) {
    if (soft && reqEl.querySelector('.req-row')) {
      // cleared for real — fall through to empty
    }
    reqEl.innerHTML = `<div class="social-empty"><strong>No follow requests</strong>When your account is private, requests show up here.</div>`;
    return;
  }
  const paintKey = list.map((r) => r.user_id).join('|');
  if (soft && reqEl.dataset.reqKey === paintKey) return;
  reqEl.dataset.reqKey = paintKey;
  reqEl.innerHTML = list.map((r) => {
    const n = r.profile?.handle || r.profile?.name || 'User';
    return `<div class="req-row">
      <div class="avatar-lg" style="width:44px;height:44px;font-size:16px;cursor:pointer" data-uid="${esc(r.user_id)}">${r.profile?.picture ? `<img src="${safeImgSrc(r.profile.picture)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : esc(n[0])}</div>
      <div class="req-meta">
        <div class="name" data-uid="${esc(r.user_id)}">${esc(n)}</div>
        <div class="sub">Wants to follow you</div>
      </div>
      <div class="req-actions">
        <button class="btn primary" type="button" data-accept="${esc(r.user_id)}">Confirm</button>
        <button class="btn" type="button" data-reject="${esc(r.user_id)}">Delete</button>
      </div>
    </div>`;
  }).join('');
  reqEl.querySelectorAll('[data-uid]').forEach((b) => {
    b.addEventListener('click', () => openUserProfile(b.dataset.uid));
  });
  reqEl.querySelectorAll('[data-accept]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await acceptFollowRequest(b.dataset.accept);
        await renderSocial({ soft: true });
      } catch (e) {
        b.disabled = false;
        alert(socialUserError(e, 'Could not confirm'));
      }
    });
  });
  reqEl.querySelectorAll('[data-reject]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await rejectFollowRequest(b.dataset.reject);
        await renderSocial({ soft: true });
      } catch (e) {
        b.disabled = false;
        alert(socialUserError(e, 'Could not delete request'));
      }
    });
  });
}

function feedPostHtml(p) {
  const a = p.author;
  const n = a?.handle || a?.name || 'Member';
  const mine = user?.id && p.user_id === user.id;
  const liked = !!p.liked_by_me;
  return `<div class="feed-row feed-post" data-uid="${esc(p.user_id || '')}" data-post="${esc(String(p.id))}">
    <div class="avatar-lg feed-av" style="width:36px;height:36px;font-size:14px;cursor:pointer" data-open-profile="${esc(p.user_id || '')}">${a?.picture ? `<img src="${safeImgSrc(a.picture)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : esc(n[0])}</div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
        <button type="button" class="feed-author" data-open-profile="${esc(p.user_id || '')}">${esc(n)}</button>
        <span style="font-size:10px;color:var(--t3)">${esc(relativeTime(p.created_at))}${p.updated_at && p.updated_at !== p.created_at ? ' · edited' : ''}</span>
      </div>
      <div class="feed-body" style="font-size:13px;margin-top:4px;white-space:pre-wrap">${esc(p.body)}</div>
      <div class="feed-actions">
        <button type="button" class="feed-act ${liked ? 'on' : ''}" data-like="${esc(String(p.id))}" aria-label="Like">${liked ? '♥' : '♡'} <span>${p.likes_count || 0}</span></button>
        <button type="button" class="feed-act" data-comments="${esc(String(p.id))}" aria-label="Comments">💬 <span>${p.comments_count || 0}</span></button>
        <span class="feed-act feed-views" data-views="${esc(String(p.id))}" aria-label="Views">${VIEW_ICO} <span>${p.views_count || 0}</span></span>
        ${mine ? `<button type="button" class="feed-act" data-edit="${esc(String(p.id))}">Edit</button>
        <button type="button" class="feed-act danger" data-del="${esc(String(p.id))}">Delete</button>` : ''}
      </div>
      <div class="feed-comments" id="comments-${esc(String(p.id))}" hidden></div>
    </div>
  </div>`;
}

function wireFeedActions(root) {
  if (!root) return;
  observeThoughtViews(root);
  root.querySelectorAll('[data-open-profile]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.openProfile;
      if (id) openUserProfile(id);
    });
  });
  root.querySelectorAll('[data-like]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.like;
      const on = btn.classList.contains('on');
      const span = btn.querySelector('span');
      const prev = Number(span?.textContent || 0);
      const nextCount = Math.max(0, prev + (on ? -1 : 1));
      btn.classList.toggle('on', !on);
      btn.innerHTML = `${!on ? '♥' : '♡'} <span>${nextCount}</span>`;
      try {
        if (on) await unlikePost(id);
        else await likePost(id);
      } catch (err) {
        btn.classList.toggle('on', on);
        btn.innerHTML = `${on ? '♥' : '♡'} <span>${prev}</span>`;
        alert(socialUserError(err, 'Could not update like'));
      }
    });
  });
  root.querySelectorAll('[data-comments]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.comments;
      const box = document.getElementById(`comments-${id}`);
      if (!box) return;
      markThoughtViewed(id, btn.closest('[data-post]'));
      if (!box.hidden && box.dataset.loaded === '1') {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      box.innerHTML = `<div style="padding:8px;color:var(--t3);font-size:12px">Loading…</div>`;
      try {
        const comments = await listPostComments(id);
        box.dataset.loaded = '1';
        const listHtml = (comments || []).length
          ? comments.map(c => {
            const n = c.author?.handle || c.author?.name || 'Member';
            return `<div class="comment-row"><strong>${esc(n)}</strong> ${esc(c.body)}
              <div style="font-size:10px;color:var(--t3)">${esc(relativeTime(c.created_at))}</div></div>`;
          }).join('')
          : `<div style="font-size:12px;color:var(--t3);padding:4px 0">No comments yet</div>`;
        box.innerHTML = `
          <div class="comment-list">${listHtml}</div>
          <div class="task-row" style="margin-top:8px">
            <input class="task-inp" id="cmt-inp-${esc(id)}" maxlength="300" placeholder="Add a comment"/>
            <button class="task-add-btn" type="button" data-send-cmt="${esc(id)}">Post</button>
          </div>`;
        box.querySelector(`[data-send-cmt="${id}"]`)?.addEventListener('click', async () => {
          const inp = document.getElementById(`cmt-inp-${id}`);
          const text = inp?.value.trim();
          if (!text) return;
          try {
            await commentOnPost(id, text);
            const countSpan = btn.querySelector('span');
            if (countSpan) countSpan.textContent = String(Number(countSpan.textContent || 0) + 1);
            box.dataset.loaded = '0';
            box.hidden = true;
            btn.click();
          } catch (err) {
            alert(socialUserError(err, 'Could not comment'));
          }
        });
      } catch (err) {
        box.innerHTML = `<div style="padding:8px;color:var(--t2);font-size:12px">${esc(socialUserError(err))}</div>`;
      }
    });
  });
  root.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.edit;
      const row = btn.closest('.feed-post');
      const bodyEl = row?.querySelector('.feed-body');
      const cur = bodyEl?.textContent || '';
      const next = prompt('Edit thought', cur);
      if (next == null) return;
      const text = next.trim().slice(0, 500);
      if (!text) return;
      try {
        await updatePost(id, text);
        if (bodyEl) bodyEl.textContent = text;
      } catch (err) {
        alert(socialUserError(err, 'Could not edit'));
      }
    });
  });
  root.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this thought?')) return;
      try {
        await deletePost(btn.dataset.del);
        btn.closest('.feed-post')?.remove();
      } catch (err) {
        alert(socialUserError(err, 'Could not delete'));
      }
    });
  });
}

function systemWelcomeBubbleHtml() {
  return `<div class="msg-bubble system" role="note">
    <div class="msg-meta">${esc(STT_CHAT_WELCOME.from)}</div>
    ${esc(STT_CHAT_WELCOME.body)}
  </div>`;
}

function chatConvItemHtml(c) {
  const p = c.peer || {};
  const name = p.handle || p.name || 'Member';
  const preview = c.last_message?.body || 'Start chatting';
  const unread = Number(c.unread) || 0;
  const active = _chatPeerId === c.peer_id ? 'active' : '';
  return `<button type="button" class="chat-conv-item ${active}" data-chat-peer="${esc(c.peer_id)}" data-chat-name="${esc(name)}">
    <div class="avatar-lg" style="width:36px;height:36px;font-size:14px;flex-shrink:0">${p.picture ? `<img src="${safeImgSrc(p.picture)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : esc(name[0])}</div>
    <div style="min-width:0;flex:1">
      <div class="name">${esc(name)}${unread ? `<span class="chat-unread">${unread > 9 ? '9+' : unread}</span>` : ''}</div>
      <div class="preview">${esc(preview)}</div>
    </div>
  </button>`;
}

function renderChatThreadHtml(peerName, messages, { compose = true } = {}) {
  const rows = [
    systemWelcomeBubbleHtml(),
    ...(messages || []).map(m => {
      const mine = m.sender_id === user?.id;
      return `<div class="msg-bubble ${mine ? 'mine' : ''}">${esc(m.body)}
        <div class="msg-meta">${esc(relativeTime(m.created_at))}</div></div>`;
    }),
  ];
  return `
    <div class="chat-pane-head">
      <div>
        <div style="font-weight:700;font-size:15px">${esc(peerName || 'Chat')}</div>
        <div style="font-size:11px;color:var(--t3)">Direct message · private</div>
      </div>
    </div>
    <div class="msg-thread chat-thread-scroll">${rows.join('')}</div>
    ${compose ? `<div class="chat-compose">
      <textarea class="task-inp chat-msg-inp" maxlength="1000" rows="1" placeholder="Write a message…" autocomplete="off" aria-label="Message"></textarea>
      <button class="chat-send-btn chat-msg-send" type="button" aria-label="Send message" title="Send">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 12h14M13 6l7 6-7 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>` : ''}`;
}

function renderChatHubEmpty() {
  return `<div class="chat-empty">
    ${systemWelcomeBubbleHtml()}
    <div style="margin-top:14px">No conversations yet. Open a profile and tap <strong>Message</strong>, or pick someone from Discover.</div>
  </div>`;
}

async function loadChatThreadInto(pane, peerId, peerName) {
  if (!pane || !peerId) return;
  pane.innerHTML = `<div class="chat-empty">Loading messages…</div>`;
  const messages = await fetchMessageThread(peerId);
  await markMessagesRead(peerId);
  pane.innerHTML = renderChatThreadHtml(peerName, messages);
  const thread = pane.querySelector('.chat-thread-scroll');
  if (thread) thread.scrollTop = thread.scrollHeight;

  let sending = false;
  const send = async () => {
    const inp = pane.querySelector('.chat-msg-inp');
    const text = (inp?.value || '').trim();
    if (!text || sending) return;
    sending = true;
    const btn = pane.querySelector('.chat-msg-send');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-sending');
    }
    const tempId = `tmp-${Date.now()}`;
    const scroll = pane.querySelector('.chat-thread-scroll');
    if (scroll) {
      scroll.insertAdjacentHTML(
        'beforeend',
        `<div class="msg-bubble mine pending" data-temp="${tempId}">${esc(text)}
          <div class="msg-meta">Sending…</div></div>`,
      );
      scroll.scrollTop = scroll.scrollHeight;
    }
    if (inp) inp.value = '';
    try {
      await sendDirectMessage(peerId, text);
      const bub = pane.querySelector(`[data-temp="${tempId}"]`);
      if (bub) {
        bub.classList.remove('pending');
        const meta = bub.querySelector('.msg-meta');
        if (meta) meta.textContent = 'Just now';
        bub.removeAttribute('data-temp');
      }
      // Refresh conversation list only — avoid full thread reload lag
      renderChatHub({ soft: true, keepPeer: true, listOnly: true }).catch(() => {});
    } catch (e) {
      pane.querySelector(`[data-temp="${tempId}"]`)?.remove();
      if (inp) inp.value = text;
      alert(socialUserError(e, 'Could not send'));
    } finally {
      sending = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-sending');
      }
      inp?.focus();
    }
  };
  pane.querySelector('.chat-msg-send')?.addEventListener('click', send);
  pane.querySelector('.chat-msg-inp')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
}

async function renderChatHub(opts = {}) {
  const listEl = $('social-chat-list');
  const paneEl = $('social-chat-pane');
  if (!listEl || !paneEl || !user) return;

  if (!messagingAllowed()) {
    listEl.innerHTML = '';
    paneEl.innerHTML = messagingUpgradePaneHtml();
    $('msg-pro-upgrade')?.addEventListener('click', goProSection);
    return;
  }

  if (!opts.soft || !_chatConversations.length) {
    listEl.innerHTML = `<div style="padding:10px;color:var(--t3);font-size:12px">Loading chats…</div>`;
  }

  try {
    const inbox = await fetchMessageInbox();
    _chatConversations = Array.isArray(inbox.conversations) ? inbox.conversations : [];
  } catch {
    if (!opts.soft) _chatConversations = [];
  }

  if (opts.peerId) {
    _chatPeerId = opts.peerId;
    _chatPeerName = opts.peerName || _chatPeerName || 'Member';
  }

  if (_chatPeerId && !_chatConversations.some(c => c.peer_id === _chatPeerId)) {
    _chatConversations = [
      {
        peer_id: _chatPeerId,
        peer: { id: _chatPeerId, name: _chatPeerName || 'Member' },
        last_message: null,
        unread: 0,
      },
      ..._chatConversations,
    ];
  }

  listEl.innerHTML = _chatConversations.length
    ? _chatConversations.map(chatConvItemHtml).join('')
    : `<div style="padding:10px;color:var(--t3);font-size:12px;line-height:1.4">No threads yet — message someone from their profile.</div>`;

  listEl.querySelectorAll('[data-chat-peer]').forEach(btn => {
    btn.addEventListener('click', () => {
      _chatPeerId = btn.dataset.chatPeer;
      _chatPeerName = btn.dataset.chatName || 'Member';
      listEl.querySelectorAll('.chat-conv-item').forEach(el => el.classList.toggle('active', el === btn));
      loadChatThreadInto(paneEl, _chatPeerId, _chatPeerName);
    });
  });

  if (opts.listOnly) return;

  if (_chatPeerId) {
    await loadChatThreadInto(paneEl, _chatPeerId, _chatPeerName || 'Member');
  } else {
    paneEl.innerHTML = renderChatHubEmpty();
  }
}

async function openMessageSheet(peerId, peerName) {
  if (!messagingAllowed()) {
    goProSection();
    return;
  }
  _chatPeerId = peerId;
  _chatPeerName = peerName || 'Member';

  // Prefer inline Community Messages tab when Community is open
  const hubCard = $('social-chat-card');
  const paneEl = $('social-chat-pane');
  const socialSec = $('section-social');
  if (hubCard && paneEl && socialSec && socialSec.style.display !== 'none') {
    setSocialTab('messages');
    await renderChatHub({ peerId, peerName: _chatPeerName });
  }

  const sheet = $('message-sheet');
  const card = $('message-sheet-card');
  if (!sheet || !card) return;
  sheet.hidden = false;
  sheet.classList.add('open');
  card.classList.add('chat-sheet');
  const close = () => {
    sheet.classList.remove('open');
    sheet.hidden = true;
  };
  sheet.onclick = e => { if (e.target === sheet) close(); };

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px">
      <div>
        <div style="font-weight:700;font-size:16px">${esc(_chatPeerName)}</div>
        <div style="font-size:11px;color:var(--t3)">Messages · Screen Time Tracker</div>
      </div>
      <button class="btn" type="button" id="msg-close">Close</button>
    </div>
    <div class="chat-pane" id="msg-sheet-pane" style="min-height:min(56vh,480px)"></div>`;
  $('msg-close')?.addEventListener('click', close);
  await loadChatThreadInto($('msg-sheet-pane'), peerId, _chatPeerName);
  // Keep hub in sync after opening from profile
  if (paneEl) renderChatHub({ peerId, peerName: _chatPeerName, soft: true }).catch(() => {});
}

async function openUserProfile(userId, opts = {}) {
  if (!user) {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
    return;
  }
  const soft = !!opts.soft;
  const sheet = $('profile-sheet');
  const card = $('profile-sheet-card');
  if (!sheet || !card) return;
  _profileSheetUserId = userId;

  if (!soft || !sheet.classList.contains('open')) {
    sheet.hidden = false;
    sheet.classList.add('open');
    if (!soft) card.innerHTML = `<div style="padding:24px;color:var(--t3)">Loading profile…</div>`;
  }

  const close = () => {
    sheet.classList.remove('open');
    sheet.hidden = true;
    _profileSheetUserId = null;
  };
  sheet.onclick = e => { if (e.target === sheet) close(); };

  let view;
  try {
    view = await getUserProfileView(userId);
  } catch (e) {
    if (soft && card.querySelector('.pf-ig')) return;
    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <div style="color:var(--t2)">${esc(socialUserError(e, 'Could not load profile'))}</div>
      <button class="btn" type="button" id="ps-close">Close</button></div>`;
    $('ps-close')?.addEventListener('click', close);
    return;
  }

  const p = view.profile;
  const display = pfDisplayName(p, 'Member');
  const handleAt = pfHandleAt(p.handle, p.name);
  const postCount = effectivePostCount(p, view.posts);

  // Soft: only patch stats + thoughts while sheet already open for same user
  if (soft && card.querySelector('.pf-ig-stats[data-pf-stats="ps"]') && _profileSheetUserId === userId) {
    softPatchPfStats(card, { ...p, posts_count: postCount }, view.canSee ? view.posts : []);
    if (view.canSee) softMergeThoughtGrid($('ps-tab-thoughts'), view.posts, { isSelf: !!view.isSelf });
    return;
  }

  const rel = view.relation?.status;
  let actionBtn = '';
  if (view.isSelf) {
    actionBtn = `<button class="btn grow" type="button" id="ps-goto-edit">Edit profile</button>`;
  } else if (rel === 'accepted') {
    actionBtn = `<button class="btn grow" type="button" id="ps-unfollow" title="Tap to unfollow">Following</button>`;
  } else if (rel === 'pending') {
    actionBtn = `<button class="btn grow" type="button" disabled>Requested</button>`;
  } else if (p.is_private) {
    actionBtn = `<button class="btn primary grow" type="button" id="ps-follow">Follow</button>`;
  } else {
    actionBtn = `<button class="btn primary grow" type="button" id="ps-follow">Follow</button>`;
  }

  const msgBtn = view.isSelf
    ? ''
    : !messagingAllowed()
      ? `<button class="btn grow" type="button" id="ps-message-pro" title="Direct messages are Pro">Message ${proTagHtml('Direct messages are Pro')}</button>`
      : view.canMessage
        ? `<button class="btn primary grow" type="button" id="ps-message">Message</button>`
        : `<button class="btn grow" type="button" id="ps-message-locked" title="Follow each other or open a public account to message">Message</button>`;

  const sitesHtml = view.canSee
    ? (view.topSites.length
      ? view.topSites.map(s => `
        <div class="site-row" style="margin-bottom:8px">
          <div class="site-fav"><img src="${faviconUrl(s.domain)}" alt="" loading="lazy"/></div>
          <div style="min-width:0;flex:1">
            <div style="font-weight:600;font-size:13px">${esc(s.domain)}</div>
            <div style="font-size:11px;color:var(--t3);text-transform:capitalize">${esc(s.category || 'other')}</div>
          </div>
          <span class="site-tv">${fmt(s.sec)}</span>
        </div>`).join('')
      : `<div class="social-empty" style="padding:16px"><strong>No synced sites yet</strong></div>`)
    : '';

  const postsBlock = view.canSee
    ? pfThoughtGridHtml(view.posts, { isSelf: !!view.isSelf })
    : `<div class="pf-ig-private-hint">
        <span class="privacy-lock">Private account</span>
        <div>Request to follow to see thoughts and top sites.</div>
      </div>`;

  card.innerHTML = `<div class="pf-ig">
    <div class="pf-ig-head">
      ${pfAvatarHtml(p.picture, display)}
      <div class="pf-ig-meta">
        <div class="pf-ig-name">${esc(display)}${p.is_private ? ' <span class="privacy-lock">Private</span>' : ''}</div>
        <div class="pf-ig-handle">${esc(handleAt)}</div>
        ${pfStatsRowHtml({ posts_count: postCount, followers_count: p.followers_count, following_count: p.following_count }, 'ps')}
      </div>
    </div>
    <div class="pf-ig-bio ${p.bio ? '' : 'empty'}">${esc(p.bio || 'Screen Time member')}</div>
    <div class="pf-ig-actions">${actionBtn}${msgBtn}<button class="btn" type="button" id="ps-close">Close</button></div>
    <div class="pf-ig-list-panel" id="ps-list-panel"></div>
    <div class="pf-ig-section">
      <div class="pf-ig-tabs" role="tablist">
        <button type="button" class="pf-ig-tab on" data-ps-tab="thoughts" role="tab" aria-selected="true">Thoughts</button>
        ${view.canSee ? `<button type="button" class="pf-ig-tab" data-ps-tab="sites" role="tab" aria-selected="false">Sites</button>` : ''}
      </div>
      <div id="ps-tab-thoughts">${postsBlock}</div>
      <div id="ps-tab-sites" hidden>${sitesHtml}</div>
    </div>
    <div class="thought-only-note">Thoughts are text-only so profiles stay fast.</div>
  </div>`;

  observeThoughtViews($('ps-tab-thoughts'));

  card.querySelectorAll('[data-ps-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const which = tab.dataset.psTab;
      card.querySelectorAll('[data-ps-tab]').forEach(t => {
        const on = t.dataset.psTab === which;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const th = $('ps-tab-thoughts');
      const si = $('ps-tab-sites');
      if (th) th.hidden = which !== 'thoughts';
      if (si) si.hidden = which !== 'sites';
    });
  });

  $('ps-close')?.addEventListener('click', close);
  $('ps-goto-edit')?.addEventListener('click', () => {
    close();
    document.querySelector('.sb-link[data-section="profile"]')?.click();
    setTimeout(() => $('pf-edit-toggle')?.click(), 80);
  });
  $('ps-follow')?.addEventListener('click', async () => {
    try {
      await followUser(userId);
      openUserProfile(userId);
      renderSocial({ soft: true });
    } catch (e) { alert(socialUserError(e, 'Follow failed')); }
  });
  $('ps-unfollow')?.addEventListener('click', async () => {
    try {
      await unfollowUser(userId);
      openUserProfile(userId);
      renderSocial({ soft: true });
    } catch (e) { alert(socialUserError(e, 'Unfollow failed')); }
  });
  $('ps-message')?.addEventListener('click', () => {
    close();
    openMessageSheet(userId, display);
  });
  $('ps-message-pro')?.addEventListener('click', () => {
    close();
    goProSection();
  });
  $('ps-message-locked')?.addEventListener('click', () => {
    alert('Messaging is available for public accounts, or when either of you has an accepted follow.');
  });

  const showPeople = async (kind) => {
    const panel = $('ps-list-panel');
    if (!panel) return;
    panel.innerHTML = `<div style="padding:10px;color:var(--t3);font-size:12px;margin-top:12px">Loading…</div>`;
    try {
      const people = kind === 'followers' ? await listFollowers(userId) : await listFollowing(userId);
      panel.innerHTML = `<div class="card-hd" style="margin-top:4px;margin-bottom:8px">${kind === 'followers' ? 'Followers' : 'Following'}</div>
        ${(people || []).length
          ? `<div class="explore-grid">${people.map(personCard).join('')}</div>`
          : `<div class="social-empty" style="padding:16px"><strong>No one here yet</strong></div>`}`;
      panel.querySelectorAll('[data-uid]').forEach(b => {
        b.addEventListener('click', () => openUserProfile(b.dataset.uid));
      });
    } catch (e) {
      panel.innerHTML = `<div style="padding:10px;color:var(--t2);font-size:12px">${esc(socialUserError(e))}</div>`;
    }
  };
  $('ps-followers')?.addEventListener('click', () => showPeople('followers'));
  $('ps-following')?.addEventListener('click', () => showPeople('following'));
}

async function renderSocial(opts = {}) {
  const soft = !!opts.soft;
  const guest = $('social-guest');
  const main = $('social-main');
  const gate = checkFeature('community', { user, plan: planInfo.plan });
  if (!gate.ok || !user) {
    if (guest) guest.hidden = false;
    if (main) main.hidden = true;
    const segs = $('social-segs');
    if (segs) segs.hidden = true;
    paintSocialSignedIn(null);
    updateSocialBadges(0, 0);
    _socialHasPainted = false;
    _socialFeedPaintKey = '';
    stopSocialLiveSync();
    return;
  }
  if (guest) guest.hidden = true;
  if (main) main.hidden = false;

  if (!soft) msg('CLOUD_SYNC_NOW').catch(() => {});

  const exploreEl = $('social-explore');
  const railEl = $('social-rail-explore');
  const feedEl = $('social-feed');
  const reqEl = $('social-requests');

  if (!soft || !_socialHasPainted) {
    if (exploreEl && !exploreEl.children.length) {
      exploreEl.innerHTML = `<div class="social-empty">Loading people…</div>`;
    }
    if (feedEl && !feedEl.children.length) {
      feedEl.innerHTML = `<div class="social-empty">Loading thoughts…</div>`;
    }
  }

  if (_socialRefreshing && soft) return;
  _socialRefreshing = true;
  let people, reqs, feed, me, inbox;
  try {
    [people, reqs, feed, me, inbox] = await Promise.all([
      explorePeople(24).catch(() => soft ? null : []),
      listFollowRequests().catch(() => soft ? null : []),
      fetchFeedWithAuthors(40).catch(() => soft ? null : []),
      getMyProfile().catch(() => null),
      fetchMessageInbox().catch(() => soft ? null : ({ conversations: [], unread_total: 0 })),
    ]);
  } finally {
    _socialRefreshing = false;
  }

  // Soft: keep prior UI if a fetch failed (null) — never wipe to empty then refill
  if (people == null && soft) people = undefined;
  if (reqs == null && soft) reqs = undefined;
  if (feed == null && soft) feed = undefined;
  if (inbox == null && soft) inbox = undefined;

  paintSocialSignedIn(me);
  setSocialTab(_socialTab);

  if (people !== undefined) {
    const list = (people || []).filter(p => p.id !== user.id);
    if (exploreEl) softMergeDiscover(exploreEl, list);
    if (railEl) {
      const railList = list.slice(0, 8);
      if (!railList.length) {
        if (!railEl.querySelector('[data-discover-id]')) {
          railEl.innerHTML = `<div class="social-empty" style="padding:12px">No one to discover yet</div>`;
        }
      } else {
        softMergeDiscover(railEl, railList);
      }
    }
  }

  if (reqs !== undefined) {
    const reqCount = Array.isArray(reqs) ? reqs.length : 0;
    const msgUnread = inbox !== undefined ? (Number(inbox?.unread_total) || 0) : undefined;
    if (msgUnread !== undefined) updateSocialBadges(reqCount, msgUnread);
    else updateSocialBadges(reqCount, Number($('social-msg-badge')?.textContent) || 0);
    softMergeRequests(reqEl, reqs || [], soft);
  } else if (inbox !== undefined) {
    const reqBadge = $('social-req-badge');
    const reqN = reqBadge && !reqBadge.hidden ? (Number(reqBadge.textContent) || 0) : 0;
    updateSocialBadges(reqN, Number(inbox?.unread_total) || 0);
  }

  if (feed !== undefined) {
    softMergeFeed(feedEl, feed || [], { soft });
  }

  if (_socialTab === 'messages' || !soft) {
    await renderChatHub({ soft: !!soft, keepPeer: true }).catch(() => {});
  }
  _socialHasPainted = true;
  startSocialLiveSync();
}

async function renderNotifications() {
  const el = $('notif-list'); if (!el) return;
  showSectionLoading(el, 'Loading alerts…');
  await refreshActivityFeed({ rangeData, settings }).catch(() => {});
  const local = await listLocalNotifications().catch(() => []);
  const cloud = user ? await listNotifications().catch(() => []) : [];
  const rows = mergeNotificationFeeds(local, Array.isArray(cloud) ? cloud : []);
  hideSectionLoading(el);
  if (!rows.length) {
    el.innerHTML = `<div style="padding:12px;color:var(--t3)">Inbox clear. Activity tips appear as you browse, hit goals, or approach limits.</div>`;
    refreshNotifDot();
    return;
  }
  el.innerHTML = rows.map(n => {
    const from = n.payload?.from;
    return `<div class="notif-row ${n.read_at ? '' : 'notif-unread'}" ${from ? `data-uid="${esc(from)}"` : ''}>
      <div style="flex:1">
        <div style="font-weight:700;font-size:13px">${esc(n.title)}</div>
        <div style="font-size:12px;color:var(--t2);margin-top:4px">${esc(n.body || '')}</div>
        <div style="font-size:10px;color:var(--t3);margin-top:4px">${esc(n.type || 'update')} · ${esc((n.created_at || '').slice(0, 16))}</div>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-uid]').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => openUserProfile(row.dataset.uid));
  });
  refreshNotifDot();
}

async function refreshNotifDot() {
  const localUnread = await unreadLocalCount().catch(() => 0);
  let cloudUnread = 0;
  if (user) {
    const rows = await listNotifications().catch(() => []);
    cloudUnread = (rows || []).filter(n => !n.read_at).length;
  }
  const unread = localUnread + cloudUnread;
  const label = unread > 99 ? '99+' : String(unread);
  const dot = $('nav-notif-dot');
  if (dot) dot.hidden = unread < 1;
  const badge = $('stt-notif-badge');
  if (badge) {
    badge.hidden = unread < 1;
    if (unread >= 1) badge.textContent = label;
  }
  const topBadge = $('top-nav-notif-badge');
  if (topBadge) {
    topBadge.hidden = unread < 1;
    if (unread >= 1) topBadge.textContent = label;
  }
}

async function renderNotifPanelList() {
  const list = $('stt-notif-panel-list');
  if (!list) return;
  showSectionLoading(list, 'Updating…');
  await refreshActivityFeed({ rangeData, settings }).catch(() => {});
  const local = await listLocalNotifications().catch(() => []);
  const cloud = user ? await listNotifications().catch(() => []) : [];
  const rows = mergeNotificationFeeds(local, Array.isArray(cloud) ? cloud : []);
  hideSectionLoading(list);
  list.innerHTML = rows.length
    ? rows.slice(0, 25).map(n => `<div class="notif-row ${n.read_at ? '' : 'notif-unread'}"><div style="flex:1"><div style="font-weight:700;font-size:12px">${esc(n.title)}</div><div style="font-size:11px;color:var(--t2);margin-top:3px">${esc(n.body || '')}</div></div></div>`).join('')
    : `<div style="padding:10px;color:var(--t3);font-size:12px">No notifications yet. Keep browsing — tips show up here.</div>`;
}

function planNiceName(plan) {
  if (plan === 'lifetime') return 'Lifetime';
  if (plan === 'yearly') return 'Yearly';
  if (plan === 'monthly') return 'Monthly';
  if (plan === 'quarterly') return '3 Months';
  return 'Free';
}

function wirePlanBadgeClicks(root = document) {
  root.querySelectorAll('[data-plan-badge]').forEach((el) => {
    if (el.dataset.wired === '1') return;
    el.dataset.wired = '1';
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPlanSheet();
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  });
}

function openPlanSheet() {
  const sheet = $('stt-plan-sheet');
  const card = $('stt-plan-sheet-card');
  if (!sheet || !card) {
    goProSection();
    return;
  }
  const exp = expiryMs(planInfo.expiresAt);
  if (planInfo.isPro) {
    const ends =
      planInfo.plan === 'lifetime'
        ? 'Never ends'
        : exp
          ? new Date(exp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
          : 'See your receipt email';
    card.innerHTML = `
      <h3 id="stt-plan-sheet-title">Pro Plan</h3>
      <p class="ps-sub">You are on Pro. Here is a quick look at your access.</p>
      <div class="ps-rows">
        <div class="ps-row"><span>Plan</span><strong>${esc(planNiceName(planInfo.plan))}</strong></div>
        <div class="ps-row"><span>Status</span><strong>Active</strong></div>
        <div class="ps-row"><span>${planInfo.plan === 'lifetime' ? 'Ends' : 'Renews / ends'}</span><strong>${esc(ends)}</strong></div>
        <div class="ps-row"><span>Email</span><strong>${esc(user?.email || 'Signed in account')}</strong></div>
      </div>
      <div class="stt-plan-sheet-actions">
        <button type="button" class="btn primary" id="stt-plan-sheet-go">View plans</button>
        <button type="button" class="btn ghost" id="stt-plan-sheet-close">Close</button>
      </div>`;
  } else {
    card.innerHTML = `
      <h3 id="stt-plan-sheet-title">Upgrade to Pro</h3>
      <p class="ps-sub">You are on Free right now. Pro unlocks Hard Lock, longer history, sync, and the tools that make focus stick.</p>
      <div class="ps-rows">
        <div class="ps-row"><span>Monthly</span><strong>$4.71 · ₹380 <small style="font-weight:500;opacity:.7">incl. tax</small></strong></div>
        <div class="ps-row"><span>Yearly</span><strong>$35.39 · ₹2,853 <small style="font-weight:500;opacity:.7">incl. tax</small></strong></div>
        <div class="ps-row"><span>Lifetime</span><strong>$94.39 · ₹7,609 <small style="font-weight:500;opacity:.7">incl. tax</small></strong></div>
      </div>
      <div class="stt-plan-sheet-actions">
        <button type="button" class="btn primary" id="stt-plan-sheet-go">See Pro plans</button>
        <button type="button" class="btn ghost" id="stt-plan-sheet-close">Not now</button>
      </div>`;
  }
  sheet.hidden = false;
  const close = () => { sheet.hidden = true; };
  $('stt-plan-sheet-close')?.addEventListener('click', close);
  $('stt-plan-sheet-go')?.addEventListener('click', () => {
    close();
    goProSection();
  });
  sheet.onclick = (e) => {
    if (e.target === sheet) close();
  };
}

function ensureProWatermark() {
  const host = $('stt-top-plan');
  if (host) {
    host.innerHTML = planBadgeHtml({
      isPro: planInfo.isPro,
      plan: planInfo.plan,
      expiresAt: planInfo.expiresAt,
      interactive: true,
    });
    wirePlanBadgeClicks(host);
  }
  const el = $('stt-pro-watermark');
  if (el) el.hidden = true;
}

function wireNotifBell() {
  const bell = $('stt-notif-bell');
  const panel = $('stt-notif-panel');
  if (!bell || !panel) return;
  bell.addEventListener('click', async (e) => {
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    bell.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      await renderNotifPanelList();
      await markLocalNotificationsRead();
      if (user) await markNotificationsRead().catch(() => {});
      refreshNotifDot();
    }
  });
  $('stt-notif-mark')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await markLocalNotificationsRead();
    if (user) await markNotificationsRead().catch(() => {});
    await renderNotifPanelList();
    refreshNotifDot();
    renderNotifications();
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !bell.contains(e.target)) {
      panel.hidden = true;
      bell.setAttribute('aria-expanded', 'false');
    }
  });
}

function wireCommunity() {
  $('lb-filters')?.addEventListener('click', e => {
    const b = e.target.closest('.fb'); if (!b) return;
    document.querySelectorAll('#lb-filters .fb').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    lbScope = b.dataset.scope || 'global';
    lbSiteDomain = null;
    if (lbScope === 'region') lbRegion = settings.region || detectRegion();
    renderLeaderboard();
  });
  $('lb-periods')?.addEventListener('click', e => {
    const b = e.target.closest('[data-period]'); if (!b) return;
    lbPeriod = b.dataset.period || 'week';
    renderLeaderboard();
  });
  $('lb-regions')?.addEventListener('click', e => {
    const b = e.target.closest('[data-region]'); if (!b) return;
    lbRegion = b.dataset.region;
    settings.region = lbRegion;
    settings.regionChosen = true;
    dsave();
    updateProfile({ region: lbRegion }).catch(() => {});
    renderLeaderboard();
  });
  $('lb-signin')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
  });
  $('social-signin')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
  });
  $('social-segs')?.addEventListener('click', e => {
    const b = e.target.closest('[data-social-tab]');
    if (!b) return;
    setSocialTab(b.dataset.socialTab);
  });
  $('social-chat-refresh')?.addEventListener('click', () => {
    if (!user) return chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
    renderChatHub({ keepPeer: true }).catch(() => {});
  });
  const compose = $('social-compose');
  const countEl = $('social-char-count');
  const updateCount = () => {
    if (!countEl || !compose) return;
    const n = (compose.value || '').length;
    countEl.textContent = `${n}/500`;
    countEl.classList.toggle('near-limit', n >= 450);
  };
  compose?.addEventListener('input', updateCount);
  updateCount();
  $('social-post-btn')?.addEventListener('click', async () => {
    if (!user) return chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
    const body = $('social-compose')?.value.trim();
    if (!body) return;
    const btn = $('social-post-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    try {
      await createPost(body);
      $('social-compose').value = '';
      updateCount();
      setSocialTab('feed');
      await renderSocial({ soft: true });
    } catch (e) { alert(socialUserError(e, 'Post failed')); }
    finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Post'; }
    }
  });
  $('social-search-btn')?.addEventListener('click', async () => {
    if (!user) return chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
    const q = $('social-search')?.value.trim();
    const box = $('social-search-results');
    const btn = $('social-search-btn');
    if (!q) {
      if (box) box.innerHTML = `<div class="social-empty" style="padding:12px">Type a name or handle to search</div>`;
      $('social-search')?.focus();
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
    }
    if (box) box.innerHTML = `<div style="color:var(--t3);font-size:12px;padding:8px 0">Searching…</div>`;
    try {
      const results = await searchProfiles(q);
      if (!box) return;
      box.innerHTML = (results || []).length
        ? (results || []).map(discoverPersonHtml).join('')
        : `<div class="social-empty" style="padding:12px">No matches for “${esc(q)}”</div>`;
      wireDiscoverPeople(box);
    } catch (e) {
      if (box) box.innerHTML = `<div style="color:var(--t2);font-size:12px">${esc(socialUserError(e))}</div>`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }
  });
  let _socialSearchTimer = 0;
  $('social-search')?.addEventListener('input', () => {
    clearTimeout(_socialSearchTimer);
    const q = $('social-search')?.value.trim();
    if (!q) {
      const box = $('social-search-results');
      if (box) box.innerHTML = '';
      return;
    }
    _socialSearchTimer = setTimeout(() => {
      if (($('social-search')?.value || '').trim().length >= 2) {
        $('social-search-btn')?.click();
      }
    }, 400);
  });
  $('social-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(_socialSearchTimer);
      $('social-search-btn')?.click();
    }
  });
  $('notif-mark-read')?.addEventListener('click', async () => {
    await markNotificationsRead();
    renderNotifications();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('profile-sheet')?.classList.contains('open')) {
        $('profile-sheet').classList.remove('open');
        $('profile-sheet').hidden = true;
      }
      if ($('message-sheet')?.classList.contains('open')) {
        $('message-sheet').classList.remove('open');
        $('message-sheet').hidden = true;
      }
    }
  });
}

function renderInsights() {
  const today = sliceRange(rangeData, 1);
  const { total, catBreakdown, score } = aggregateRange(today);
  const cats = {}; catBreakdown.forEach(c => { cats[c.category] = c.time; });
  const social = cats.social || 0, ent = cats.entertainment || 0;
  const prod = (cats.productivity || 0) + (cats.coding || 0) + (cats.education || 0);
  const insights = [], sugs = [];
  if (social > 3600) { insights.push(['Social heavy', `${fmt(social)} on social`]); sugs.push('Add a session cap for your top social site.'); }
  if (ent > 7200) insights.push(['Entertainment spike', `${fmt(ent)} entertainment`]);
  if (score >= 75) insights.push(['Strong focus', `Score ${score}/100`]);
  else if (score < 40 && total > 3600) { insights.push(['Focus dip', `Score ${score}/100`]); sugs.push('Turn on Focus mode for the next hour.'); }
  if (prod > 2 * 3600) insights.push(['Deep work', `${fmt(prod)} productive`]);
  if (!insights.length) insights.push(['Keep going', 'Browse and insights will appear.']);
  if (!sugs.length) sugs.push('Use Hard Lock for deep work blocks.');

  const digest = weeklyDigest(rangeData);
  $('ins-list').innerHTML = insights.map(([t, d]) => `
    <div style="padding:12px;border-radius:16px;background:var(--c3);margin-bottom:8px;border:1px solid var(--c4)">
      <div style="font-weight:700;margin-bottom:4px">${esc(t)}</div><div style="color:var(--t2);font-size:12px">${esc(d)}</div></div>`).join('');
  $('ins-sugs').innerHTML = sugs.map((s, i) => `
    <div style="display:flex;gap:8px;padding:10px;border-radius:14px;background:var(--m3-tonal);margin-bottom:6px">
      <b style="color:var(--m3-primary)">${i + 1}</b><span style="font-size:12px;color:var(--t2)">${esc(s)}</span></div>`).join('');
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
  $('ins-report').innerHTML = `
    <div style="font-size:28px;font-weight:700;color:var(--m3-primary);margin-bottom:6px">Grade ${grade}</div>
    <div style="color:var(--t2);margin-bottom:10px">${score}/100 · ${fmt(total)}</div>
    <div style="font-weight:600;margin-bottom:6px">${esc(digest.headline)}</div>
    <div style="font-size:12px;color:var(--t3)">Best day: ${esc(digest.bestDay)} · Top: ${esc(digest.topCategory)}</div>`;
}

function dayFocusSec(dayObj) {
  const { catBreakdown } = aggregateRange({ x: dayObj || {} });
  return ['productivity', 'coding', 'education'].reduce((s, c) => s + (catBreakdown.find(x => x.category === c)?.time || 0), 0);
}

function renderGoals() {
  const today = rangeData[dateKey(0)] || {};
  const { catBreakdown, total, score } = aggregateRange({ [dateKey(0)]: today });
  const focus = dayFocusSec(today);
  const social = catBreakdown.find(c => c.category === 'social')?.time || 0;
  const ent = catBreakdown.find(c => c.category === 'entertainment')?.time || 0;
  const goalMins = settings.focusGoalMins || 120;
  const socialMax = settings.socialLimit || 60;
  const entMax = settings.entLimit || 120;
  const goalSec = goalMins * 60;
  const pct = Math.min(100, Math.round((focus / Math.max(goalSec, 1)) * 100));
  const left = Math.max(0, goalSec - focus);
  const socialOk = social <= socialMax * 60;
  const entOk = ent <= entMax * 60;
  const focusDone = focus >= goalSec;
  const focusOn = !!settings.focusMode;

  if ($('goal-focus-val')) {
    $('goal-focus-val').innerHTML = `${esc(fmt(focus))}<small style="font-size:14px;color:var(--t2)"> / ${goalMins}m</small>`;
  }
  const gp = Math.max(0.06, Math.min(1, focus / Math.max(goalSec, 1)));
  $('goal-wavy')?.style.setProperty('--wavy-progress', String(gp));

  const circ = 2 * Math.PI * 44;
  const ring = $('goal-ring');
  if (ring) {
    ring.style.transition = 'stroke-dashoffset .7s cubic-bezier(.05,.7,.1,1)';
    ring.setAttribute('stroke-dashoffset', String(circ - (pct / 100) * circ));
  }
  if ($('goal-pct')) $('goal-pct').textContent = pct + '%';

  const chip = $('goal-status-chip');
  if (chip) {
    chip.className = 'goal-chip';
    if (focusDone) { chip.textContent = 'Quest complete'; chip.classList.add('done'); }
    else if (pct >= 70) { chip.textContent = 'Almost there'; }
    else if (pct >= 35) { chip.textContent = 'On track'; }
    else if (total > 30 * 60 && pct < 25) { chip.textContent = 'Needs a push'; chip.classList.add('warn'); }
    else { chip.textContent = 'Ready when you are'; }
  }

  const coach = $('goal-coach');
  if (coach) {
    if (focusDone && socialOk) coach.textContent = 'Strong day — focus hit and social stayed in budget.';
    else if (focusDone) coach.textContent = 'Focus goal locked. Keep social under budget to finish clean.';
    else if (left <= 15 * 60) coach.textContent = `Only ${fmt(left)} left — one short block finishes it.`;
    else if (pct === 0) coach.textContent = 'Pick a target below, then Start Focus mode to fill the ring.';
    else coach.textContent = `${fmt(left)} left today. Keep going.`;
  }

  const vibe = $('goal-vibe');
  if (vibe) {
    if (focusDone && socialOk && entOk) vibe.textContent = 'Clean sweep — focus, social, and entertainment all in check.';
    else if (focusDone) vibe.textContent = 'Focus locked · budgets still matter for your streak.';
    else if (pct >= 70) vibe.textContent = 'Close — the ring is almost full.';
    else if (pct >= 35) vibe.textContent = 'Solid progress — stay on productive sites.';
    else if (total > 0) vibe.textContent = 'Early in the day — protect a deep-work block next.';
    else vibe.textContent = 'Quiet so far — your next productive site starts the meter.';
  }

  if ($('goal-mins')) $('goal-mins').value = goalMins;
  if ($('goal-mins-lbl')) $('goal-mins-lbl').textContent = goalMins + 'm';
  if ($('goal-social')) $('goal-social').value = socialMax;
  if ($('goal-social-lbl')) $('goal-social-lbl').textContent = socialMax + 'm';
  const sp = Math.min(100, Math.round((social / Math.max(socialMax * 60, 1)) * 100));
  if ($('goal-social-bar')) $('goal-social-bar').style.width = sp + '%';
  if ($('goal-social-meta')) {
    $('goal-social-meta').textContent = socialOk
      ? `${fmt(social)} used · ${fmt(Math.max(0, socialMax * 60 - social))} left`
      : `${fmt(social)} used · over budget`;
  }

  if ($('goal-ent')) $('goal-ent').value = entMax;
  if ($('goal-ent-lbl')) $('goal-ent-lbl').textContent = entMax + 'm';
  const ep = Math.min(100, Math.round((ent / Math.max(entMax * 60, 1)) * 100));
  if ($('goal-ent-bar')) $('goal-ent-bar').style.width = ep + '%';
  if ($('goal-ent-meta')) {
    $('goal-ent-meta').textContent = entOk
      ? `${fmt(ent)} used · ${fmt(Math.max(0, entMax * 60 - ent))} left`
      : `${fmt(ent)} used · over budget`;
  }

  // Preset highlight
  document.querySelectorAll('#goal-presets .goal-preset').forEach(b => {
    const match = +b.dataset.focus === goalMins && +b.dataset.social === socialMax;
    b.classList.toggle('on', match);
  });

  const checks = [
    { on: focusDone, label: 'Hit focus goal', sub: `${pct}% of ${goalMins}m` },
    { on: socialOk && social > 0, label: 'Social under budget', sub: social === 0 ? 'No social yet' : `${fmt(social)} / ${socialMax}m` },
    { on: entOk, label: 'Entertainment in check', sub: `${fmt(ent)} / ${entMax}m` },
    { on: focusOn, label: 'Focus mode armed', sub: focusOn ? 'Blocking distractions now' : 'Tap Start Focus mode' },
    { on: score >= 70, label: 'Score ≥ 70', sub: `Today ${score}/100` },
  ];
  const list = $('goal-checklist');
  if (list) {
    list.innerHTML = checks.map(c => `
      <div class="goal-check ${c.on ? 'on' : ''}">
        <div class="dot">${c.on ? '✓' : ''}</div>
        <div style="min-width:0;flex:1">
          <div style="font-weight:600">${esc(c.label)}</div>
          <div style="font-size:11px;color:var(--t3)">${esc(c.sub)}</div>
        </div>
      </div>`).join('');
  }

  // Last 7 days focus wins (today → older)
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let wins = 0;
  const weekEl = $('goal-week');
  if (weekEl) {
    const cells = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKey(i);
      const f = dayFocusSec(rangeData[key] || {});
      const win = f >= goalSec;
      if (win) wins++;
      cells.push(`<div class="goal-day ${win ? 'win' : ''}" title="${labels[d.getDay()]} · ${fmt(f)}">
        <div class="gd"></div><span>${labels[d.getDay()][0]}</span></div>`);
    }
    weekEl.innerHTML = cells.join('');
  }
  if ($('goal-week-meta')) {
    $('goal-week-meta').textContent = wins === 0
      ? 'No wins yet this week — fill today’s ring to light a dot.'
      : `${wins} of 7 days cleared · open Streaks for your run`;
  }

  const tips = [
    'Protect the first deep-work hour — it compounds.',
    'Social spike? Add a 15-minute session cap on your top site.',
    'Pair Focus mode with a 25-minute timer to move the ring.',
    'Hit focus first; entertainment feels earned after.',
    'Balanced preset works for most weekdays.',
  ];
  if ($('goal-tip')) $('goal-tip').textContent = tips[new Date().getDay() % tips.length];

  const startBtn = $('goal-start-focus');
  if (startBtn) startBtn.textContent = focusOn ? 'Focus mode on' : 'Start Focus mode';
}

function renderSchedule() {
  const sch = settings.focusSchedule || {};
  setTog('sch-tog', !!sch.enabled);
  if ($('sch-start')) $('sch-start').value = sch.start || '09:00';
  if ($('sch-end')) $('sch-end').value = sch.end || '17:00';
  const days = new Set(sch.days || [1, 2, 3, 4, 5]);
  document.querySelectorAll('#sch-days .fb').forEach(b => {
    b.classList.toggle('active', days.has(+b.dataset.d));
  });
}

function renderStreaks() {
  const streak = settings.streaks || {};
  const current = Number(streak.current) || 0;
  const best = Number(streak.best) || 0;
  const focusDays = Number(streak.focusDays) || 0;
  const limitDays = Number(streak.limitOkDays) || 0;
  const scoreDays = Number(streak.scoreDays) || 0;

  const overall = $('streak-overall');
  if (overall) {
    overall.innerHTML = [
      ['Current streak', current, current ? 'Good days in a row' : 'Hit focus + stay under budget today'],
      ['Best streak', best, best ? 'Longest run so far' : 'Your record will land here'],
    ].map(([t, n, sub]) => `
      <div class="card streak-hero-card">
        <div class="stat-ico" style="background:var(--m3-primary-container);color:var(--m3-on-primary-container)">${icon('flame', 18)}</div>
        <div class="stat-val">${n}</div>
        <div class="stat-key">${t}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:6px">${sub}</div>
      </div>`).join('');
  }

  const cards = $('streak-cards');
  if (cards) {
    cards.innerHTML = [
      ['Focus streak', focusDays, 'Days you hit focus goal'],
      ['Limit streak', limitDays, 'Days under social & entertainment'],
      ['Score streak', scoreDays, 'Days score ≥ 70'],
    ].map(([t, n, sub]) => `
      <div class="card">
        <div class="stat-ico" style="background:var(--m3-primary-container);color:var(--m3-on-primary-container)">${icon('flame', 18)}</div>
        <div class="stat-val">${n}</div>
        <div class="stat-key">${t}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:6px">${sub}</div>
      </div>`).join('');
  }

  const list = $('streak-list');
  if (list) {
    const items = [];
    if (current >= 3) items.push(`On a ${current}-day overall streak — keep the chain.`);
    else if (best > 0 && current === 0) items.push(`Best so far: ${best} days. Start a new run today.`);
    if (focusDays >= 3) items.push('Nice — 3+ focus days in a row.');
    if (limitDays >= 2) items.push('Budgets held for multiple days.');
    if (scoreDays >= 2) items.push('Score stayed at 70+ for multiple days.');
    if ((calcScore(rangeData[dateKey(0)] || {})) >= 70) items.push('Today’s score is on track (≥ 70).');

    if (!items.length) {
      list.innerHTML = `<div class="empty-cta streak-empty">
        <strong>No streak wins yet</strong>
        <span>Hit your focus goal and stay under social &amp; entertainment budgets to start Current streak.</span>
      </div>`;
    } else {
      list.innerHTML = items.map(t => `<div style="padding:10px 12px;border-radius:14px;background:var(--c3);margin-bottom:6px;font-size:13px">${esc(t)}</div>`).join('');
    }
  }
}

$('goal-mins')?.addEventListener('input', e => {
  settings.focusGoalMins = +e.target.value;
  if ($('goal-mins-lbl')) $('goal-mins-lbl').textContent = settings.focusGoalMins + 'm';
  dsave();
  renderGoals();
});
$('goal-social')?.addEventListener('input', e => {
  settings.socialLimit = +e.target.value;
  if ($('goal-social-lbl')) $('goal-social-lbl').textContent = settings.socialLimit + 'm';
  dsave();
  renderGoals();
});
$('goal-ent')?.addEventListener('input', e => {
  settings.entLimit = +e.target.value;
  if ($('goal-ent-lbl')) $('goal-ent-lbl').textContent = settings.entLimit + 'm';
  dsave();
  renderGoals();
});
$('goal-presets')?.addEventListener('click', e => {
  const b = e.target.closest('.goal-preset'); if (!b) return;
  settings.focusGoalMins = +b.dataset.focus;
  settings.socialLimit = +b.dataset.social;
  dsave();
  renderGoals();
});
$('goal-start-focus')?.addEventListener('click', () => {
  settings.focusMode = true;
  dsave();
  renderGoals();
});
$('goal-open-limits')?.addEventListener('click', () => {
  document.querySelector('.sb-link[data-section="limits"]')?.click();
});
$('sch-tog')?.addEventListener('click', () => {
  settings.focusSchedule = { ...(settings.focusSchedule || {}), enabled: !settings.focusSchedule?.enabled };
  dsave();
  renderSchedule();
});
$('sch-days')?.addEventListener('click', e => {
  const b = e.target.closest('.fb'); if (!b) return;
  b.classList.toggle('active');
});
$('sch-save')?.addEventListener('click', () => {
  const days = [...document.querySelectorAll('#sch-days .fb.active')].map(b => +b.dataset.d);
  settings.focusSchedule = {
    ...(settings.focusSchedule || {}),
    enabled: !!settings.focusSchedule?.enabled,
    start: $('sch-start')?.value || '09:00',
    end: $('sch-end')?.value || '17:00',
    days: days.length ? days : [1, 2, 3, 4, 5],
  };
  dsave();
  const btn = $('sch-save');
  if (btn) { const t = btn.textContent; btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = t; }, 900); }
});

init().then(() => {
  const hash = (location.hash || '').replace('#', '');
  if (hash && document.querySelector(`.sb-link[data-section="${hash}"]`)) {
    document.querySelector(`.sb-link[data-section="${hash}"]`).click();
  }
  // Success deep-link (#pro) — keep polling until Pro lands (capture/webhook race)
  if (hash === 'pro' && user?.email) {
    syncPlanFromBackground({ force: true }).catch(() => {});
    startEntitlementWatch();
  }
}).catch((e) => log.error(e));
