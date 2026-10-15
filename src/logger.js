// Production-safe logger — no PII / tokens in console when DEBUG is off.
// Note: Chrome DevTools on the owner's machine can still inspect extension pages;
// this only stops casual log leaks and remote-facing noise.

import { CONFIG } from './config.js';

const DEBUG = CONFIG.DEBUG === true;

const SENSITIVE =
  /access_token|refresh_token|id_token|password|Authorization|Bearer\s|apikey|client_secret|service_role|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/i;

function scrubOne(v) {
  if (v == null) return v;
  if (typeof v === 'string') {
    if (SENSITIVE.test(v)) return '[redacted]';
    // Avoid dumping long emails / JWTs in prod errors
    if (!DEBUG && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return '[email]';
    return v;
  }
  if (v instanceof Error) {
    const msg = String(v.message || 'Error');
    return SENSITIVE.test(msg) ? new Error('[redacted]') : new Error(msg.slice(0, 200));
  }
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      if (SENSITIVE.test(s)) return '[redacted-object]';
      if (!DEBUG && s.length > 400) return '[object]';
    } catch {
      return '[object]';
    }
  }
  return v;
}

function scrub(args) {
  return args.map(scrubOne);
}

export const log = {
  debug(...args) {
    if (DEBUG) console.debug('[STT]', ...scrub(args));
  },
  info(...args) {
    if (DEBUG) console.info('[STT]', ...scrub(args));
  },
  warn(...args) {
    if (DEBUG) console.warn('[STT]', ...scrub(args));
  },
  /** Always allowed but scrubbed — use for hard failures only */
  error(...args) {
    console.error('[STT]', ...scrub(args));
  },
};
