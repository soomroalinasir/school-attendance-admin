// Checking fields before they are sent, and explaining database refusals in plain words.
//
// A column definition is [key, label, type, opts]; the rules come from opts:
//   req            required
//   max            at most this many characters (the same limits the database enforces)
//   pattern / patternMsg   text must match (e.g. phone, email)
//   min / maxValue / int   number range, whole numbers only
import { errText } from './data.js';

/** A message when the value is not acceptable, else null. raw is the trimmed text or a boolean. */
export function fieldProblem(col, raw) {
  const [, label, type = 'text', opts = {}] = col;
  if (type === 'bool') return null;
  if (raw === '' || raw == null) return opts.req ? `${label} is required.` : null;
  const text = String(raw);
  if (opts.max && text.length > opts.max) return `${label} is too long (max ${opts.max} characters).`;
  if (opts.pattern && !opts.pattern.test(text)) return opts.patternMsg || `${label} has the wrong format.`;
  if (type === 'number') {
    const n = Number(text);
    if (!Number.isFinite(n)) return `${label} must be a number.`;
    if (opts.int && !Number.isInteger(n)) return `${label} must be a whole number.`;
    if (opts.min != null && n < opts.min) return `${label} must be at least ${opts.min}.`;
    if (opts.maxValue != null && n > opts.maxValue) return `${label} must be at most ${opts.maxValue}.`;
  }
  return null;
}

const humanize = (column) => column.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Plain text for a database error. Check constraints are named chk_<table>_<column>_<rule>
 * (see the input-validation migration); cols gives the field labels.
 */
export function describeDbError(error, table, cols = []) {
  const message = errText(error);
  const found = /\b(chk_[a-z0-9_]+)\b/.exec(`${message} ${(error && error.details) || ''}`);
  if (found) {
    const rule = /^chk_(.+)_(max(\d+)|blank|format|range)$/.exec(found[1]);
    if (rule) {
      const column = table && rule[1].startsWith(`${table}_`) ? rule[1].slice(table.length + 1) : rule[1];
      const label = (cols.find((c) => c[0] === column) || [])[1] || humanize(column);
      if (rule[3]) return `${label} is too long (max ${rule[3]} characters).`;
      if (rule[2] === 'blank') return `${label} cannot be empty.`;
      if (rule[2] === 'format') return `${label} has the wrong format.`;
      return `${label} is out of range.`;
    }
  }
  switch (error && error.code) {
    case '23505': return 'This already exists. Check for a duplicate name or number.';
    case '23503': return 'This is still used elsewhere (attendance, enrollments or timetable), so it cannot be changed this way.';
    case '42501': return 'Not allowed: this browser is not signed in as an admin any more. Use “Sign out” in the menu and sign in again with the admin account.';
    default: return message;
  }
}
