// School settings (one row). Rules match the database checks in the input-validation migration.
import { fill, h, icon, title } from '../dom.js';
import { hhmm } from '../format.js';
import { toast } from '../ui.js';
import { db } from '../data.js';
import { describeDbError, fieldProblem } from '../validation.js';

export const SETTINGS_COLS = [
  ['school_name', 'School name', 'text', { req: true, max: 100, hint: 'Printed on reports and marksheets.' }],
  ['timezone', 'Time zone', 'text', { req: true, max: 64, ph: 'Asia/Karachi', hint: 'Decides when a school day starts and ends, e.g. Asia/Karachi.' }],
  ['school_end_time', 'School day ends at', 'time', { req: true, hint: 'After this time teachers can no longer edit that day’s attendance on the phone.' }],
  ['low_attendance_threshold', 'Low-attendance threshold (%)', 'number', { req: true, min: 0, maxValue: 100, hint: 'Students below this percentage are flagged. 0 to 100.' }],
  ['max_offline_days', 'Late uploads accepted (days)', 'number', { req: true, int: true, min: 0, maxValue: 60, hint: 'Attendance taken offline is accepted up to this many days late. 0 to 60.' }],
];

export async function settingsView(main) {
  const { data, error } = await db().from('school_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  const fields = SETTINGS_COLS.map((c) => {
    const [key, label, type, opts] = c;
    const input = h('input', { type, name: key, step: type === 'number' ? 'any' : null, maxlength: opts.max || null, placeholder: opts.ph || null,
      value: data[key] == null ? '' : type === 'time' ? hhmm(data[key]) : data[key] });
    const err = h('div', { class: 'field-err' });
    return { c, input, err, node: [h('label', { class: 'f' }, label, h('span', { class: 'req' }, '*')), input, h('div', { class: 'hint' }, opts.hint), err] };
  });
  const msg = h('p', { class: 'err', role: 'alert' });

  const save = async () => {
    msg.textContent = '';
    const obj = {};
    let bad = null;
    for (const f of fields) {
      const raw = f.input.value.trim();
      const problem = fieldProblem(f.c, raw);
      f.err.textContent = problem || '';
      f.input.classList.toggle('invalid', !!problem);
      if (problem && !bad) bad = f;
      obj[f.c[0]] = f.c[2] === 'number' ? Number(raw) : raw;
    }
    if (bad) {
      bad.input.focus();
      return;
    }
    const { error: e } = await db().from('school_settings').update(obj).eq('id', 1);
    if (e) {
      msg.textContent = describeDbError(e, 'school_settings', SETTINGS_COLS);
      return;
    }
    toast('Saved. Phones pick this up on their next sync.');
  };

  fill(main, h('div', { class: 'toolbar' }, title('School settings', 'sliders')),
    h('div', { class: 'card' }, fields.map((f) => f.node), msg,
      h('p', {}, h('button', { class: 'primary', onclick: save }, icon('check', 16), 'Save'))));
}
