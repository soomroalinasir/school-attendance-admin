// Weekly timetable grid for one section: a subject + teacher per day and period. Changes save at once;
// a teacher booked in two sections at the same time is shown in red.
import { fill, h, title } from '../dom.js';
import { DAYS, hhmm } from '../format.js';
import { toast } from '../ui.js';
import { activeYear, byId, cache, db, lab, options, reload, router, ui } from '../data.js';
import { describeDbError } from '../validation.js';

/** Is the teacher also teaching another section at this day + period? */
export function hasClash(weekly, sectionId, day, slotId, teacherId) {
  return weekly.some((e) => {
    if (e.section_id === sectionId || e.day_of_week !== day || e.timetable_slot_id !== slotId) return false;
    const a = byId('teaching_assignments', e.teaching_assignment_id);
    return !!a && a.teacher_id === teacherId;
  });
}

async function saveCell(entry, assignmentId, sectionId, day, slotId) {
  const table = db().from('timetable_entries');
  if (!assignmentId) return table.delete().eq('id', entry.id);
  if (entry) return table.update({ teaching_assignment_id: assignmentId }).eq('id', entry.id);
  return table.insert({ teaching_assignment_id: assignmentId, section_id: sectionId, day_of_week: day, timetable_slot_id: slotId });
}

export async function timetableView(main) {
  await reload('timetable_entries', 'teaching_assignments', 'timetable_slots', 'sections');
  const weekly = cache.timetable_entries.filter((e) => !e.adhoc_date); // one-off extra periods are not part of the week
  const ay = activeYear();
  const sections = options('sections', (s) => !ay || s.academic_year_id === ay.id);
  if (!sections.length) {
    fill(main, h('div', { class: 'toolbar' }, title('Weekly timetable', 'table')),
      h('p', { class: 'err' }, 'Create sections for the active year first.'),
      h('button', { class: 'link', onclick: () => router.go('sections') }, 'Go to Sections →'));
    return;
  }
  if (!ui.ttSection || !sections.some((s) => s.id === ui.ttSection)) ui.ttSection = sections[0].id;
  const sectionId = ui.ttSection;
  const days = ui.ttSunday ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6];
  const assignments = cache.teaching_assignments.filter((a) => a.section_id === sectionId)
    .map((a) => ({ id: a.id, label: `${lab('subjects', a.subject_id)} — ${lab('teachers', a.teacher_id)}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const entryAt = (d, slotId) => weekly.find((e) => e.section_id === sectionId && e.day_of_week === d && e.timetable_slot_id === slotId);
  const msg = h('p', { class: 'err', role: 'alert' });

  const cell = (d, slot) => {
    const e = entryAt(d, slot.id);
    const a = e && byId('teaching_assignments', e.teaching_assignment_id);
    const clash = !!a && hasClash(weekly, sectionId, d, slot.id, a.teacher_id);
    const sel = h('select', { value: e ? e.teaching_assignment_id : '', 'aria-label': `${DAYS[d]} period ${slot.period_no}` },
      h('option', { value: '' }, '— free —'), assignments.map((o) => h('option', { value: o.id }, o.label)));
    sel.addEventListener('change', async () => {
      msg.textContent = '';
      const { error } = await saveCell(e, sel.value, sectionId, d, slot.id);
      if (error) {
        msg.textContent = error.code === '23503'
          ? 'This period already has attendance recorded, so it cannot be removed. Change the subject instead.'
          : describeDbError(error, 'timetable_entries');
        sel.value = e ? e.teaching_assignment_id : '';
        return;
      }
      toast(sel.value ? 'Timetable saved.' : 'Period cleared.');
      router.render();
    });
    return h('td', { class: clash ? 'clash' : '', title: clash ? 'This teacher is also teaching another section at this time' : null }, sel);
  };

  fill(main,
    h('div', { class: 'toolbar' }, title('Weekly timetable', 'table'),
      h('select', { value: sectionId, 'aria-label': 'Section', onchange: (ev) => { ui.ttSection = ev.target.value; router.render(); } },
        sections.map((s) => h('option', { value: s.id }, s.label))),
      h('label', { style: 'display:flex;gap:6px;align-items:center' },
        h('input', { type: 'checkbox', checked: !!ui.ttSunday, onchange: (ev) => { ui.ttSunday = ev.target.checked; router.render(); } }), 'Sunday')),
    h('p', { class: 'help' }, 'Pick a subject and teacher for every period; choose “— free —” to clear one. Options come from Teaching assignments for this section. Red cells mean the teacher is double-booked. Changes save straight away.'),
    !assignments.length && h('p', { class: 'err' }, 'This section has no teaching assignments yet.'),
    !cache.timetable_slots.length && h('p', { class: 'err' }, 'No periods yet. Add them under “Periods”.'),
    msg,
    h('div', { class: 'scroll tt' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Period'), days.map((d) => h('th', {}, DAYS[d])))),
      h('tbody', {}, cache.timetable_slots.map((slot) => h('tr', {},
        h('td', {}, h('b', {}, `P${slot.period_no}`), h('div', { class: 'muted' }, `${hhmm(slot.start_time)}–${hhmm(slot.end_time)}`)),
        days.map((d) => cell(d, slot))))))));
}
