// Subject allocation: which subject each student of a divided class takes (e.g. Biology or Mathematics).
// Teachers do this in the app; here the admin sees it and can change it. Saving goes through
// save_subject_allocation, which puts each student in the groups of one option only.
import { fill, h, icon, title } from '../dom.js';
import { toast } from '../ui.js';
import { activeYear, byId, cache, db, errText, reload, ui } from '../data.js';

/** The choices of the active year: [{ key, sectionId, choice, label, options: [name], groups: [id] }]. */
export function subjectChoices() {
  const ay = activeYear();
  const out = new Map();
  for (const g of cache.sections || []) {
    if (!g.group_of || !g.subject_choice || (ay && g.academic_year_id !== ay.id)) continue;
    const key = `${g.group_of}|${g.subject_choice}`;
    if (!out.has(key)) {
      const cls = byId('classes', g.class_id);
      const parent = byId('sections', g.group_of);
      out.set(key, { key, sectionId: g.group_of, choice: g.subject_choice, sort: cls ? cls.sort_order : 0,
        label: `${cls ? cls.name : '?'}-${parent ? parent.name : '?'} · ${g.subject_choice}`, options: [], groups: [] });
    }
    const c = out.get(key);
    c.groups.push(g);
    if (!c.options.includes(g.subject_option)) c.options.push(g.subject_option);
  }
  for (const c of out.values()) c.options.sort();
  return [...out.values()].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}

/** The class's students in roll order, with what each takes now ('' = no subject yet). */
async function loadStudents(c) {
  const [enr, members] = await Promise.all([
    db().from('enrollments').select('id, student_id, section_id, roll_no, status, students!inner(full_name)')
      .eq('section_id', c.sectionId).eq('status', 'active').order('roll_no').range(0, 999),
    db().from('group_members').select('id, section_id, student_id').in('section_id', c.groups.map((g) => g.id)).range(0, 4999),
  ]);
  if (enr.error) throw enr.error;
  if (members.error) throw members.error;
  const optionOf = new Map(c.groups.map((g) => [g.id, g.subject_option]));
  const takes = new Map(members.data.map((m) => [m.student_id, optionOf.get(m.section_id)]));
  return enr.data.map((e) => ({ id: e.student_id, roll: e.roll_no, name: e.students.full_name, option: takes.get(e.student_id) || '' }));
}

export async function subjectAllocationView(main) {
  await reload('sections', 'classes');
  const choices = subjectChoices();
  const chosen = choices.find((c) => c.key === ui.allocationOf);
  const pick = h('select', { 'aria-label': 'Class and subjects', value: chosen ? chosen.key : '',
    onchange: (e) => { ui.allocationOf = e.target.value; subjectAllocationView(main); } },
  h('option', { value: '' }, 'Choose the class…'),
  choices.map((c) => h('option', { value: c.key }, c.label)));
  const toolbar = h('div', { class: 'toolbar' }, title('Subject allocation', 'layers'), choices.length ? pick : null);

  if (!chosen) {
    fill(main, toolbar, h('div', { class: 'card empty' }, icon('layers', 40), h('p', {}, choices.length
      ? 'Choose a class to see which subject each student takes.'
      : 'No class is divided by subject yet. On the Sections page, give each group a “Subject choice” and its “Subject in that choice”.')));
    return;
  }

  const students = await loadStudents(chosen);
  const selects = new Map();
  const counts = h('p', { class: 'help', role: 'status' });
  const refresh = () => {
    const n = (o) => [...selects.values()].filter((s) => s.value === o).length;
    counts.textContent = [...chosen.options.map((o) => `${o} ${n(o)}`), ...(n('') ? [`No subject yet ${n('')}`] : [])].join(' · ');
  };
  const rows = students.map((s) => {
    const sel = h('select', { 'aria-label': `Subject of ${s.name}`, value: s.option, onchange: refresh },
      h('option', { value: '' }, 'No subject yet'), chosen.options.map((o) => h('option', { value: o }, o)));
    sel.value = s.option;
    selects.set(s.id, sel);
    return h('tr', {}, h('td', {}, String(s.roll ?? '–')), h('td', {}, s.name), h('td', {}, sel));
  });
  refresh();

  const msg = h('p', { class: 'err', role: 'alert' });
  const restButtons = chosen.options.length < 2 ? [] : chosen.options.map((o) => h('button', { onclick: () => {
    for (const sel of selects.values()) if (!sel.value) sel.value = o;
    refresh();
  } }, `The rest take ${o}`));
  const save = h('button', { class: 'primary', onclick: async () => {
    msg.textContent = '';
    const changed = students.filter((s) => selects.get(s.id).value !== s.option)
      .map((s) => ({ student_id: s.id, option: selects.get(s.id).value || null }));
    if (!changed.length) {
      msg.textContent = 'Nothing was changed.';
      return;
    }
    save.disabled = true;
    try {
      const { error } = await db().rpc('save_subject_allocation',
        { p: { section_id: chosen.sectionId, choice: chosen.choice, students: changed } });
      if (error) {
        msg.textContent = 'Not saved: ' + errText(error);
        return;
      }
      toast(`Saved: ${changed.length} ${changed.length === 1 ? 'student' : 'students'} changed.`);
      await subjectAllocationView(main);
    } catch (e) {
      msg.textContent = 'Not saved: ' + errText(e);
    } finally {
      save.disabled = false;
    }
  } }, icon('check', 16), 'Save');

  fill(main, toolbar,
    h('p', { class: 'help' }, 'Each student takes one subject of this choice. The subject teachers see only their own students when they take attendance. ',
      'Teachers can also do this in the app; students stay registered once, in the class.'),
    counts,
    students.length ? h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Roll', 'Student', 'Subject'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows))) : h('div', { class: 'card empty' }, h('p', {}, 'This class has no students yet.')),
    msg,
    students.length ? h('p', {}, save, ' ', restButtons.flatMap((b) => [b, ' '])) : null);
}
