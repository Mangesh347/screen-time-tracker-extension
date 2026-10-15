/**
 * Reusable Free / Pro / Guest / Auth entitlements layer.
 * UI + background should gate through these helpers — never "hide button only".
 */
import { CONFIG } from './config.js';
import {
  canUse as proCanUse,
  isPro as isProPlan,
  normalizePlan,
  enforceFreeCaps,
  getEffectivePlan,
  proPaywallCopy,
  freeLimits,
  historyDaysForPlan,
  isVisualThemeAllowed,
} from './pro.js';

/** Feature → gate. auth = signed-in; pro = paid plan; free = always (guest ok). */
export const FEATURE_MAP = Object.freeze({
  // Core tracking — guest + free + pro
  trackTime: { gate: 'free', copy: 'Local screen-time tracking' },
  siteLimitsBasic: { gate: 'free', copy: 'Basic site limits' },
  focusTimer: { gate: 'free', copy: 'Focus timer' },
  leaderboardView: { gate: 'free', copy: 'Leaderboard (guest scores local)' },

  // Social / community — require account
  leaderboardLive: { gate: 'auth', copy: 'Live leaderboard & ranks' },
  community: { gate: 'auth', copy: 'Community feed & follows' },
  profiles: { gate: 'auth', copy: 'Profiles & Explore' },
  friends: { gate: 'auth', copy: 'Friends & follow requests' },
  sharing: { gate: 'auth', copy: 'Sharing & thoughts' },
  achievementsSync: { gate: 'auth', copy: 'Achievements sync across devices' },
  lightSync: { gate: 'auth', copy: 'Cloud restore of usage history' },

  // Pro — advanced analytics / automation / customization
  nuclear: { gate: 'pro', feature: 'nuclear' },
  hardLock: { gate: 'pro', feature: 'hardLock' },
  whitelist: { gate: 'pro', feature: 'whitelist' },
  keywordBlock: { gate: 'pro', feature: 'keywordBlock' },
  scheduleCustom: { gate: 'pro', feature: 'scheduleCustom' },
  history90: { gate: 'pro', feature: 'history90' },
  newTab: { gate: 'pro', feature: 'newTab' },
  cloudSync: { gate: 'pro', feature: 'cloudSync' },
  cleanerDeep: { gate: 'pro', feature: 'cleanerDeep' },
  emailReports: { gate: 'pro', feature: 'emailReports' },
  categoryBudgets: { gate: 'pro', feature: 'categoryBudgets' },
  themesAll: { gate: 'pro', feature: 'themesAll' },
  visualThemesAll: { gate: 'pro', feature: 'visualThemesAll' },
  messaging: { gate: 'pro', feature: 'messaging' },
  history30: { gate: 'pro', feature: 'history30' },
  pdfReport: { gate: 'pro', feature: 'pdfReport' },
  redirectOnBlock: { gate: 'pro', feature: 'redirectOnBlock' },
  settingsPin: { gate: 'pro', feature: 'settingsPin' },
  totalDailyCap: { gate: 'pro', feature: 'totalDailyCap' },
  focusProfilesExtra: { gate: 'pro', feature: 'focusProfilesExtra' },
  streakShield: { gate: 'pro', feature: 'streakShield' },
});

export function isGuestUser(user) {
  return !user?.id || !user?.email;
}

export function requireAuth(user) {
  if (user?.id && user?.email) {
    return { ok: true, user };
  }
  return {
    ok: false,
    code: 'AUTH_REQUIRED',
    message: 'Sign in to use Community, live leaderboard, and cloud sync.',
  };
}

export function requirePro(planOrInfo, featureKey = null) {
  const plan =
    typeof planOrInfo === 'string'
      ? planOrInfo
      : planOrInfo?.plan || (planOrInfo?.isPro ? 'yearly' : 'free');
  const key = featureKey && FEATURE_MAP[featureKey]?.feature
    ? FEATURE_MAP[featureKey].feature
    : featureKey;
  if (key) {
    if (proCanUse(key, plan)) return { ok: true, plan: normalizePlan(plan) };
    return {
      ok: false,
      code: 'PRO_REQUIRED',
      feature: key,
      message: proPaywallCopy(key),
      plan: normalizePlan(plan),
    };
  }
  if (isProPlan(plan)) return { ok: true, plan: normalizePlan(plan) };
  return {
    ok: false,
    code: 'PRO_REQUIRED',
    message: 'Upgrade to Pro to unlock this.',
    plan: 'free',
  };
}

/** Resolve access for a FEATURE_MAP key given user + plan. */
export function checkFeature(featureId, { user = null, plan = 'free' } = {}) {
  const def = FEATURE_MAP[featureId];
  if (!def) return { ok: true, gate: 'free' };
  if (def.gate === 'free') return { ok: true, gate: 'free' };
  if (def.gate === 'auth') {
    const auth = requireAuth(user);
    return auth.ok
      ? { ok: true, gate: 'auth' }
      : { ...auth, gate: 'auth' };
  }
  if (def.gate === 'pro') {
    const auth = requireAuth(user);
    // Pro features still need an account for checkout / entitlement binding
    if (!auth.ok) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Sign in, then upgrade to Pro.',
        gate: 'pro',
      };
    }
    return { ...requirePro(plan, featureId), gate: 'pro' };
  }
  return { ok: true, gate: def.gate };
}

export function canUse(feature, plan) {
  return proCanUse(feature, plan);
}

export {
  isProPlan,
  normalizePlan,
  enforceFreeCaps,
  getEffectivePlan,
  proPaywallCopy,
  freeLimits,
  historyDaysForPlan,
  isVisualThemeAllowed,
};

export function freeLimitsFromConfig() {
  return { ...CONFIG.FREE_LIMITS };
}
