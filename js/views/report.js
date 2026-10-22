// Daily report: school totals, class-wise counts with absent names, students who left after the
// first period, and which periods were (not) submitted, for one date. Downloadable as a PDF.
import { fill, h, icon, title } from '../dom.js';
import { prettyDate, pct, roll, timeOf, todayYmd, ymdOf } from '../format.js';
import { kpi, toast } from '../ui.js';
import { db, errText, router, ui } from '../data.js';
import { downloadDailyReport } from '../pdf.js';
import { SCHOOL_NAME } from '../brand.js';

/** Everything the report shows for one date (YYYY-MM-DD). */
export async function reportData(date) {
  const client = db();
  const [sum, classes, missing, settings, submitted] = await Promise.all([
    client.rpc('admin_day_summary', { p_date: date }),
    client.rpc('daily_section_summary', { p_date: date }),
    client.rpc('admin_missing_submissions', { p_date: date }),
    client.from('school_settings').select('school_name').eq('id', 1).single(),
    client.rpc('admin_day_submissions', { p_date: date }),
  ]);
  for (const r of [sum, classes, missing, submitted]) if (r.error) throw r.error;
  return {
    date, sum: sum.data, classes: classes.data || [], missing: missing.data || [], submitted: submitted.data || [],
    school: (settings.data && settings.data.school_name) || SCHOOL_NAME,
  };
}

const table = (head, rows) => h('div', { class: 'scroll' }, h('table', {},
  h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows)));
const sectionName = (x) => `${x.class_name} ${x.section_name}`;

export async function reportView(main) {
  const today = todayYmd();
  if (!ui.reportDate || ui.reportDate > today) ui.reportDate = today;
  const d = await reportData(ui.reportDate);
  const s = d.sum;
  const showDate = (v) => {
    if (v && v <= today) {
      ui.reportDate = v;
      router.render();
    }
  };
  const step = (days) => {
    const t = new Date(d.date + 'T00:00:00');
    t.setDate(t.getDate() + days);
    showDate(ymdOf(t));
  };
  const dateInput = h('input', { type: 'date', value: d.date, max: today, 'aria-label': 'Report date' });
  dateInput.addEventListener('change', () => showDate(dateInput.value));
  const pdfBtn = h('button', { class: 'primary', onclick: async () => {
    pdfBtn.disabled = true;
    try {
      await downloadDailyReport(d);
      toast('PDF downloaded.');
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      pdfBtn.disabled = false;
    }
  } }, icon('download', 16), 'Download PDF');
  const withBunks = d.classes.filter((c) => c.bunk_list.length);

  fill(main,
    h('div', { class: 'toolbar' }, title('Daily report', 'fileText'),
      h('button', { title: 'Previous day', 'aria-label': 'Previous day', onclick: () => step(-1) }, icon('chevronLeft', 16)), dateInput,
      h('button', { title: 'Next day', 'aria-label': 'Next day', disabled: d.date >= today, onclick: () => step(1) }, icon('chevronRight', 16)),
      pdfBtn),
    h('p', { class: 'help' }, prettyDate(d.date) + '. Day attendance comes from the first period. “Left later” means present in the first period but absent in a later one.'),
    s.holiday && h('div', { class: 'banner' }, icon('sun'), 'This day is a school holiday.'),
    h('div', { class: 'kpis' },
      kpi('Students', s.total_students),
      kpi('Present', s.students_present_day, 'good'),
      kpi('Absent', s.students_absent_day, s.students_absent_day ? 'bad' : ''),
      kpi('On leave', s.students_leave_day),
      kpi('Left later periods', s.bunk_students, s.bunk_students ? 'warn' : ''),
      kpi('Attendance', pct(s.present_pct), 'good'),
      kpi('Periods taken', `${s.submitted_periods} / ${s.scheduled_periods}`, s.submitted_periods < s.scheduled_periods ? 'warn' : 'good')),

    h('h3', { class: 'sec' }, icon('layers'), 'Class-wise'),
    d.classes.length
      ? table(['Class', 'Students', 'Present', 'Absent', 'Leave', '%', 'Periods taken', 'Absent students'],
        d.classes.map((c) => h('tr', {},
          h('td', {}, h('b', {}, sectionName(c))),
          h('td', {}, c.students), h('td', {}, c.present_students), h('td', {}, c.absent_students), h('td', {}, c.leave_students),
          h('td', {}, pct(c.present_pct)),
          h('td', {}, h('span', { class: 'pill' + (Number(c.submitted) < Number(c.scheduled) ? ' off' : '') }, `${c.submitted}/${c.scheduled}`)),
          h('td', { class: 'names' }, c.absent_list.map(roll).join(', ') || '—'))))
      : h('p', { class: 'muted' }, 'No sections in the active year yet.'),

    withBunks.length > 0 && [h('h3', { class: 'sec' }, icon('alert'), 'Left later periods'),
      table(['Class', 'Student', 'Missed periods'], withBunks.flatMap((c) => c.bunk_list.map((b) => h('tr', {},
        h('td', {}, sectionName(c)), h('td', {}, roll(b)),
        h('td', {}, b.periods.map((p) => `P${p.period_no} ${p.subject}`).join(', ')))))) ],

    h('h3', { class: 'sec' }, icon('check'), `Attendance submitted (${d.submitted.length})`),
    d.submitted.length
      ? table(['Class', 'Period', 'Subject', 'Submitted by', 'At', 'P / A / L / LV'], d.submitted.map((x) => h('tr', {},
        h('td', {}, sectionName(x)), h('td', {}, `P${x.period_no}`), h('td', {}, x.subject_name),
        h('td', {}, h('b', {}, x.submitted_by),
          x.extra_period ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'extra period')
            : x.submitted_by !== x.timetable_teacher && h('span', { class: 'pill', style: 'margin-left:6px' }, `substitute for ${x.timetable_teacher}`)),
        h('td', {}, timeOf(x.submitted_at)),
        h('td', {}, `${x.present} / ${x.absent} / ${x.late} / ${x.on_leave}`))))
      : h('p', { class: 'muted' }, 'No attendance submitted for this day yet.'),

    h('h3', { class: 'sec' }, icon('clock'), `Attendance not taken (${d.missing.length})`),
    d.missing.length
      ? table(['Class', 'Period', 'Subject', 'Teacher', 'Phone'], d.missing.map((m) => h('tr', {},
        h('td', {}, sectionName(m)), h('td', {}, `P${m.period_no} (${String(m.start_time).slice(0, 5)})`),
        h('td', {}, m.subject_name), h('td', {}, m.teacher_name || '—'), h('td', {}, m.teacher_phone || '—'))))
      : h('p', { class: 'ok' }, 'Every scheduled period has attendance.'));
}
