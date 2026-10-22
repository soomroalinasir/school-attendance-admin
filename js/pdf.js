// PDF documents: the daily attendance report and student marksheets.
// The builders take the jsPDF class (with the autoTable plugin) and return the document, so tests can
// run them in Node; the download functions load the library from the CDN once and save the file.
import { h } from './dom.js';
import { num, prettyDate, roll, timeOf } from './format.js';
import { LOGO_ASPECT, LOGO_URL, logoPng, MARK_ASPECT, MARK_URL, SCHOOL_NAME } from './brand.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
const BLUE = [47, 37, 201];
const GOLD = [212, 175, 55];
const DASH = '-'; // the PDF's built-in font has no long dash

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = h('script', { src });
    el.onload = resolve;
    el.onerror = () => reject(new Error('Could not load the PDF tool. Check the internet connection.'));
    document.head.append(el);
  });
}

async function loadJsPdf() {
  await loadScript(JSPDF_URL);
  await loadScript(AUTOTABLE_URL);
  return window.jspdf.jsPDF;
}

/** A file name without characters that file systems reject. */
export const safeFileName = (name, fallback) => String(name).replace(/[^\w\- ]+/g, '').trim() || fallback;

const pctText = (v) => (v == null ? DASH : `${v}%`);

// ---- daily report -----------------------------------------------------------------------

/** Landscape A4: totals, class-wise counts with absent names, bunks, submitted and missing periods.
 * mark: the logo mark as a PNG data URL, drawn beside the school name (null leaves it out). */
export function buildDailyReport(JsPdf, d, mark = null) {
  const doc = new JsPdf({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const s = d.sum;
  const school = d.school || SCHOOL_NAME;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const markHeight = 46;
  const textX = mark ? 40 + markHeight * MARK_ASPECT + 12 : 40;

  if (mark) doc.addImage(mark, 'PNG', 40, 26, markHeight * MARK_ASPECT, markHeight);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BLUE);
  doc.text(school, textX, 44);
  doc.setFontSize(12);
  doc.setTextColor(40);
  doc.text('Daily attendance report: ' + prettyDate(d.date), textX, 62);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text('Generated ' + new Date().toLocaleString('en-GB') + '. Day attendance comes from the first period.', textX, 76);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.5);
  doc.line(40, 84, W - 40, 84);
  if (s.holiday) {
    doc.setTextColor(180, 90, 0);
    doc.text('This day is a school holiday.', W - 40, 46, { align: 'right' });
  }

  const table = (opts) => doc.autoTable({
    theme: 'grid', margin: { left: 40, right: 40 },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [245, 248, 247] },
    ...opts,
  });
  const after = () => doc.lastAutoTable.finalY;
  const heading = (text, y) => {
    if (y > H - 80) {
      doc.addPage();
      y = 50;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(40);
    doc.text(text, 40, y);
    return y + 6;
  };
  const sectionName = (x) => `${x.class_name} ${x.section_name}`;

  table({ startY: 92, head: [['Students', 'Present', 'Absent', 'On leave', 'Left later periods', 'Attendance', 'Periods taken']],
    body: [[s.total_students, s.students_present_day, s.students_absent_day, s.students_leave_day, s.bunk_students,
      pctText(s.present_pct), `${s.submitted_periods} / ${s.scheduled_periods}`]],
    styles: { fontSize: 11, halign: 'center', cellPadding: 6 } });

  table({ startY: heading('Class-wise', after() + 24),
    head: [['Class', 'Students', 'Present', 'Absent', 'Leave', '%', 'Periods', 'Absent students']],
    body: d.classes.length
      ? d.classes.map((c) => [sectionName(c), c.students, c.present_students, c.absent_students,
        c.leave_students, pctText(c.present_pct), `${c.submitted}/${c.scheduled}`, c.absent_list.map(roll).join(', ') || DASH])
      : [[{ content: 'No sections in the active year.', colSpan: 8 }]],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 1: { halign: 'center', cellWidth: 52 }, 2: { halign: 'center', cellWidth: 48 },
      3: { halign: 'center', cellWidth: 48 }, 4: { halign: 'center', cellWidth: 42 }, 5: { halign: 'center', cellWidth: 44 },
      6: { halign: 'center', cellWidth: 52 } } });

  const bunks = d.classes.flatMap((c) => c.bunk_list.map((b) => [sectionName(c), roll(b),
    b.periods.map((p) => `P${p.period_no} ${p.subject}`).join(', ')]));
  if (bunks.length) {
    table({ startY: heading('Left later periods (present in first period, absent later)', after() + 24),
      head: [['Class', 'Student', 'Missed periods']], body: bunks, columnStyles: { 0: { cellWidth: 90 } } });
  }

  table({ startY: heading(`Attendance submitted (${d.submitted.length})`, after() + 24),
    head: [['Class', 'Period', 'Subject', 'Submitted by', 'At', 'P / A / L / LV']],
    body: d.submitted.length
      ? d.submitted.map((x) => [sectionName(x), `P${x.period_no}`, x.subject_name,
        x.submitted_by + (x.extra_period ? ' (extra period)' : x.submitted_by !== x.timetable_teacher ? ` (for ${x.timetable_teacher})` : ''),
        timeOf(x.submitted_at), `${x.present} / ${x.absent} / ${x.late} / ${x.on_leave}`])
      : [[{ content: 'No attendance submitted for this day yet.', colSpan: 6 }]],
    columnStyles: { 0: { cellWidth: 90 } } });

  table({ startY: heading(`Attendance not taken (${d.missing.length})`, after() + 24),
    head: [['Class', 'Period', 'Subject', 'Teacher', 'Phone']],
    body: d.missing.length
      ? d.missing.map((m) => [sectionName(m), `P${m.period_no} (${String(m.start_time).slice(0, 5)})`,
        m.subject_name, m.teacher_name || DASH, m.teacher_phone || DASH])
      : [[{ content: 'Every scheduled period has attendance.', colSpan: 5 }]],
    columnStyles: { 0: { cellWidth: 90 } } });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`${school}  |  ${d.date}  |  page ${i} of ${pages}`, W / 2, H - 20, { align: 'center' });
  }
  return doc;
}

export async function downloadDailyReport(d) {
  const [JsPdf, mark] = await Promise.all([loadJsPdf(), logoPng(MARK_URL, MARK_ASPECT)]);
  buildDailyReport(JsPdf, d, mark).save(`attendance-report-${d.date}.pdf`);
}

// ---- marksheets -------------------------------------------------------------------------

/** One A4 page per student with marks: the school's logo (or its name when logo is null), student details,
 * subject table, percentage, signatures. logo: the full logo as a PNG data URL. */
export function buildMarksheets(JsPdf, data, logo = null) {
  const sheets = data.sheets.filter((s) => s.subjects.length);
  if (!sheets.length) throw new Error('No marks entered for this selection yet.');
  const doc = new JsPdf({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const bold = (content) => ({ content, styles: { fontStyle: 'bold' } });

  sheets.forEach((sh, i) => {
    if (i) doc.addPage();
    doc.setFillColor(...BLUE);
    doc.rect(0, 0, W, 8, 'F');
    doc.setFillColor(...GOLD);
    doc.rect(0, 8, W, 2, 'F');
    doc.setFont('helvetica', 'bold');
    if (logo) {
      const logoHeight = 68;
      doc.addImage(logo, 'PNG', (W - logoHeight * LOGO_ASPECT) / 2, 22, logoHeight * LOGO_ASPECT, logoHeight);
    } else {
      doc.setFontSize(20);
      doc.setTextColor(...BLUE);
      doc.text(data.school_name || SCHOOL_NAME, W / 2, 62, { align: 'center' });
    }
    doc.setFontSize(13);
    doc.setTextColor(40);
    doc.text(`Marksheet: ${data.name}`, W / 2, 110, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(`Academic year ${data.year}`, W / 2, 126, { align: 'center' });

    const st = sh.student;
    doc.autoTable({
      startY: 140, theme: 'plain', margin: { left: 50, right: 50 }, styles: { fontSize: 11, cellPadding: 3 },
      body: [
        [bold('Student'), st.full_name, bold('Admission no.'), st.admission_no || DASH],
        [bold('Class'), `${st.class_name || DASH} ${st.section_name || ''}`, bold('Roll no.'), st.roll_no ?? DASH],
      ],
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14, theme: 'grid', margin: { left: 50, right: 50 },
      headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 10.5, cellPadding: 6 },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' } },
      head: [['Subject', 'Total marks', 'Obtained', 'Percentage', 'Remarks']],
      body: sh.subjects.map((x) => [x.subject, num(x.max_marks), x.absent ? 'Absent' : num(x.obtained), pctText(x.pct), x.remarks || '']),
      foot: [['Total', num(sh.total_max), num(sh.total_obtained), pctText(sh.pct), '']],
      footStyles: { fillColor: [236, 235, 253], textColor: 30, fontStyle: 'bold', halign: 'center' },
    });
    const y = doc.lastAutoTable.finalY + 30;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...BLUE);
    doc.text(`Overall percentage: ${pctText(sh.pct)}`, 50, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.line(50, H - 110, 210, H - 110);
    doc.text('Class teacher', 50, H - 96);
    doc.line(W - 210, H - 110, W - 50, H - 110);
    doc.text('Principal', W - 210, H - 96);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Generated ${new Date().toLocaleDateString('en-GB')}  |  page ${i + 1} of ${sheets.length}`, W / 2, H - 30, { align: 'center' });
  });
  return doc;
}

export async function downloadMarksheets(data, fileName) {
  const [JsPdf, logo] = await Promise.all([loadJsPdf(), logoPng(LOGO_URL, LOGO_ASPECT)]);
  buildMarksheets(JsPdf, data, logo).save(`${safeFileName(fileName, 'marksheet')}.pdf`);
}
