import { logoMarkHtml, mountLogoMark } from './logo-mark.js';

// Lightweight Material You motion helpers (no heavy libs)
const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Replay CSS entrance on a list container */
export function restagger(el, className = 'stagger') {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  if (!reduced()) el.classList.add(className);
}

/** Flash metric update animation */
export function flashMetric(el) {
  if (!el || reduced()) return;
  el.classList.remove('is-updating');
  void el.offsetWidth;
  el.classList.add('is-updating');
}

/** Chart shell shimmer entrance */
export function chartEnter(elOrId) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el || reduced()) return;
  el.classList.remove('is-entering');
  void el.offsetWidth;
  el.classList.add('is-entering');
  setTimeout(() => el.classList.remove('is-entering'), 1200);
}

/**
 * Static brand mark `<img>` HTML.
 * One solid scalloped-seal PNG across Material/Editorial/Minimal — no animation.
 */
export function logoMark(size = 36) {
  return logoMarkHtml(size);
}

/** Mount static brand mark (`<img>`). */
export function mountLogo(el, size = 36) {
  return mountLogoMark(el, size);
}

/** Closed wavy ring path for loaders (matches Focus Score geometry, smaller). */
function wavyLoaderPath(cx = 24, cy = 24, r = 16, { amp = 2.4, waves = 8, steps = 64 } = {}) {
  const n = Math.max(24, steps);
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rr = r + amp * Math.sin(waves * t);
    const x = cx + Math.cos(t) * rr;
    const y = cy + Math.sin(t) * rr;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

/** Material You wavy indeterminate circular loader for section content areas */
export function showSectionLoading(el, label = 'Loading…') {
  if (!el) return;
  el.dataset.sttPrevHtml = el.dataset.sttHasLoader === '1' ? el.dataset.sttPrevHtml : '';
  el.dataset.sttHasLoader = '1';
  const msg = String(label || 'Loading…');
  const ring = wavyLoaderPath(24, 24, 16, { amp: 2.4, waves: 8, steps: 72 });
  el.innerHTML = `<div class="stt-section-loader" role="status" aria-live="polite" aria-busy="true">
    <div class="stt-wavy-progress" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="52" height="52">
        <path class="stt-wavy-track" d="${ring}" fill="none" stroke-width="3.5"
          stroke-linecap="round" stroke-linejoin="round"/>
        <path class="stt-wavy-arc stt-wavy-ring" d="${ring}" fill="none" stroke-width="3.5"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="stt-section-loader-label">${msg.replace(/</g, '&lt;')}</div>
  </div>`;
}

export function hideSectionLoading(el) {
  if (!el) return;
  el.dataset.sttHasLoader = '0';
  el.removeAttribute('aria-busy');
}
