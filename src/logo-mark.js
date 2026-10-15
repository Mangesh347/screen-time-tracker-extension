/**
 * Screen Time Tracker brand mark — static PNG only.
 * No animation, no live clock hands, no scallop spin.
 */

function pickIconSize(size) {
  const s = Math.max(16, Number(size) || 36);
  if (s <= 16) return 16;
  if (s <= 32) return 32;
  if (s <= 48) return 48;
  return 128;
}

/** Absolute extension URL for the crisp static icon PNG. */
export function logoSrc(size = 36) {
  const px = pickIconSize(size);
  const path = `icons/icon${px}.png`;
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path);
    }
  } catch { /* ignore */ }
  return path;
}

/**
 * Static brand mark markup (`<img>`).
 * @param {number} size
 * @param {{ className?: string, alt?: string }} [opts]
 */
export function logoMarkHtml(size = 36, opts = {}) {
  const s = Math.max(16, Number(size) || 36);
  const cls = ['m3-logo', 'stt-logo', opts.className].filter(Boolean).join(' ');
  const alt = opts.alt ?? 'Screen Time Tracker';
  return `<img class="${cls}" src="${logoSrc(s)}" width="${s}" height="${s}" alt="${alt}" draggable="false" decoding="async" />`;
}

/** @deprecated Use logoMarkHtml — kept as alias for callers expecting SVG-era name. */
export function logoMarkSvg(size = 36, opts = {}) {
  return logoMarkHtml(size, opts);
}

/**
 * Mount static brand mark into a host element.
 */
export function mountLogoMark(el, size = 36, opts = {}) {
  if (!el) return null;
  stopLogoMark(el);
  el.innerHTML = logoMarkHtml(size, opts);
  el.classList.add('m3-logo-wrap', 'stt-logo-wrap');
  el.classList.remove('m3-logo-minimal-wrap');
  return el.querySelector('img.stt-logo');
}

/** No-op cleanup (no intervals / motion listeners). */
export function stopLogoMark(el) {
  if (!el) return;
  if (el._sttLogoMq) {
    delete el._sttLogoMq;
  }
}
