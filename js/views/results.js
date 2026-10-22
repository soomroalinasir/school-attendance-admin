// Results: teachers enter marks per subject in the app; here the admin sees what has come in for
// each class and downloads marksheets (one page per student, all subjects, percentages).
import { fill, h, icon, title } from '../dom.js';
import { num, pct, roll } from '../format.js';
import { kpi, toast } from '../ui.js';
import { db, errText, router, ui } from '../data.js';
import { downloadMarksheets } from '../pdf.js';

async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
}

/** Runs a download from a button, keeping it disabled meanwhile. */
async function download(button, work, done) {
  button.disabled = true;
  try {
    await work();
    toast(done);
  } catch (e) {
    toast(errText(e), 'err');
  } finally {
    button.disabled = false;
  }
}

export async function resultsView(main) {
  const exams = await rpc('admin_exams');
  const toolbar = h('div', { class: 'toolbar' }, title('Results', 'award'));
  const help = h('p', { class: 'help' }, 'Subject teachers enter marks in the app (Results tab): they choose Monthly test, Mid-term or Annual exam, the class, the subject and the marks of each student. ',
    'Here you see which subjects have come in for each class and download marksheets: one page per student with all subjects and the overall percentage.');
  if (!exams.length) {
    fill(main, toolbar, help, h('div', { class: 'card empty' }, icon('inbox', 40),
      h('p', {}, 'No marks have been entered yet. Exams appear here as soon as a teacher saves marks for one.')));
    return;
  }
  if (!ui.resExam || !exams.some((e) => e.id === ui.resExam)) ui.resExam = exams[0].id;
  const exam = exams.find((e) => e.id === ui.resExam);
  toolbar.append(h('select', { value: exam.id, 'aria-label': 'Exam', onchange: (e) => {
    ui.resExam = e.target.value;
    ui.resSection = null;
    router.render();
  } }, exams.map((e) => h('option', { value: e.id }, `${e.name} (${e.marks_entered} marks)`))));

  const progress = await rpc('exam_progress', { p_exam: exam.id });
  const open = ui.resSection && progress.find((p) => p.section_id === ui.resSection);
  if (open) {
    await sectionResultsView(main, exam, open, toolbar);
    return;
  }

  fill(main, toolbar, help,
    h('div', { class: 'kpis' },
      kpi('marks entered', exam.marks_entered),
      kpi('subjects', exam.subjects),
      kpi('classes with marks', `${exam.sections} / ${progress.length}`)),
    h('h3', { class: 'sec' }, icon('layers'), `${exam.name}: marks received per class`),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Class', 'Students', 'Subjects entered (marks · entered by)', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, progress.map((p) => h('tr', {},
        h('td', {}, h('b', {}, `${p.class_name} ${p.section_name}`)),
        h('td', {}, p.students),
        h('td', { class: 'names' }, p.subjects.length
          ? p.subjects.map((s) => h('div', {}, h('span', { class: 'pill' + (s.entered < p.students ? ' off' : '') }, `${s.subject} ${s.entered}/${p.students}`), ' ', s.entered_by || ''))
          : '—'),
        h('td', { class: 'row-actions' },
          h('button', { class: 'act', disabled: !p.subjects.length, onclick: () => { ui.resSection = p.section_id; router.render(); } },
            icon('fileText', 16), h('span', {}, 'Marksheets')))))))));
}

async function sectionResultsView(main, exam, sec, toolbar) {
  const data = await rpc('section_marksheets', { p_exam: exam.id, p_section: sec.section_id });
  const subjects = [...new Set(data.sheets.flatMap((s) => s.subjects.map((x) => x.subject)))].sort();
  const allBtn = h('button', { class: 'primary', onclick: () => download(allBtn,
    () => downloadMarksheets(data, `marksheets-${sec.class_name}-${sec.section_name}`), 'Marksheets downloaded.') },
  icon('download', 16), `Download all ${data.sheets.length} marksheets (PDF)`);

  const mark = (x) => (!x ? '—' : x.absent ? h('span', { class: 'pill off' }, 'Absent') : `${num(x.obtained)}/${num(x.max_marks)}`);
  fill(main, toolbar,
    h('p', {}, h('button', { class: 'link', onclick: () => { ui.resSection = null; router.render(); } }, icon('chevronLeft', 16), 'All classes')),
    h('div', { class: 'toolbar' }, h('h3', { class: 'sec', style: 'margin:0 auto 0 0' }, icon('users'), `${sec.class_name} ${sec.section_name} · ${exam.name}`), allBtn),
    h('p', { class: 'help' }, 'Each row is one student with every subject entered so far. Missing subjects show “—”. Download one marksheet, or all of them in one PDF (one page per student).'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Student'), subjects.map((s) => h('th', {}, s)), h('th', {}, 'Total'), h('th', {}, '%'), h('th', {}))),
      h('tbody', {}, data.sheets.map((sh) => {
        const by = Object.fromEntries(sh.subjects.map((x) => [x.subject, x]));
        const btn = h('button', { class: 'act', disabled: !sh.subjects.length, onclick: () => download(btn,
          () => downloadMarksheets({ ...data, sheets: [sh] }, `marksheet-${sh.student.full_name}`), 'Marksheet downloaded.') },
        icon('download', 16), h('span', {}, 'Marksheet'));
        return h('tr', {},
          h('td', {}, h('b', {}, roll(sh.student)), h('div', { class: 'muted' }, sh.student.admission_no)),
          subjects.map((s) => h('td', {}, mark(by[s]))),
          h('td', {}, sh.subjects.length ? `${num(sh.total_obtained)}/${num(sh.total_max)}` : '—'),
          h('td', {}, h('b', {}, pct(sh.pct))),
          h('td', { class: 'row-actions' }, btn));
      })))));
}
