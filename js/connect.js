// Talks to your own Compass server (server/ folder) for live, read-only data:
// Gmail / Outlook, Google & Outlook calendars, Canvas, Plaid banking and push notifications.

import { state, update, logAction } from './store.js';
import { categorize } from './finance.js';
import { matchCourse } from './school.js';
import { toLocalInput, dayKey, uid } from './util.js';

export const isPaired = () => !!(state.settings.serverUrl && state.settings.serverToken);

async function api(path, { method = 'GET', body } = {}) {
  const base = state.settings.serverUrl.replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${state.settings.serverToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Can’t reach your Compass server. Check the address and your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('The server rejected the pairing token.');
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

export const serverStatus = () => api('/status');

export async function startOAuth(provider) {
  const { url } = await api(`/oauth/${provider}/start`, { method: 'POST' });
  location.href = url; // returns to #settings?connected=… or ?error=…
}

export const connectCanvas = (baseUrl, token) => api('/canvas', { method: 'POST', body: { baseUrl, token } });
export const disconnect = (provider) => api(`/connections/${provider}`, { method: 'DELETE' });
export const deleteServerData = () => api('/all', { method: 'DELETE' });
export const testPush = () => api('/push/test', { method: 'POST' });

// Plaid Link runs in Plaid’s own secure window; Compass never sees your bank password.
export async function connectBank() {
  const { link_token } = await api('/plaid/link-token', { method: 'POST' });
  if (!window.Plaid) {
    await new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src: 'https://cdn.plaid.com/link/v2/stable/link-initialize.js', onload: resolve, onerror: () => reject(new Error('Couldn’t load Plaid')) });
      document.head.append(s);
    });
  }
  return new Promise((resolve, reject) => {
    const handler = window.Plaid.create({
      token: link_token,
      onSuccess: async (public_token, meta) => {
        try { await api('/plaid/exchange', { method: 'POST', body: { public_token, institution: meta.institution?.name } }); resolve(meta.institution?.name || 'Bank'); }
        catch (e) { reject(e); }
      },
      onExit: (err) => (err ? reject(new Error(err.display_message || err.error_message || 'Bank connection cancelled')) : resolve(null)),
    });
    handler.open();
  });
}

const urlB64ToBytes = (s) => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// Subscribes this device to server push (7 AM briefing / evening recap at exact times).
export async function enableServerPush() {
  if (!('PushManager' in window)) throw new Error('Push isn’t available here. On iPhone, open Compass from the Home Screen icon (iOS 16.4+).');
  const { vapidPublicKey } = await serverStatus();
  if (!vapidPublicKey) throw new Error('Push keys aren’t set on the server yet (VAPID_PUBLIC).');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for Compass.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(vapidPublicKey) });
  const s = state.settings;
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, briefingHour: s.briefingHour, recapHour: s.recapHour, recap: s.recap } });
  update((st) => { st.settings.notifications = true; });
}

// Merge server data into local state. Everything is keyed by stable ids, so syncing never duplicates.
function mergeEvents(st, events, source) {
  const keep = st.events.filter((e) => e.source !== source);
  const prev = new Map(st.events.filter((e) => e.source === source).map((e) => [e.uid, e]));
  const next = events.map((e) => {
    const old = prev.get(e.uid);
    const toLocal = (v) => (e.allDay ? v.slice(0, 10) : toLocalInput(new Date(v)));
    return { id: old?.id || uid(), category: old?.category || 'personal', travelMin: old?.travelMin || 0, repeat: 'none', ...e, start: toLocal(e.start), end: toLocal(e.end) };
  });
  st.events = [...keep, ...next];
}

function mergeCanvas(st, c) {
  for (const co of c.courses) {
    let course = st.courses.find((x) => x.canvasId === co.id) || matchCourse(st.courses, co.code);
    if (!course) { course = { id: uid(), code: co.code, name: co.name, target: 80, items: [] }; st.courses.push(course); }
    Object.assign(course, { canvasId: co.id, canvasScore: co.score, canvasGrade: co.grade });
  }
  const missing = new Set(c.missing.map((m) => m.id));
  for (const a of c.assignments) {
    const tUid = `canvas-a-${a.id}`;
    const course = st.courses.find((x) => x.canvasId === a.courseId);
    // Adopt a task imported earlier from the Canvas .ics feed instead of duplicating it.
    let t = st.tasks.find((x) => x.uid === tUid) || st.tasks.find((x) => x.uid === `event-assignment-${a.id}`);
    if (t) t.uid = tUid;
    const due = toLocalInput(new Date(a.due));
    if (!t) {
      t = { id: uid(), uid: tUid, title: `${a.title} [${a.courseCode}]`, priority: a.isQuiz ? 3 : 2, estimate: a.isQuiz ? 45 : 120, category: 'school', subtasks: [], done: false, created: new Date().toISOString(), source: 'canvas' };
      st.tasks.push(t);
    }
    Object.assign(t, { due, link: a.link, courseId: course?.id || t.courseId || '', missing: missing.has(a.id) || a.missing });
    if (a.submitted && !t.done) { t.done = true; t.doneAt = new Date().toISOString(); }
  }
  st.announcements = c.announcements;
}

const PLAID_CATS = { INCOME: 'Income', TRANSFER_IN: 'Transfers', TRANSFER_OUT: 'Transfers', LOAN_PAYMENTS: 'Transfers', RENT_AND_UTILITIES: 'Rent', FOOD_AND_DRINK: 'Dining', TRANSPORTATION: 'Transport', ENTERTAINMENT: 'Entertainment', GENERAL_MERCHANDISE: 'Shopping', MEDICAL: 'Health', BANK_FEES: 'Fees' };

function mergePlaid(st, p) {
  const fin = st.finance;
  for (const a of p.accounts) {
    let acct = fin.accounts.find((x) => x.plaidId === a.account_id);
    if (!acct) { acct = { id: uid(), plaidId: a.account_id }; fin.accounts.push(acct); }
    Object.assign(acct, {
      name: `${a.institution} ${a.name}${a.mask ? ` ••${a.mask}` : ''}`, type: a.type === 'credit' ? 'credit' : a.subtype === 'savings' ? 'savings' : 'chequing',
      balance: a.balances.current ?? '', asOf: dayKey(new Date()),
    });
  }
  const acctId = Object.fromEntries(fin.accounts.filter((a) => a.plaidId).map((a) => [a.plaidId, a.id]));
  const removed = new Set(p.removed);
  fin.txns = fin.txns.filter((t) => !removed.has(t.plaidId));
  for (const t of [...p.added, ...p.modified]) {
    const amount = -t.amount; // Plaid: positive = money out
    const existing = fin.txns.find((x) => x.plaidId === t.id);
    const ownRule = fin.rules.find((r) => t.name.toLowerCase().includes(r.match));
    const category = existing?.category || ownRule?.category || (categorize(fin, t.name, amount) !== 'Other' ? categorize(fin, t.name, amount) : PLAID_CATS[t.category] || 'Other');
    const row = { id: existing?.id || uid(), uid: `plaid|${t.id}`, plaidId: t.id, accountId: acctId[t.account], date: t.date, desc: t.name, amount, category, pending: t.pending };
    if (existing) Object.assign(existing, row); else fin.txns.push(row);
  }
  fin.txns.sort((a, b) => b.date.localeCompare(a.date));
  st.meta.plaidCursors = { ...(st.meta.plaidCursors || {}), ...p.cursors };
}

let syncing = null;
export function sync({ quiet = true } = {}) {
  if (!isPaired()) return Promise.resolve(null);
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const r = await api('/sync', { method: 'POST', body: { plaidCursors: state.meta.plaidCursors || {} } });
      update((st) => {
        const now = new Date().toISOString();
        st.meta.sync ||= {};
        st.meta.syncErrors = r.errors || {};
        const emails = [];
        if (r.google) { emails.push(...r.google.emails); mergeEvents(st, r.google.events, 'google'); st.meta.sync.google = now; }
        if (r.microsoft) { emails.push(...r.microsoft.emails); mergeEvents(st, r.microsoft.events, 'outlook'); st.meta.sync.microsoft = now; }
        if (r.google || r.microsoft) st.emails = emails.sort((a, b) => new Date(b.date) - new Date(a.date));
        if (r.canvas) { mergeCanvas(st, r.canvas); st.meta.sync.canvas = now; }
        if (r.plaid) { mergePlaid(st, r.plaid); st.meta.sync.plaid = now; }
        if (!quiet) logAction('sync', `Synced${Object.keys(r.errors || {}).length ? ` with errors: ${Object.keys(r.errors).join(', ')}` : ''}`);
      });
      return r;
    } catch (e) {
      update((st) => { st.meta.syncErrors = { server: e.message }; });
      if (!quiet) throw e;
      return null;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
