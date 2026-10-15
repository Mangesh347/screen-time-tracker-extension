// Screen Time Tracker — shared utilities (ES Module)

export function fmt(secs) {
  const n = Number(secs) || 0;
  if (n <= 0) return '0s';
  if (n < 60) return `${Math.max(1, Math.round(n))}s`;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.round(n % 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m < 3 && s > 0 && n < 180) return `${m}m ${s}s`;
  return `${m}m`;
}
export function fmtShort(secs) {
  const n = Number(secs) || 0;
  if (n <= 0) return '0s';
  if (n < 60) return `${Math.max(1, Math.round(n))}s`;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return h > 0 ? `${h}h` : `${m}m`;
}

/** Metric strip helper — intentional empty state + clear unit */
export function fmtMetric(secs, { empty = '—' } = {}) {
  const n = Number(secs) || 0;
  if (n <= 0) return empty === '—' ? '0s' : empty;
  return fmt(n);
}

export function catColorForVisual(category, visual) {
  if (visual === 'minimal') {
    try {
      const mode = document.documentElement?.getAttribute('data-mode') || 'light';
      return mode === 'dark' ? '#FFFFFF' : '#000000';
    } catch {
      return '#000000';
    }
  }
  return catColor(category);
}

/** Semantic category hues — distinct on light & dark Material surfaces */
export const CAT_COLORS = {
  social:        '#E11D74', // rose — feeds & chat
  coding:        '#0D9488', // teal — builders
  productivity:  '#6366F1', // indigo — deep work
  entertainment: '#F59E0B', // amber — play / video
  education:     '#0EA5E9', // sky — learn
  news:          '#F97316', // orange — headlines
  shopping:      '#D946EF', // fuchsia — commerce
  search:        '#3B82F6', // blue — lookup
  other:         '#94A3B8', // slate — readable catch-all
};

/** Soft track fills for bars / pills */
export const CAT_SOFT = {
  social:        'color-mix(in srgb, #E11D74 28%, transparent)',
  coding:        'color-mix(in srgb, #0D9488 28%, transparent)',
  productivity:  'color-mix(in srgb, #6366F1 28%, transparent)',
  entertainment: 'color-mix(in srgb, #F59E0B 28%, transparent)',
  education:     'color-mix(in srgb, #0EA5E9 28%, transparent)',
  news:          'color-mix(in srgb, #F97316 28%, transparent)',
  shopping:      'color-mix(in srgb, #D946EF 28%, transparent)',
  search:        'color-mix(in srgb, #3B82F6 28%, transparent)',
  other:         'color-mix(in srgb, #94A3B8 32%, transparent)',
};

export const CAT_ICONS = {
  social: 'users', coding: 'code', productivity: 'list', entertainment: 'film',
  education: 'book', news: 'news', shopping: 'cart', search: 'search', other: 'globe',
};
export const catColor = c => CAT_COLORS[c] || CAT_COLORS.other;
export const catSoft = c => CAT_SOFT[c] || CAT_SOFT.other;
export const catIcon = c => CAT_ICONS[c] || 'globe';

export function scoreColor(s) {
  if (s >= 75) return '#00f5a0';
  if (s >= 50) return '#7c6cfa';
  if (s >= 30) return '#ffb700';
  return '#ff2d6b';
}
export function scoreLabel(s) {
  if (s >= 85) return 'On fire';
  if (s >= 70) return 'Great day';
  if (s >= 55) return 'Good vibe';
  if (s >= 40) return 'Okay';
  if (s >= 25) return 'Rough';
  return 'Reset time';
}

export function calcScore(dayData) {
  const prod   = ['productivity','coding','education'];
  const unprod = ['social','entertainment'];
  let p=0, u=0, t=0;
  for (const e of Object.values(dayData || {})) {
    const sec = Number(e?.totalTime) || 0;
    if (!Number.isFinite(sec) || sec <= 0) continue;
    t += sec;
    if (prod.includes(e.category))   p += sec;
    if (unprod.includes(e.category)) u += sec;
  }
  if (t === 0) return 50;
  const raw = Math.round(((p - u * 0.5) / t + 1) * 50);
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 50;
}

export function aggregateRange(rangeData) {
  const domains={}, cats={}, daily=[];
  let total=0;
  for (const [date, dayObj] of Object.entries(rangeData)) {
    let dt=0;
    for (const [domain, entry] of Object.entries(dayObj)) {
      dt    += entry.totalTime; total += entry.totalTime;
      cats[entry.category] = (cats[entry.category]||0)+entry.totalTime;
      if (!domains[domain]) domains[domain]={totalTime:0,visits:0,category:entry.category,title:entry.title||domain};
      domains[domain].totalTime += entry.totalTime;
      domains[domain].visits    += entry.visits||1;
    }
    daily.push({date, time:dt});
  }
  daily.sort((a,b)=>a.date.localeCompare(b.date));
  const topSites = Object.entries(domains)
    .map(([domain,d])=>({domain,...d}))
    .sort((a,b)=>b.totalTime-a.totalTime);
  const catBreakdown = Object.entries(cats)
    .map(([category,time])=>({category,time}))
    .sort((a,b)=>b.time-a.time);
  const score = calcScore(Object.fromEntries(Object.entries(domains).map(([d,v])=>[d,v])));
  return {total, topSites, catBreakdown, daily, score};
}

export function msg(type, payload={}) {
  return new Promise((res,rej) => {
    chrome.runtime.sendMessage({type,...payload}, r => {
      if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
      else res(r);
    });
  });
}

/** Logical day boundary hour (0 = midnight). Synced from settings.dailyResetHour. */
let _dailyResetHour = 0;

export function setDailyResetHour(hour) {
  const h = Number(hour);
  _dailyResetHour = Number.isFinite(h) ? Math.min(23, Math.max(0, Math.floor(h))) : 0;
  return _dailyResetHour;
}

export function getDailyResetHour() {
  return _dailyResetHour;
}

function formatDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Logical "now" calendar date respecting dailyResetHour (hours before reset belong to previous day). */
export function logicalDate(ms = Date.now(), resetHour = _dailyResetHour) {
  const d = new Date(ms);
  const h = Number(resetHour) || 0;
  if (h > 0 && d.getHours() < h) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0); // noon avoids DST edge when stepping days
  return d;
}

/** Next logical-day boundary (ms) after `ms`. */
export function nextDayBoundaryMs(ms = Date.now(), resetHour = _dailyResetHour) {
  const h = Number(resetHour) || 0;
  const d = new Date(ms);
  const boundary = new Date(d);
  boundary.setSeconds(0, 0);
  boundary.setMinutes(0);
  boundary.setHours(h);
  if (boundary.getTime() <= ms) boundary.setDate(boundary.getDate() + 1);
  return boundary.getTime();
}

/**
 * Day key for screentime buckets. Uses settings.dailyResetHour when set via setDailyResetHour.
 * offset=0 → current logical day, offset=1 → previous logical day, etc.
 */
export function dateKey(offset = 0, resetHour = _dailyResetHour) {
  const d = logicalDate(Date.now(), resetHour);
  const o = Number(offset) || 0;
  if (o) d.setDate(d.getDate() - o);
  return formatDayKey(d);
}

export function dayKeyFromMs(ms, resetHour = _dailyResetHour) {
  return formatDayKey(logicalDate(ms, resetHour));
}

export function todayKey(resetHour = _dailyResetHour) {
  return dateKey(0, resetHour);
}

/** Escape text for safe HTML / attribute insertion (XSS hygiene). */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Allow only http(s) URLs for img/src / redirects — blocks javascript:/data: etc. */
export function safeHttpUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.href;
  } catch {
    return '';
  }
}

/** Escaped safe URL for use inside HTML attributes, or empty string. */
export function safeImgSrc(url) {
  const u = safeHttpUrl(url);
  return u ? escapeHtml(u) : '';
}

/** Google favicon helper — domain is encoded to avoid query injection. */
export function faviconUrl(domain) {
  const d = String(domain || '')
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/[^a-zA-Z0-9.-]/g, '')
    .slice(0, 253);
  if (!d) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=32`;
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem('stt_user')||'null'); } catch { return null; }
}
export function setUser(u) {
  if (u) localStorage.setItem('stt_user', JSON.stringify(u));
  else localStorage.removeItem('stt_user');
}

export function sliceRange(rangeData, days) {
  const keys = [];
  for (let i = 0; i < days; i++) keys.push(dateKey(i));
  const out = {};
  for (const k of keys) if (rangeData[k]) out[k] = rangeData[k];
  return out;
}

export function dayTotal(dayObj = {}) {
  return Object.values(dayObj).reduce((s, e) => s + (e.totalTime || 0), 0);
}

export function compareDelta(a, b) {
  if (!b) return { pct: 0, label: '—' };
  const pct = Math.round(((a - b) / Math.max(b, 1)) * 100);
  return { pct, label: `${pct > 0 ? '+' : ''}${pct}%` };
}

export function toCSV(rangeData) {
  const rows = [['date', 'domain', 'category', 'seconds', 'visits', 'title']];
  for (const [date, day] of Object.entries(rangeData || {})) {
    for (const [domain, e] of Object.entries(day)) {
      rows.push([date, domain, e.category || '', e.totalTime || 0, e.visits || 0, JSON.stringify(e.title || '')]);
    }
  }
  return rows.map(r => r.join(',')).join('\n');
}

export function unlockOk(settings, pin) {
  if (!settings?.settingsLock?.enabled) return true;
  return String(pin || '') === String(settings.settingsLock.pin || '');
}

export function weeklyDigest(rangeData) {
  const thisWeek = sliceRange(rangeData, 7);
  const lastWeekRaw = {};
  for (let i = 7; i < 14; i++) {
    const k = dateKey(i);
    if (rangeData[k]) lastWeekRaw[k] = rangeData[k];
  }
  const a = aggregateRange(thisWeek);
  const b = aggregateRange(lastWeekRaw);
  const best = [...(a.daily || [])].sort((x, y) => y.time - x.time)[0];
  const worstCat = a.catBreakdown?.[0];
  const delta = compareDelta(a.total, b.total);
  return {
    headline: a.total === 0
      ? 'No browsing data this week yet.'
      : `${delta.pct <= 0 ? 'Calmer week' : 'Heavier week'}: ${fmt(a.total)} total (${delta.label} vs last week).`,
    bestDay: best ? `${best.date} · ${fmt(best.time)}` : '—',
    topCategory: worstCat ? `${worstCat.category} · ${fmt(worstCat.time)}` : '—',
    score: a.score,
    thisTotal: a.total,
    lastTotal: b.total,
  };
}

const FOCUS_CATS = ['productivity', 'coding', 'education'];
const DISTRACT_CATS = ['social', 'entertainment'];

export function isFocusCategory(c) {
  return FOCUS_CATS.includes(c);
}
export function isDistractCategory(c) {
  return DISTRACT_CATS.includes(c);
}

/** Previous N-day window immediately before the current slice */
export function previousPeriodRange(rangeData, days) {
  const out = {};
  for (let i = days; i < days * 2; i++) {
    const k = dateKey(i);
    if (rangeData[k]) out[k] = rangeData[k];
  }
  return out;
}

/** Daily layered series for multi-wave charts */
export function aggregateDailyLayers(rangeData) {
  const rows = [];
  for (const [date, dayObj] of Object.entries(rangeData || {})) {
    let total = 0, focus = 0, social = 0, entertainment = 0;
    for (const e of Object.values(dayObj || {})) {
      const t = e.totalTime || 0;
      total += t;
      if (FOCUS_CATS.includes(e.category)) focus += t;
      if (e.category === 'social') social += t;
      if (e.category === 'entertainment') entertainment += t;
    }
    rows.push({ date, total, focus, social, entertainment });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

/** 24h intensity from heatmap (one weekday or average across week) */
export function heatmapHourSeries(heatmap, { dow = null, aggregate = false } = {}) {
  const out = Array.from({ length: 24 }, () => 0);
  const hm = heatmap || {};
  if (aggregate || dow == null) {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) out[h] += hm[`${d}_${h}`] || 0;
    }
    if (!aggregate && dow == null) {
      /* keep sum — callers can normalize */
    }
  } else {
    for (let h = 0; h < 24; h++) out[h] = hm[`${dow}_${h}`] || 0;
  }
  return out;
}

/** Sparkline 0–1 values for a site from visits + relative daily share */
export function siteActivityWave(rangeData, domain, heatmap, length = 12) {
  const keys = Object.keys(rangeData || {}).sort();
  if (keys.length >= 2) {
    const vals = keys.map(k => {
      const e = rangeData[k]?.[domain];
      return e?.totalTime || 0;
    });
    const max = Math.max(...vals, 1);
    return vals.slice(-length).map(v => v / max);
  }
  // Derive from today's heatmap rhythm when single-day / sparse
  const dow = new Date().getDay();
  const hours = heatmapHourSeries(heatmap, { dow });
  const max = Math.max(...hours, 1);
  const step = Math.max(1, Math.floor(24 / length));
  const wave = [];
  for (let i = 0; i < length; i++) {
    const h = Math.min(23, i * step);
    wave.push(hours[h] / max);
  }
  // Bias by site share so rows aren't identical
  let siteT = 0, dayT = 0;
  const today = rangeData[dateKey(0)] || {};
  for (const [d, e] of Object.entries(today)) {
    dayT += e.totalTime || 0;
    if (d === domain) siteT = e.totalTime || 0;
  }
  const bias = dayT > 0 ? 0.35 + 0.65 * (siteT / dayT) : 0.5;
  return wave.map((v, i) => Math.min(1, v * bias + (i % 3 === 0 ? 0.05 : 0)));
}

/** Session-ish stats derived from visits + time (no raw session log) */
export function deriveSessionStats(rangeData) {
  let switches = 0;
  let totalTime = 0;
  const segments = [];
  for (const dayObj of Object.values(rangeData || {})) {
    for (const [domain, e] of Object.entries(dayObj || {})) {
      const visits = Math.max(1, e.visits || 1);
      const t = e.totalTime || 0;
      switches += visits;
      totalTime += t;
      const avgSec = t / visits;
      segments.push({
        domain,
        category: e.category || 'other',
        time: t,
        visits,
        avgSec,
      });
    }
  }
  segments.sort((a, b) => b.time - a.time);
  const avgSession = switches > 0 ? totalTime / switches : 0;
  const activeHours = Math.max(1, totalTime / 3600);
  const velocity = switches / activeHours; // switches per hour of browsing
  return { switches, totalTime, avgSession, velocity, segments };
}

/** Contiguous high-activity hour windows from heatmap */
export function focusWindowsFromHeatmap(heatmap, catBreakdown = []) {
  const dow = new Date().getDay();
  const hours = heatmapHourSeries(heatmap, { dow });
  const max = Math.max(...hours, 0);
  if (max <= 0) return [];
  const thresh = max * 0.45;
  const focusShare = (() => {
    const total = catBreakdown.reduce((s, c) => s + (c.time || 0), 0) || 1;
    const f = catBreakdown
      .filter(c => FOCUS_CATS.includes(c.category))
      .reduce((s, c) => s + c.time, 0);
    return f / total;
  })();
  const windows = [];
  let start = null;
  for (let h = 0; h <= 24; h++) {
    const on = h < 24 && hours[h] >= thresh;
    if (on && start == null) start = h;
    if (!on && start != null) {
      const end = h;
      const intensity = hours.slice(start, end).reduce((s, v) => s + v, 0) / Math.max(1, end - start);
      windows.push({
        start,
        end,
        intensity,
        kind: focusShare >= 0.45 ? 'focus' : focusShare >= 0.25 ? 'mixed' : 'distract',
        label: `${String(start).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00`,
      });
      start = null;
    }
  }
  return windows.slice(0, 6);
}

/** Single rotating insight from real aggregates */
export function buildTodayInsight({ total, topSites, catBreakdown, score, heatmap, comparePct }) {
  if (!total) {
    return {
      id: 'empty',
      title: "Today's Insight",
      body: 'Browse a bit and your first insight will appear here.',
      tone: 'neutral',
    };
  }
  const candidates = [];
  const top = topSites?.[0];
  if (top) {
    candidates.push({
      id: 'top-site',
      title: "Today's Insight",
      body: `${top.domain} leads at ${fmt(top.totalTime)} — ${Math.round((top.totalTime / total) * 100)}% of your day.`,
      tone: isDistractCategory(top.category) ? 'warn' : 'good',
    });
  }
  const topCat = catBreakdown?.[0];
  if (topCat) {
    candidates.push({
      id: 'top-cat',
      title: "Today's Insight",
      body: `${topCat.category} is your dominant category (${fmt(topCat.time)}).`,
      tone: isFocusCategory(topCat.category) ? 'good' : 'neutral',
    });
  }
  if (typeof score === 'number') {
    candidates.push({
      id: 'score',
      title: "Today's Insight",
      body: score >= 70
        ? `Focus score ${score} — strong balance so far.`
        : `Focus score ${score} — a short Focus block could lift this.`,
      tone: score >= 70 ? 'good' : 'warn',
    });
  }
  if (typeof comparePct === 'number' && Number.isFinite(comparePct)) {
    candidates.push({
      id: 'vs-yest',
      title: "Today's Insight",
      body: comparePct === 0
        ? 'Usage matches yesterday so far.'
        : comparePct < 0
          ? `${Math.abs(comparePct)}% less screen time than yesterday — calmer pace.`
          : `${comparePct}% more than yesterday — watch the evening scroll.`,
      tone: comparePct <= 0 ? 'good' : 'warn',
    });
  }
  const dow = new Date().getDay();
  const hours = heatmapHourSeries(heatmap, { dow });
  const peakH = hours.indexOf(Math.max(...hours));
  if (Math.max(...hours) > 0) {
    candidates.push({
      id: 'peak-hour',
      title: "Today's Insight",
      body: `Your heaviest hour pattern lands near ${peakH}:00. Protect that window.`,
      tone: 'neutral',
    });
  }
  if (!candidates.length) {
    return { id: 'fallback', title: "Today's Insight", body: 'Keep browsing — insights unlock with more data.', tone: 'neutral' };
  }
  const dayBucket = Math.floor(Date.now() / 3600000); // rotates hourly
  return candidates[dayBucket % candidates.length];
}

/** 0–1 pulse intensity from heatmap + total */
export function digitalPulseIntensity(heatmap, total) {
  const dow = new Date().getDay();
  const hours = heatmapHourSeries(heatmap, { dow });
  const nowH = new Date().getHours();
  const recent = hours.slice(Math.max(0, nowH - 2), nowH + 1);
  const local = recent.reduce((s, v) => s + v, 0);
  const dayMax = Math.max(...hours, 1);
  const heatPart = Math.min(1, local / dayMax);
  const volPart = Math.min(1, (total || 0) / (4 * 3600));
  return Math.max(0.08, Math.min(1, heatPart * 0.65 + volPart * 0.35));
}

/** Fingerprint axes from real behavior (0–1) */
export function digitalFingerprintAxes(agg, sessionStats, heatmap) {
  const total = Math.max(1, agg.total || 0);
  const focus = (agg.catBreakdown || [])
    .filter(c => FOCUS_CATS.includes(c.category))
    .reduce((s, c) => s + c.time, 0);
  const social = (agg.catBreakdown || []).find(c => c.category === 'social')?.time || 0;
  const ent = (agg.catBreakdown || []).find(c => c.category === 'entertainment')?.time || 0;
  const hours = heatmapHourSeries(heatmap, { dow: new Date().getDay() });
  const night = hours.slice(22).concat(hours.slice(0, 6)).reduce((s, v) => s + v, 0);
  const daySum = hours.reduce((s, v) => s + v, 0) || 1;
  const depth = sessionStats.avgSession > 0
    ? Math.min(1, sessionStats.avgSession / 600)
    : 0.2;
  const variety = Math.min(1, (agg.topSites?.length || 0) / 25);
  const velocity = Math.min(1, (sessionStats.velocity || 0) / 40);
  return [
    { key: 'Focus', value: focus / total },
    { key: 'Social', value: social / total },
    { key: 'Play', value: ent / total },
    { key: 'Depth', value: depth },
    { key: 'Variety', value: variety },
    { key: 'Night', value: night / daySum },
    { key: 'Switch', value: velocity },
  ];
}
