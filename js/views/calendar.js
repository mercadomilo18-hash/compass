import { state } from '../store.js';
import { occurrences, dayOccurrences, conflicts, freeSlots } from '../planner.js';
import { eventRow } from '../components.js';
import { icon, empty } from '../ui.js';
import { openEvent } from '../forms.js';
import { h, fmtDate, fmtTime, addDays, startOfDay, startOfWeek, sameDay, dayKey, toLocalInput, minutesBetween, fmtDuration, parseLocal } from '../util.js';

let mode = 'week';
let cursor = startOfDay(new Date());

function dayBlock(date, { showFree = false } = {}) {
  const occ = dayOccurrences(state.events, date);
  const clash = new Set(conflicts(occ).flat().map((o) => o.occId));
  const free = showFree ? freeSlots(state.events, date, state.settings) : [];
  return `${occ.length ? `<ul class="list">${occ.map((o) => eventRow(o, { conflict: clash.has(o.occId) })).join('')}</ul>` : empty('Nothing scheduled.')}
    ${free.length ? `<p class="muted small free">Free: ${free.map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)} (${fmtDuration(minutesBetween(a, b))})`).join(' · ')}</p>` : ''}`;
}

function dayView() {
  return `<section class="card"><h2>${fmtDate(cursor, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>${dayBlock(cursor, { showFree: true })}</section>`;
}

function weekView() {
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
    const occ = dayOccurrences(state.events, d);
    return `<section class="card day${sameDay(d, new Date()) ? ' is-today' : ''}">
      <div class="card-head"><h2 data-act="goDay" data-date="${dayKey(d)}" class="tappable">${fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
      <button class="icon-btn" data-act="newEvent" data-date="${dayKey(d)}" aria-label="Add event on ${fmtDate(d)}">${icon('plus', 18)}</button></div>
      ${occ.length ? dayBlock(d) : '<p class="muted small">Free</p>'}</section>`;
  }).join('');
}

function monthView() {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const occ = occurrences(state.events, gridStart, addDays(gridStart, 42));
  const byDay = {};
  occ.forEach((o) => (byDay[dayKey(o.start)] ||= []).push(o));
  const due = {};
  state.tasks.filter((t) => !t.done && t.due).forEach((t) => (due[t.due.slice(0, 10)] = (due[t.due.slice(0, 10)] || 0) + 1));
  const heads = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="mh">${d}</div>`).join('');
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = addDays(gridStart, i), k = dayKey(d), items = byDay[k] || [];
    return `<button class="mcell${d.getMonth() !== cursor.getMonth() ? ' out' : ''}${sameDay(d, new Date()) ? ' is-today' : ''}" data-act="goDay" data-date="${k}" aria-label="${fmtDate(d)}: ${items.length} events">
      <span class="num">${d.getDate()}</span>
      ${items.slice(0, 3).map((o) => `<span class="mev cat-${h(o.category || 'personal')}">${h(o.title)}</span>`).join('')}
      ${items.length > 3 ? `<span class="more">+${items.length - 3}</span>` : ''}
      ${due[k] ? `<span class="due-dot" title="${due[k]} due">${due[k]} due</span>` : ''}
    </button>`;
  }).join('');
  return `<section class="card"><div class="month">${heads}${cells}</div></section>`;
}

function title() {
  if (mode === 'day') return fmtDate(cursor, { month: 'long', day: 'numeric', year: 'numeric' });
  if (mode === 'month') return fmtDate(cursor, { month: 'long', year: 'numeric' });
  const s = startOfWeek(cursor);
  return `${fmtDate(s, { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(s, 6), { month: 'short', day: 'numeric' })}`;
}

export default {
  id: 'calendar',
  title: 'Calendar',
  render() {
    return `<header class="page-head"><h1>${title()}</h1>
      <button class="btn primary" data-act="newEvent">${icon('plus', 18)} Event</button></header>
      <div class="toolbar">
        <div class="seg" role="tablist">${['day', 'week', 'month'].map((m) => `<button role="tab" aria-selected="${mode === m}" class="${mode === m ? 'on' : ''}" data-act="mode" data-mode="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
        <div class="nav-btns"><button class="icon-btn" data-act="prev" aria-label="Previous">${icon('left')}</button><button class="btn ghost small" data-act="today">Today</button><button class="icon-btn" data-act="next" aria-label="Next">${icon('right')}</button></div>
      </div>
      <div class="${mode === 'week' ? 'grid' : ''}">${mode === 'day' ? dayView() : mode === 'week' ? weekView() : monthView()}</div>`;
  },
  act: {
    mode: (el) => { mode = el.dataset.mode; },
    prev: () => { cursor = mode === 'day' ? addDays(cursor, -1) : mode === 'week' ? addDays(cursor, -7) : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); },
    next: () => { cursor = mode === 'day' ? addDays(cursor, 1) : mode === 'week' ? addDays(cursor, 7) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); },
    today: () => { cursor = startOfDay(new Date()); },
    goDay: (el) => { cursor = parseLocal(el.dataset.date); mode = 'day'; },
    newEvent: (el) => {
      const d = el.dataset.date ? parseLocal(el.dataset.date) : mode === 'day' ? new Date(cursor) : new Date();
      d.setHours(new Date().getHours() + 1, 0, 0, 0);
      openEvent({ start: toLocalInput(d) });
    },
  },
};
