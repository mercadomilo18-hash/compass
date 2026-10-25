// Optional Bible reading plans. A plan is a chapter sequence spread evenly over N days;
// progress counts unique chapters read, so chapters read earlier still count.

import { books, isRead, nextReading } from './bible.js';
import { parseLocal, startOfDay, addDays, dayKey } from './util.js';

export const PLANS = {
  year: { name: 'Whole Bible in a year', days: 365, pick: (b) => b },
  nt90: { name: 'New Testament in 90 days', days: 90, pick: (b) => b.filter((x) => x.t === 'NT') },
  gospels30: { name: 'Gospels & Acts in 30 days', days: 30, pick: (b) => b.filter((x) => ['MAT', 'MRK', 'LUK', 'JHN', 'ACT'].includes(x.code)) },
  psapro60: { name: 'Psalms & Proverbs in 60 days', days: 60, pick: (b) => b.filter((x) => ['PSA', 'PRO'].includes(x.code)) },
  ot1y: { name: 'Old Testament in a year', days: 365, pick: (b) => b.filter((x) => x.t === 'OT') },
};

export function sequence(bible, id) {
  return PLANS[id].pick(books(bible)).flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.code, name: b.name, ch: i + 1 })));
}

// Chapters assigned to day n (1-based).
export function dayAssignment(seq, days, n) {
  const a = Math.floor(((n - 1) * seq.length) / days), b = Math.floor((n * seq.length) / days);
  return seq.slice(a, b);
}

// What to read next: today's unread plan chapters (then catch-up), or the next unread in order.
export function nextChapters(bible, now = new Date()) {
  const st = status(bible, now);
  if (!st) return nextReading(bible, Math.max(1, bible.dailyGoal || 1));
  const todo = st.today.filter((c) => !c.read);
  return todo.length ? todo : st.overdue.slice(0, Math.max(1, bible.dailyGoal || 1));
}

export function status(bible, now = new Date()) {
  const p = bible.readingPlan;
  if (!p || !PLANS[p.id]) return null;
  const plan = PLANS[p.id];
  const seq = sequence(bible, p.id);
  const day = Math.min(plan.days, Math.max(1, Math.floor((startOfDay(now) - startOfDay(parseLocal(p.start))) / 86400000) + 1));
  const readFlags = seq.map((c) => isRead(bible, c.book, c.ch));
  const done = readFlags.filter(Boolean).length;
  const today = dayAssignment(seq, plan.days, day).map((c) => ({ ...c, read: isRead(bible, c.book, c.ch) }));
  // Catch-up list: unread chapters that were due before today.
  const todayStart = Math.floor(((day - 1) * seq.length) / plan.days);
  const overdue = seq.slice(0, todayStart).filter((c, i) => !readFlags[i]);
  const end = addDays(parseLocal(p.start), plan.days - 1);
  return {
    id: p.id, name: plan.name, day, days: plan.days, total: seq.length, done, pct: done / seq.length,
    behind: overdue.length, today, overdue, end: dayKey(end),
    summary: `${plan.name}, day ${day}/${plan.days}, ${done}/${seq.length} chapters${overdue.length ? `, ${overdue.length} chapters behind` : ', on track'}; today: ${today.map((c) => `${c.name} ${c.ch}`).join(', ')}`,
  };
}
