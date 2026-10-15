// Screen Time Tracker — Material You popup (Usage + Limits)
import {
  fmt, catColor, scoreLabel, calcScore,
  aggregateRange, msg, faviconUrl, dateKey, sliceRange, setDailyResetHour,
  escapeHtml, safeImgSrc,
} from './utils.js';
import { log } from './logger.js';
import { renderAreaChart, renderFocusWavyThin } from './charts.js';
import { applyTheme, themeList } from './themes.js';
import { VISUAL_THEMES, normalizeVisualTheme } from './visual-theme.js';
import { icon } from './icons.js';
import { mountLogo, restagger, flashMetric } from './motion.js';
import { CONFIG } from './config.js';
import { isVisualThemeAllowed, planBadgeHtml } from './pro.js';

let todayData = {};
let rangeCache = {};
let settings = {};
let liveInfo = null;
let usageDays = 1;
let saveDeb = null;
let planInfo = { plan: 'free', isPro: false, expiresAt: null };

const $ = id => document.getElementById(id);
const esc = escapeHtml;

function dsave() {
  clearTimeout(saveDeb);
  saveDeb = setTimeout(() => msg('SAVE_SETTINGS', { settings }).catch(() => {}), 250);
}

function openDash() {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
}

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
  renderThemeBar();
  renderVisualThemeBar();
  remountChromeIcons();
}

function renderThemeBar() {
  const bar = $('theme-bar');
  if (!bar) return;
  const cur = currentThemeId();
  const mode = currentMode();
  bar.innerHTML = themeList().map(t => {
    const bg = typeof t.swatch === 'string' && t.swatch.startsWith('linear')
      ? `background:${t.swatch}`
      : `background:${t.swatch || 'var(--m3-primary)'}`;
    const cls = t.id === 'auto' ? 'theme-chip auto' : 'theme-chip';
    return `<button type="button" class="${cls}${t.id === cur ? ' on' : ''}" data-theme="${t.id}" title="${esc(t.label)}" style="${t.id === 'auto' ? '' : bg}" aria-label="${esc(t.label)}"></button>`;
  }).join('') + `
    <div class="mode-pill" role="group" aria-label="Light or dark">
      <button type="button" data-mode="auto" class="${mode === 'auto' ? 'on' : ''}">Auto</button>
      <button type="button" data-mode="light" class="${mode === 'light' ? 'on' : ''}">Light</button>
      <button type="button" data-mode="dark" class="${mode === 'dark' ? 'on' : ''}">Dark</button>
    </div>`;

  bar.querySelectorAll('[data-theme]').forEach(b => {
    b.onclick = () => {
      settings.theme = b.dataset.theme;
      settings.m3YouApplied = true;
      paintTheme();
      dsave();
      renderUsage();
    };
  });
  bar.querySelectorAll('[data-mode]').forEach(b => {
    b.onclick = () => {
      settings.themeMode = b.dataset.mode;
      paintTheme();
      dsave();
      renderUsage();
    };
  });
  bar.style.opacity = normalizeVisualTheme(settings.visualTheme) === 'material' ? '1' : '0.4';
}

function dismissVisualProGate(restore = true) {
  $('stt-pro-gate')?.remove();
  if (restore) paintTheme();
}

function showVisualProGate(themeId) {
  const id = normalizeVisualTheme(themeId);
  const meta = VISUAL_THEMES.find(v => v.id === id) || { label: id, blurb: '' };
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
  const swatches = id === 'minimal'
    ? ['#F5F5F4', '#1A1A1A', '#4A6270', '#0C0C0C']
    : id === 'editorial'
      ? ['#FAF6EF', '#0B7A75', '#E85D4C', '#1E1B16']
      : ['#fdf8ff', '#6750a4', '#c45c7a', '#1c1b1f'];
  overlay.innerHTML = `<div class="stt-pro-gate-card">
    <div class="stt-pro-gate-eyebrow">Pro skin</div>
    <h2 class="stt-pro-gate-title">${esc(meta.label)}</h2>
    <p class="stt-pro-gate-copy">${esc(meta.blurb)}. Unlock with Pro to keep this look.</p>
    <div class="stt-pro-gate-swatches" aria-hidden="true">${swatches.map(c => `<i style="background:${c}"></i>`).join('')}</div>
    <div class="stt-pro-gate-actions">
      <button type="button" class="btn" id="stt-gate-dismiss">Not now</button>
      <button type="button" class="btn primary" id="stt-gate-upgrade">Upgrade to Pro</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) dismissVisualProGate(true); });
  $('stt-gate-dismiss')?.addEventListener('click', () => dismissVisualProGate(true));
  $('stt-gate-upgrade')?.addEventListener('click', () => {
    dismissVisualProGate(true);
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') + '#pro' });
  });
}

function renderVisualThemeBar() {
  const host = $('visual-theme-bar');
  if (!host) return;
  const cur = normalizeVisualTheme(settings.visualTheme);
  const short = { material: 'Material', editorial: 'Editorial', minimal: 'Minimal' };
  host.classList.add('visual-theme-bar--compact');
  host.innerHTML = VISUAL_THEMES.map(v => {
    const locked = !isVisualThemeAllowed(v.id, planInfo.isPro ? planInfo.plan : 'free');
    const tip = `${v.label} — ${v.blurb}${locked ? ' (Pro)' : ''}`;
    return `<button type="button" class="visual-chip ${v.id === cur ? 'on' : ''}${locked ? ' locked' : ''}" data-visual="${v.id}" data-locked="${locked ? '1' : '0'}" title="${esc(tip)}" aria-label="${esc(v.label)}${locked ? ' (Pro)' : ''}" aria-pressed="${v.id === cur ? 'true' : 'false'}">
      <strong>${esc(short[v.id] || v.label)}</strong>
    </button>`;
  }).join('');
  host.querySelectorAll('[data-visual]').forEach(b => {
    b.onclick = () => {
      if (b.dataset.locked === '1') {
        showVisualProGate(b.dataset.visual);
        return;
      }
      settings.visualTheme = b.dataset.visual;
      paintTheme();
      dsave();
      renderUsage();
    };
  });
}

function remountChromeIcons() {
  document.querySelectorAll('[data-ico]').forEach(el => {
    el.innerHTML = icon(el.dataset.ico, Number(el.dataset.icoSize) || 15);
  });
  document.querySelectorAll('[data-logo]').forEach(el => {
    mountLogo(el, Number(el.dataset.logo) || 36);
  });
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`panel-${tab.dataset.tab}`)?.classList.add('active');
    if (tab.dataset.tab === 'limits') applyLimitsUI();
  });
});

$('usage-filters')?.addEventListener('click', e => {
  const b = e.target.closest('.f-btn');
  if (!b) return;
  const days = +b.dataset.days;
  if (days > 7 && !planInfo.isPro) {
    // Soft CTA — open dashboard Pro tab
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html#pro') }).catch(() => {});
    return;
  }
  document.querySelectorAll('#usage-filters .f-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  usageDays = days;
  renderUsage();
});

async function boot() {
  const [live, st, range] = await Promise.all([
    msg('GET_LIVE').catch(() => ({})),
    msg('GET_SETTINGS').then(r => r.settings || {}),
    msg('GET_RANGE', { days: 90 }).then(r => r.data || {}).catch(() => ({})),
  ]);
  settings = st;
  todayData = live.data || {};
  liveInfo = live.live || null;
  rangeCache = range || {};
  try { setDailyResetHour(settings.dailyResetHour); } catch {}

  if (!settings.m3YouApplied) {
    settings.theme = 'auto';
    settings.themeMode = 'auto';
    settings.m3YouApplied = true;
    settings.skyThemeApplied = true;
    await msg('SAVE_SETTINGS', { settings });
  }

  // Soft plan check + auto cloud sync (GET_PLAN also soft-refreshes; avoid double network)
  await msg('CLOUD_PULL').catch(() => {});

  paintTheme();
  mountLogo($('hdr-logo'), 32);
  await renderProfileStrip();

  $('btn-refresh').innerHTML = icon('reset', 16);
  $('dash-ico').innerHTML = icon('dash', 14);
  $('ghost-ico').innerHTML = icon('ghost', 14);
  $('btn-nuclear').innerHTML = `${icon('nuclear', 14)} Hard Lock (Pro)`;
  $('btn-open-dash').innerHTML = `${icon('dash', 14)} Open full dashboard`;

  renderUsage();
  applyLimitsUI();
  updateGhost();
}

function updateGhost() {
  $('ghost-banner')?.classList.toggle('on', !!settings.ghostMode);
}

async function renderProfileStrip() {
  const el = $('profile-strip');
  if (!el) return;
  const [ur, guestStore, plan] = await Promise.all([
    msg('GET_USER').then(r => r.user || null).catch(() => null),
    chrome.storage.local.get(['stt_guest']),
    msg('GET_PLAN').then(r => r || {}).catch(() => ({})),
  ]);
  let guest = guestStore.stt_guest;
  if (!guest?.deviceId) {
    try {
      await msg('PUBLISH_GUEST_SCORE');
      guest = (await chrome.storage.local.get(['stt_guest'])).stt_guest;
    } catch {}
  }
  planInfo = { plan: plan.plan || 'free', isPro: !!plan.isPro, expiresAt: plan.expiresAt ?? null };
  document.querySelectorAll('#usage-filters .f-btn[data-days]').forEach(b => {
    const days = +b.dataset.days;
    const locked = days > 7 && !planInfo.isPro;
    b.classList.toggle('pro-locked', locked);
    b.title = locked ? 'Pro — 30 & 90 day ranges' : '';
  });
  if (ur?.email) {
    el.innerHTML = `<div class="ps-inner">
      <div class="ps-av">${ur.picture ? `<img src="${safeImgSrc(ur.picture)}" alt=""/>` : esc((ur.name || 'U')[0])}</div>
      <div class="ps-meta"><b>${esc(ur.name || 'Member')}</b><span style="display:inline-flex;align-items:center;gap:6px">${planBadgeHtml(planInfo)} · auto sync</span></div>
      <button type="button" class="ps-btn" id="ps-open">Profile</button>
    </div>`;
  } else {
    el.innerHTML = `<div class="ps-inner">
      <div class="ps-av">${esc((guest?.displayName || 'G')[0])}</div>
      <div class="ps-meta"><b>${esc(guest?.displayName || 'Guest')}</b><span>Local · sign in to sync</span></div>
      <button type="button" class="ps-btn primary" id="ps-auth">Sign in</button>
    </div>`;
  }
  $('ps-open')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') + '#profile' });
  });
  $('ps-auth')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/auth.html') });
  });
}

function periodLabel(days) {
  if (days === 1) return 'Today';
  if (days === 7) return 'This week';
  if (days === 30) return 'This month';
  return 'Last 90 days';
}

function usageSlice() {
  if (usageDays === 1) return { [dateKey(0)]: todayData };
  return sliceRange(rangeCache, usageDays);
}

function setWavyProgress(elOrId, score) {
  const el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
  if (!el) return;
  const p = Math.max(0.06, Math.min(1, (Number(score) || 0) / 100));
  el.style.setProperty('--wavy-progress', String(p));
}

function renderUsage({ soft = false } = {}) {
  const sl = usageSlice();
  const { total, topSites, catBreakdown, daily, score } = aggregateRange(sl);
  const dayScore = usageDays === 1 ? calcScore(todayData) : score;
  const social = catBreakdown.find(c => c.category === 'social')?.time || 0;
  const ent = catBreakdown.find(c => c.category === 'entertainment')?.time || 0;
  const prod = ['productivity', 'coding', 'education']
    .reduce((s, c) => s + (catBreakdown.find(x => x.category === c)?.time || 0), 0);

  if ($('usage-period-label')) $('usage-period-label').textContent = periodLabel(usageDays);
  if ($('hdr-mood')) $('hdr-mood').textContent = periodLabel(usageDays);
  if ($('hero-total')) {
    $('hero-total').innerHTML = `${esc(fmt(total))}<small>total</small>`;
    if (!soft) flashMetric($('hero-total'));
  }

  const themeCol = getComputedStyle(document.documentElement).getPropertyValue('--m3-primary').trim() || null;
  renderFocusWavyThin('pop-focus-ring', dayScore, themeCol);
  if ($('rn')) $('rn').textContent = dayScore;
  if ($('rl')) $('rl').textContent = scoreLabel(dayScore);
  $('pop-focus-ring')?.closest('.ring-wrap')?.classList.add('is-live');

  setWavyProgress('wavy-wrap', dayScore);

  if ($('ms-sites')) $('ms-sites').textContent = topSites.length;
  if ($('ms-prod')) $('ms-prod').textContent = fmt(prod);
  if ($('ms-social')) $('ms-social').textContent = fmt(social);
  if ($('ms-ent')) $('ms-ent').textContent = fmt(ent);
  if (!soft) restagger(document.querySelector('.mini-stats'), 'stagger');

  renderLiveBar({ soft });
  if (!soft) renderSiteList('usage-sites', topSites.slice(0, 8));
  else {
    const list = $('usage-sites');
    if (!list || !list.querySelector('.site-row')) {
      renderSiteList('usage-sites', topSites.slice(0, 8));
    } else {
      const rows = list.querySelectorAll('.site-row');
      const max = topSites[0]?.totalTime || 1;
      topSites.slice(0, 8).forEach((s, i) => {
        const row = rows[i];
        if (!row) return;
        const tv = row.querySelector('.site-tv');
        const bar = row.querySelector('.site-bar-f');
        const link = row.querySelector('.site-link');
        if (tv) tv.textContent = fmt(s.totalTime);
        if (bar) bar.style.width = `${Math.max(6, Math.round((s.totalTime / max) * 100))}%`;
        if (link && link.textContent !== s.domain) link.textContent = s.domain;
      });
    }
  }
  renderAreaChart('usage-chart', daily?.length ? daily : [{ date: dateKey(0), time: total }], { fmt, soft });
}

function renderLiveBar({ soft = false } = {}) {
  const el = $('live-bar');
  if (!el) return;
  if (!liveInfo?.domain) {
    if (soft && el.querySelector('.site-row')) return;
    el.innerHTML = `<div style="font-size:12px;color:var(--t3)">Browse any site to see live time</div>`;
    return;
  }
  const existing = el.querySelector('.site-row');
  if (soft && existing) {
    const link = existing.querySelector('.site-link');
    const tv = existing.querySelector('.site-tv');
    const img = existing.querySelector('img');
    if (link) link.innerHTML = `${esc(liveInfo.domain)} <span class="live-tag">LIVE</span>`;
    if (tv) tv.textContent = fmt(liveInfo.elapsed || 0);
    if (img) img.src = faviconUrl(liveInfo.domain);
    return;
  }
  el.innerHTML = `<div class="site-row" style="padding:0">
    <div class="site-fav"><img src="${faviconUrl(liveInfo.domain)}" alt=""/></div>
    <div class="site-meta">
      <div class="site-link">${esc(liveInfo.domain)} <span class="live-tag">LIVE</span></div>
      <div class="site-bar-w"><div class="site-bar-f" style="width:70%"></div></div>
    </div>
    <span class="site-tv">${fmt(liveInfo.elapsed || 0)}</span>
  </div>`;
}

function renderSiteList(id, sites) {
  const el = $(id);
  if (!el) return;
  if (!sites.length) {
    el.innerHTML = `<div class="empty">${icon('eye', 24)}<div style="margin-top:8px">No usage in this period</div></div>`;
    return;
  }
  const max = sites[0]?.totalTime || 1;
  el.innerHTML = sites.map(s => {
    const pct = Math.max(6, Math.round((s.totalTime / max) * 100));
    return `<div class="site-row">
      <div class="site-fav"><img src="${faviconUrl(s.domain)}" alt="" loading="lazy"/></div>
      <div class="site-meta">
        <a class="site-link" href="https://${esc(s.domain)}" target="_blank" rel="noopener">${esc(s.domain)}</a>
        <div class="site-bar-w"><div class="site-bar-f" style="width:${pct}%"></div></div>
      </div>
      <span class="site-tv">${fmt(s.totalTime)}</span>
    </div>`;
  }).join('');
  restagger(el, 'stagger');
}

function setTog(id, on) {
  const el = $(id);
  if (!el) return;
  el.className = 'toggle ' + (on ? 'on' : 'off');
}

function applyLimitsUI() {
  setTog('tog-focus', !!settings.focusMode);
  setTog('tog-schedule', !!settings.focusSchedule?.enabled);
  setTog('tog-cleaner', !!settings.cleaner?.enabled);
  setTog('tog-bw', !!settings.bwMode);
  if ($('sl-social')) $('sl-social').value = settings.socialLimit || 60;
  if ($('sl-sv')) $('sl-sv').textContent = (settings.socialLimit || 60) + 'm';
  if ($('sl-ent')) $('sl-ent').value = settings.entLimit || 120;
  if ($('sl-ev')) $('sl-ev').textContent = (settings.entLimit || 120) + 'm';
  renderBlocked();
  renderSiteLimits();
  renderSessionCaps();
  renderPatterns();
  wireWavySliders();
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

function wireToggle(id, fn) {
  $(id)?.addEventListener('click', () => { fn(); dsave(); applyLimitsUI(); });
}
wireToggle('tog-focus', () => { settings.focusMode = !settings.focusMode; });
wireToggle('tog-schedule', () => {
  settings.focusSchedule = { ...(settings.focusSchedule || {}), enabled: !settings.focusSchedule?.enabled };
});
wireToggle('tog-cleaner', () => {
  settings.cleaner = { ...(settings.cleaner || {}), enabled: !settings.cleaner?.enabled };
});
wireToggle('tog-bw', () => { settings.bwMode = !settings.bwMode; });

function renderBlocked() {
  const el = $('bl-tags');
  if (!el) return;
  el.innerHTML = (settings.blockedSites || []).map((s, i) =>
    `<span class="bl-tag">${esc(s)} <button type="button" data-i="${i}">×</button></span>`
  ).join('') || '<div style="font-size:12px;color:var(--t3)">No blocked sites</div>';
  el.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      settings.blockedSites.splice(+b.dataset.i, 1);
      renderBlocked();
      dsave();
    };
  });
}
$('bl-add')?.addEventListener('click', () => {
  const s = $('bl-inp')?.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!s) return;
  settings.blockedSites = [...new Set([...(settings.blockedSites || []), s])];
  $('bl-inp').value = '';
  renderBlocked();
  dsave();
});

function renderSiteLimits() {
  const el = $('site-limits');
  if (!el) return;
  const limits = settings.siteLimits || {};
  el.innerHTML = Object.entries(limits).map(([d, m]) => `
    <div class="srow">
      <div class="srow-lbl">${esc(d)}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="sl-val">${m}m</span>
        <button type="button" data-rm="${esc(d)}" style="border:none;background:transparent;cursor:pointer;color:var(--t2);font-size:16px">×</button>
      </div>
    </div>`).join('') || '<div style="font-size:12px;color:var(--t3)">No daily limits</div>';
  el.querySelectorAll('[data-rm]').forEach(b => {
    b.onclick = () => {
      delete settings.siteLimits[b.dataset.rm];
      renderSiteLimits();
      dsave();
    };
  });
}
$('slimit-add')?.addEventListener('click', () => {
  const d = $('slimit-domain')?.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const m = parseInt($('slimit-mins')?.value || '60', 10);
  if (!d || !m) return;
  settings.siteLimits = { ...(settings.siteLimits || {}), [d]: m };
  $('slimit-domain').value = '';
  renderSiteLimits();
  dsave();
});

function renderSessionCaps() {
  const el = $('session-caps');
  if (!el) return;
  const caps = settings.sessionCaps || {};
  el.innerHTML = Object.entries(caps).map(([d, cap]) => `
    <div class="srow">
      <div><div class="srow-lbl">${esc(d)}</div><div class="srow-sub">${Math.round((cap.usedSec || 0) / 60)}m / ${cap.limitMin}m</div></div>
      <button type="button" data-rm-cap="${esc(d)}" style="border:none;background:transparent;cursor:pointer;color:var(--t2);font-size:16px">×</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--t3)">No session caps</div>';
  el.querySelectorAll('[data-rm-cap]').forEach(b => {
    b.onclick = () => {
      delete settings.sessionCaps[b.dataset.rmCap];
      renderSessionCaps();
      dsave();
    };
  });
}
$('scap-add')?.addEventListener('click', () => {
  const d = $('scap-domain')?.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const m = parseInt($('scap-mins')?.value || '15', 10);
  if (!d || !m) return;
  settings.sessionCaps = {
    ...(settings.sessionCaps || {}),
    [d]: { limitMin: m, usedSec: 0, dayKey: dateKey(0) },
  };
  $('scap-domain').value = '';
  renderSessionCaps();
  dsave();
});

function renderPatterns() {
  const el = $('pattern-list');
  if (!el) return;
  el.innerHTML = (settings.blockedPatterns || []).map((s, i) =>
    `<span class="bl-tag">${esc(s)} <button type="button" data-i="${i}">×</button></span>`
  ).join('') || '<div style="font-size:12px;color:var(--t3)">No path patterns</div>';
  el.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      settings.blockedPatterns.splice(+b.dataset.i, 1);
      renderPatterns();
      dsave();
    };
  });
}
$('pattern-add')?.addEventListener('click', () => {
  const s = $('pattern-inp')?.value.trim().toLowerCase().replace(/^https?:\/\//, '');
  if (!s) return;
  settings.blockedPatterns = [...new Set([...(settings.blockedPatterns || []), s])];
  $('pattern-inp').value = '';
  renderPatterns();
  dsave();
});

$('sl-social')?.addEventListener('input', e => {
  settings.socialLimit = +e.target.value;
  if ($('sl-sv')) $('sl-sv').textContent = settings.socialLimit + 'm';
  dsave();
});
$('sl-ent')?.addEventListener('input', e => {
  settings.entLimit = +e.target.value;
  if ($('sl-ev')) $('sl-ev').textContent = settings.entLimit + 'm';
  dsave();
});

$('btn-nuclear')?.addEventListener('click', async () => {
  const hours = parseFloat(prompt('Hard Lock hours (e.g. 1 or 2):', '1') || '0');
  if (!hours || hours <= 0) return;
  const r = await msg('START_NUCLEAR', { hours });
  if (!r?.ok) {
    alert(r?.error || 'Hard Lock requires Pro — upgrade from the dashboard.');
    return;
  }
  alert('Hard Lock active until ' + new Date(r.until).toLocaleString());
});

$('btn-refresh')?.addEventListener('click', async () => {
  const btn = $('btn-refresh');
  btn?.classList.add('is-spinning');
  try {
    const [live, range] = await Promise.all([
      msg('GET_LIVE'),
      msg('GET_RANGE', { days: 90 }).then(r => r.data || {}),
    ]);
    todayData = live.data || {};
    liveInfo = live.live || null;
    rangeCache = range;
    renderUsage({ soft: true });
  } catch {}
  setTimeout(() => btn?.classList.remove('is-spinning'), 450);
});

$('btn-dash')?.addEventListener('click', openDash);
$('btn-open-dash')?.addEventListener('click', openDash);

boot().catch((e) => log.error(e));

setInterval(async () => {
  try {
    const live = await msg('GET_LIVE');
    todayData = live.data || todayData;
    liveInfo = live.live || null;
    if (document.querySelector('#panel-usage.active') && usageDays === 1) {
      renderUsage({ soft: true });
    } else {
      renderLiveBar({ soft: true });
    }
  } catch {}
}, 2500);
