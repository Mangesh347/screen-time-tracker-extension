import { icon, setIconPack } from './icons.js';
import { applySettingsTheme } from './themes.js';
import { mountLogo } from './motion.js';
import { normalizeVisualTheme } from './visual-theme.js';

const boot = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => ({}));
const bootSettings = boot?.settings || {};
applySettingsTheme(bootSettings, document.documentElement, { animate: false });
const visual = normalizeVisualTheme(bootSettings.visualTheme);
setIconPack(visual === 'editorial' ? 'editorial' : 'material');
mountLogo(document.getElementById('blocked-logo'), 40);

const p = new URLSearchParams(location.search);
const site = p.get('site') || 'this site';
const reason = p.get('reason') || 'focus';

document.getElementById('sn').textContent = site;
const title = document.getElementById('title');
const reasonEl = document.getElementById('reason');
const copy = document.getElementById('copy');
const ico = document.getElementById('ico');

ico.innerHTML = icon('block', 56);

let hardLock = reason === 'nuclear';
let cooldown = hardLock ? 60 : 300;

if (reason.startsWith('limit')) {
  title.textContent = 'Daily Limit Reached';
  reasonEl.textContent = 'Per-site / category budget';
  copy.innerHTML = "You hit today's limit for this site.<br/>Take a break or use a one-time grace.";
  ico.innerHTML = icon('clock', 56);
  document.getElementById('grace-btn').style.display = 'inline-block';
} else if (reason === 'nuclear') {
  title.textContent = 'Hard Lock Active';
  reasonEl.textContent = 'Type the domain to unlock (Pro)';
  copy.innerHTML =
    'Hard Lock is on. Wait for cooldown, then type the exact site name to escape once.';
  ico.innerHTML = icon('nuclear', 56);
  document.getElementById('unblock-btn').textContent = 'Challenge unlock';
} else if (reason === 'whitelist') {
  title.textContent = 'Allow-only Mode';
  reasonEl.textContent = 'Site not on whitelist';
  copy.innerHTML = 'Whitelist mode blocks everything except approved sites.';
  ico.innerHTML = icon('block', 56);
} else if (reason === 'keyword') {
  const kw = p.get('kw') || 'keyword';
  title.textContent = 'Keyword Blocked';
  reasonEl.textContent = 'Matched: ' + kw;
  copy.innerHTML = 'This page matched a blocked keyword (URL, title, or content).';
  ico.innerHTML = icon('key', 56);
}

let s = cooldown;
const tot = s;
const t = setInterval(() => {
  s--;
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  document.getElementById('tm').textContent = `${m}:${ss}`;
  document.getElementById('pf').style.width = `${(s / tot) * 100}%`;
  if (s <= 0) {
    clearInterval(t);
    const b = document.getElementById('unblock-btn');
    if (b) {
      b.disabled = false;
      b.style.opacity = '1';
    }
  }
}, 1000);

document.getElementById('back-btn')?.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = 'https://www.google.com';
});

document.getElementById('unblock-btn').addEventListener('click', () => {
  if (hardLock) {
    const typed = prompt(`Type "${site}" exactly to unlock once:`);
    if (!typed || typed.trim().toLowerCase() !== site.toLowerCase()) {
      alert('Challenge failed — stay focused.');
      chrome.storage.local.get(['settings'], ({ settings = {} }) => {
        const week = new Date().toISOString().slice(0, 10);
        settings.bypassCountWeek = (settings.bypassCountWeek || 0) + 1;
        settings.bypassWeekKey = week;
        chrome.storage.local.set({ settings });
      });
      return;
    }
  }
  chrome.storage.local.get(['settings'], ({ settings = {} }) => {
    const bl = settings.blockedSites || [];
    settings.blockedSites = bl.filter(b => b !== site && !site.endsWith('.' + b));
    chrome.storage.local.set({ settings }, () => history.back());
  });
});

document.getElementById('grace-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'USE_GRACE', domain: site }, r => {
    if (r && r.ok) history.back();
    else alert(r?.error || 'Grace unavailable');
  });
});
