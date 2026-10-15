// Local activity notifications — offline for Free, guests, and Pro
import { dateKey, fmt, calcScore } from './utils.js';

const STORE_KEY = 'stt_notifications_local';
const MAX = 40;

function uid() {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function loadAll() {
  const store = await chrome.storage.local.get([STORE_KEY]);
  return Array.isArray(store[STORE_KEY]) ? store[STORE_KEY] : [];
}

async function saveAll(rows) {
  await chrome.storage.local.set({ [STORE_KEY]: rows.slice(0, MAX) });
}

export async function pushActivityNotification({
  type = 'activity',
  title,
  body,
  dedupeKey = null,
  payload = {},
} = {}) {
  if (!title) return null;
  const rows = await loadAll();
  const key = dedupeKey || `${type}:${title}:${body}`;
  const existing = rows.findIndex(r => r.dedupeKey === key);
  const row = {
    id: existing >= 0 ? rows[existing].id : uid(),
    type,
    title,
    body: body || '',
    payload,
    dedupeKey: key,
    created_at: new Date().toISOString(),
    read_at: existing >= 0 ? rows[existing].read_at : null,
  };
  if (existing >= 0) rows.splice(existing, 1);
  rows.unshift(row);
  await saveAll(rows);
  return row;
}

export async function listLocalNotifications(limit = 40) {
  return (await loadAll()).slice(0, limit);
}

export async function unreadLocalCount() {
  return (await loadAll()).filter(r => !r.read_at).length;
}

export async function markLocalNotificationsRead(ids = null) {
  const now = new Date().toISOString();
  const rows = (await loadAll()).map(r => {
    if (ids && !ids.includes(r.id)) return r;
    return { ...r, read_at: r.read_at || now };
  });
  await saveAll(rows);
}

export async function markOneLocalRead(id) {
  if (id) await markLocalNotificationsRead([id]);
}

function summarize(dayObj = {}) {
  let total = 0, focus = 0, social = 0;
  const sites = [];
  for (const [domain, e] of Object.entries(dayObj || {})) {
    const t = e?.totalTime || 0;
    total += t;
    if (['productivity', 'coding', 'education'].includes(e?.category)) focus += t;
    if (e?.category === 'social') social += t;
    sites.push({ domain, sec: t, category: e?.category || 'other' });
  }
  sites.sort((a, b) => b.sec - a.sec);
  return { total, focus, social, sites, score: calcScore(dayObj || {}) };
}

export async function refreshActivityFeed({ rangeData = {}, settings = {} } = {}) {
  const today = rangeData[dateKey(0)] || {};
  const sum = summarize(today);
  const day = dateKey(0);
  const goalMin = Number(settings.focusGoalMins) || 120;
  const goalSec = goalMin * 60;
  const socialMax = (Number(settings.socialLimit) || 60) * 60;
  const streak = settings.streaks?.current || 0;

  if (sum.sites[0] && sum.sites[0].sec >= 20 * 60) {
    const top = sum.sites[0];
    await pushActivityNotification({
      type: 'site',
      title: `${top.domain} is leading today`,
      body: `You used ${top.domain} for ${fmt(top.sec)} so far.`,
      dedupeKey: `site_top_${day}_${top.domain}`,
      payload: { domain: top.domain },
    });
  }

  for (const s of sum.sites.slice(0, 5)) {
    const lim = settings.siteLimits?.[s.domain];
    if (!lim) continue;
    const limSec = Number(lim) * 60;
    if (limSec <= 0) continue;
    const pct = s.sec / limSec;
    if (pct >= 0.85 && pct < 1) {
      await pushActivityNotification({
        type: 'limit',
        title: `Limit approaching on ${s.domain}`,
        body: `${fmt(s.sec)} of ${lim}m used — about ${Math.round((1 - pct) * 100)}% left.`,
        dedupeKey: `limit_warn_${day}_${s.domain}`,
        payload: { domain: s.domain },
      });
    } else if (pct >= 1) {
      await pushActivityNotification({
        type: 'limit',
        title: `Limit reached on ${s.domain}`,
        body: `Daily cap of ${lim}m is used up for ${s.domain}.`,
        dedupeKey: `limit_hit_${day}_${s.domain}`,
        payload: { domain: s.domain },
      });
    }
  }

  if (socialMax > 0 && sum.social >= socialMax * 0.85) {
    const hit = sum.social >= socialMax;
    await pushActivityNotification({
      type: 'goal',
      title: hit ? 'Social budget used' : 'Social budget nearly full',
      body: hit
        ? `Social time hit ${fmt(sum.social)} against your ${settings.socialLimit || 60}m budget.`
        : `${fmt(sum.social)} social so far — ${settings.socialLimit || 60}m is the daily budget.`,
      dedupeKey: `social_budget_${day}`,
    });
  }

  if (goalSec > 0) {
    if (sum.focus >= goalSec) {
      await pushActivityNotification({
        type: 'goal',
        title: 'Focus goal complete',
        body: `${fmt(sum.focus)} of productive time — daily focus target of ${goalMin}m locked in.`,
        dedupeKey: `focus_done_${day}`,
      });
    } else if (sum.focus >= goalSec * 0.5) {
      const left = Math.max(0, goalSec - sum.focus);
      await pushActivityNotification({
        type: 'goal',
        title: 'Focus goal in progress',
        body: `${fmt(sum.focus)} focus so far · ${fmt(left)} left to hit ${goalMin}m.`,
        dedupeKey: `focus_mid_${day}`,
      });
    } else if (sum.total > 45 * 60 && sum.focus < goalSec * 0.25) {
      await pushActivityNotification({
        type: 'goal',
        title: 'Focus goal at risk',
        body: `Only ${fmt(sum.focus)} productive so far against a ${goalMin}m target.`,
        dedupeKey: `focus_risk_${day}`,
      });
    }
  }

  if (streak >= 2) {
    await pushActivityNotification({
      type: 'streak',
      title: `${streak}-day streak`,
      body: 'Consistency boosts your standing when scores are close.',
      dedupeKey: `streak_${day}_${streak}`,
    });
  }

  if (sum.score >= 75 && sum.total > 20 * 60) {
    await pushActivityNotification({
      type: 'focus',
      title: `Focus Score ${sum.score}`,
      body: 'Strong balance of productive vs distracting time today.',
      dedupeKey: `score_high_${day}`,
    });
  } else if (sum.score < 40 && sum.total > 60 * 60) {
    await pushActivityNotification({
      type: 'focus',
      title: `Focus Score ${sum.score}`,
      body: 'A short Focus block can recover the day — productive sites lift the score.',
      dedupeKey: `score_low_${day}`,
    });
  }

  const hour = new Date().getHours();
  if (hour >= 21 && sum.total > 3 * 3600) {
    await pushActivityNotification({
      type: 'habit',
      title: 'Long day on screen',
      body: `${fmt(sum.total)} tracked today. A wind-down helps protect tomorrow’s streak.`,
      dedupeKey: `long_day_${day}`,
    });
  }

  return listLocalNotifications();
}

export function mergeNotificationFeeds(localRows = [], cloudRows = []) {
  const cloud = (cloudRows || []).map(n => ({
    id: n.id || `c_${n.created_at}`,
    type: n.type || 'cloud',
    title: n.title || 'Update',
    body: n.body || '',
    payload: n.payload || {},
    created_at: n.created_at || new Date().toISOString(),
    read_at: n.read_at || null,
    source: 'cloud',
  }));
  const local = (localRows || []).map(n => ({ ...n, source: 'local' }));
  return [...local, ...cloud]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, MAX);
}
