// The list / add / edit / delete page used by every setup table (DEFS in defs.js).
// Small tables are filtered in the browser; big ones (students, enrollments) are searched and paged
// on the server, so the page stays fast with tens of thousands of rows.
import { fill, h, icon, title } from '../dom.js';
import { cap } from '../format.js';
import { confirmBox, modal, toast } from '../ui.js';
import { DEFS, nextStepBanner } from '../defs.js';
import { describeDbError, fieldProblem } from '../validation.js';
import {
  activeYear, cache, counts, db, errText, fetchPage, isBig, LABEL, lab, options, PAGE_SIZE, refreshCount, reload,
  router, searchStudents, studentLabel, ui,
} from '../data.js';

const MAX_LISTED = 2000; // small tables: rows drawn at once
const SEARCH_DELAY_MS = 300; // big tables: wait for typing to pause before asking the server

const typeOf = (col) => col[2] || 'text';
const editable = (def) => def.cols.filter((c) => !(c[3] && c[3].ro));
const isRequired = (c) => !!(c[3] && c[3].req);

/** A cell's text: foreign keys show the referenced row's name. */
function fmt(col, row) {
  const [key, , type = 'text'] = col;
  const v = row[key];
  if (type === 'fk:students') return row.students ? studentLabel(row.students) : '';
  if (v == null || v === '') return '';
  if (type === 'bool') return v ? '✓' : '—';
  if (type.startsWith('fk:')) return lab(type.slice(3), v);
  if (type === 'time') return String(v).slice(0, 5);
  return String(v);
}

function cell(col, row) {
  const [key, , type = 'text'] = col;
  const v = row[key];
  if (type === 'bool') return h('span', { class: 'pill' + (v ? '' : ' off') }, v ? 'yes' : 'no');
  if (key === 'created_by_teacher_id') return v ? h('span', { class: 'pill' }, lab('teachers', v)) : '';
  return fmt(col, row);
}

// ---- where the rows come from -----------------------------------------------------------

function cachedSource(table, def) {
  return {
    paged: false,
    async load() {
      const fval = ui.filter[table] || '';
      const term = (ui.search[table] || '').trim().toLowerCase();
      let rows = cache[table];
      if (fval) rows = rows.filter((r) => r[def.filter] === fval);
      if (term) rows = rows.filter((r) => def.cols.some((c) => fmt(c, r).toLowerCase().includes(term)));
      return { rows: rows.slice(0, MAX_LISTED), matching: rows.length, total: cache[table].length };
    },
  };
}

function pagedSource(table, def) {
  return {
    paged: true,
    async load() {
      const { rows, total: matching } = await fetchPage(table, {
        filter: def.filter ? { column: def.filter, value: ui.filter[table] } : null,
        search: ui.search[table],
        page: ui.page[table] || 0,
      });
      return { rows, matching, total: counts[table] ?? matching };
    },
  };
}

// ---- the page ---------------------------------------------------------------------------

export async function crudView(main, table) {
  const def = DEFS[table];
  if (isBig(table)) await refreshCount(table);
  else await reload(table, ...(def.needs || []));
  const source = isBig(table) ? pagedSource(table, def) : cachedSource(table, def);

  const fcol = def.filter && def.cols.find((c) => c[0] === def.filter);
  if (fcol && ui.filter[table] === undefined) {
    const ay = activeYear();
    ui.filter[table] = def.filter === 'academic_year_id' ? (ay ? ay.id : '') : '';
  }

  const state = { rows: [], matching: 0, total: 0 };
  const selected = new Map(); // id → row (kept across pages)

  const searchInput = h('input', { type: 'search', placeholder: `Search ${def.title.toLowerCase()}…`, value: ui.search[table] || '', 'aria-label': 'Search' });
  const countLine = h('p', { class: 'muted', style: 'margin:0 0 8px' });
  const selCount = h('b');
  const selbar = h('div', { class: 'selbar', hidden: true }, selCount,
    h('button', { class: 'danger solid', onclick: () => removeRows(table, [...selected.values()]) }, icon('trash', 16), 'Delete selected'),
    h('button', { class: 'link', onclick: () => { selected.clear(); render(); } }, 'Clear selection'));
  const pickAll = h('input', { type: 'checkbox', title: 'Select all shown', 'aria-label': 'Select all shown' });
  const tbody = h('tbody');
  const prev = h('button', { 'aria-label': 'Previous page', onclick: () => turnPage(-1) }, icon('chevronLeft', 16), 'Previous');
  const next = h('button', { 'aria-label': 'Next page', onclick: () => turnPage(1) }, 'Next', icon('chevronRight', 16));
  const pageInfo = h('span', { class: 'muted' });
  const pager = source.paged && h('div', { class: 'pager' }, prev, pageInfo, next);
  const columns = def.cols.length + (def.extra ? 3 : 2);

  let latest = 0; // answers to older requests (slower than a newer search) are dropped
  async function refresh() {
    const mine = ++latest;
    let loaded;
    try {
      loaded = await source.load();
    } catch (e) {
      if (mine === latest) fill(tbody, h('tr', {}, h('td', { colspan: columns, class: 'err' }, describeDbError(e, table, def.cols))));
      return;
    }
    if (mine !== latest) return;
    // the last rows of the last page were deleted: show the page before it
    if (source.paged && !loaded.rows.length && loaded.matching > 0 && ui.page[table] > 0) {
      ui.page[table] = Math.floor((loaded.matching - 1) / PAGE_SIZE);
      await refresh();
      return;
    }
    Object.assign(state, loaded);
    render();
  }

  function turnPage(delta) {
    ui.page[table] = Math.max(0, (ui.page[table] || 0) + delta);
    refresh();
  }

  function render() {
    const { rows, matching, total } = state;
    const page = ui.page[table] || 0;
    if (source.paged) {
      const first = matching ? page * PAGE_SIZE + 1 : 0;
      const last = Math.min(matching, (page + 1) * PAGE_SIZE);
      countLine.textContent = matching === total
        ? `${total.toLocaleString()} ${total === 1 ? def.one : def.title.toLowerCase()}`
        : `${matching.toLocaleString()} of ${total.toLocaleString()} match`;
      pageInfo.textContent = matching ? `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${matching.toLocaleString()}` : '';
      prev.disabled = page === 0;
      next.disabled = last >= matching;
    } else {
      countLine.textContent = matching === total
        ? `${total} ${total === 1 ? def.one : def.title.toLowerCase()}`
        : `${matching} of ${total} shown` + (matching > rows.length ? ` — first ${rows.length} listed, refine the search` : '');
    }
    selbar.hidden = selected.size === 0;
    selCount.textContent = `${selected.size} selected`;
    pickAll.checked = rows.length > 0 && rows.every((r) => selected.has(r.id));

    if (!rows.length) {
      const nothingYet = total === 0;
      fill(tbody, h('tr', {}, h('td', { colspan: columns }, h('div', { class: 'empty' },
        icon(nothingYet ? 'inbox' : 'search', 40),
        h('p', {}, nothingYet ? `No ${def.title.toLowerCase()} yet.` : 'Nothing matches your search or filter.'),
        nothingYet
          ? h('button', { class: 'primary', onclick: () => editDialog(table, null) }, icon('plus', 16), `Add the first ${def.one}`)
          : h('button', { onclick: () => { ui.search[table] = ''; searchInput.value = ''; ui.page[table] = 0; refresh(); } }, icon('x', 16), 'Clear search')))));
      return;
    }
    fill(tbody, ...rows.map((r) => {
      const pick = h('input', { type: 'checkbox', checked: selected.has(r.id), 'aria-label': 'Select row' });
      pick.addEventListener('change', () => { pick.checked ? selected.set(r.id, r) : selected.delete(r.id); render(); });
      return h('tr', { class: selected.has(r.id) ? 'selected' : '', ondblclick: () => editDialog(table, r), title: 'Double-click to edit' },
        h('td', { class: 'pick' }, pick),
        def.cols.map((c) => h('td', {}, cell(c, r))),
        def.extra && h('td', {}, def.extra[1](r)),
        h('td', { class: 'row-actions' },
          h('button', { class: 'act', title: 'Edit', onclick: () => editDialog(table, r) }, icon('pencil', 16), h('span', {}, 'Edit')),
          h('button', { class: 'act danger', title: 'Delete', onclick: () => removeRows(table, [r]) }, icon('trash', 16), h('span', {}, 'Delete'))));
    }));
  }

  let searchTimer;
  searchInput.addEventListener('input', () => {
    ui.search[table] = searchInput.value;
    ui.page[table] = 0;
    clearTimeout(searchTimer);
    if (source.paged) searchTimer = setTimeout(refresh, SEARCH_DELAY_MS);
    else refresh();
  });
  pickAll.addEventListener('change', () => {
    for (const r of state.rows) pickAll.checked ? selected.set(r.id, r) : selected.delete(r.id);
    render();
  });

  const toolbar = h('div', { class: 'toolbar' }, title(def.title, def.icon),
    fcol && h('select', { value: ui.filter[table] || '', 'aria-label': 'Filter', onchange: (e) => {
      ui.filter[table] = e.target.value;
      ui.page[table] = 0;
      selected.clear();
      refresh();
    } },
    h('option', { value: '' }, `All ${fcol[1].toLowerCase()}s`),
    options(fcol[2].slice(3)).map((o) => h('option', { value: o.id }, o.label))),
    h('div', { class: 'search' }, icon('search', 16), searchInput),
    h('button', { class: 'primary', onclick: () => editDialog(table, null) }, icon('plus', 16), `Add ${def.one}`));

  fill(main, toolbar, def.help && h('p', { class: 'help' }, def.help), nextStepBanner(table), countLine, selbar,
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { class: 'pick' }, pickAll), def.cols.map((c) => h('th', {}, c[1])),
        def.extra && h('th', {}, def.extra[0]), h('th', {}))),
      tbody)),
    pager);
  await refresh();
}

// ---- form controls ----------------------------------------------------------------------
// Every field is a control: { node, read() → raw value, focus(), setInvalid(bool), reset(), keep, empty }
// keep: the value stays for "Save & add another"; empty: a pick-list with nothing to choose.

function checkboxControl(key, value) {
  const el = h('input', { type: 'checkbox', name: key, checked: !!value });
  return { node: el, read: () => el.checked, focus: () => el.focus(), setInvalid: () => {}, reset: () => {}, keep: true };
}

function selectControl(key, value, choices) {
  const el = h('select', { name: key, value: value ?? '' }, h('option', { value: '' }, '— choose —'),
    choices.map((o) => h('option', { value: o.id }, o.label)));
  return {
    node: el, read: () => el.value, focus: () => el.focus(), setInvalid: (b) => el.classList.toggle('invalid', b),
    reset: () => {}, keep: true, empty: choices.length === 0,
  };
}

function inputControl(col, value) {
  const [key, , type = 'text', opts = {}] = col;
  const htmlType = { number: 'number', date: 'date', time: 'time' }[type] || 'text';
  const el = h('input', {
    type: htmlType, name: key, placeholder: opts.ph || null, maxlength: opts.max || null,
    value: value == null ? '' : (type === 'time' ? String(value).slice(0, 5) : value),
  });
  return {
    node: el, read: () => el.value.trim(), focus: () => el.focus(), setInvalid: (b) => el.classList.toggle('invalid', b),
    // roll numbers count up when adding a list; other text starts empty
    reset: () => { el.value = key === 'roll_no' && el.value ? String(Number(el.value) + 1) : ''; },
    keep: false,
  };
}

/** Type-to-search student field: never loads the whole student list. */
function studentPickerControl(key, value, student) {
  let selectedId = value || '';
  const input = h('input', { type: 'search', name: key, autocomplete: 'off', placeholder: 'Type a name or admission no.',
    value: student ? studentLabel(student) : '', 'aria-label': 'Student' });
  const list = h('div', { class: 'picker-list', role: 'listbox', hidden: true });
  let timer;
  let latest = 0; // a slow answer to older text must not replace the newer one
  async function search() {
    const mine = ++latest;
    try {
      const found = await searchStudents(input.value);
      if (mine !== latest) return;
      fill(list, found.length
        ? found.map((s) => h('button', { type: 'button', class: 'picker-item', role: 'option', onclick: () => {
          selectedId = s.id;
          input.value = studentLabel(s);
          list.hidden = true;
        } }, studentLabel(s)))
        : h('div', { class: 'muted picker-none' }, 'No student matches.'));
    } catch (e) {
      if (mine !== latest) return;
      fill(list, h('div', { class: 'err picker-none' }, errText(e)));
    }
    list.hidden = !input.value.trim();
  }
  input.addEventListener('input', () => {
    selectedId = '';
    clearTimeout(timer);
    timer = setTimeout(search, SEARCH_DELAY_MS);
  });
  return {
    node: h('div', { class: 'picker' }, input, list),
    read: () => selectedId, focus: () => input.focus(), setInvalid: (b) => input.classList.toggle('invalid', b),
    reset: () => { selectedId = ''; input.value = ''; list.hidden = true; },
    keep: false, requiredMsg: 'Type part of the name, then pick the student from the list.',
  };
}

function controlFor(col, value, row) {
  const [key, , type = 'text'] = col;
  if (type === 'bool') return checkboxControl(key, value);
  if (type === 'fk:students') return studentPickerControl(key, value, row && row.students);
  if (type.startsWith('select:')) return selectControl(key, value, type.slice(7).split(',').map((o) => ({ id: o, label: o })));
  if (type.startsWith('fk:')) {
    const t = type.slice(3);
    const ay = activeYear();
    const filt = t === 'sections' ? (r) => !ay || r.academic_year_id === ay.id || r.id === value : null;
    return selectControl(key, value, options(t, filt));
  }
  return inputControl(col, value);
}

// ---- add / edit dialog --------------------------------------------------------------------

export function editDialog(table, row) {
  const def = DEFS[table];
  const cols = editable(def);
  const defaults = () => {
    const d = {};
    const ay = activeYear();
    if (ay && cols.some((c) => c[0] === 'academic_year_id')) d.academic_year_id = ay.id;
    if (def.filter && ui.filter[table]) d[def.filter] = ui.filter[table];
    if (cols.some((c) => c[0] === 'is_active') && table !== 'academic_years') d.is_active = true;
    if (table === 'enrollments') d.status = 'active';
    if (table === 'holidays') d.scope = 'school';
    return d;
  };
  let added = 0;

  modal((close) => {
    const start = row || defaults();
    const fields = cols.map((c) => {
      const control = controlFor(c, start[c[0]], row);
      const errEl = h('div', { class: 'field-err' });
      const opts = c[3] || {};
      const label = typeOf(c) === 'bool'
        ? h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center;font-weight:normal' }, control.node, c[1])
        : [h('label', { class: 'f' }, c[1], isRequired(c) && h('span', { class: 'req', title: 'Required' }, '*')), control.node];
      // an empty pick-list (e.g. no academic year yet): say so and offer to go and add one
      const fkTable = typeOf(c).startsWith('fk:') && typeOf(c).slice(3);
      const need = control.empty && fkTable && DEFS[fkTable] && h('div', { class: 'need' }, icon('alert', 16),
        `No ${DEFS[fkTable].title.toLowerCase()} yet.`,
        h('button', { class: 'link', onclick: () => { close(false); router.go(fkTable); } }, `Add ${DEFS[fkTable].one} first →`));
      return { c, control, errEl, node: [label, opts.hint && h('div', { class: 'hint' }, opts.hint), need, errEl] };
    });
    const msg = h('p', { class: 'err', role: 'alert' });
    const progress = h('p', { class: 'ok', style: 'margin:8px 0 0' });
    const closeBtn = h('button', { onclick: () => close(added > 0) }, 'Cancel');

    /** The row to save, or null (with each problem shown under its field). */
    const read = () => {
      const obj = {};
      let firstBad = null;
      for (const f of fields) {
        const [key, , type = 'text'] = f.c;
        const raw = f.control.read();
        let problem = fieldProblem(f.c, raw);
        if (problem && raw === '' && f.control.requiredMsg) problem = f.control.requiredMsg;
        f.control.setInvalid(!!problem);
        f.errEl.textContent = problem || '';
        if (problem && !firstBad) firstBad = f;
        obj[key] = type === 'bool' ? raw : raw === '' ? null : type === 'number' ? Number(raw) : raw;
      }
      if (firstBad) firstBad.control.focus();
      return firstBad ? null : obj;
    };

    const save = async (again) => {
      msg.textContent = '';
      const obj = read();
      if (!obj) return;
      try {
        const client = db();
        if (table === 'academic_years' && obj.is_active) {
          const { error } = await client.from('academic_years').update({ is_active: false })
            .neq('id', row ? row.id : '00000000-0000-0000-0000-000000000000').eq('is_active', true);
          if (error) throw error;
        }
        const { error } = row ? await client.from(table).update(obj).eq('id', row.id) : await client.from(table).insert(obj);
        if (error) throw error;
        if (!isBig(table)) await reload(table);
        if (again) {
          added++;
          for (const f of fields) if (!f.control.keep) f.control.reset();
          progress.textContent = `Saved ${added} so far. Add the next one.`;
          closeBtn.textContent = 'Done';
          const first = fields.find((f) => typeOf(f.c) !== 'bool');
          if (first) first.control.focus();
          return;
        }
        close(true);
      } catch (e) {
        msg.textContent = describeDbError(e, table, def.cols);
      }
    };

    for (const f of fields) {
      if (f.control.node.tagName === 'INPUT') {
        f.control.node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(false); } });
      }
    }
    return [
      h('h3', {}, icon(row ? 'pencil' : 'plus', 20), (row ? 'Edit ' : 'Add ') + def.one),
      h('p', { class: 'muted', style: 'margin:0' }, 'Fields marked * are required. Press Enter to save.'),
      fields.map((f) => f.node), progress, msg,
      h('div', { class: 'dlg-actions' },
        closeBtn,
        !row && h('button', { onclick: () => save(true) }, icon('plus', 16), 'Save & add another'),
        h('button', { class: 'primary', onclick: () => save(false) }, icon('check', 16), 'Save')),
    ];
  }).then((changed) => {
    if (changed || added) {
      toast(row ? `${cap(def.one)} updated.` : added > 1 ? `${added} ${def.title.toLowerCase()} added.` : `${cap(def.one)} added.`);
      router.render();
    }
  });
}

// ---- delete -----------------------------------------------------------------------------

const DELETE_CHUNK = 200; // ids per delete request (keeps the request URL short)

export async function removeRows(table, rows) {
  const def = DEFS[table];
  if (!rows.length) return;
  const one = rows.length === 1;
  const ok = await confirmBox({
    title: one ? `Delete ${LABEL[table] ? LABEL[table](rows[0]) : 'this ' + def.one}?` : `Delete ${rows.length} ${def.title.toLowerCase()}?`,
    body: 'This cannot be undone.' + (def.cols.some((c) => c[0] === 'is_active') ? ' To keep history, edit and untick “Active” instead.' : ''),
  });
  if (!ok) return;
  const client = db();
  let deleted = 0;
  const inUse = [];
  const failed = [];
  for (let i = 0; i < rows.length; i += DELETE_CHUNK) {
    const chunk = rows.slice(i, i + DELETE_CHUNK);
    // one request per chunk; if something is still referenced, go row by row to find out which
    const { error } = await client.from(table).delete().in('id', chunk.map((r) => r.id));
    if (!error) {
      deleted += chunk.length;
      continue;
    }
    for (const r of chunk) {
      const { error: e } = await client.from(table).delete().eq('id', r.id);
      if (!e) deleted++;
      else if (e.code === '23503') inUse.push(r);
      else failed.push(describeDbError(e, table, def.cols));
    }
  }
  if (!isBig(table)) await reload(table);
  if (deleted) toast(one ? `${cap(def.one)} deleted.` : `${deleted} deleted.`);
  if (inUse.length) {
    const who = one ? 'It is' : `${inUse.length} ${inUse.length === 1 ? 'is' : 'are'}`;
    toast(`${who} still used elsewhere (attendance, enrollments or timetable), so not deleted.` +
      (def.cols.some((c) => c[0] === 'is_active') ? ' Mark them inactive instead.' : ''), 'err');
  }
  if (failed.length) toast(failed[0], 'err');
  router.render();
}
