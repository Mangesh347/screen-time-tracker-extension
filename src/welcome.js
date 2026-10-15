import { icon } from './icons.js';
import { applyTheme, themeList } from './themes.js';
import { mountLogo } from './motion.js';

const boot = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => ({}));
const bootSettings = boot?.settings || {};
applyTheme(bootSettings.theme || 'auto', bootSettings.themeMode || 'auto', document.documentElement, {
  animate: false,
  visualSkin: bootSettings.visualTheme || 'material',
});
mountLogo(document.getElementById('welcome-logo'), 48);

const bar = document.getElementById('theme-bar');
if (bar) {
  let cur = 'auto';
  const paint = () => {
    bar.innerHTML = themeList().map(t => {
      const bg = typeof t.swatch === 'string' && t.swatch.startsWith('linear')
        ? `background:${t.swatch}`
        : `background:${t.swatch || 'var(--m3-primary)'}`;
      const cls = t.id === 'auto' ? 'theme-chip auto' : 'theme-chip';
      return `<button type="button" class="${cls}${t.id === cur ? ' on' : ''}" data-theme="${t.id}" title="${t.label}" style="${t.id === 'auto' ? '' : bg}" aria-label="${t.label}"></button>`;
    }).join('');
    bar.querySelectorAll('[data-theme]').forEach(b => {
      b.onclick = () => {
        cur = b.dataset.theme;
        applyTheme(cur, 'auto', document.documentElement, {
          animate: true,
          visualSkin: bootSettings.visualTheme || 'material',
        });
        paint();
      };
    });
  };
  paint();
}

document.querySelectorAll('[data-ico]').forEach(el => {
  el.innerHTML = icon(el.dataset.ico, 22);
});

const openDash = e => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
};

document.getElementById('cta-dash')?.addEventListener('click', openDash);
document.getElementById('foot-dash')?.addEventListener('click', openDash);
