// The school's name and logo. img/logo.svg (full logo) and img/logo-mark.svg ("IBA" in the swoosh) are the
// same files as the app's, made by scripts/brand/make_logo.py (a test checks the copies match).
import { h } from './dom.js';

export const SCHOOL_NAME = 'IBA Public School Ubauro';
export const TAGLINE = 'Attendance & Results';
export const LOGO_URL = 'img/logo.svg';
export const MARK_URL = 'img/logo-mark.svg';

/** Width ÷ height of the two drawings (their SVG view boxes). */
export const LOGO_ASPECT = 314 / 152;
export const MARK_ASPECT = 290 / 150;

/** The full logo, where it stands alone. */
export const logo = (height) => h('img', { src: LOGO_URL, alt: `${SCHOOL_NAME} logo`, height, class: 'logo' });

/** The compact mark, next to the written school name (so it needs no text of its own). */
export const mark = (height) => h('img', { src: MARK_URL, alt: '', height, class: 'mark' });

/** The logo and a small caption, e.g. on the sign-in card. */
export const brandBlock = (caption) => h('div', { class: 'brand' },
  logo(92),
  h('div', { class: 'brand-caption' }, caption));

/**
 * One of the drawings as a PNG data URL for the PDFs (jsPDF cannot draw SVG). Resolves to null when the
 * browser cannot draw it in time, so a PDF is still made, just without the logo.
 */
export function logoPng(url, aspect, heightPx = 240, timeoutMs = 3000) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(null), timeoutMs); // never hold up a download for the logo
    const img = document.createElement('img');
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.height = heightPx;
        canvas.width = Math.round(heightPx * aspect);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
