// Scheduling brain: recurring events, conflicts, task priority, free time,
// suggested plans, and the morning briefing / evening recap.

import { parseLocal, startOfDay, addDays, addMinutes, dayKey, sameDay, minutesBetween, fmtTime } from './util.js';
import * as Bible from './bible.js';
import * as Fin from './finance.js';
import * as Plans from './plans.js';

// Emails synced from connected accounts (Phase 2 server), most important first.
export const importantEmails = (state, now = new Date()) =>
  (state.emails || []).filter((e) => e.important && new Date(e.date) > addDays(now, -14)).sort((a, b) => new Date(b.date) - new Date(a.date));

const MIN_SLOT = 30;
const MAX_BLOCK = 90;
const GYM_RE = /gym|workout|exercise|run|lift/i;
const TEST_RE = /exam|test|quiz|midterm|final|lab/i;

export const CATEGORIES = {
  class: 'Class', school: 'School', study: 'Study', work: 'Work', church: 'Church', gym: 'Gym', personal: 'Personal',
};

function bounds(ev) {
  const s = parseLocal(ev.start);
  let e = parseLocal(ev.end);
  if (ev.allDay) e = e && e > s ? e : addDays(startOfDay(s), 1);
  else if (!e || e <= s) e = addMinutes(s, 60);
  return [s, e];
}

// Expand events (including daily / weekdays / weekly repeats) into concrete occurrences in [from, to).
export function occurrences(events, from, to) {
  const out = [];
  for (const ev of events) {
    const [s, e] = bounds(ev);
    if (!s) continue;
    const dur = e - s;
    const until = ev.until ? addDays(parseLocal(ev.until), 1) : null;
    const push = (start) => {
      const end = new Date(start.getTime() + dur);
      if (end > from && start < to) out.push({ ...ev, start, end, occId: `${ev.id}@${dayKey(start)}` });
    };
    if (!ev.repeat || ev.repeat === 'none') { push(s); continue; }
    const step = ev.repeat === 'weekly' ? 7 : 1;
    let d = new Date(s);
    // Jump close to the window instead of walking from the first occurrence.
    if (d < from) {
      const skip = Math.floor((startOfDay(from) - startOfDay(d)) / 86400000 / step) * step - step;
      if (skip > 0) d = addDays(d, skip);
    }
    for (; d < to && (!until || d < until); d = addDays(d, step)) {
      if (ev.repeat === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) continue;
      push(new Date(d));
    }
  }
  return out.sort((a, b) => a.start - b.start || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));
}

export const dayOccurrences = (events, date) => occurrences(events, startOfDay(date), addDays(startOfDay(date), 1));

export function conflicts(occs) {
  const timed = occs.filter((o) => !o.allDay);
  const out = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && timed[j].start < timed[i].end; j++) out.push([timed[i], timed[j]]);
  }
  return out;
}

export const leaveBy = (occ) => (occ.travelMin > 0 && !occ.allDay ? addMinutes(occ.start, -occ.travelMin) : null);

export function taskScore(t, now = new Date()) {
  let score = (t.priority || 2) * 12;
  const due = parseLocal(t.due);
  if (due) {
    const hours = (due - now) / 3.6e6;
    score += hours <= 0 ? 100 : 80 / (1 + hours / 24);
    if (hours < 24 * 7) score += Math.min(20, ((t.estimate || 60) / 60) * 4);
  }
  return score;
}

export const openTasks = (tasks, now = new Date()) =>
  tasks.filter((t) => !t.done).sort((a, b) => taskScore(b, now) - taskScore(a, now));

const atTime = (date, hhmm) => {
  const [hh, mm] = (hhmm || '08:00').split(':').map(Number);
  const d = startOfDay(date); d.setHours(hh, mm); return d;
};

export function freeSlots(events, date, settings, now = new Date()) {
  let cursor = atTime(date, settings.dayStart);
  const end = atTime(date, settings.dayEnd);
  if (sameDay(date, now) && now > cursor) {
    cursor = new Date(now); cursor.setSeconds(0, 0);
    cursor.setMinutes(Math.ceil(cursor.getMinutes() / 15) * 15);
  }
  const busy = dayOccurrences(events, date).filter((o) => !o.allDay)
    .map((o) => [leaveBy(o) || o.start, o.end]).sort((a, b) => a[0] - b[0]);
  const slots = [];
  for (const [bs, be] of busy) {
    if (bs > cursor && minutesBetween(cursor, bs) >= MIN_SLOT) slots.push([new Date(cursor), new Date(Math.min(bs, end))]);
    if (be > cursor) cursor = new Date(be);
    if (cursor >= end) break;
  }
  if (minutesBetween(cursor, end) >= MIN_SLOT) slots.push([cursor, end]);
  return slots.filter(([s, e]) => minutesBetween(s, e) >= MIN_SLOT);
}

// Fills free time with work on the most urgent tasks (+ a gym block if that habit is pending).
export function suggestPlan(state, date = new Date(), now = new Date()) {
  const horizon = addDays(date, 10);
  const queue = openTasks(state.tasks, now)
    .filter((t) => { const d = parseLocal(t.due); return d ? d < horizon : t.priority === 3; })
    .map((t) => ({ t, left: t.estimate || 60 }));
  const blocks = [];
  let slots = freeSlots(state.events, date, state.settings, now);
  // Reserve a gym hour first (prefer 3 PM or later), then fill the rest with work.
  const gymHabit = state.habits.find((hb) => GYM_RE.test(hb.name) && !hb.log?.[dayKey(date)]);
  if (gymHabit) {
    const at3 = atTime(date, '15:00');
    const pick = slots.map(([s, e]) => [s < at3 ? at3 : s, e]).find(([s, e]) => minutesBetween(s, e) >= 60)
      || slots.find(([s, e]) => minutesBetween(s, e) >= 60);
    if (pick) {
      const gs = pick[0], ge = addMinutes(gs, 60);
      blocks.push({ start: gs, end: ge, title: gymHabit.name, kind: 'gym' });
      slots = slots.flatMap(([s, e]) => (gs >= e || ge <= s ? [[s, e]] : [[s, gs], [addMinutes(ge, 10), e]]))
        .filter(([s, e]) => minutesBetween(s, e) >= MIN_SLOT);
    }
  }
  for (const [s, e] of slots) {
    let cur = s;
    while (minutesBetween(cur, e) >= MIN_SLOT) {
      const item = queue.find((q) => q.left > 0);
      if (!item) break;
      const len = Math.min(item.left, MAX_BLOCK, minutesBetween(cur, e));
      if (len < MIN_SLOT && item.left >= MIN_SLOT) break;
      blocks.push({ start: cur, end: addMinutes(cur, len), title: `Work on: ${item.t.title}`, taskId: item.t.id, kind: 'study' });
      item.left -= len;
      cur = addMinutes(cur, len + 10);
    }
  }
  return blocks.sort((a, b) => a.start - b.start);
}

export function alerts(state, now = new Date()) {
  const out = [];
  const overdue = state.tasks.filter((t) => !t.done && t.due && parseLocal(t.due) < now);
  if (overdue.length) out.push({ level: 'bad', text: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}: ${overdue.slice(0, 3).map((t) => t.title).join(', ')}`, go: 'tasks' });
  const week = occurrences(state.events, startOfDay(now), addDays(startOfDay(now), 7));
  for (const [a, b] of conflicts(week).slice(0, 3)) {
    out.push({ level: 'warn', text: `Conflict ${a.start.toLocaleDateString([], { weekday: 'short' })}: “${a.title}” overlaps “${b.title}”`, go: 'calendar' });
  }
  const soon = week.filter((o) => !o.allDay && o.start > now && minutesBetween(now, leaveBy(o) || o.start) <= 60);
  soon.forEach((o) => out.push({ level: 'info', text: `${o.title} ${leaveBy(o) ? `— leave by ${fmtTime(leaveBy(o))}` : `starts at ${fmtTime(o.start)}`}`, go: 'calendar' }));
  const due = new Date(now.getTime() + 72 * 3.6e6);
  const dueSoon = state.tasks.filter((t) => !t.done && t.due && parseLocal(t.due) >= now && parseLocal(t.due) < due);
  for (let i = 0; i < dueSoon.length; i++) {
    for (let j = i + 1; j < dueSoon.length; j++) {
      if (Math.abs(parseLocal(dueSoon[i].due) - parseLocal(dueSoon[j].due)) < 6 * 3.6e6) {
        out.push({ level: 'warn', text: `Deadlines bunch up: “${dueSoon[i].title}” and “${dueSoon[j].title}” are due within hours of each other`, go: 'tasks' });
        i = dueSoon.length; break;
      }
    }
  }
  for (const g of state.goals) {
    const last = g.history?.[0];
    if (last && last.progress < last.target && !(g.progress > 0)) {
      out.push({ level: 'warn', text: `Missed last ${g.period === 'daily' ? 'day' : g.period === 'weekly' ? 'week' : 'month'}’s goal “${g.title}” (${last.progress}/${last.target}) — fresh start now`, go: 'habits' });
    }
  }
  out.push(...Fin.alerts(state.finance, now));
  const NAMES = { canvas: 'Canvas', plaid: 'Bank (Plaid)', server: 'Compass server', feeds: 'Calendar links' };
  const label = (k) => (k.startsWith('google:') ? `Gmail (${k.slice(7)})` : k.startsWith('microsoft:') ? `Outlook (${k.slice(10)})` : k.startsWith('feed:') ? 'Calendar link' : NAMES[k] || k);
  Object.entries(state.meta.syncErrors || {}).forEach(([k, msg]) => out.push({ level: 'bad', text: `${label(k)} sync failed: ${msg}`, go: 'settings' }));
  const missing = state.tasks.filter((t) => t.missing && !t.done);
  if (missing.length) out.push({ level: 'bad', text: `Canvas shows ${missing.length} missing submission${missing.length > 1 ? 's' : ''}: ${missing.slice(0, 2).map((t) => t.title).join(', ')}`, go: 'tasks' });
  const stale = importantEmails(state, now).filter((e) => e.unread && (now - new Date(e.date)) / 3.6e6 > 48);
  if (stale.length) out.push({ level: 'warn', text: `${stale.length} important email${stale.length > 1 ? 's' : ''} unread for 2+ days: ${stale.slice(0, 2).map((e) => e.subject).join('; ')}`, go: 'chat' });
  const b = Bible.streak(state.bible, now);
  if (!b.readToday && b.current > 0 && now.getHours() >= 19) out.push({ level: 'info', text: `Keep your ${b.current}-day Bible streak — you haven't read yet today`, go: 'bible' });
  return out;
}

function upcomingTests(state, now, days = 7) {
  const end = addDays(now, days);
  const fromTasks = state.tasks.filter((t) => !t.done && t.due && TEST_RE.test(t.title) && parseLocal(t.due) < end && parseLocal(t.due) >= now)
    .map((t) => ({ title: t.title, when: parseLocal(t.due) }));
  const fromEvents = occurrences(state.events, now, end).filter((o) => TEST_RE.test(o.title)).map((o) => ({ title: o.title, when: o.start }));
  return [...fromTasks, ...fromEvents].sort((a, b) => a.when - b.when);
}

export function briefing(state, now = new Date()) {
  const today = dayOccurrences(state.events, now);
  const open = openTasks(state.tasks, now);
  const endToday = addDays(startOfDay(now), 1);
  return {
    events: today,
    dueToday: open.filter((t) => t.due && parseLocal(t.due) < endToday),
    dueSoon: open.filter((t) => t.due && parseLocal(t.due) >= endToday && parseLocal(t.due) < addDays(endToday, 3)),
    tests: upcomingTests(state, now),
    conflicts: conflicts(today),
    priorities: open.slice(0, 3),
    habits: state.habits.filter((hb) => !hb.log?.[dayKey(now)]),
    bible: { ...Bible.streak(state.bible, now), next: Plans.nextChapters(state.bible, now) },
    plan: suggestPlan(state, now, now),
    money: state.finance.txns.length ? {
      week: Fin.weekStatus(state.finance, now),
      bills: Fin.recurring(state.finance, now).filter((r) => !r.income && (r.next - startOfDay(now)) / 86400000 <= 3),
      alerts: Fin.alerts(state.finance, now).filter((a) => a.level !== 'info'),
    } : null,
    emails: importantEmails(state, now).filter((e) => e.unread).slice(0, 5),
  };
}

export function recap(state, now = new Date()) {
  const key = dayKey(now);
  const tomorrow = addDays(startOfDay(now), 1);
  const tmrw = dayOccurrences(state.events, tomorrow);
  const firstTimed = tmrw.find((o) => !o.allDay);
  let wake = atTime(tomorrow, '07:00');
  if (firstTimed) {
    const prep = addMinutes(leaveBy(firstTimed) || firstTimed.start, -75);
    if (prep < wake) wake = prep;
  }
  const bedtime = addMinutes(wake, -(state.settings.sleepHours || 8) * 60);
  return {
    done: state.tasks.filter((t) => t.done && t.doneAt?.startsWith(key)),
    unfinished: state.tasks.filter((t) => !t.done && t.due && parseLocal(t.due) < addDays(tomorrow, 1)),
    tomorrow: tmrw,
    upcoming: openTasks(state.tasks, now).filter((t) => t.due && parseLocal(t.due) >= tomorrow && parseLocal(t.due) < addDays(tomorrow, 4)),
    wake, bedtime,
  };
}
