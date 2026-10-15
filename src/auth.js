import { googleSignIn, isClientIdConfigured } from './auth-google.js';
import { emailSignIn, emailSignUp, detectRegion } from './cloud.js';
import { applyTheme } from './themes.js';
import { mountLogo } from './motion.js';
import { icon } from './icons.js';

const GOOGLE_BTN_HTML = `<svg class="google-g" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  <path fill="none" d="M0 0h48v48H0z"/>
</svg><span>Continue with Google</span>`;

const boot = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => ({}));
const bootSettings = boot?.settings || {};
applyTheme(bootSettings.theme || 'auto', bootSettings.themeMode || 'auto', document.documentElement, {
  animate: false,
  visualSkin: bootSettings.visualTheme || 'material',
});
mountLogo(document.getElementById('auth-logo'), 44);

['l-eye', 's-eye', 's-eye2'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.innerHTML = icon('eye', 16);
});

// Prefill region from timezone when possible
const regionEl = document.getElementById('s-region');
if (regionEl) {
  const guessed = detectRegion();
  if (guessed && guessed !== 'global') regionEl.value = guessed;
}

function showErr(msg) {
  const e = document.getElementById('msg-err');
  e.classList.add('show');
  document.getElementById('msg-err-text').textContent = msg;
  document.getElementById('msg-ok').classList.remove('show');
}
function showOk(msg) {
  const e = document.getElementById('msg-ok');
  e.classList.add('show');
  document.getElementById('msg-ok-text').textContent = msg;
  document.getElementById('msg-err').classList.remove('show');
}
function clearMsgs() {
  document.getElementById('msg-err').classList.remove('show');
  document.getElementById('msg-ok').classList.remove('show');
}

function goDashboard() {
  location.href = chrome.runtime.getURL('pages/dashboard.html#leaderboard');
}

document.getElementById('tab-login').addEventListener('click', () => setTab('login'));
document.getElementById('tab-signup').addEventListener('click', () => setTab('signup'));

function setTab(t) {
  document.getElementById('tab-login').classList.toggle('active', t === 'login');
  document.getElementById('tab-signup').classList.toggle('active', t === 'signup');
  document.getElementById('tab-login').setAttribute('aria-selected', t === 'login' ? 'true' : 'false');
  document.getElementById('tab-signup').setAttribute('aria-selected', t === 'signup' ? 'true' : 'false');
  document.getElementById('form-login').style.display = t === 'login' ? 'block' : 'none';
  document.getElementById('form-signup').style.display = t === 'signup' ? 'block' : 'none';
  clearMsgs();
  const focusId = t === 'signup' ? 's-name' : 'l-email';
  setTimeout(() => document.getElementById(focusId)?.focus(), 50);
}

function makeToggle(inputId, btnId) {
  document.getElementById(btnId)?.addEventListener('click', () => {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
}
makeToggle('l-pwd', 'l-eye');
makeToggle('s-pwd', 's-eye');
makeToggle('s-pwd2', 's-eye2');

document.getElementById('form-login')?.addEventListener('submit', async function (e) {
  e.preventDefault();
  clearMsgs();
  const btn = document.getElementById('l-submit');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const email = document.getElementById('l-email').value.trim();
    const password = document.getElementById('l-pwd').value;
    await emailSignIn({ email, password });
    showOk('Signed in. Opening your dashboard…');
    setTimeout(goDashboard, 450);
  } catch (err) {
    showErr(err.message || 'Sign-in failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in with email';
  }
});

document.getElementById('form-signup')?.addEventListener('submit', async function (e) {
  e.preventDefault();
  clearMsgs();
  const btn = document.getElementById('s-submit');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const name = document.getElementById('s-name').value.trim();
    const email = document.getElementById('s-email').value.trim();
    const password = document.getElementById('s-pwd').value;
    const password2 = document.getElementById('s-pwd2')?.value || '';
    const region = document.getElementById('s-region').value;
    if (!region) throw new Error('Pick your country / region');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    if (password !== password2) throw new Error('Passwords do not match');
    const r = await emailSignUp({ name, email, password, region });
    if (r?.needsConfirm) {
      showOk('Account created. Check your email to confirm, then sign in with the same password.');
      document.getElementById('l-email').value = email;
      setTab('login');
    } else {
      showOk('Account ready. Opening your dashboard…');
      setTimeout(goDashboard, 450);
    }
  } catch (err) {
    const msg = err.message || 'Could not create account';
    showErr(msg);
    if (/already has an account/i.test(msg)) {
      const email = document.getElementById('s-email').value.trim();
      if (email) document.getElementById('l-email').value = email;
      setTimeout(() => setTab('login'), 600);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
});

async function doGoogle() {
  clearMsgs();
  if (!isClientIdConfigured()) {
    showErr('Google sign-in is not configured yet. Use email & password below.');
    return;
  }
  const btn = document.getElementById('btn-google');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Connecting…</span>`;
  }
  try {
    await googleSignIn();
    showOk('Google connected. Opening your dashboard…');
    setTimeout(goDashboard, 450);
  } catch (err) {
    showErr(err.message || 'Google sign-in failed');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = GOOGLE_BTN_HTML;
    }
  }
}

document.getElementById('btn-google')?.addEventListener('click', doGoogle);

document.getElementById('btn-guest')?.addEventListener('click', async () => {
  try {
    const { getOrCreateGuest } = await import('./cloud.js');
    await getOrCreateGuest();
    await chrome.runtime.sendMessage({ type: 'PUBLISH_GUEST_SCORE' }).catch(() => {});
  } catch {}
  location.href = chrome.runtime.getURL('pages/dashboard.html');
});
