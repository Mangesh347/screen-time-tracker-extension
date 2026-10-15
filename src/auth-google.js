// Back-compat shim — Google + Supabase auth lives in supabase-auth.js
export {
  googleSignIn,
  googleSignOut,
  getExtensionRedirectUri,
  isGoogleConfigured as isClientIdConfigured,
  syncSettingsToCloud as syncToBackend,
} from './supabase-auth.js';

export async function getAuthToken() {
  const { stt_user } = await chrome.storage.local.get(['stt_user']);
  if (stt_user?.googleAccessToken) return stt_user.googleAccessToken;
  if (stt_user?.supabaseAccessToken) return stt_user.supabaseAccessToken;
  throw new Error('Sign in with Google first');
}
