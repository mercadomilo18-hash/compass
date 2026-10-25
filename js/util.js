// Small shared helpers: DOM, escaping, dates, files.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

export const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toLocalInput = (d) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as local time (never UTC).
export function parseLocal(s) {
  if (!s) return null;
  if (s instanceof Date) return new Date(s);
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
export const sameDay = (a, b) => dayKey(a) === dayKey(b);
export const minutesBetween = (a, b) => Math.round((b - a) / 60000);
export const startOfWeek = (d) => addDays(startOfDay(d), -startOfDay(d).getDay());

export const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => d.toLocaleDateString([], opts);
export const fmtDuration = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}` : `${min}m`);

// "in 3h", "tomorrow 9:00 AM", "2 days overdue"
export function relDue(due, now = new Date()) {
  const diff = minutesBetween(now, due);
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  if (diff < 0) {
    if (days === 0) return 'overdue';
    return `${-days} day${days === -1 ? '' : 's'} overdue`;
  }
  if (days === 0) return diff < 60 ? `in ${diff}m` : `today ${fmtTime(due)}`;
  if (days === 1) return `tomorrow ${fmtTime(due)}`;
  if (days < 7) return `${fmtDate(due, { weekday: 'long' })} ${fmtTime(due)}`;
  return fmtDate(due);
}

// Minimal, safe markdown: escape first, then bold / italics / lists / line breaks.
export function md(text) {
  const lines = h(text).split('\n');
  let out = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\s)\*(\S.+?)\*/g, '$1<em>$2</em>');
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    const head = line.match(/^#{1,4}\s+(.*)/);
    out += head ? `<p><strong>${head[1]}</strong></p>` : line.trim() ? `<p>${line}</p>` : '';
  }
  return out + (inList ? '</ul>' : '');
}

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      f.text().then((text) => resolve({ name: f.name, text }));
    };
    input.click();
  });
}

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
