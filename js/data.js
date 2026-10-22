// Server access, the in-memory copies of the small tables, and paging for the big ones.
//
// Small tables (years, classes, sections, subjects, teachers, timetable …) hold dozens to a few
// thousand rows and are loaded whole. Students and enrollments can reach tens of thousands, so
// they are searched and paged on the server and never loaded whole.

/** What the admin is looking at (current page, filters, searches). */
export const ui = { view: 'academic_years', filter: {}, search: {}, page: {} };

/** Set by main.js: go(view) switches page; render() redraws the current page. */
export const router = { go: () => {}, render: () => {} };

let client = null;
export const setClient = (c) => { client = c; };
/** The Supabase client (signed in as the admin). */
export const db = () => client;

export function errText(e) {
  return (e && (e.message || e.error_description || e.error)) || String(e);
}

const ORDER = {
  academic_years: 'start_date', classes: 'sort_order', sections: 'name', subjects: 'name', teachers: 'full_name',
  teaching_assignments: 'id', class_teacher_assignments: 'id', timetable_slots: 'period_no', timetable_entries: 'id',
  holidays: 'date', app_users: 'created_at',
};
const FETCH_CHUNK = 1000;

export const cache = {};
const index = {};

async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += FETCH_CHUNK) {
    // id breaks ties, so rows with the same sort value are never repeated or skipped between chunks
    const { data, error } = await client.from(table).select('*').order(ORDER[table] || 'id').order('id')
      .range(from, from + FETCH_CHUNK - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < FETCH_CHUNK) break;
  }
  return out;
}

/** Reloads small tables into the cache. */
export async function reload(...tables) {
  for (const t of tables) {
    cache[t] = await fetchAll(t);
    index[t] = new Map(cache[t].map((r) => [r.id, r]));
  }
}

export const byId = (t, id) => index[t] && index[t].get(id);
export const activeYear = () => (cache.academic_years || []).find((y) => y.is_active);

/** Row counts of the big tables (the setup checklist needs "are there any students?"). */
export const counts = {};
export async function refreshCount(table) {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
  if (error) throw error;
  counts[table] = count ?? 0;
}

export const studentLabel = (s) => (s ? `${s.full_name} (${s.admission_no})` : '?');

/** How each kind of row is named in lists, pickers and messages. */
export const LABEL = {
  academic_years: (r) => r.name + (r.is_active ? ' (active)' : ''),
  classes: (r) => r.name,
  sections: (r) => {
    const c = byId('classes', r.class_id);
    const y = byId('academic_years', r.academic_year_id);
    return `${c ? c.name : '?'} ${r.name}` + (y && !y.is_active ? ` [${y.name}]` : '');
  },
  subjects: (r) => r.name,
  teachers: (r) => r.full_name + (r.employee_no ? ` (${r.employee_no})` : ''),
  students: studentLabel,
  teaching_assignments: (r) => `${lab('sections', r.section_id)} · ${lab('subjects', r.subject_id)} · ${lab('teachers', r.teacher_id)}`,
  timetable_slots: (r) => `P${r.period_no} ${String(r.start_time).slice(0, 5)}`,
  // enrollment rows carry their student (embedded by the paged query)
  enrollments: (r) => `${studentLabel(r.students)} in ${lab('sections', r.section_id)}`,
  class_teacher_assignments: (r) => `${lab('teachers', r.teacher_id)} for ${lab('sections', r.section_id)}`,
  holidays: (r) => `${r.date}${r.description ? ' – ' + r.description : ''}`,
};

export function lab(t, id) {
  const r = byId(t, id);
  return r ? LABEL[t](r) : (id ? '?' : '');
}

/** {id, label} choices from a cached table, sorted by label. */
export function options(t, filterFn) {
  return (cache[t] || []).filter(filterFn || (() => true))
    .map((r) => ({ id: r.id, label: LABEL[t](r) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

// ---- big tables: server-side search and paging ------------------------------------------

export const PAGE_SIZE = 50;
const MAX_TERM = 50;

/**
 * Makes typed search text safe for a PostgREST filter: drops the characters that structure the
 * filter (, ( ) and quotes) and the wildcards, and limits the length.
 */
export function searchTerm(text) {
  return String(text || '').replace(/[,()"'\\*%_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM);
}

const BIG = {
  students: { select: '*', order: 'full_name', search: ['full_name', 'admission_no'] },
  enrollments: {
    select: '*, students!inner(full_name, admission_no)',
    order: 'roll_no',
    search: ['full_name', 'admission_no'],
    searchIn: 'students',
  },
};
export const isBig = (table) => table in BIG;

/** One page of a big table: { rows, total }. filter = { column, value } or null. */
export async function fetchPage(table, { filter = null, search = '', page = 0 } = {}) {
  const spec = BIG[table];
  let q = client.from(table).select(spec.select, { count: 'exact' });
  if (filter && filter.value) q = q.eq(filter.column, filter.value);
  const term = searchTerm(search);
  if (term) {
    const or = spec.search.map((c) => `${c}.ilike.*${term}*`).join(',');
    q = spec.searchIn ? q.or(or, { referencedTable: spec.searchIn }) : q.or(or);
  }
  const from = page * PAGE_SIZE;
  // id breaks ties (same name / roll number), so paging never repeats or skips a row; indexed in migration 011
  const { data, error, count } = await q.order(spec.order, { nullsFirst: false }).order('id').range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data, total: count ?? 0 };
}

/** Up to 20 students matching the typed text (for the student picker). */
export async function searchStudents(text) {
  const term = searchTerm(text);
  if (!term) return [];
  const { data, error } = await client.from('students').select('id, full_name, admission_no')
    .or(`full_name.ilike.*${term}*,admission_no.ilike.*${term}*`).order('full_name').order('id').limit(20);
  if (error) throw error;
  return data;
}

// ---- the admin-users server function (creates logins) -----------------------------------

export async function callUsers(body) {
  const { data, error } = await client.functions.invoke('admin-users', { body });
  if (error) {
    let m = error.message;
    try {
      const j = await error.context.json();
      m = j.error || m;
    } catch {
      // the answer was not JSON: keep the transport message
    }
    throw new Error(m + (/not found|Failed to send/i.test(m) ? ' — is the admin-users function deployed?' : ''));
  }
  return data;
}
