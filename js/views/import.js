// Import students from a CSV file: creates or updates students by admission number and enrolls them
// in the active year (the import_students database function checks every row).
import { fill, h, icon, title } from '../dom.js';
import { toast } from '../ui.js';
import { activeYear, db, errText, refreshCount, reload } from '../data.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // ~50,000 rows; bigger files should be split
const BATCH = 500; // rows per server call

/** CSV text → rows of fields. Handles quotes, "" escapes, , ; or tab separators, CRLF and a BOM. */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const IMPORT_COLS = ['admission_no', 'full_name', 'class', 'section', 'roll_no', 'gender', 'dob'];
const REQUIRED_COLS = ['admission_no', 'full_name', 'class'];
const ALIASES = {
  'admission no': 'admission_no', admission: 'admission_no', 'adm no': 'admission_no', name: 'full_name',
  'student name': 'full_name', 'full name': 'full_name', grade: 'class', 'roll no': 'roll_no', roll: 'roll_no', 'date of birth': 'dob',
};

/** Header names (any spelling from ALIASES) → column keys. */
export const headerKey = (x) => {
  const k = x.trim().toLowerCase().replace(/_/g, ' ');
  return ALIASES[k] || k.replace(/ /g, '_');
};

/** CSV text → { rows } (objects keyed by column) or { error } in plain words. */
export function readStudentCsv(text) {
  const raw = parseCsv(text);
  if (raw.length < 2) return { error: 'The file has no data rows.' };
  const header = raw[0].map(headerKey);
  const missing = REQUIRED_COLS.filter((c) => !header.includes(c));
  if (missing.length) return { error: 'Missing column(s): ' + missing.join(', ') };
  return { rows: raw.slice(1).map((r) => Object.fromEntries(header.map((k, i) => [k, (r[i] || '').trim()]))) };
}

export function importView(main) {
  const ay = activeYear();
  const file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'CSV file' });
  const preview = h('div');
  const out = h('div');
  let rows = [];
  const template = 'admission_no,full_name,class,section,roll_no,gender,dob\r\nADM00001,Ali Khan,Grade 9,A,1,male,2011-05-04\r\n';

  file.addEventListener('change', async () => {
    fill(out);
    const f = file.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      fill(preview, h('p', { class: 'err' }, 'The file is larger than 5 MB. Split it into smaller files and import them one by one.'));
      return;
    }
    const result = readStudentCsv(await f.text());
    if (result.error) {
      fill(preview, h('p', { class: 'err' }, result.error));
      return;
    }
    rows = result.rows;
    fill(preview,
      h('p', {}, `${rows.length} student(s) found. First rows:`),
      h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, IMPORT_COLS.map((c) => h('th', {}, c)))),
        h('tbody', {}, rows.slice(0, 8).map((r) => h('tr', {}, IMPORT_COLS.map((c) => h('td', {}, r[c] || ''))))))),
      h('p', {}, h('button', { class: 'primary', disabled: !ay, onclick: run }, icon('upload', 16),
        `Import ${rows.length} students into ${ay ? ay.name : '(no active year!)'}`)));
  });

  async function run() {
    let created = 0;
    let updated = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i += BATCH) {
      fill(out, h('p', { class: 'muted' }, `Importing… ${i} of ${rows.length}`));
      const { data, error } = await db().rpc('import_students', { p_rows: rows.slice(i, i + BATCH) });
      if (error) {
        fill(out, h('p', { class: 'err' }, `Stopped after ${i} rows: ${errText(error)}`));
        return;
      }
      created += data.created;
      updated += data.updated;
      // +1 for the header line, so the number matches the line in the spreadsheet
      for (const e of data.errors) errors.push({ ...e, line: e.line + i + 1 });
    }
    await Promise.all([refreshCount('students'), reload('sections')]);
    toast(`Import done: ${created} new, ${updated} updated.`);
    fill(out,
      h('p', { class: 'ok' }, `Done: ${created} new, ${updated} updated, ${errors.length} with errors.`),
      errors.length > 0 && h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'CSV line'), h('th', {}, 'Admission no.'), h('th', {}, 'Problem'))),
        h('tbody', {}, errors.map((e) => h('tr', {}, h('td', {}, e.line), h('td', {}, e.admission_no || ''), h('td', { class: 'err' }, e.error)))))));
  }

  fill(main,
    h('div', { class: 'toolbar' }, title('Import students', 'upload')),
    h('p', { class: 'help' }, 'Columns: admission_no, full_name, class, section, roll_no, gender (male / female / other), dob (YYYY-MM-DD). ',
      'Class names must match the Classes list. Missing sections are created. Re-importing updates existing students by admission number.'),
    !ay && h('p', { class: 'err' }, 'Set an active academic year first.'),
    h('p', {}, h('a', { href: 'data:text/csv;charset=utf-8,' + encodeURIComponent(template), download: 'students_template.csv',
      style: 'display:inline-flex;gap:6px;align-items:center;color:var(--primary)' }, icon('download', 16), 'Download template')),
    h('div', { class: 'card' }, file, preview, out));
}
