// On-device storage. With a passcode set, everything (including the Claude key)
// is encrypted with AES-GCM using a key derived from the passcode (PBKDF2).
// The passcode itself is never stored.

const PLAIN = 'compass:data';
const VAULT = 'compass:vault';
const ITERATIONS = 310000;

export const HOME_CARDS = ['briefing', 'alerts', 'schedule', 'tasks', 'plan', 'money', 'emails', 'habits', 'bible'];

const defaults = () => ({
  version: 1,
  settings: {
    name: '',
    theme: 'auto',
    briefingHour: 7,
    recap: true,
    recapHour: 21,
    sleepHours: 8,
    dayStart: '08:00',
    dayEnd: '22:00',
    apiKey: '',
    voiceReplies: false,
    autoLockMin: 5,
    notifications: false,
    homeCards: HOME_CARDS.map((id) => ({ id, on: true })),
    onboarded: false,
    serverUrl: '',
    serverToken: '',
    voiceShare: false,
  },
  voiceInbox: [],
  events: [],
  tasks: [],
  courses: [],
  habits: [],
  goals: [],
  bible: { canon: 'protestant', read: {}, log: [], dailyGoal: 1, plan: { order: 'canonical', endDate: '' }, readingPlan: null },
  finance: {
    accounts: [],
    txns: [],
    weeklyAllowance: 150,
    budgets: {},
    rules: [],
    savings: [],
    ignoredRecurring: [],
  },
  emails: [],
  chat: [],
  actions: [],
  meta: { notified: {}, sync: {} },
});

export let state = null;
let key = null;
let salt = null;
const listeners = new Set();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passcode, saltBytes) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

function merge(data) {
  const d = defaults();
  const s = {
    ...d, ...data,
    settings: { ...d.settings, ...(data.settings || {}) },
    bible: { ...d.bible, ...(data.bible || {}) },
    finance: { ...d.finance, ...(data.finance || {}) },
    meta: { ...d.meta, ...(data.meta || {}) },
  };
  // Keep home cards list complete if new cards are added in later versions.
  const known = new Set(s.settings.homeCards.map((c) => c.id));
  HOME_CARDS.forEach((id) => known.has(id) || s.settings.homeCards.push({ id, on: true }));
  return s;
}

export const hasVault = () => !!localStorage.getItem(VAULT);
export const hasPasscode = () => !!key;

// Returns 'ready' or 'locked'.
export function load() {
  if (hasVault()) return 'locked';
  try { state = merge(JSON.parse(localStorage.getItem(PLAIN) || '{}')); }
  catch { state = defaults(); }
  return 'ready';
}

// A vault saved by the old buggy auto-lock has an empty salt and can't be opened by anyone.
export const vaultDamaged = () => { try { return !JSON.parse(localStorage.getItem(VAULT)).salt; } catch { return true; } };

export async function unlock(passcode) {
  const vault = JSON.parse(localStorage.getItem(VAULT));
  const s = unb64(vault.salt);
  const k = await deriveKey(passcode, s);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, k, unb64(vault.ct));
    state = merge(JSON.parse(new TextDecoder().decode(plain)));
    key = k; salt = s;
    return true;
  } catch {
    return false;
  }
}

export async function lock() {
  if (!hasVault()) return false;
  await flush();
  state = null; key = null; salt = null;
  return true;
}

// Set, change or (with an empty value) remove the passcode.
export async function setPasscode(passcode) {
  if (!passcode) {
    key = null; salt = null;
    localStorage.removeItem(VAULT);
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(passcode, salt);
    localStorage.removeItem(PLAIN);
  }
  await persist();
}

let pending = null;
let writing = Promise.resolve();

// Snapshot state, key and salt together *before* any await, so a lock or passcode change
// happening mid-save can never pair a ciphertext with the wrong salt. Saves run one at a time.
function persist() {
  if (!state) return writing;
  const json = JSON.stringify(state);
  const k = key, s = salt;
  writing = writing.catch(() => {}).then(async () => {
    if (k && s) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(json));
      localStorage.setItem(VAULT, JSON.stringify({ v: 1, salt: b64(s), iv: b64(iv), ct: b64(ct) }));
    } else if (!k) {
      localStorage.setItem(PLAIN, json);
    }
  });
  return writing;
}

export function flush() {
  if (pending) { clearTimeout(pending); pending = null; }
  return persist().catch((e) => console.error('Save failed', e));
}

export function save() {
  clearTimeout(pending);
  pending = setTimeout(flush, 250);
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// The one way views change data: mutate, persist, re-render.
export function update(fn) {
  if (!state) return; // locked: late async work (e.g. a sync finishing) must not touch data
  fn(state);
  save();
  listeners.forEach((l) => l());
}

export function logAction(type, summary, status = 'done', source = 'you') {
  state.actions.unshift({ id: crypto.randomUUID?.() || String(Date.now()), ts: new Date().toISOString(), type, summary, status, source });
  state.actions.length = Math.min(state.actions.length, 300);
}

export function exportBackup() {
  const copy = structuredClone(state);
  copy.settings.apiKey = ''; // never put keys in a backup file
  copy.settings.serverToken = '';
  return JSON.stringify({ app: 'compass', exported: new Date().toISOString(), data: copy }, null, 2);
}

export function importBackup(text) {
  const parsed = JSON.parse(text);
  if (parsed.app !== 'compass' || !parsed.data) throw new Error('Not a Compass backup file');
  const { apiKey, serverToken } = state.settings;
  state = merge(parsed.data);
  Object.assign(state.settings, { apiKey, serverToken });
  return flush();
}

export function wipe() {
  localStorage.removeItem(PLAIN);
  localStorage.removeItem(VAULT);
  state = defaults(); key = null; salt = null;
}
