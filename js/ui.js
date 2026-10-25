// Reusable UI pieces: icons, modal sheet, toast, form fields.

import { $, h } from './util.js';

const P = {
  today: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  tasks: '<path d="m4 7 2 2 4-4M4 17l2 2 4-4M13 7h7M13 17h7"/>',
  habits: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  bible: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M12 7v5M9.5 9h5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};

export const icon = (name, size = 22) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

let toastTimer;
export function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Opens a bottom sheet (phone) / dialog (desktop). onSubmit receives form values; return false to keep open.
export function modal({ title, body, submit = 'Save', onSubmit, extra = '', onOpen }) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <form class="sheet" role="dialog" aria-modal="true" aria-label="${h(title)}" novalidate>
      <header class="sheet-head"><h2>${h(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></header>
      <div class="sheet-body">${body}</div>
      ${onSubmit ? `<footer class="sheet-foot">${extra}<span class="grow"></span><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${h(submit)}</button></footer>` : ''}
    </form>`;
  const form = root.querySelector('form');
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc); };
  const esc = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', esc);
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const res = await onSubmit(formValues(form), form);
    if (res !== false) close();
  });
  setTimeout(() => (form.querySelector('[autofocus]') || form.querySelector('input,select,textarea'))?.focus(), 50);
  onOpen?.(form, close);
  return { form, close };
}

export function closeModal() { $('#modal-root').innerHTML = ''; }

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? '' : Number(el.value);
    else out[el.name] = el.value.trim();
  }
  return out;
}

export const field = (label, input, hint = '') =>
  `<label class="field"><span>${h(label)}</span>${input}${hint ? `<small>${hint}</small>` : ''}</label>`;

export const select = (name, options, value) =>
  `<select name="${name}">${Object.entries(options).map(([v, l]) => `<option value="${h(v)}"${String(v) === String(value) ? ' selected' : ''}>${h(l)}</option>`).join('')}</select>`;

export const confirmSheet = (title, text, okLabel = 'Confirm') =>
  new Promise((resolve) => {
    let ok = false;
    const { form } = modal({ title, body: `<p>${h(text)}</p>`, submit: okLabel, onSubmit: () => { ok = true; resolve(true); } });
    form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => ok || resolve(false)));
  });

export const empty = (text, action = '') => `<div class="empty"><p>${text}</p>${action}</div>`;

export const ring = (pct, size = 76, label = '') => {
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${h(label || `${Math.round(pct * 100)}%`)}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, pct))}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
};

export const bar = (pct) => `<div class="bar${pct > 1 ? ' over' : ''}"><i style="width:${Math.min(100, Math.max(0, pct) * 100).toFixed(1)}%"></i></div>`;
