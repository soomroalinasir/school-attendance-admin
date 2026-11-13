// "Forgot password?" on the admin sign-in: Supabase emails a one-time code, and the code sets a new password.
// The email template must show the code ({{ .Token }}): docs/password-reset.md. The same flow is in the app.
import { fill, h, icon } from '../dom.js';
import { brandBlock } from '../brand.js';
import { db, errText } from '../data.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A message for a new password the login rules refuse, else ''. Same rule as the admin-users function. */
export function passwordProblem(p) {
  if (p.length < 8) return 'Use at least 8 characters.';
  if (p.length > 72) return 'Use at most 72 characters.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Use at least one letter and one number.';
  return '';
}

/** Supabase Auth's refusals in plain words. */
function plain(error) {
  const code = error && error.code;
  if (code === 'otp_expired' || code === 'otp_disabled') return 'This code is wrong or has expired. Ask for a new code.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || (error && error.status === 429)) {
    return 'Too many tries. Wait a few minutes, then try again.';
  }
  if (code === 'same_password') return 'Choose a password different from your old one.';
  if (code === 'weak_password') return 'This password is too easy to guess. Choose another one.';
  return 'Could not reset the password: ' + errText(error);
}

/** Fills root with the reset page. onDone(email) after the password is changed (nobody is signed in then);
 * onCancel() for "Back to sign in". */
export function forgotPasswordView(root, { email: typed = '', onDone, onCancel }) {
  let sent = false;
  const email = h('input', { type: 'email', autocomplete: 'username', maxlength: 254, 'aria-label': 'Email', value: EMAIL.test(typed.trim()) ? typed.trim() : '' });
  const code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 10, 'aria-label': 'Code from the email' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 72, 'aria-label': 'New password' });
  const again = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 72, 'aria-label': 'New password again' });
  const msg = h('p', { class: 'err', role: 'alert' });
  const info = h('p', { class: 'muted', role: 'status' });
  const main = h('button', { class: 'primary' });

  async function busy(work) {
    msg.textContent = '';
    main.disabled = true;
    try {
      await work();
    } catch (e) {
      msg.textContent = 'Could not reach the server: ' + errText(e);
    } finally {
      main.disabled = false;
    }
  }

  const sendCode = () => busy(async () => {
    const addr = email.value.trim().toLowerCase();
    info.textContent = '';
    if (!EMAIL.test(addr)) {
      msg.textContent = 'Enter the email address you sign in with.';
      return;
    }
    const { error } = await db().auth.resetPasswordForEmail(addr);
    if (error) {
      msg.textContent = plain(error);
      return;
    }
    sent = true;
    render();
    info.textContent = `If ${addr} has a login, a code is on its way. Check the inbox and the spam folder. It can take a minute.`;
  });

  const change = () => busy(async () => {
    const addr = email.value.trim().toLowerCase();
    const token = code.value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) {
      msg.textContent = 'Enter the code from the email (only numbers).';
      return;
    }
    const problem = passwordProblem(pw.value);
    if (problem) {
      msg.textContent = problem;
      return;
    }
    if (pw.value !== again.value) {
      msg.textContent = 'The two passwords are not the same.';
      return;
    }
    const verified = await db().auth.verifyOtp({ email: addr, token, type: 'recovery' }); // signs in with the code
    if (verified.error) {
      msg.textContent = plain(verified.error);
      return;
    }
    let updated;
    try {
      updated = await db().auth.updateUser({ password: pw.value });
    } finally {
      await db().auth.signOut(); // signing in normally next checks that the account is an admin
    }
    if (updated.error) {
      msg.textContent = plain(updated.error);
      return;
    }
    onDone(addr);
  });

  const enter = (fn) => (e) => { if (e.key === 'Enter') fn(); };
  email.addEventListener('keydown', enter(sendCode));
  again.addEventListener('keydown', enter(change));

  function render() {
    email.disabled = sent;
    fill(main, sent ? 'Change password' : 'Email me a code');
    main.onclick = sent ? change : sendCode;
    fill(root, h('div', { class: 'center' }, h('div', { class: 'card auth-card' }, brandBlock('Admin portal'),
      h('h2', {}, icon('key', 22), 'Reset password'),
      h('p', { class: 'muted' }, sent
        ? 'Enter the code from the email and choose a new password.'
        : 'Enter the email address you sign in with. We will email you a code to set a new password.'),
      h('label', { class: 'f' }, 'Email'), email,
      sent && [
        h('label', { class: 'f' }, 'Code from the email'), code,
        h('label', { class: 'f' }, 'New password'), pw,
        h('p', { class: 'help' }, 'At least 8 characters, with a letter and a number.'),
        h('label', { class: 'f' }, 'New password again'), again,
      ],
      info, msg,
      h('p', {}, main, ' ',
        sent && h('button', { class: 'link', onclick: sendCode }, 'Send a new code'),
        sent && h('button', { class: 'link', onclick: () => { sent = false; info.textContent = ''; msg.textContent = ''; render(); } }, 'Use another email'),
        h('button', { class: 'link', onclick: onCancel }, 'Back to sign in')))));
  }
  render();
}
