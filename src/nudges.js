// Feature nudges + domain awards — calm, domain-y copy (few/no emoji)
import { pushLocalNotification } from './cloud.js';
import { dateKey } from './utils.js';

const FEATURES = [
  {
    id: 'focus_mode',
    title: 'Focus mode is waiting',
    body: 'Turn on Focus when you need an uninterrupted block. Your block list is already set.',
    daysIdle: 3,
    check: (s) => !s.focusMode,
  },
  {
    id: 'cleaner',
    title: 'Quiet the feeds',
    body: 'Distraction Cleaner hides Shorts and Reels so the scroll stops sooner.',
    daysIdle: 4,
    check: (s) => !s.cleaner?.enabled,
  },
  {
    id: 'goals',
    title: 'Set a focus target',
    body: 'A daily focus goal turns browsing into a score you can improve.',
    daysIdle: 3,
    check: (s) => !(s.focusGoalMins > 0),
  },
  {
    id: 'social_feed',
    title: 'Share one focus win',
    body: 'Pro members can post a short thought and find people who track time like you.',
    daysIdle: 4,
    check: () => true,
    proHint: true,
  },
  {
    id: 'hard_lock',
    title: 'Hard Lock for deep work',
    body: 'When willpower is thin, Hard Lock holds the line until your timer ends.',
    daysIdle: 4,
    check: (s) => !s.hardLock?.enabled,
    proHint: true,
  },
];

export async function runFeatureNudges(settings, planIsPro) {
  const store = await chrome.storage.local.get(['stt_nudge_log', 'stt_install_at']);
  const log = store.stt_nudge_log || {};
  const installAt = store.stt_install_at || Date.now();
  if (!store.stt_install_at) await chrome.storage.local.set({ stt_install_at: installAt });

  const daysSinceInstall = (Date.now() - installAt) / (86400 * 1000);
  if (daysSinceInstall < 2) return;

  for (const f of FEATURES) {
    if (f.proHint && !planIsPro && f.id !== 'social_feed' && f.id !== 'hard_lock') continue;
    if (!f.check(settings || {})) continue;
    const last = log[f.id] || 0;
    const daysSince = (Date.now() - last) / (86400 * 1000);
    if (daysSince < f.daysIdle) continue;
    await pushLocalNotification('feature', f.title, f.body, { feature: f.id });
    try {
      await chrome.notifications.create(`nudge_${f.id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: f.title,
        message: f.body,
      });
    } catch {}
    log[f.id] = Date.now();
    break; // one nudge per run
  }
  await chrome.storage.local.set({ stt_nudge_log: log });
}

/** When a site crosses a high daily hours mark — award dominion-style notice */
export async function maybeDomainAward(domain, totalSec) {
  if (!domain || totalSec < 2 * 3600) return;
  const hours = Math.floor(totalSec / 3600);
  if (hours < 2) return;
  const key = `domain_award_${domain}_${dateKey(0)}_${hours}`;
  const prev = await chrome.storage.local.get([key]);
  if (prev[key]) return;
  await chrome.storage.local.set({ [key]: true });
  const title = `${domain} claimed ${hours}h`;
  const body = hours >= 4
    ? `You lead your day on ${domain}. Own it — or reclaim the next hour with Focus.`
    : `${domain} is rising on your chart. A short Focus block keeps you in command.`;
  await pushLocalNotification('domain_award', title, body, { domain, hours });
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: body,
    });
  } catch {}
}
