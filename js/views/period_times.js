// Period times by section: the admin first chooses ECE, Primary or Senior, sees every period with that
// section's start and end, edits them and saves. Times are kept per school section (section_period_times);
// Senior writes the same times for Middle and for Secondary & Higher Secondary. A period set back to the
// school's normal time (the Periods page) follows the school again: its own time is removed.
import { fill, h, icon, title } from '../dom.js';
import { hhmm } from '../format.js';
import { toast } from '../ui.js';
import { db, ui } from '../data.js';
import { describeDbError } from '../validation.js';

export const TIME_SECTIONS = [
  { id: 'ece', label: 'ECE (Early Childhood)', keys: ['early_childhood'] },
  { id: 'primary', label: 'Primary', keys: ['primary'] },
  { id: 'senior', label: 'Senior (Middle, Secondary & Higher Secondary)', keys: ['middle', 'secondary'] },
];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

async function load() {
  const [slots, own] = await Promise.all([
    db().from('timetable_slots').select('*').order('period_no'),
    db().from('section_period_times').select('*'),
  ]);
  if (slots.error) throw slots.error;
  if (own.error) throw own.error;
  return { slots: slots.data, own: own.data };
}

/** Writes one period's time for one school section; null start = follow the school. */
async function writeTime(client, own, key, slot, start_time, end_time) {
  const mine = own.find((o) => o.school_section === key && o.timetable_slot_id === slot.id);
  const same = start_time === hhmm(slot.start_time) && end_time === hhmm(slot.end_time);
  if (same) return mine ? client.from('section_period_times').delete().eq('id', mine.id) : { error: null };
  if (mine) {
    if (start_time === hhmm(mine.start_time) && end_time === hhmm(mine.end_time)) return { error: null };
    return client.from('section_period_times').update({ start_time, end_time }).eq('id', mine.id);
  }
  return client.from('section_period_times').insert({ school_section: key, timetable_slot_id: slot.id, start_time, end_time });
}

export async function periodTimesView(main) {
  const section = TIME_SECTIONS.find((s) => s.id === ui.periodTimesOf);
  const pick = h('select', { 'aria-label': 'Section', value: section ? section.id : '',
    onchange: (e) => { ui.periodTimesOf = e.target.value; periodTimesView(main); } },
  h('option', { value: '' }, 'Choose the section…'),
  TIME_SECTIONS.map((s) => h('option', { value: s.id }, s.label)));
  const toolbar = h('div', { class: 'toolbar' }, title('Period times by section', 'clock'), pick);

  if (!section) {
    fill(main, toolbar, h('div', { class: 'card empty' }, icon('clock', 40),
      h('p', {}, 'First choose the section whose period times you want to see or change: ECE, Primary or Senior.')));
    return;
  }

  const { slots, own } = await load();
  const ownOf = (slotId) => own.find((o) => o.school_section === section.keys[0] && o.timetable_slot_id === slotId);

  const rows = slots.map((s) => {
    const mine = ownOf(s.id);
    const start = h('input', { type: 'time', 'aria-label': `Period ${s.period_no} start`, value: hhmm(mine ? mine.start_time : s.start_time) });
    const end = h('input', { type: 'time', 'aria-label': `Period ${s.period_no} end`, value: hhmm(mine ? mine.end_time : s.end_time) });
    const note = h('span', { class: 'muted' });
    const refresh = () => {
      const same = start.value === hhmm(s.start_time) && end.value === hhmm(s.end_time);
      fill(note, same ? 'Normal time' : h('span', { class: 'pill' }, `Own time (normal: ${hhmm(s.start_time)}–${hhmm(s.end_time)})`));
    };
    start.addEventListener('input', refresh);
    end.addEventListener('input', refresh);
    refresh();
    return { s, start, end, tr: h('tr', {}, h('td', {}, h('b', {}, `P${s.period_no}`)), h('td', {}, start), h('td', {}, end), h('td', {}, note)) };
  });

  const msg = h('p', { class: 'err', role: 'alert' });
  const save = h('button', { class: 'primary', onclick: async () => {
    msg.textContent = '';
    for (const r of rows) {
      if (!HHMM.test(r.start.value) || !HHMM.test(r.end.value)) {
        msg.textContent = `Period ${r.s.period_no}: enter both times, e.g. 08:40 and 09:20.`;
        return;
      }
      if (r.end.value <= r.start.value) {
        msg.textContent = `Period ${r.s.period_no}: the end must be after the start.`;
        return;
      }
    }
    save.disabled = true;
    try {
      const client = db();
      for (const r of rows) {
        for (const key of section.keys) {
          const { error } = await writeTime(client, own, key, r.s, r.start.value, r.end.value);
          if (error) {
            msg.textContent = `Period ${r.s.period_no}: ` + describeDbError(error, 'section_period_times');
            return;
          }
        }
      }
      toast(`Times for ${section.label} saved.`);
      await periodTimesView(main);
    } finally {
      save.disabled = false;
    }
  } }, icon('check', 16), 'Save times');

  const normal = h('button', { onclick: () => {
    for (const r of rows) {
      r.start.value = hhmm(r.s.start_time);
      r.end.value = hhmm(r.s.end_time);
      r.start.dispatchEvent(new Event('input'));
    }
  } }, 'Use the normal times for all');

  fill(main, toolbar,
    h('p', { class: 'help' }, `${section.label}: change the times of the periods that run differently (e.g. after another break), then save. `,
      'The app shows these times to the teachers of this section’s classes. Period numbers stay the same, so timetables are not affected. ',
      'The normal times are on the “Periods” page.'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Period', 'Start', 'End', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => r.tr)))),
    msg,
    h('p', {}, save, ' ', normal));
}
