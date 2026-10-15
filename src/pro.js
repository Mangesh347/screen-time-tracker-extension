// Free / Pro feature gates
import { CONFIG } from './config.js';
import { normalizeVisualTheme } from './visual-theme.js';

const PRO_PLANS = new Set(['pro', 'monthly', 'quarterly', 'yearly', 'years_2', 'lifetime']);

export function normalizePlan(plan) {
  if (!plan || plan === 'free') return 'free';
  if (PRO_PLANS.has(plan)) return plan === 'pro' ? 'yearly' : plan;
  return 'free';
}

export function isProPlan(plan) {
  return PRO_PLANS.has(normalizePlan(plan));
}

/** Coerce expiry (ms or ISO) → number ms or null */
export function expiryMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Date.parse(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Resolve effective plan from settings + entitlement cache (guest = free). */
export async function getEffectivePlan(settings, user) {
  if (!user?.email) return 'free';
  const cache = settings?.entitlementCache || {};
  const sub = settings?.subscription || {};
  const plan = normalizePlan(cache.plan || sub.plan || 'free');
  if (!isProPlan(plan)) return 'free';
  // Lifetime never expires
  if (plan === 'lifetime') return 'lifetime';
  const exp = expiryMs(cache.expiresAt);
  if (exp && Date.now() > exp) {
    // Offline grace: 72h after last verify
    const graceMs = 72 * 3600 * 1000;
    if (cache.verifiedAt && Date.now() - cache.verifiedAt < graceMs) return plan;
    return 'free';
  }
  return plan;
}

export function isPro(plan) {
  return isProPlan(plan);
}

/** Free can browse all skins; only ALLOWED_FREE_VISUAL_THEMES may be applied. */
export function isVisualThemeAllowed(visualId, plan) {
  if (isPro(plan)) return true;
  const free = CONFIG.ALLOWED_FREE_VISUAL_THEMES || ['material'];
  return free.includes(normalizeVisualTheme(visualId));
}

export function freeLimits() {
  return { ...CONFIG.FREE_LIMITS };
}

export function canUse(feature, plan) {
  const pro = isPro(plan);
  const L = CONFIG.FREE_LIMITS;
  switch (feature) {
    case 'nuclear':
    case 'hardLock':
    case 'whitelist':
    case 'cleanerDeep':
    case 'emailReports':
    case 'cloudSync':
    case 'totalDailyCap':
    // socialPost + friends: free for signed-in (gated in UI by auth, not Pro)
    case 'settingsPin':
    case 'newTab':
    case 'categoryBudgets':
    case 'streakShield':
    case 'scheduleCustom':
    case 'keywordBlock':
    case 'history90':
    case 'pdfReport':
    case 'focusProfilesExtra':
    case 'redirectOnBlock':
    case 'themesAll':
    case 'visualThemesAll':
    case 'messaging':
    case 'history30':
      return pro;
    case 'leaderboard':
      return true;
    default:
      return true;
  }
}

/** Clamp settings to Free limits when not Pro. Returns { settings, violations[] }. */
export function enforceFreeCaps(settings, plan) {
  const s = { ...settings };
  const violations = [];
  if (isPro(plan)) return { settings: s, violations };

  const L = CONFIG.FREE_LIMITS;

  if ((s.blockedSites || []).length > L.maxBlockedSites) {
    s.blockedSites = s.blockedSites.slice(0, L.maxBlockedSites);
    violations.push(`Free allows ${L.maxBlockedSites} blocked sites`);
  }

  if ((s.blockedPatterns || []).length > (L.maxBlockedPatterns || 3)) {
    s.blockedPatterns = s.blockedPatterns.slice(0, L.maxBlockedPatterns || 3);
    violations.push(`Free allows ${L.maxBlockedPatterns || 3} path patterns`);
  }

  const sessionCaps = s.sessionCaps || {};
  const capKeys = Object.keys(sessionCaps);
  if (capKeys.length > (L.maxSessionCaps || 2)) {
    const keep = {};
    capKeys.slice(0, L.maxSessionCaps || 2).forEach(k => { keep[k] = sessionCaps[k]; });
    s.sessionCaps = keep;
    violations.push(`Free allows ${L.maxSessionCaps || 2} quick session caps`);
  }

  const limits = s.siteLimits || {};
  const keys = Object.keys(limits);
  if (keys.length > L.maxSiteLimits) {
    const keep = {};
    keys.slice(0, L.maxSiteLimits).forEach(k => { keep[k] = limits[k]; });
    s.siteLimits = keep;
    violations.push(`Free allows ${L.maxSiteLimits} site limits`);
  }

  if (!L.nuclear) {
    s.nuclearUntil = null;
  }
  if (!L.hardLock) {
    s.hardLock = { ...(s.hardLock || {}), enabled: false, until: null };
  }
  if (!L.whitelist) {
    s.whitelistMode = false;
  }
  if (!L.keywordBlock) {
    s.keywordBlock = [];
  }
  if (!L.categoryBudgets) {
    s.categoryBudgets = {};
  }
  if (!L.newTab) {
    s.newTabDashboard = false;
  }
  if (!L.scheduleCustom && s.focusSchedule) {
    s.focusSchedule = {
      ...s.focusSchedule,
      dayHours: {},
      startHour: s.focusSchedule.startHour ?? 9,
      endHour: s.focusSchedule.endHour ?? 18,
    };
  }
  if (!L.cleanerDeep && s.cleaner) {
    s.cleaner = {
      ...s.cleaner,
      youtubeComments: false,
      youtubeHome: false,
      youtubeRelated: false,
      youtubeSearch: false,
      youtubeAutoplay: false,
      instagramStories: false,
      facebook: false,
      reddit: false,
      snapchat: false,
      grayscaleSocial: false,
    };
  }
  if (!CONFIG.ALLOWED_FREE_THEMES.includes(s.theme)) {
    s.theme = 'auto';
    violations.push('Theme locked on Free — upgrade for all themes');
  }
  if (!isVisualThemeAllowed(s.visualTheme, 'free')) {
    s.visualTheme = 'material';
    violations.push('Visual skin locked on Free — upgrade for Editorial & Minimal');
  }
  if (s.redirectOnBlock) s.redirectOnBlock = '';

  return { settings: s, violations };
}

export function historyDaysForPlan(plan) {
  // Pro: full cloud history (years). Free UI: 7 days (data still stored in cloud when signed in).
  return isPro(plan) ? 3650 : CONFIG.FREE_LIMITS.historyDays;
}

export function proPaywallCopy(feature) {
  const map = {
    nuclear: 'Hard Lock / Nuclear is a Pro feature',
    hardLock: 'Hard Lock requires Pro',
    whitelist: 'Allow-only mode is Pro',
    keywordBlock: 'Keyword blocking is Pro',
    scheduleCustom: 'Custom schedules are Pro',
    history90: '90-day history is Pro',
    newTab: 'Focus New Tab is Pro',
    cloudSync: 'Cloud sync is Pro',
    cleanerDeep: 'Deep distraction cleaner is Pro',
    emailReports: 'Email reports are Pro',
    categoryBudgets: 'Category budgets are Pro',
    visualThemesAll: 'Editorial & Minimal skins are Pro',
    messaging: 'Direct messages are Pro',
    history30: '30 & 90-day analytics are Pro',
    history90: '30 & 90-day analytics are Pro',
  };
  return map[feature] || 'Upgrade to Pro to unlock this';
}

/** Compact HTML for Pro / Upgrade badge (token-aware via CSS). */
export function planBadgeHtml({ isPro: pro, plan = 'free', expiresAt = null, interactive = false } = {}) {
  const click = interactive ? ' role="button" tabindex="0" data-plan-badge="1"' : '';
  if (!pro) {
    return `<span class="stt-plan-badge upgrade"${click} title="See Pro plans">Upgrade to Pro</span>`;
  }
  const tip =
    plan === 'lifetime'
      ? 'Lifetime Pro · never ends'
      : expiryMs(expiresAt)
        ? `Pro until ${new Date(expiryMs(expiresAt)).toLocaleDateString()}`
        : 'Pro is active';
  return `<span class="stt-plan-badge pro"${click} title="${tip}"><span class="stt-plan-gem" aria-hidden="true"></span>Pro Plan</span>`;
}

/** Small PRO lock tag for gated controls (nav, chips, toggles, sections). */
export function proTagHtml(title = 'Pro feature') {
  return `<span class="stt-pro-tag" title="${title}">PRO</span>`;
}
