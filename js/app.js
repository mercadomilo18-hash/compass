import * as Store from './store.js';
import { icon, modal, field, toast, formValues, closeModal } from './ui.js';
import { $ } from './util.js';
import { openEvent, openTask, toggleTask, toggleSubtask } from './forms.js';
import { checkReminders } from './notify.js';
import * as Connect from './connect.js';
import { scanFlow } from './scan.js';
import { rollGoals } from './views/habits.js';
import today from './views/today.js';
import calendar from './views/calendar.js';
import tasks from './views/tasks.js';
import habits from './views/habits.js';
import bible from './views/bible.js';
import chat from './views/chat.js';
import settings from './views/settings.js';
import money from './views/money.js';

const VIEWS = { today, calendar, tasks, money, habits, bible, chat, settings };
// Phone tab bar holds six; Goals lives in the top bar there and in the sidebar on desktop.
const NAV = [['today', 'today', 'Today'], ['calendar', 'calendar', 'Calendar'], ['tasks', 'tasks', 'School'], ['money', 'money', 'Money'], ['bible', 'bible', 'Bible'], ['chat', 'chat', 'Assistant']];

// Actions available on every screen.
const shared = {
  editEvent: (el) => { const ev = Store.state.events.find((x) => x.id === el.dataset.id); if (ev) openEvent(ev); },
  editTask: (el) => { const t = Store.state.tasks.find((x) => x.id === el.dataset.id); if (t) openTask(t); },
  toggleTask: (el) => toggleTask(el.dataset.id),
  toggleSub: (el) => toggleSubtask(el.dataset.task, el.dataset.id),
  lock: async () => { if (await Store.lock()) showLock(); },
  scanPhoto: () => scanFlow(),
};

const route = () => { const r = location.hash.slice(1).split('?')[0]; return VIEWS[r] ? r : 'today'; };

// Back from a Google/Microsoft sign-in: #settings?connected=google or ?error=…
function handleReturnParams() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (!q.size) return;
  if (q.get('connected')) { toast(`${q.get('connected')} connected — syncing…`); Connect.sync(); }
  if (q.get('error')) toast(`Couldn’t connect: ${q.get('error')}`, 7000);
  history.replaceState(null, '', `#${route()}`);
}

function applyTheme() {
  const t = Store.state?.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function renderNav() {
  const cur = route();
  const links = NAV.map(([id, ic, label]) => `<a href="#${id}" class="${cur === id ? 'on' : ''}" ${cur === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('');
  $('#tabbar').innerHTML = links;
  $('#sidebar').innerHTML = `<div class="brand">${icon('today', 20)} Compass</div>${links}
    <a href="#habits" class="${cur === 'habits' ? 'on' : ''}">${icon('habits')}<span>Goals &amp; habits</span></a>
    <span class="grow"></span><a href="#settings" class="${cur === 'settings' ? 'on' : ''}">${icon('settings')}<span>Settings</span></a>
    ${Store.hasPasscode() ? `<button class="navbtn" data-act="lock">${icon('lock')}<span>Lock</span></button>` : ''}`;
}

export function render() {
  if (!Store.state) return;
  applyTheme();
  renderNav();
  const view = VIEWS[route()];
  const main = $('#main');
  const active = document.activeElement?.dataset?.input;
  const caret = document.activeElement?.selectionStart;
  const scroll = main.scrollTop;
  main.innerHTML = `<div class="topbar">
      <a href="#habits" class="icon-btn" aria-label="Goals and habits">${icon('habits')}</a>
      <a href="#settings" class="icon-btn" aria-label="Settings">${icon('settings')}</a>
      ${Store.hasPasscode() ? `<button class="icon-btn" data-act="lock" aria-label="Lock">${icon('lock')}</button>` : ''}
    </div>${view.render({ rerender: render })}`;
  main.scrollTop = scroll;
  if (active) {
    const el = main.querySelector(`[data-input="${active}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* not a text input */ } }
  }
  view.after?.();
  document.title = `${view.title} · Compass`;
}

function bindEvents() {
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-stop]')) return;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const view = VIEWS[route()];
    const fn = view.act?.[el.dataset.act] || shared[el.dataset.act];
    if (!fn) return;
    if (el.tagName !== 'INPUT') e.preventDefault();
    await fn(el, e);
    if (view.act?.[el.dataset.act] && Store.state) render();
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (!el || !$('#main').contains(el)) return;
    const fn = VIEWS[route()].input?.[el.dataset.input];
    if (fn?.(el)) render();
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    VIEWS[route()].forms?.[form.dataset.form]?.(formValues(form), form);
  });
  window.addEventListener('hashchange', () => { closeModal(); handleReturnParams(); render(); window.scrollTo(0, 0); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { hiddenAt = Date.now(); Store.flush(); return; }
    if (!Store.state) return;
    const mins = (Date.now() - hiddenAt) / 60000;
    if (hiddenAt && Store.hasPasscode() && mins >= Store.state.settings.autoLockMin) { if (await Store.lock()) showLock(); return; }
    if (rollGoals(Store.state)) Store.save();
    checkReminders();
    maybeSync();
    render();
  });
  window.addEventListener('pagehide', () => Store.flush());
}

function showLock() {
  closeModal();
  $('#tabbar').innerHTML = ''; $('#sidebar').innerHTML = '';
  if (Store.vaultDamaged()) {
    $('#main').innerHTML = `<div class="lock">
      <div class="lock-icon">${icon('lock', 36)}</div>
      <h1>This saved data can’t be opened</h1>
      <p>An earlier version of Compass had a bug that damaged the lock when it auto-locked, so even the right passcode won’t open it. Sorry about that — it’s fixed now.</p>
      <p class="muted small">Reset to start fresh (and restore a backup if you made one). Your new passcode will work reliably.</p>
      <button class="btn primary" id="reset-app">Reset and start fresh</button></div>`;
    $('#reset-app').addEventListener('click', () => { Store.wipe(); Store.flush().then(() => location.reload()); });
    return;
  }
  $('#main').innerHTML = `<form class="lock" id="lock-form">
    <div class="lock-icon">${icon('lock', 36)}</div>
    <h1>Compass is locked</h1>
    <input type="password" name="pass" inputmode="numeric" autocomplete="current-password" placeholder="Passcode" aria-label="Passcode" autofocus>
    <button class="btn primary">Unlock</button>
    <p class="muted small">Forgot it? Data is encrypted and can’t be recovered without it. You can restore a backup after resetting.</p>
    <button type="button" class="link" id="reset-app">Reset app</button>
  </form>`;
  const form = $('#lock-form');
  setTimeout(() => form.pass.focus(), 50);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.btn'); btn.disabled = true; btn.textContent = 'Unlocking…';
    if (await Store.unlock(form.pass.value)) start();
    else { toast('Wrong passcode'); form.pass.value = ''; btn.disabled = false; btn.textContent = 'Unlock'; }
  });
  $('#reset-app').addEventListener('click', () => {
    if (confirm('Erase all Compass data on this device? This cannot be undone.')) { Store.wipe(); location.reload(); }
  });
}

function onboarding() {
  modal({
    title: 'Welcome to Compass',
    body: `<p>Your schedule, school work, goals and Bible reading in one place. Everything is stored privately on this device.</p>
      ${field('What should I call you?', '<input name="name" autofocus autocomplete="given-name">')}
      ${field('Passcode (recommended)', '<input type="password" name="pass" inputmode="numeric" autocomplete="new-password" placeholder="6+ characters">', 'Encrypts your data and locks the app. Can’t be recovered if forgotten.')}
      <p class="muted small">Next: add your classes in Calendar (set them to repeat weekly), import your Canvas calendar in Settings, and add your Claude key for the AI assistant.</p>`,
    submit: 'Get started',
    onSubmit: async (v) => {
      if (v.pass && v.pass.length < 6) { toast('Passcode needs 6+ characters'); return false; }
      Store.update((s) => { s.settings.name = v.name; s.settings.onboarded = true; });
      if (v.pass) await Store.setPasscode(v.pass);
      render();
    },
  });
}

let subscribed = false;
function start() {
  if (!subscribed) { Store.subscribe(render); subscribed = true; }
  if (rollGoals(Store.state)) Store.save();
  render();
  if (!Store.state.settings.onboarded) onboarding();
  handleReturnParams();
  checkReminders();
  maybeSync();
}

const SYNC_EVERY = 30 * 60000;
function maybeSync() {
  const last = Math.max(0, ...Object.values(Store.state?.meta.sync || {}).map((d) => Date.parse(d) || 0));
  if (Store.state && Connect.isPaired() && Date.now() - last > 5 * 60000) Connect.sync();
}

let started = false;
let lastTickSync = Date.now();
const tick = () => {
  if (!Store.state) return;
  checkReminders();
  if (Date.now() - lastTickSync > SYNC_EVERY) { lastTickSync = Date.now(); Connect.sync(); }
};

function boot() {
  if (!started) { bindEvents(); setInterval(tick, 60000); started = true; }
  // Offline cache only on the real site; on localhost it would serve stale files while developing.
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  navigator.storage?.persist?.();
  if (Store.load() === 'locked') showLock();
  else start();
}

boot();
