// Screen Time Tracker v4.0 — Fenwick Labs
// Google OAuth → Supabase · PayPal + Razorpay · Free/Pro

export const CONFIG = {
  PRODUCT: 'Screen Time Tracker',
  VERSION: '5.4.61',

  /**
   * DEBUG=true enables verbose console logging (dev only).
   * Keep false for Chrome Web Store builds — never log tokens/PII.
   * Owner DevTools can still Inspect extension pages; this is not anti-devtools.
   */
  DEBUG: false,

  // Google Web Client ID (public OAuth client id — not a secret)
  GOOGLE_CLIENT_ID: '179379728844-5tq61kd6dj85mulki8oftakk37je16jr.apps.googleusercontent.com',

  supabase: {
    url: 'https://mproxhlssrniwlcywfhq.supabase.co',
    // anon/public key only — service role must NEVER ship in the extension
    anonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcm94aGxzc3JuaXdsY3l3ZmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNDk4MjksImV4cCI6MjEwMTkyNTgyOX0._eAoLEN8NqQdZQ4r0ka-zhOEAQvtnlg5DCuPXL8RTqg',
  },

  // Live Vercel site
  checkoutBaseUrl: 'https://screen-time-tracker-seven.vercel.app/checkout.html',
  billingApiUrl: 'https://screen-time-tracker-seven.vercel.app/api/stt/access',
  /** Social network API (auth JWT) — falls back to direct Supabase REST if unreachable */
  socialApiUrl: 'https://screen-time-tracker-seven.vercel.app/api/stt/social',
  paymentProviders: ['paypal', 'razorpay'],
  paymentTestMode: false,

  // Optional local Node backend for PDF email (dev only). Empty in production store builds.
  BACKEND_URL: '',

  SCOPES: [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ],

  prices: {
    monthlyUsd: 3.99,
    quarterlyUsd: 10.99,
    yearlyUsd: 29.99,
    years2Usd: 54.99,
    lifetimeUsd: 79.99,
    monthlyInr: 380,
    quarterlyInr: 1045,
    yearlyInr: 2853,
    years2Inr: 5231,
    lifetimeInr: 7609,
    foundingLifetimeUsd: 59.99,
    foundingLifetimeInr: 5706,
  },

  /** Free tier caps — Pro removes these */
  FREE_LIMITS: {
    maxBlockedSites: 5,
    maxSiteLimits: 2,
    historyDays: 7,
    maxThemes: 8, // Free seed colors (see ALLOWED_FREE_THEMES)
    maxKeywordBlocks: 0,
    maxFocusProfiles: 1,
    maxBlockedPatterns: 3,
    maxSessionCaps: 2,
    exportDays: 7,
    nuclear: false,
    hardLock: false,
    whitelist: false,
    cleanerDeep: false,
    emailReports: false,
    cloudSync: false, // full history sync is Pro
    lightSync: true, // guest score + profile basics free when signed in
    newTab: false,
    categoryBudgets: false,
    streakShield: false,
    scheduleCustom: false,
    leaderboard: true, // view free
    socialPost: true, // Free for signed-in — thoughts only (no media)
    friends: true, // Free follow / explore for signed-in
    totalDailyCap: false, // Pro
    settingsPin: false, // Pro
  },

  /** Material You — Free gets Auto + 2 basic seeds; rest Pro-gated */
  ALLOWED_FREE_THEMES: ['auto', 'violet', 'sage'],
  // Pro unlocks: rose, ember, teal, mint, coral, plum, sand, indigo, amber, slate, fuchsia, ocean

  /** Visual skins Free can apply (others visible but Pro-gated) */
  ALLOWED_FREE_VISUAL_THEMES: ['material'],

  /** Editorial 2-color combos Free may apply (see visual-theme.js EDITORIAL_COMBOS) */
  ALLOWED_FREE_EDITORIAL_COMBOS: ['cream-teal', 'cream-coral'],

  DEFAULT_SETTINGS: {
    notifications: true,
    overUseRemindAt: 80, // % of site/category limit before gentle nudge
    dailyResetHour: 0, // 0–23 — day rolls at this local hour (like productivity tools)
    focusMode: false,
    blockedSites: ['twitter.com', 'instagram.com', 'tiktok.com', 'reddit.com'],
    // Path / partial URL patterns e.g. "youtube.com/shorts" (Pro-enhanced Free: 3)
    blockedPatterns: [],
    siteLimits: {},
    // Quick session caps: { domain: { limitMin, usedSec, dayKey } }
    sessionCaps: {},
    categoryBudgets: {}, // { social: 60, entertainment: 120 } minutes — Pro
    socialLimit: 60,
    entLimit: 120,
    pomodoroWork: 25,
    pomodoroBreak: 5,
    nuclearUntil: null,
    hardLock: { enabled: false, until: null, challenge: true, delaySec: 30 },
    focusSchedule: {
      enabled: false,
      days: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 18,
      // per-day overrides: { "1": { start: 9, end: 17 }, ... }
      dayHours: {},
    },
    focusProfiles: {
      active: 'deep',
      presets: {
        deep: { name: 'Deep Work', blocked: ['twitter.com', 'instagram.com', 'tiktok.com', 'reddit.com', 'youtube.com'] },
        study: { name: 'Study', blocked: ['twitter.com', 'instagram.com', 'tiktok.com', 'netflix.com'] },
        wind: { name: 'Wind-down', blocked: ['linkedin.com', 'news.ycombinator.com'] },
      },
    },
    whitelistMode: false,
    whitelistSites: ['google.com', 'docs.google.com', 'github.com'],
    redirectOnBlock: '', // productive URL or ''
    settingsLock: { enabled: false, pin: '', delaySec: 0 },
    cleaner: {
      enabled: false,
      youtube: true,
      youtubeComments: false,
      youtubeHome: false,
      youtubeRelated: false,
      youtubeSearch: false,
      youtubeAutoplay: false,
      instagram: true,
      instagramStories: false,
      tiktok: true,
      twitter: true,
      facebook: false,
      reddit: false,
      snapchat: false,
      grayscaleSocial: false, // calm grayscale on social hosts only
    },
    ignoreList: [],
    categoryOverrides: {},
    ghostMode: false,
    mediaAwareTracking: true, // keep tracking if tab plays media while idle
    graceUsed: {},
    graceUntil: {},
    goals: { maxSocialMin: 60, minProdMin: 120 },
    streaks: { current: 0, best: 0, lastDate: null, shieldUsedMonth: null },
    emailReports: {
      daily: false,
      weekly: true,
      dailyHour: 21,
      weeklyDay: 0,
      weeklyHour: 9,
      extraEmails: '',
    },
    theme: 'auto',
    themeMode: 'auto',
    visualTheme: 'material', // 'material' | 'editorial' | 'minimal'
    editorialCombo: 'cream-teal', // curated 2-color Editorial pair
    focusGoalMins: 120,
    region: null, // set only when user picks (regionChosen)
    regionChosen: false,
    keywordBlock: [], // [{ term, matchUrl, matchTitle, matchBody }]
    bwMode: false,
    focusTint: false, // B&W + dim social
    liveBanner: true,
    newTabDashboard: false,
    subscription: { plan: 'free', status: 'active', provider: null, cycle: null },
    entitlementCache: { plan: 'free', verifiedAt: 0, expiresAt: null },
    dismissedUpdate: null,
    inkThemeApplied: false,
    airThemeApplied: false,
    m3ThemeApplied: false,
    skyThemeApplied: false,
    m3YouApplied: false,
    coach: { enabled: true, lastMorning: null, lastEvening: null },
    limitHitCount: 0,
    bypassCountWeek: 0,
    bypassWeekKey: null,
    paywallShown: false,
  },

  PLANS: [
    {
      id: 'free',
      name: 'Free',
      price: '$0',
      priceInr: '₹0',
      period: 'forever',
      feats: [
        'See where your time goes today',
        '7 days of history to spot patterns',
        'Block 5 sites and set 2 limits',
        'Habits board to keep the streak alive',
        'Guest profile and leaderboard peek',
        'A calm Material You starter look',
      ],
    },
    {
      id: 'monthly',
      name: 'Pro Monthly',
      price: '$3.99',
      priceInr: '₹380',
      period: '/mo',
      cycle: 'monthly',
      feats: [
        'Hard Lock when you need real focus',
        'Unlimited blocks and site limits',
        '30 and 90 day deep analytics',
        'Full cloud sync of your history',
        'Direct messages in Community',
        'Deep cleaner, schedules, all themes',
      ],
    },
    {
      id: 'yearly',
      name: 'Pro Yearly',
      price: '$29.99',
      priceInr: '₹2,853',
      period: '/yr',
      cycle: 'yearly',
      featured: true,
      savings: 'Smart pick · ~$2.50/mo',
      feats: [
        'Everything in Pro Monthly',
        'Best deal if you use this daily',
        'One calm renewal each year',
        'Same Pro power for less per month',
      ],
    },
    {
      id: 'lifetime',
      name: 'Lifetime',
      price: '$79.99',
      priceInr: '₹7,609',
      period: 'once',
      cycle: 'lifetime',
      feats: [
        'All Pro features forever',
        'No renewal date to track',
        'Founding member badge energy',
        'Future Pro upgrades stay yours',
      ],
    },
  ],

  UPDATE: {
    version: '5.0.0',
    title: "What's New in 5.0",
    body: 'Cloud sync, Google + email sign-in, Free/Pro plans, leaderboard, social feed, petal analytics, and Material You M mark.',
  },
};
