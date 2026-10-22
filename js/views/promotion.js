// Year-end promotion: enrolls every active student of one year into the next class of another year.
import { fill, h, icon, title } from '../dom.js';
import { confirmBox } from '../ui.js';
import { activeYear, db, errText, options, reload } from '../data.js';

export function promotionView(main) {
  const years = options('academic_years');
  const from = h('select', { 'aria-label': 'From year' }, years.map((y) => h('option', { value: y.id }, y.label)));
  const to = h('select', { 'aria-label': 'To year' }, years.map((y) => h('option', { value: y.id }, y.label)));
  const ay = activeYear();
  if (ay) from.value = ay.id;
  const later = years.find((y) => y.id !== from.value);
  if (later) to.value = later.id;
  const out = h('p', { role: 'status' });

  const promote = async () => {
    if (years.length < 2) {
      out.className = 'err';
      out.textContent = 'Create the new academic year first.';
      return;
    }
    if (from.value === to.value) {
      out.className = 'err';
      out.textContent = 'Choose two different years.';
      return;
    }
    if (!await confirmBox({ title: 'Promote all active students now?', body: 'Students are enrolled into the next class of the target year.', ok: 'Promote', danger: false })) return;
    const { data, error } = await db().rpc('promote_students', { p_from_year: from.value, p_to_year: to.value });
    out.className = error ? 'err' : 'ok';
    out.textContent = error ? errText(error)
      : `Promoted ${data.promoted}, finished school ${data.graduated}, already enrolled ${data.skipped}. Now set the new year active.`;
    if (!error) await reload('sections');
  };

  fill(main, h('div', { class: 'toolbar' }, title('Year-end promotion', 'arrowUp')),
    h('p', { class: 'help' }, 'Enrolls every active student of one year into the next class (by class order) of another year. ',
      'Same section letter is kept when it exists. Old enrollments and all attendance history are kept. Classes made by teachers are left alone. Create the new year first.'),
    h('div', { class: 'card' },
      h('label', { class: 'f' }, 'From year'), from, h('div', { class: 'hint' }, 'The year that is ending.'),
      h('label', { class: 'f' }, 'To year'), to, h('div', { class: 'hint' }, 'The new year. Its sections are created when missing.'),
      h('p', {}, h('button', { class: 'primary', onclick: promote }, icon('arrowUp', 16), 'Promote')), out));
}
