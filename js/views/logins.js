// Logins: create teacher / admin sign-ins, reset passwords, deactivate accounts. Sign-ins are made by
// the admin-users server function, which checks every field (validate.ts); its message is shown here.
import { fill, h, icon, title } from '../dom.js';
import { confirmBox, promptBox, toast } from '../ui.js';
import { byId, cache, callUsers, db, errText, lab, options, reload, router } from '../data.js';
import { describeDbError } from '../validation.js';

const PASSWORD_RULE = '8 to 72 characters, with at least one letter and one number.';

function field(label, control, hint) {
  return [h('label', { class: 'f' }, label), control, hint && h('div', { class: 'hint' }, hint)];
}

function createLoginCard() {
  const linked = new Set(cache.app_users.map((u) => u.teacher_id).filter(Boolean));
  const role = h('select', { name: 'role' }, h('option', { value: 'teacher' }, 'Teacher'), h('option', { value: 'admin' }, 'Admin'));
  const teacher = h('select', { name: 'teacher' }, h('option', { value: '' }, '— choose teacher —'),
    options('teachers', (t) => !linked.has(t.id) && t.is_active).map((o) => h('option', { value: o.id }, o.label)));
  const email = h('input', { type: 'email', name: 'email', maxlength: 254, placeholder: 'teacher@school.pk', autocomplete: 'off' });
  const phone = h('input', { type: 'tel', name: 'phone', maxlength: 20, placeholder: '+923001234567', autocomplete: 'off' });
  const pw = h('input', { type: 'text', name: 'password', maxlength: 72, placeholder: 'e.g. school2026', autocomplete: 'new-password' });
  const msg = h('p', { role: 'alert' });
  const teacherRow = h('div', {}, field('Teacher', teacher, 'The teacher this sign-in belongs to. Teachers who already have a login are not listed.'));
  role.addEventListener('change', () => { teacherRow.hidden = role.value !== 'teacher'; });
  teacher.addEventListener('change', () => {
    const t = byId('teachers', teacher.value);
    if (!t) return;
    if (!email.value && t.email) email.value = t.email;
    if (!phone.value && t.phone) phone.value = t.phone;
  });

  const createBtn = h('button', { class: 'primary', onclick: async () => {
    msg.className = 'muted';
    msg.textContent = 'Creating…';
    createBtn.disabled = true;
    try {
      await callUsers({ action: 'create', role: role.value, teacher_id: role.value === 'teacher' ? teacher.value || null : null,
        email: email.value.trim(), phone: phone.value.trim(), password: pw.value });
      toast('Login created. Share the email/phone and password with the teacher.');
      router.render();
    } catch (e) {
      msg.className = 'err';
      msg.textContent = errText(e);
    } finally {
      createBtn.disabled = false;
    }
  } }, icon('check', 16), 'Create login');

  return h('div', { class: 'card' }, h('h3', { style: 'margin-top:0;display:flex;gap:8px;align-items:center' }, icon('plus', 20), 'Create a login'),
    field('Role', role, 'Teachers use the phone app; admins use this panel.'),
    teacherRow,
    field('Email', email, 'The teacher signs in with this email, or leave it blank and use a phone number.'),
    field('Phone', phone, 'International format, e.g. +923001234567.'),
    field('Initial password', pw, PASSWORD_RULE + ' Ask the teacher to keep it private.'),
    h('p', {}, createBtn), msg);
}

async function resetPassword(u) {
  const p = await promptBox({ title: 'Reset password', label: `New password: ${PASSWORD_RULE}` });
  if (!p) return;
  try {
    await callUsers({ action: 'reset_password', auth_user_id: u.auth_user_id, password: p });
    toast('Password changed.');
  } catch (e) {
    toast(errText(e), 'err');
  }
}

async function toggleActive(u) {
  if (u.is_active && !await confirmBox({ title: 'Deactivate this login?', body: 'Their phone stops syncing until you activate it again.', ok: 'Deactivate' })) return;
  const { error } = await db().from('app_users').update({ is_active: !u.is_active }).eq('id', u.id);
  if (error) {
    toast(describeDbError(error, 'app_users'), 'err');
    return;
  }
  toast(u.is_active ? 'Login deactivated.' : 'Login activated.');
  router.render();
}

export async function loginsView(main) {
  await reload('app_users', 'teachers');
  let authUsers = [];
  let authError = null;
  try {
    authUsers = await callUsers({ action: 'list' });
  } catch (e) {
    authError = errText(e);
  }
  const authMap = new Map(authUsers.map((u) => [u.auth_user_id, u]));

  fill(main,
    h('div', { class: 'toolbar' }, title('Logins', 'key')),
    h('p', { class: 'help' }, 'Teachers sign in on the phone with email or phone + password. Deactivated accounts cannot sync.'),
    authError && h('p', { class: 'err' }, 'Could not list sign-ins: ' + authError),
    createLoginCard(),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Sign-in', 'Role', 'Teacher', 'Status', 'Last sign-in', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, cache.app_users.map((u) => {
        const a = authMap.get(u.auth_user_id) || {};
        return h('tr', {},
          h('td', {}, a.email || a.phone || h('span', { class: 'muted' }, u.auth_user_id.slice(0, 8) + '…')),
          h('td', {}, u.role),
          h('td', {}, u.teacher_id ? lab('teachers', u.teacher_id) : '—'),
          h('td', {}, h('span', { class: 'pill' + (u.is_active ? '' : ' off') }, u.is_active ? 'active' : 'deactivated')),
          h('td', {}, a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString() : '—'),
          h('td', { class: 'row-actions' },
            h('button', { class: 'act', title: 'Reset password', onclick: () => resetPassword(u) }, icon('key', 16), h('span', {}, 'Reset password')),
            h('button', { class: 'act' + (u.is_active ? ' danger' : ''), title: u.is_active ? 'Deactivate' : 'Activate', onclick: () => toggleActive(u) },
              icon('power', 16), h('span', {}, u.is_active ? 'Deactivate' : 'Activate'))));
      })))));
}
