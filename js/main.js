// Start-up: server settings, admin sign-in, the menu, and switching pages (also from #links).
import { fill, h, icon } from './dom.js';
import { brandBlock, mark, SCHOOL_NAME, TAGLINE } from './brand.js';
import { cache, errText, refreshCount, reload, router, setClient, ui, db } from './data.js';
import { DEFS, NAV, SPECIAL_VIEWS } from './defs.js';
import { crudView } from './views/crud.js';
import { fixturesView } from './views/fixtures.js';
import { importView } from './views/import.js';
import { loginsView } from './views/logins.js';
import { promotionView } from './views/promotion.js';
import { reportView } from './views/report.js';
import { resultsView } from './views/results.js';
import { settingsView } from './views/settings.js';
import { timetableView } from './views/timetable.js';

const CFG_KEY = 'attendance_cfg';
// Own storage key: the teacher web app on the same site must not replace the admin's sign-in
const SESSION_KEY = 'attendance-admin-session';
const STARTUP_TABLES = ['academic_years', 'classes', 'sections', 'subjects', 'teachers', 'teaching_assignments', 'timetable_slots'];

const VIEWS = {
  fixtures: fixturesView, logins: loginsView, import: importView, timetable: timetableView, settings: settingsView,
  promotion: promotionView, report: reportView, results: resultsView,
};
export const isView = (v) => !!DEFS[v] || SPECIAL_VIEWS.includes(v);

let app;
let createClient;
let main = null;
let listening = false; // the #link listener is added once

// ---- server settings ----------------------------------------------------------------------

/** The Supabase project URL must be https (http only for a server on this computer). */
export function serverUrlProblem(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'That is not a web address. It looks like https://xxxx.supabase.co';
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return 'The address must start with https://';
  return null;
}

function savedConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (c && typeof c.url === 'string' && typeof c.key === 'string' && !serverUrlProblem(c.url)) return c;
  } catch {
    // storage blocked or the saved value is damaged: fall back to config.js
  }
  return null;
}

function forgetConfig() {
  try {
    localStorage.removeItem(CFG_KEY);
  } catch {
    // storage blocked: nothing was saved
  }
}

function configView() {
  const url = h('input', { type: 'url', placeholder: 'https://xxxx.supabase.co', 'aria-label': 'Project URL' });
  const key = h('input', { placeholder: 'anon / publishable key', 'aria-label': 'Anon key' });
  const msg = h('p', { class: 'err', role: 'alert' });
  const go = () => {
    const u = url.value.trim().replace(/\/+$/, '');
    const k = key.value.trim();
    msg.textContent = !u || !k ? 'Enter both the project URL and the key.' : serverUrlProblem(u) || '';
    if (msg.textContent) return;
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({ url: u, key: k }));
    } catch {
      msg.textContent = 'This browser does not allow saving settings. Allow site data and try again.';
      return;
    }
    boot();
  };
  fill(app, h('div', { class: 'center' }, h('div', { class: 'card auth-card' }, brandBlock('Admin portal'),
    h('h2', {}, icon('server', 22), 'Connect to your server'),
    h('p', { class: 'muted' }, 'Find these in Supabase → Project Settings → API. They are saved in this browser only. Never use the service_role key here.'),
    h('label', { class: 'f' }, 'Project URL'), url,
    h('label', { class: 'f' }, 'Anon (public) key'), key, msg,
    h('p', {}, h('button', { class: 'primary', onclick: go }, 'Continue')))));
}

// ---- sign-in --------------------------------------------------------------------------------

function loginView(message) {
  const email = h('input', { type: 'email', autocomplete: 'username', maxlength: 254, 'aria-label': 'Email' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', maxlength: 72, 'aria-label': 'Password' });
  const msg = h('p', { class: 'err', role: 'alert' }, message || '');
  const btn = h('button', { class: 'primary', onclick: () => go() }, 'Sign in');
  async function go() {
    msg.textContent = '';
    if (!email.value.trim() || !pw.value) {
      msg.textContent = 'Enter your email and password.';
      return;
    }
    btn.disabled = true;
    try {
      const { error } = await db().auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
      if (error) {
        msg.textContent = /invalid login/i.test(error.message) ? 'Wrong email or password.' : error.message;
        return;
      }
      await boot();
    } catch (e) {
      msg.textContent = 'Could not reach the server: ' + errText(e);
    } finally {
      btn.disabled = false;
    }
  }
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  fill(app, h('div', { class: 'center' }, h('div', { class: 'card auth-card' }, brandBlock('Admin portal'),
    h('h2', {}, icon('key', 22), 'Admin sign in'),
    h('label', { class: 'f' }, 'Email'), email,
    h('label', { class: 'f' }, 'Password'), pw, msg,
    h('p', {}, btn, ' ',
      h('button', { class: 'link', onclick: () => { forgetConfig(); configView(); } }, 'Change server')))));
}

// ---- the menu and pages -------------------------------------------------------------------

function shell() {
  main = h('main');
  const nav = h('nav', {}, h('div', { class: 'nav-brand' }, h('span', { class: 'mark-badge' }, mark(30)),
    h('div', {}, h('div', { class: 'nav-school' }, SCHOOL_NAME), h('div', { class: 'nav-tagline' }, TAGLINE))),
    NAV.map(([group, items]) => [h('div', { class: 'group' }, group),
      items.map(([id, label, ic]) => h('button', { class: ui.view === id ? 'active' : '', 'aria-current': ui.view === id ? 'page' : null,
        onclick: () => router.go(id) }, icon(ic), label))]),
    h('div', { class: 'group' }, 'Account'),
    h('button', { onclick: signOut }, icon('logout'), 'Sign out'));
  fill(app, h('div', { class: 'layout' }, nav, main));
  return show();
}

async function show() {
  const target = main;
  fill(target, h('p', { class: 'muted' }, 'Loading…'));
  try {
    const v = ui.view;
    if (DEFS[v]) await crudView(target, v);
    else await VIEWS[v](target);
  } catch (e) {
    console.error(`[admin] ${ui.view}:`, e);
    fill(target, h('div', { class: 'card' }, h('p', { class: 'err' }, 'This page could not be loaded: ' + errText(e)),
      h('button', { onclick: () => router.render() }, 'Try again')));
  }
}

async function signOut() {
  await db().auth.signOut();
  for (const k of Object.keys(cache)) delete cache[k];
  boot();
}

function go(view) {
  if (!isView(view)) return;
  ui.view = view;
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  shell();
}

// ---- start --------------------------------------------------------------------------------

async function boot() {
  const cfg = savedConfig() || window.ATTENDANCE_CFG || null; // config.js next to this page presets the school's server
  if (!cfg) return configView();
  setClient(createClient(cfg.url, cfg.key, { auth: { storageKey: SESSION_KEY } }));
  const client = db();
  const { data } = await client.auth.getSession();
  if (!data.session) return loginView();
  const { data: isAdmin, error } = await client.rpc('is_admin');
  if (error || !isAdmin) {
    await client.auth.signOut();
    return loginView(error ? 'Could not check the account: ' + errText(error) : 'This account is not an admin.');
  }
  fill(app, h('p', { class: 'center muted' }, 'Loading school data…'));
  try {
    await Promise.all([reload(...STARTUP_TABLES), refreshCount('students')]);
  } catch (e) {
    console.error('[admin] start-up load failed:', e);
    fill(app, h('div', { class: 'center card' }, h('p', { class: 'err' }, 'Could not load data: ' + errText(e)),
      h('button', { onclick: boot }, 'Try again')));
    return;
  }
  // open a page straight from a link, e.g. …/#results (used by the app's "Results & marksheets")
  const wanted = location.hash.slice(1);
  if (isView(wanted)) ui.view = wanted;
  return shell();
}

/** Starts the panel in root. createClient is supabase.createClient (tests pass a fake). */
export function start({ root = document.getElementById('app'), clientFactory = window.supabase && window.supabase.createClient } = {}) {
  app = root;
  createClient = clientFactory;
  router.go = go;
  router.render = () => (main ? show() : Promise.resolve());
  main = null;
  if (!listening) {
    listening = true;
    window.addEventListener('hashchange', () => {
      const v = location.hash.slice(1);
      if (main && isView(v) && v !== ui.view) go(v);
    });
  }
  if (!createClient) {
    fill(app, h('p', { class: 'center err' }, 'Could not load the Supabase library. Check the internet connection and reload.'));
    return Promise.resolve();
  }
  return boot().catch((e) => {
    console.error('[admin] start failed:', e);
    fill(app, h('div', { class: 'center card' }, h('p', { class: 'err' }, 'Could not start: ' + errText(e)),
      h('button', { onclick: () => location.reload() }, 'Reload')));
  });
}
