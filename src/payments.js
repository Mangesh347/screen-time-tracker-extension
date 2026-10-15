// PaymentProvider — PayPal + Razorpay via Supabase Edge Functions (sandbox-first)
import { CONFIG } from './config.js';
import { refreshEntitlement } from './entitlement.js';
import { log } from './logger.js';

function functionsBase() {
  const u = (CONFIG.supabase?.functionsUrl || `${CONFIG.supabase.url}/functions/v1`).replace(/\/$/, '');
  return u;
}

async function getSessionAuth() {
  const { stt_user, supabaseSession } = await chrome.storage.local.get(['stt_user', 'supabaseSession']);
  const token =
    supabaseSession?.access_token ||
    stt_user?.supabaseAccessToken ||
    stt_user?.jwt ||
    null;
  const user = stt_user || null;
  return { token, user };
}

/**
 * Open hosted checkout with cycle + provider.
 * Prefers Edge Function create-checkout (JWT); falls back to hosted page with access_token.
 */
export async function createCheckout({ cycle = 'yearly', provider = 'paypal', currency = 'USD' } = {}) {
  const { token, user } = await getSessionAuth();
  if (!user?.email || !user?.id) {
    return { ok: false, error: 'sign_in_required', message: 'Sign in with Google or email first' };
  }
  if (!token) {
    return {
      ok: false,
      error: 'session_expired',
      message: 'Session expired — sign in again before checkout',
    };
  }

  const providers = CONFIG.paymentProviders || ['paypal', 'razorpay'];
  if (!providers.includes(provider)) {
    return { ok: false, error: 'bad_provider', message: 'Unsupported payment provider' };
  }

  let cur = currency;
  let pay = provider;
  try {
    const lang = (chrome.i18n?.getUILanguage?.() || navigator.language || '').toLowerCase();
    if (lang.includes('in') || lang.endsWith('-in')) {
      if (provider === 'paypal' && !currency) pay = 'razorpay';
      if (pay === 'razorpay') cur = 'INR';
    }
  } catch {}

  const extId = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : '';

  // 1) Try Edge Function create-checkout
  try {
    const res = await fetch(`${functionsBase()}/create-checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: CONFIG.supabase.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cycle, provider: pay, currency: cur, ext_id: extId || undefined }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      if (pay === 'paypal' && data.approve_url) {
        await chrome.tabs.create({ url: data.approve_url });
        scheduleRevalidate();
        return { ok: true, provider: pay, cycle, via: 'edge', order_id: data.order_id };
      }
      // Razorpay / generic → hosted checkout with order + token for verify
      const base = (CONFIG.checkoutBaseUrl || '').replace(/\?.*$/, '');
      if (base && !base.includes('YOUR_')) {
        const url = new URL(base);
        url.searchParams.set('cycle', cycle);
        url.searchParams.set('provider', pay);
        url.searchParams.set('currency', cur || (pay === 'razorpay' ? 'INR' : 'USD'));
        url.searchParams.set('email', user.email);
        url.searchParams.set('user_id', user.id);
        url.searchParams.set('access_token', token);
        url.searchParams.set('product', 'stt');
        if (extId) url.searchParams.set('ext_id', extId);
        if (data.order_id) url.searchParams.set('order_id', data.order_id);
        if (CONFIG.paymentTestMode || data.mode === 'sandbox' || data.mode === 'simulated_preview') {
          url.searchParams.set('test', '1');
        }
        await chrome.tabs.create({ url: url.toString() });
        scheduleRevalidate();
        return { ok: true, provider: pay, cycle, via: 'edge+hosted', order_id: data.order_id };
      }
    }
  } catch (e) {
    log.warn('[STT] create-checkout edge', e.message);
  }

  // 2) Fallback: hosted checkout page with JWT in query (page sends Authorization header)
  const base = (CONFIG.checkoutBaseUrl || '').replace(/\?.*$/, '');
  if (!base || base.includes('YOUR_')) {
    return {
      ok: false,
      error: 'checkout_unconfigured',
      message: 'Set checkoutBaseUrl in config.js or deploy Edge Functions',
    };
  }

  const url = new URL(base);
  url.searchParams.set('cycle', cycle);
  url.searchParams.set('provider', pay);
  url.searchParams.set('currency', cur || (pay === 'razorpay' ? 'INR' : 'USD'));
  url.searchParams.set('email', user.email);
  url.searchParams.set('user_id', user.id);
  url.searchParams.set('access_token', token);
  url.searchParams.set('product', 'stt');
  url.searchParams.set('name', user.name || '');
  if (extId) url.searchParams.set('ext_id', extId);
  if (CONFIG.paymentTestMode) url.searchParams.set('test', '1');

  await chrome.tabs.create({ url: url.toString() });
  scheduleRevalidate();
  return { ok: true, provider: pay, cycle, via: 'hosted', url: url.toString() };
}

function scheduleRevalidate() {
  try {
    chrome.alarms.create('stt-revalidate-entitlement', { delayInMinutes: 0.5 });
    chrome.alarms.create('stt-revalidate-entitlement-2', { delayInMinutes: 2 });
    chrome.alarms.create('stt-revalidate-entitlement-3', { delayInMinutes: 5 });
  } catch {}
}

export async function openBillingPortal() {
  const support =
    (CONFIG.checkoutBaseUrl || '').replace(/checkout\.html.*/, 'support.html') ||
    'https://screen-time-tracker-seven.vercel.app/support.html';
  await chrome.tabs.create({ url: support });
  return { ok: true };
}

export async function afterCheckoutReturn() {
  return refreshEntitlement({ force: true });
}

/** Suggest provider for UI */
export function suggestedProvider() {
  try {
    const lang = (navigator.language || '').toLowerCase();
    if (lang.includes('in')) return 'razorpay';
  } catch {}
  return 'paypal';
}
