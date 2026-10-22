// Shared UI pieces: toast messages and dialogs.
import { h, icon } from './dom.js';

/** Short message at the bottom of the screen. kind 'err' stays longer and is red. */
export function toast(text, kind = 'ok') {
  const t = h('div', { class: 'toast' + (kind === 'err' ? ' err' : ''), role: kind === 'err' ? 'alert' : 'status' },
    icon(kind === 'err' ? 'alert' : 'check'), h('span', {}, text));
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 2600);
}

/** Modal dialog built by build(close); resolves with the value passed to close(), or null when dismissed. */
export function modal(build) {
  return new Promise((resolve) => {
    let result = null;
    const dlg = h('dialog');
    const close = (v) => { result = v; dlg.close(); };
    dlg.append(...[build(close)].flat(Infinity).filter((x) => x != null && x !== false));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=checkbox]), select, textarea');
    if (first) first.focus();
  });
}

/** Yes/no question. Resolves true only when confirmed. */
export const confirmBox = ({ title, body, ok = 'Delete', danger = true }) => modal((close) => [
  h('h3', {}, icon(danger ? 'trash' : 'alert', 20), title),
  body && h('p', { class: 'muted' }, body),
  h('div', { class: 'dlg-actions' },
    h('button', { onclick: () => close(false) }, 'Cancel'),
    h('button', { class: danger ? 'danger solid' : 'primary', onclick: () => close(true) }, ok)),
]).then((v) => v === true);

/** Asks for one value. Resolves with the text, or null when cancelled. */
export const promptBox = ({ title, label, type = 'text', ok = 'Save' }) => modal((close) => {
  const input = h('input', { type, style: 'width:100%' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); });
  return [h('h3', {}, title), h('label', { class: 'f' }, label), input,
    h('div', { class: 'dlg-actions' },
      h('button', { onclick: () => close(null) }, 'Cancel'),
      h('button', { class: 'primary', onclick: () => close(input.value) }, ok))];
});

/** A number tile on the report pages. */
export const kpi = (label, value, cls = '') => h('div', { class: 'kpi ' + cls }, h('b', {}, value), h('span', {}, label));
