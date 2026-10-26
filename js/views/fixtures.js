// Leave & fixtures: mark a teacher on leave for a day (or some periods), or approve a teacher's request
// from the app; their periods are given at once to substitutes by the database (admin_record_leave,
// rules in the teacher-leave and school-sections migrations). The admin can change any fixture or make it
// Physical Activity.
import { fill, h, icon, title } from '../dom.js';
import { hhmm, prettyDate, todayYmd, ymdOf } from '../format.js';
import { confirmBox, promptBox, toast } from '../ui.js';
import { db, errText, router, ui } from '../data.js';
import { describeDbError, fieldProblem } from '../validation.js';

export const PHYSICAL_ACTIVITY = 'Physical Activity (grounds)';
const REASON = ['reason', 'Reason', 'text', { max: 200 }];

async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const periodList = (ps) => ps.map((p) => `P${p}`).join(', ');
const NOTE_MAX = 200; // leave_requests.review_note

/** The toast after a leave is recorded (by the admin or by approving a request). */
const leaveToast = (name, r) => (r.fixtures
  ? `${name} is on leave: ${plural(r.fixtures, 'fixture')} made` + (r.physical_activity ? `, ${r.physical_activity} as Physical Activity.` : '.')
  : `${name} is on leave. No classes needed covering.`);

/** Is this teacher free to take period `periodNo`? (Not teaching then and not on leave then.) */
function freeAt(teacher, periodNo, leaves) {
  if (teacher.busy.includes(periodNo)) return false;
  const leave = leaves.find((l) => l.teacher_id === teacher.id);
  return !leave || (!leave.whole_day && !leave.periods.includes(periodNo));
}

/** The form that records (or changes) a leave. */
function leaveForm(day, editing) {
  const teachers = day.teachers;
  const teacher = h('select', { name: 'teacher', 'aria-label': 'Teacher' }, h('option', { value: '' }, '— choose teacher —'),
    teachers.map((t) => h('option', { value: t.id }, t.name)));
  const wholeDay = h('input', { type: 'radio', name: 'span', value: 'day', checked: true });
  const somePeriods = h('input', { type: 'radio', name: 'span', value: 'periods' });
  const periodsBox = h('div', { class: 'period-picks' });
  const reason = h('input', { name: 'reason', maxlength: REASON[3].max, placeholder: 'e.g. Sick leave' });
  const msg = h('p', { class: 'err', role: 'alert' });

  const drawPeriods = () => {
    const t = teachers.find((x) => x.id === teacher.value);
    if (!t) return fill(periodsBox);
    if (!t.periods.length) return fill(periodsBox, h('p', { class: 'muted' }, `${t.name} has no classes on this day.`));
    const chosen = editing && editing.teacher_id === t.id && !editing.whole_day ? editing.periods : [];
    fill(periodsBox, t.periods.map((p) => h('label', { class: 'pick-period' },
      h('input', { type: 'checkbox', name: 'period', value: p.slot_id, checked: chosen.includes(p.period_no), disabled: wholeDay.checked }),
      h('b', {}, `P${p.period_no}`), ` ${p.class_name} ${p.section_name} · ${p.subject_name}`)));
  };
  teacher.addEventListener('change', drawPeriods);
  for (const r of [wholeDay, somePeriods]) r.addEventListener('change', drawPeriods);
  if (editing) {
    teacher.value = editing.teacher_id;
    somePeriods.checked = !editing.whole_day;
    wholeDay.checked = editing.whole_day;
    reason.value = editing.reason || '';
  }
  drawPeriods();

  const save = h('button', { class: 'primary', onclick: async () => {
    msg.textContent = '';
    if (!teacher.value) {
      msg.textContent = 'Choose the teacher who is on leave.';
      return teacher.focus();
    }
    const slots = somePeriods.checked
      ? [...periodsBox.querySelectorAll('input[name=period]:checked')].map((c) => c.value)
      : null;
    if (slots && !slots.length) {
      msg.textContent = 'Tick the periods of the leave, or choose “Whole day”.';
      return;
    }
    const reasonProblem = fieldProblem(REASON, reason.value.trim());
    if (reasonProblem) {
      msg.textContent = reasonProblem;
      return reason.focus();
    }
    save.disabled = true;
    try {
      const r = await rpc('admin_record_leave', { p_teacher: teacher.value, p_date: day.date, p_slots: slots, p_reason: reason.value.trim() || null });
      toast(leaveToast(teachers.find((t) => t.id === teacher.value).name, r));
      ui.fixtureEdit = null;
      router.render();
    } catch (e) {
      msg.textContent = describeDbError(e, 'teacher_leaves', [REASON]);
    } finally {
      save.disabled = false;
    }
  } }, icon('check', 16), editing ? 'Save changes & reassign' : 'Save leave & assign fixtures');

  return h('div', { class: 'card' },
    h('h3', { style: 'margin-top:0;display:flex;gap:8px;align-items:center' }, icon(editing ? 'pencil' : 'userX', 20),
      editing ? `Change ${editing.teacher_name}’s leave` : 'Mark a teacher on leave'),
    h('label', { class: 'f' }, 'Teacher', h('span', { class: 'req' }, '*')), teacher,
    h('div', { class: 'hint' }, 'Their classes on this day are given to substitutes straight away.'),
    h('label', { class: 'f' }, 'Leave'),
    h('div', { class: 'span-choice' },
      h('label', {}, wholeDay, ' Whole day'), h('label', {}, somePeriods, ' Some periods')),
    periodsBox,
    h('label', { class: 'f' }, 'Reason'), reason, h('div', { class: 'hint' }, 'Optional. Shown only to admins.'),
    msg,
    h('p', {}, save, editing && h('button', { class: 'link', onclick: () => { ui.fixtureEdit = null; router.render(); } }, 'Cancel')));
}

/**
 * Who can take a fixture: free teachers of the class's section group first (fewest classes), then free
 * teachers of the other sections (allowed, but marked), then the busy ones (disabled).
 */
function substituteSelect(f, day) {
  const options = day.teachers
    .filter((t) => t.id !== f.absent_teacher_id)
    .map((t) => {
      const current = t.id === f.substitute_teacher_id;
      const free = current || freeAt(t, f.period_no, day.leaves);
      const same = !f.group || (t.groups || []).includes(f.group);
      const load = t.busy.length - (current ? 1 : 0);
      const label = `${t.name} — ${plural(load, 'class', 'classes')}` + (!free ? ' (busy)' : same ? '' : ' (other section)');
      return { t, free, same, load, label };
    })
    .sort((a, b) => (b.free - a.free) || (b.same - a.same) || (a.load - b.load) || a.t.name.localeCompare(b.t.name));
  const sel = h('select', { value: f.substitute_teacher_id || '', 'aria-label': `Substitute for P${f.period_no} ${f.class_name} ${f.section_name}` },
    h('option', { value: '' }, PHYSICAL_ACTIVITY),
    options.map((o) => h('option', { value: o.t.id, disabled: !o.free }, o.label)));
  sel.addEventListener('change', async () => {
    try {
      await rpc('admin_set_fixture', { p_fixture: f.id, p_teacher: sel.value || null });
      toast(sel.value ? 'Fixture changed.' : `P${f.period_no} is now ${PHYSICAL_ACTIVITY}.`);
      router.render();
    } catch (e) {
      sel.value = f.substitute_teacher_id || '';
      toast(describeDbError(e, 'fixtures'), 'err');
    }
  });
  return sel;
}

/** Teachers' leave requests from the app, waiting for an answer (every date). */
function requestsCard(requests) {
  if (requests.failed) {
    return [h('h3', { class: 'sec' }, icon('inbox'), 'Leave requests from teachers'),
      h('p', { class: 'err' }, 'The leave requests could not be loaded: ' + requests.failed)];
  }
  const answer = async (r, approve) => {
    let note = null;
    if (!approve) {
      note = await promptBox({ title: `Reject ${r.teacher_name}’s leave?`, label: 'Note for the teacher (optional)', ok: 'Reject' });
      if (note === null) return;
      note = note.trim() || null;
      if (note && note.length > NOTE_MAX) return toast(`The note can be at most ${NOTE_MAX} characters.`, 'err');
    }
    try {
      const res = await rpc('admin_review_leave_request', { p_request: r.id, p_approve: approve, p_note: note });
      if (approve) {
        toast(leaveToast(r.teacher_name, res));
        ui.fixtureDate = r.leave_date; // show the day with its new fixtures
      } else {
        toast(`${r.teacher_name}’s request was rejected.`);
      }
      ui.fixtureEdit = null;
      router.go('fixtures'); // also updates the number on the menu
    } catch (e) {
      toast(describeDbError(e, 'leave_requests'), 'err');
      router.render();
    }
  };
  return [
    h('h3', { class: 'sec' }, icon('inbox'), `Leave requests from teachers (${requests.length})`),
    requests.length
      ? h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Date', 'Teacher', 'Leave', 'Reason', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, requests.map((r) => h('tr', {},
          h('td', {}, h('b', {}, prettyDate(r.leave_date))),
          h('td', {}, r.teacher_name, r.already_on_leave && h('div', {}, h('span', { class: 'pill' }, 'already marked on leave'))),
          h('td', {}, r.whole_day ? 'Whole day' : periodList(r.periods)),
          h('td', { class: 'muted' }, r.reason),
          h('td', { class: 'row-actions' },
            h('button', { class: 'act', onclick: () => answer(r, true) }, icon('check', 16), h('span', {}, 'Approve')),
            h('button', { class: 'act danger', onclick: () => answer(r, false) }, icon('x', 16), h('span', {}, 'Reject'))))))))
      : h('p', { class: 'muted' }, 'No requests waiting. Teachers ask for leave in the app (More → My leave).'),
  ];
}

export async function fixturesView(main) {
  ui.fixtureDate = ui.fixtureDate || todayYmd();
  const [day, requests] = await Promise.all([
    rpc('admin_fixtures', { p_date: ui.fixtureDate }),
    // the requests failing must not hide the day's leave and fixtures
    rpc('admin_leave_requests', {}).catch((e) => {
      console.error('[admin] leave requests:', e);
      return { failed: errText(e) };
    }),
  ]);
  const show = (v) => {
    if (!v) return;
    ui.fixtureDate = v;
    ui.fixtureEdit = null;
    router.render();
  };
  const step = (n) => {
    const t = new Date(day.date + 'T00:00:00');
    t.setDate(t.getDate() + n);
    show(ymdOf(t));
  };
  const dateInput = h('input', { type: 'date', value: day.date, 'aria-label': 'Date' });
  dateInput.addEventListener('change', () => show(dateInput.value));
  const editing = ui.fixtureEdit && day.leaves.find((l) => l.id === ui.fixtureEdit);

  const removeLeave = async (l) => {
    if (!await confirmBox({ title: `Remove ${l.teacher_name}’s leave?`, body: 'Their classes go back to them and the fixtures are removed.', ok: 'Remove' })) return;
    try {
      await rpc('admin_delete_leave', { p_leave: l.id });
      toast('Leave removed.');
      router.render();
    } catch (e) {
      toast(errText(e), 'err');
    }
  };

  const pe = day.fixtures.filter((f) => !f.substitute_teacher_id).length;
  fill(main,
    h('div', { class: 'toolbar' }, title('Leave & fixtures', 'userX'),
      h('button', { 'aria-label': 'Previous day', onclick: () => step(-1) }, icon('chevronLeft', 16)), dateInput,
      h('button', { 'aria-label': 'Next day', onclick: () => step(1) }, icon('chevronRight', 16))),
    h('p', { class: 'help' }, prettyDate(day.date) + '. ',
      'Each period of a teacher on leave goes to a teacher of the same sections who is free then, with the fewest classes that day: Early Childhood and Primary teachers cover each other, and Middle and Secondary teachers cover each other. Two classes in a row are fine, three never. When equal: no class next to it first, then the fewest fixtures this month. ',
      `If nobody is free the class has ${PHYSICAL_ACTIVITY}. You can change any fixture below.`),
    day.classes_without_section > 0 && h('div', { class: 'banner' }, icon('alert'),
      h('span', {}, `${plural(day.classes_without_section, 'class has', 'classes have')} no school section yet, so any teacher can cover them.`),
      h('button', { class: 'link', onclick: () => router.go('classes') }, 'Set it under Classes →')),
    requestsCard(requests),
    leaveForm(day, editing),

    h('h3', { class: 'sec' }, icon('userX'), `On leave (${day.leaves.length})`),
    day.leaves.length
      ? h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Teacher', 'Leave', 'Reason', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, day.leaves.map((l) => h('tr', {},
          h('td', {}, h('b', {}, l.teacher_name)),
          h('td', {}, l.whole_day ? 'Whole day' : periodList(l.periods)),
          h('td', { class: 'muted' }, l.reason || '—'),
          h('td', { class: 'row-actions' },
            h('button', { class: 'act', onclick: () => { ui.fixtureEdit = l.id; router.render(); } }, icon('pencil', 16), h('span', {}, 'Change')),
            h('button', { class: 'act danger', onclick: () => removeLeave(l) }, icon('trash', 16), h('span', {}, 'Remove'))))))))
      : h('p', { class: 'muted' }, 'Nobody is on leave on this day.'),

    h('h3', { class: 'sec' }, icon('swap'), `Fixtures (${day.fixtures.length})`),
    pe > 0 && h('div', { class: 'banner' }, icon('sun'), `${plural(pe, 'class', 'classes')} with ${PHYSICAL_ACTIVITY}: no teacher of those sections was free without three classes in a row. Choose a substitute below if you wish.`),
    day.fixtures.length
      ? h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Period', 'Class', 'Subject', 'On leave', 'Substitute', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, day.fixtures.map((f) => h('tr', { class: f.substitute_teacher_id ? '' : 'pe-row' },
          h('td', {}, h('b', {}, `P${f.period_no}`), h('div', { class: 'muted' }, hhmm(f.start_time))),
          h('td', {}, `${f.class_name} ${f.section_name}`),
          h('td', {}, f.subject_name),
          h('td', {}, f.absent_teacher),
          h('td', {}, substituteSelect(f, day)),
          h('td', {},
            f.assigned_by === 'admin' && h('span', { class: 'pill' }, 'changed by admin'),
            f.attendance_taken && h('span', { class: 'pill', style: 'margin-left:4px' }, 'attendance taken')))))))
      : h('p', { class: 'muted' }, 'No fixtures on this day.'));
}
