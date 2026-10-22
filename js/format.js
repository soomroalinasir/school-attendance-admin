// Small formatting helpers shared by the pages and the PDFs.

export const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A Date as YYYY-MM-DD in local time. */
export const ymdOf = (d) => {
  const t = new Date(d);
  t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
  return t.toISOString().slice(0, 10);
};
export const todayYmd = () => ymdOf(new Date());
export const prettyDate = (ymd) =>
  new Date(ymd + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const timeOf = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
export const hhmm = (t) => String(t).slice(0, 5);

export const pct = (v) => (v == null ? '–' : `${v}%`);
export const num = (v) => (v == null ? '' : String(Number(v)));
/** "4. Ali Raza" when there is a roll number. */
export const roll = (s) => (s.roll_no != null ? `${s.roll_no}. ` : '') + s.full_name;
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
