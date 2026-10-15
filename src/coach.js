// Budget Coach + insight helpers
import { fmt, calcScore } from './utils.js';

export function buildMorningCoach(today, settings) {
  const socialLim = (settings.goals?.maxSocialMin || 60) * 60;
  let social = 0;
  for (const e of Object.values(today || {})) {
    if (e.category === 'social') social += e.totalTime;
  }
  const left = Math.max(0, socialLim - social);
  const leftMin = Math.round(left / 60);
  let body;
  if (leftMin >= 45) body = `Nice runway — about ${fmt(left)} of social time left. Start Focus when you're ready to lock in.`;
  else if (leftMin >= 15) body = `${fmt(left)} of social left. You've got this — a short Focus session keeps the streak happy.`;
  else body = `Social budget is nearly full. One Focus tap and you're back in control.`;
  return {
    title: 'Your coach',
    body,
    cta: leftMin < 20 ? 'Start Focus' : "I'm ready",
    kind: 'morning',
  };
}

export function buildEveningCoach(today, yesterday) {
  const score = calcScore(today || {});
  let total = 0;
  for (const e of Object.values(today || {})) total += e.totalTime;
  let y = 0;
  for (const e of Object.values(yesterday || {})) y += e.totalTime;
  const delta = y ? Math.round(((total - y) / y) * 100) : 0;
  let vibe =
    score >= 70
      ? 'Solid day — celebrate the focus.'
      : score >= 45
        ? 'Decent day. Tomorrow can feel even lighter.'
        : 'Rough scroll day? Reset with Focus tomorrow morning.';
  const deltaTxt =
    delta === 0
      ? 'same as yesterday'
      : delta < 0
        ? `${Math.abs(delta)}% less than yesterday — nice`
        : `${delta}% more than yesterday`;
  return {
    title: 'Evening wrap',
    body: `${vibe} Score ${score} · ${fmt(total)} total (${deltaTxt}).`,
    cta: 'See Stats',
    kind: 'evening',
  };
}

export function buildInsightCards(today, heatmap) {
  const cards = [];
  const score = calcScore(today || {});
  cards.push({
    title: 'Productivity score',
    body: score >= 70 ? `Strong day at ${score}. Keep the streak.` : `Score ${score} — try a Focus session.`,
  });

  // Worst hour from heatmap today (approx using dow)
  const dow = new Date().getDay();
  let worstH = 0;
  let worstV = 0;
  for (let h = 0; h < 24; h++) {
    const v = heatmap?.[`${dow}_${h}`] || 0;
    if (v > worstV) {
      worstV = v;
      worstH = h;
    }
  }
  if (worstV > 0) {
    cards.push({
      title: 'Your heaviest hour',
      body: `Around ${worstH}:00 you browse most. Schedule Focus then.`,
    });
  }

  const cats = {};
  for (const e of Object.values(today || {})) {
    cats[e.category] = (cats[e.category] || 0) + e.totalTime;
  }
  const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  if (topCat) {
    cards.push({
      title: 'Top category',
      body: `${topCat[0]} leads today at ${fmt(topCat[1])}.`,
    });
  }
  return cards.slice(0, 3);
}

export function shouldShowPaywall(settings) {
  if (settings.paywallShown) return false;
  return (settings.limitHitCount || 0) >= 3 || (settings.streaks?.current || 0) >= 3;
}
