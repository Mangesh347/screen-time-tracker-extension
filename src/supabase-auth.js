// Google OAuth → Supabase Auth (signInWithIdToken pattern)
import { CONFIG } from './config.js';
import { refreshEntitlement, clearEntitlementOnLogout } from './entitlement.js';

function supabaseBase() {
  return (CONFIG.supabase?.url || '').replace(/\/$/, '');
}

function anonKey() {
  return CONFIG.supabase?.anonKey || '';
}

export function getExtensionRedirectUri() {
  return `https://${chrome.runtime.id}.chromiumapp.org/`;
}

export function isGoogleConfigured() {
  return !!(
    CONFIG.GOOGLE_CLIENT_ID &&
    !CONFIG.GOOGLE_CLIENT_ID.startsWith('YOUR_') &&
    supabaseBase() &&
    anonKey()
  );
}

function launchWebAuthFlow(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, responseUrl => {
      if (chrome.runtime.lastError || !responseUrl) {
        const msg = chrome.runtime.lastError?.message || 'Sign-in cancelled';
        if (/did not approve|cancel|closed|user denied/i.test(msg)) {
          reject(new Error('Sign-in cancelled — click Allow on the Google screen.'));
        } else reject(new Error(msg));
      } else resolve(responseUrl);
    });
  });
}

function buildGoogleAuthUrl(redirectUri, nonceForGoogle) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', CONFIG.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  // id_token requires nonce (Google Error 400 if missing)
  url.searchParams.set('response_type', 'id_token token');
  url.searchParams.set('scope', 'openid email profile');
  // Supabase hashes the body nonce and compares to the JWT claim —
  // so Google must receive the SHA-256 hex, and Supabase the raw value.
  url.searchParams.set('nonce', nonceForGoogle);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

function extractTokens(responseUrl) {
  const u = new URL(responseUrl);
  const hash = new URLSearchParams((u.hash || '').replace(/^#/, ''));
  const q = new URLSearchParams(u.search);
  const err = hash.get('error') || q.get('error');
  if (err) throw new Error(hash.get('error_description') || q.get('error_description') || err);
  const idToken = hash.get('id_token') || q.get('id_token');
  const accessToken = hash.get('access_token') || q.get('access_token');
  if (!idToken) throw new Error('No id_token from Google');
  return { idToken, accessToken };
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function supabaseSignInWithIdToken(idToken, rawNonce) {
  const body = {
    provider: 'google',
    id_token: idToken,
    nonce: rawNonce,
  };

  const res = await fetch(`${supabaseBase()}/auth/v1/token?grant_type=id_token`, {
    method: 'POST',
    headers: {
      apikey: anonKey(),
      Authorization: `Bearer ${anonKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.error || `Supabase auth ${res.status}`);
  }
  return data;
}

async function fetchGoogleProfile(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function googleSignIn() {
  if (!isGoogleConfigured()) {
    throw new Error('Configure GOOGLE_CLIENT_ID + Supabase in src/config.js');
  }

  const redirectUri = getExtensionRedirectUri();
  // Official Supabase + Google pattern:
  //   Google OAuth nonce = SHA-256(raw)
  //   Supabase signInWithIdToken nonce = raw
  const rawNonce = crypto.randomUUID();
  const hashedNonce = await sha256Hex(rawNonce);

  const authUrl = buildGoogleAuthUrl(redirectUri, hashedNonce);
  let responseUrl;
  try {
    responseUrl = await launchWebAuthFlow(authUrl);
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (/redirect_uri_mismatch|invalid_request|Access blocked|400/i.test(msg) || /did not approve/i.test(msg) === false) {
      // Surface the exact URI Google must allow (ID changes for unpacked builds)
      const err = new Error(
        `Google blocked sign-in (redirect_uri_mismatch). In Google Cloud → Auth Platform → your Web client → Authorised redirect URIs, add EXACTLY:\n${redirectUri}\nAlso add without trailing slash:\n${redirectUri.replace(/\/$/, '')}\nThen wait a few minutes and try again.`,
      );
      err.redirectUri = redirectUri;
      err.cause = e;
      // Only rewrite when it looks like OAuth config / blocked — keep cancel as-is
      if (/cancel|closed|user denied|did not approve/i.test(msg)) throw e;
      throw err;
    }
    throw e;
  }
  const { idToken, accessToken } = extractTokens(responseUrl);
  const session = await supabaseSignInWithIdToken(idToken, rawNonce);
  const profile = await fetchGoogleProfile(accessToken);

  const user = {
    id: session.user?.id || profile?.sub,
    name: session.user?.user_metadata?.full_name || profile?.name || session.user?.email,
    email: session.user?.email || profile?.email,
    picture: session.user?.user_metadata?.avatar_url || profile?.picture || null,
    provider: 'google',
    jwt: session.access_token,
    supabaseAccessToken: session.access_token,
    supabaseRefreshToken: session.refresh_token,
    googleAccessToken: accessToken || null,
    signedInAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({ stt_user: user, supabaseSession: session });
  try {
    await chrome.runtime.sendMessage({ type: 'SET_USER', user });
  } catch {}

  // Upsert profile row (best-effort) so the user appears on the leaderboard immediately
  try {
    await fetch(`${supabaseBase()}/rest/v1/stt_profiles`, {
      method: 'POST',
      headers: {
        apikey: anonKey(),
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        is_private: true,
        is_public: false,
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      }),
    });
  } catch {}

  await refreshEntitlement({ force: true });
  try {
    const {
      pullAndMergeCloud,
      pushFullSync,
      syncProfileViaBackend,
      migrateGuestToAccount,
    } = await import('./cloud.js');
    await migrateGuestToAccount({ user, access: session.access_token }).catch(() => {});
    await pullAndMergeCloud().catch(() => {});
    // Use Pro full sync when entitled so history + settings travel with the email
    let full = false;
    try {
      const { settings } = await chrome.storage.local.get(['settings']);
      const { getEffectivePlan, canUse } = await import('./pro.js');
      const plan = await getEffectivePlan(settings || {}, user);
      full = canUse('cloudSync', plan);
    } catch {}
    await pushFullSync({ full }).catch(() => {});
    await syncProfileViaBackend().catch(() => {});
  } catch {}
  return user;
}

export async function googleSignOut() {
  // Flush cloud before clearing session — never delete cloud source-of-truth
  try {
    const { pushFullSync } = await import('./cloud.js');
    await pushFullSync({ full: false });
  } catch {}
  try {
    const { stt_user, supabaseSession } = await chrome.storage.local.get(['stt_user', 'supabaseSession']);
    const token = supabaseSession?.access_token || stt_user?.supabaseAccessToken;
    if (token) {
      await fetch(`${supabaseBase()}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: anonKey(),
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => {});
    }
  } catch {}
  await clearEntitlementOnLogout();
  await chrome.storage.local.remove(['stt_user', 'supabaseSession']);
  try {
    await chrome.runtime.sendMessage({ type: 'LOGOUT' });
  } catch {}
}

export async function syncSettingsToCloud(settings, dailyStats) {
  const { stt_user } = await chrome.storage.local.get(['stt_user']);
  if (!stt_user?.supabaseAccessToken || !stt_user?.id) return { skipped: true };
  const payload = {
    user_id: stt_user.id,
    settings: {
      blockedSites: settings.blockedSites,
      siteLimits: settings.siteLimits,
      focusSchedule: settings.focusSchedule,
      goals: settings.goals,
      theme: settings.theme,
      focusMode: settings.focusMode,
    },
    daily: dailyStats || null,
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${supabaseBase()}/rest/v1/stt_sync`, {
    method: 'POST',
    headers: {
      apikey: anonKey(),
      Authorization: `Bearer ${stt_user.supabaseAccessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Sync failed');
  return { ok: true };
}

// Back-compat exports used by auth pages
export { isGoogleConfigured as isClientIdConfigured };
