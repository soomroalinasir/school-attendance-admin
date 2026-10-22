// What each setup page shows and edits, the menu, and the setup checklist.
//
// Columns are [key, label, type, opts]. type: text | number | date | time | bool | select:a,b | fk:<table>
// opts: req, ro (list only), ph (placeholder), hint, and the rules in validation.js (max, pattern …).
// Length limits are the database's (supabase/migrations/*_input_validation.sql); a test keeps them equal.
import { h, icon } from './dom.js';
import { DAYS } from './format.js';
import { activeYear, byId, cache, counts, lab, router } from './data.js';

export const PHONE = /^\+?[0-9][0-9 -]{6,18}[0-9]$/;
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Who teaches in one period (time slot), from the active year's weekly timetable. */
function slotTeachers(slot) {
  const ay = activeYear();
  const byTeacher = new Map();
  for (const e of cache.timetable_entries || []) {
    if (e.adhoc_date || e.timetable_slot_id !== slot.id) continue;
    const a = byId('teaching_assignments', e.teaching_assignment_id);
    const s = byId('sections', e.section_id);
    if (!a || (ay && s && s.academic_year_id !== ay.id)) continue;
    const key = `${lab('sections', a.section_id)} · ${lab('subjects', a.subject_id)}`;
    if (!byTeacher.has(a.teacher_id)) byTeacher.set(a.teacher_id, new Map());
    const classes = byTeacher.get(a.teacher_id);
    if (!classes.has(key)) classes.set(key, []);
    classes.get(key).push(e.day_of_week);
  }
  if (!byTeacher.size) return h('span', { class: 'muted' }, 'Not on the timetable yet');
  const dayText = (ds) => {
    ds = [...new Set(ds)].sort();
    const run = ds.length > 2 && ds[ds.length - 1] - ds[0] === ds.length - 1;
    return run ? `${DAYS[ds[0]]}–${DAYS[ds[ds.length - 1]]}` : ds.map((d) => DAYS[d]).join(', ');
  };
  return [...byTeacher].map(([tid, classes]) => ({ name: lab('teachers', tid), classes }))
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((t) => h('div', {}, h('b', {}, t.name),
      [...t.classes].map(([cls, ds]) => h('div', { class: 'muted', style: 'font-size:12px' }, `${cls} · ${dayText(ds)}`))));
}

export const DEFS = {
  academic_years: { title: 'Academic years', one: 'academic year', icon: 'calendar',
    cols: [
      ['name', 'Name', 'text', { req: true, max: 30, ph: 'e.g. 2026-27', hint: 'A short name for the school year, shown on reports and marksheets.' }],
      ['start_date', 'Start', 'date', { req: true, hint: 'First day of the school year.' }],
      ['end_date', 'End', 'date', { req: true, hint: 'Last day of the school year. Attendance is only expected between these dates.' }],
      ['is_active', 'Active', 'bool', { hint: 'Tick for the current year. Ticking this makes every other year inactive.' }]],
    help: 'Exactly one year should be active. Teachers, imports, reports and results use the active year.' },
  classes: { title: 'Classes', one: 'class', icon: 'layers',
    cols: [
      ['name', 'Name', 'text', { req: true, max: 60, ph: 'e.g. Grade 6 or Matric', hint: 'The class name teachers and parents know.' }],
      ['level', 'Level', 'number', { int: true, ph: 'e.g. 6', hint: 'Optional number for the grade (Nursery = -1, KG = 0).' }],
      ['sort_order', 'Order', 'number', { int: true, ph: 'e.g. 7', hint: 'Lists are sorted by this number, and at year end students move to the class with the next number.' }],
      ['created_by_teacher_id', 'Made by teacher', 'fk:teachers', { ro: true }]],
    help: 'Order decides promotion: students move to the class with the next order number. Classes made by teachers on their phone are marked and never used for promotion.' },
  sections: { title: 'Sections', one: 'section', icon: 'grid',
    cols: [
      ['class_id', 'Class', 'fk:classes', { req: true, hint: 'Which class this section belongs to.' }],
      ['academic_year_id', 'Year', 'fk:academic_years', { req: true, hint: 'Sections are made again each school year.' }],
      ['name', 'Section', 'text', { req: true, max: 30, ph: 'A', hint: 'Usually A, B, C… Use "A" if the class is not split.' }],
      ['created_by_teacher_id', 'Made by teacher', 'fk:teachers', { ro: true }]],
    help: 'Create sections only where a class is split (A, B, C…). A class with one section still needs one section, e.g. "A". Students are enrolled into sections.', filter: 'academic_year_id' },
  subjects: { title: 'Subjects', one: 'subject', icon: 'book',
    cols: [
      ['name', 'Name', 'text', { req: true, max: 60, ph: 'e.g. Mathematics', hint: 'Shown on attendance, timetable and marksheets.' }],
      ['code', 'Code', 'text', { max: 20, ph: 'e.g. MATH', hint: 'Optional short code.' }]],
    help: 'Subjects are used for attendance, the timetable and results.' },
  teachers: { title: 'Teachers', one: 'teacher', icon: 'user',
    cols: [
      ['employee_no', 'Employee no.', 'text', { max: 30, ph: 'e.g. T001', hint: 'Optional staff number.' }],
      ['full_name', 'Name', 'text', { req: true, max: 100, ph: 'e.g. Nasir Ali', hint: 'Full name as it should appear on reports.' }],
      ['phone', 'Phone', 'text', { max: 20, pattern: PHONE, patternMsg: 'Phone must be digits, e.g. 03001234567 or +923001234567.', ph: '+923001234567', hint: 'Optional. Shown to the admin for periods with missing attendance.' }],
      ['email', 'Email', 'text', { max: 254, pattern: EMAIL, patternMsg: 'That email address does not look right.', ph: 'name@school.pk', hint: 'Optional. Used to fill in the login form.' }],
      ['is_active', 'Active', 'bool', { hint: 'Untick when a teacher leaves; their phone stops syncing.' }]],
    help: 'After adding a teacher, create their sign-in under “Logins”. Any teacher can take attendance in any class.' },
  students: { title: 'Students', one: 'student', icon: 'users', big: true,
    cols: [
      ['admission_no', 'Admission no.', 'text', { req: true, max: 30, ph: 'e.g. 1122', hint: 'Must be unique for every student.' }],
      ['full_name', 'Name', 'text', { req: true, max: 100, ph: 'e.g. Atif Ali', hint: 'Full name as it should appear on the attendance list and marksheet.' }],
      ['gender', 'Gender', 'select:male,female,other', { hint: 'Optional.' }],
      ['dob', 'Date of birth', 'date', { hint: 'Optional.' }],
      ['is_active', 'Active', 'bool', { hint: 'Untick when the student leaves the school.' }]],
    help: 'Use “Import students” to add many at once from a CSV file. Then put each student in a class under “Enrollments”, so they appear on the teacher’s attendance list.' },
  enrollments: { title: 'Enrollments', one: 'enrollment', icon: 'clipboard', big: true,
    cols: [
      ['student_id', 'Student', 'fk:students', { req: true, hint: 'Type part of the name or admission no., then pick the student.' }],
      ['academic_year_id', 'Year', 'fk:academic_years', { req: true, hint: 'Usually the active year.' }],
      ['section_id', 'Section', 'fk:sections', { req: true, hint: 'The class and section the student studies in. They appear on this class’s attendance list.' }],
      ['roll_no', 'Roll no.', 'number', { int: true, min: 1, maxValue: 9999, ph: 'e.g. 1', hint: 'Order on the attendance list. Must be unique within the section.' }],
      ['status', 'Status', 'select:active,promoted,left,transferred', { req: true, hint: '“active” = studying now. Use “left” instead of deleting, to keep history.' }]],
    help: 'One enrollment per student per year. Enrolled students appear on the teacher’s attendance list for that class.', filter: 'section_id' },
  teaching_assignments: { title: 'Teaching assignments', one: 'teaching assignment', icon: 'link',
    cols: [
      ['academic_year_id', 'Year', 'fk:academic_years', { req: true, hint: 'Usually the active year.' }],
      ['section_id', 'Section', 'fk:sections', { req: true, hint: 'The class and section taught.' }],
      ['subject_id', 'Subject', 'fk:subjects', { req: true, hint: 'The subject taught to this section.' }],
      ['teacher_id', 'Teacher', 'fk:teachers', { req: true, hint: 'The usual teacher for this subject.' }]],
    help: 'Who normally teaches which subject to which section. Put them on the weekly timetable so the period shows on the teacher’s “Today” list. (Teachers can still take attendance in any class.)', filter: 'section_id' },
  class_teacher_assignments: { title: 'Class teachers', one: 'class teacher', icon: 'star',
    cols: [
      ['academic_year_id', 'Year', 'fk:academic_years', { req: true, hint: 'Usually the active year.' }],
      ['section_id', 'Section', 'fk:sections', { req: true, hint: 'One class teacher per section.' }],
      ['teacher_id', 'Teacher', 'fk:teachers', { req: true, hint: 'They see every period of this section in “My class”.' }]],
    help: 'One class teacher per section. They can see every period of their section.' },
  timetable_slots: { title: 'Periods (time slots)', one: 'period', icon: 'clock',
    cols: [
      ['period_no', 'Period', 'number', { req: true, int: true, min: 1, maxValue: 12, ph: '1', hint: 'Period number in the day: 1 to 12.' }],
      ['start_time', 'Start', 'time', { req: true, hint: 'When the period starts.' }],
      ['end_time', 'End', 'time', { req: true, hint: 'When it ends. Must be after the start.' }]],
    help: 'The periods of the school day, usually 8. Teachers pick a period when taking attendance. “Teachers” shows who teaches each period, from the weekly timetable.',
    needs: ['timetable_entries'], extra: ['Teachers', slotTeachers] },
  holidays: { title: 'Holidays', one: 'holiday', icon: 'sun',
    cols: [
      ['date', 'Date', 'date', { req: true, hint: 'The day off.' }],
      ['description', 'Description', 'text', { max: 200, ph: 'e.g. Eid ul-Fitr', hint: 'Shown to teachers on that day.' }],
      ['scope', 'Scope', 'select:school,section', { req: true, hint: '“school” = whole school; “section” = only one section.' }],
      ['section_id', 'Section (if scope = section)', 'fk:sections', { hint: 'Only when Scope is “section”.' }]],
    help: 'Holidays are not counted as missing submissions and are excluded from reports.' },
};

/** Pages that are not a plain table, by id (the menu and #links use these). */
export const SPECIAL_VIEWS = ['report', 'results', 'fixtures', 'logins', 'import', 'timetable', 'settings', 'promotion'];

export const NAV = [
  ['Daily', [['report', 'Daily report', 'fileText'], ['fixtures', 'Leave & fixtures', 'userX'], ['results', 'Results & marksheets', 'award']]],
  ['Start of year', [['academic_years', 'Academic years', 'calendar'], ['classes', 'Classes', 'layers'], ['sections', 'Sections', 'grid'], ['subjects', 'Subjects', 'book'], ['timetable_slots', 'Periods', 'clock']]],
  ['People', [['teachers', 'Teachers', 'user'], ['logins', 'Logins', 'key'], ['students', 'Students', 'users'], ['import', 'Import students (CSV)', 'upload'], ['enrollments', 'Enrollments', 'clipboard']]],
  ['Timetable', [['teaching_assignments', 'Teaching assignments', 'link'], ['timetable', 'Weekly timetable', 'table'], ['class_teacher_assignments', 'Class teachers', 'star']]],
  ['Calendar & rules', [['holidays', 'Holidays', 'sun'], ['settings', 'School settings', 'sliders'], ['promotion', 'Year-end promotion', 'arrowUp']]],
];

// The school is set up in this order; the banner points at the first step still missing
const SETUP_STEPS = [
  ['academic_years', 'Add an academic year and tick “Active”', () => !!activeYear()],
  ['classes', 'Add your classes', () => (cache.classes || []).length > 0],
  ['sections', 'Add a section for each class (e.g. “A”)', () => (cache.sections || []).length > 0],
  ['subjects', 'Add the subjects', () => (cache.subjects || []).length > 0],
  ['timetable_slots', 'Add the periods (times of the day)', () => (cache.timetable_slots || []).length > 0],
  ['teachers', 'Add the teachers', () => (cache.teachers || []).length > 0],
  ['students', 'Add students (or use Import students)', () => (counts.students || 0) > 0],
];

export function nextStepBanner(current) {
  const i = SETUP_STEPS.findIndex(([, , done]) => !done());
  if (i < 0 || SETUP_STEPS[i][0] === current) return null;
  const [view, text] = SETUP_STEPS[i];
  return h('div', { class: 'banner' }, icon('alert'), h('span', {}, `Setup step ${i + 1} of ${SETUP_STEPS.length}: ${text}.`),
    h('button', { class: 'link', onclick: () => router.go(view) }, 'Go there →'));
}
