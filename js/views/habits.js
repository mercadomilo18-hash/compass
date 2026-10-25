import { state, update, logAction } from '../store.js';
import { icon, modal, field, select, empty, bar, toast, confirmSheet } from '../ui.js';
import { h, uid, dayKey, addDays, startOfWeek, fmtDate } from '../util.js';

export const periodKey = (period, d = new Date()) =>
  period === 'daily' ? dayKey(d) : period === 'weekly' ? dayKey(startOfWeek(d)) : dayKey(d).slice(0, 7);

// Start a fresh period for each goal, keeping the old result in history.
export function rollGoals(s, now = new Date()) {
  let changed = false;
  for (const g of s.goals) {
    const k = periodKey(g.period, now);
    if (g.periodKey !== k) {
      if (g.periodKey) (g.history ||= []).unshift({ key: g.periodKey, progress: g.progress || 0, target: g.target });
      g.history = (g.history || []).slice(0, 24);
      g.periodKey = k; g.progress = 0; changed = true;
    }
  }
  return changed;
}

function habitStreak(hb, now = new Date()) {
  let d = now, n = 0;
  if (!hb.log?.[dayKey(d)]) d = addDays(d, -1);
  while (hb.log?.[dayKey(d)]) { n++; d = addDays(d, -1); }
  return n;
}

function habitCard(hb, now) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(now, i - 6));
  const week = days.filter((d) => hb.log?.[dayKey(d)]).length;
  return `<li class="item habit">
    <div class="what"><strong>${h(hb.name)}</strong><div class="meta"><span class="muted">${habitStreak(hb, now)}-day streak · ${week}/7 this week</span></div>
      <div class="dots">${days.map((d) => `<button class="dot${hb.log?.[dayKey(d)] ? ' on' : ''}" data-act="toggleDay" data-id="${h(hb.id)}" data-date="${dayKey(d)}" aria-label="${h(hb.name)} ${fmtDate(d)}" aria-pressed="${!!hb.log?.[dayKey(d)]}">${fmtDate(d, { weekday: 'narrow' })}</button>`).join('')}</div>
    </div>
    <button class="icon-btn" data-act="delHabit" data-id="${h(hb.id)}" aria-label="Delete ${h(hb.name)}">${icon('trash', 18)}</button>
  </li>`;
}

function goalCard(g) {
  const pct = g.target ? (g.progress || 0) / g.target : 0;
  const last = g.history?.[0];
  return `<li class="item goal">
    <div class="what"><strong>${h(g.title)}</strong>
      <div class="meta"><span class="chip">${h(g.period)}</span><span class="muted">${g.progress || 0} / ${g.target} ${h(g.unit || '')}</span>
      ${last ? `<span class="${last.progress >= last.target ? 'good-text' : 'bad-text'} small">Last: ${last.progress}/${last.target}${last.progress >= last.target ? ' ✓' : ' missed'}</span>` : ''}</div>
      ${bar(pct)}
    </div>
    <div class="stepper"><button class="icon-btn" data-act="goalStep" data-id="${h(g.id)}" data-d="-1" aria-label="Decrease">−</button><button class="icon-btn" data-act="goalStep" data-id="${h(g.id)}" data-d="1" aria-label="Increase">+</button>
    <button class="icon-btn" data-act="delGoal" data-id="${h(g.id)}" aria-label="Delete goal">${icon('trash', 18)}</button></div>
  </li>`;
}

export default {
  id: 'habits',
  title: 'Goals',
  render() {
    const now = new Date();
    return `<header class="page-head"><h1>Goals &amp; habits</h1></header>
      <div class="grid">
      <section class="card"><div class="card-head"><h2>Habits</h2><button class="btn small" data-act="newHabit">${icon('plus', 16)} Habit</button></div>
        ${state.habits.length ? `<ul class="list">${state.habits.map((hb) => habitCard(hb, now)).join('')}</ul>` : empty('Track things like Workout, Study 2h, Prayer, Sleep by 11.')}</section>
      <section class="card"><div class="card-head"><h2>Goals</h2><button class="btn small" data-act="newGoal">${icon('plus', 16)} Goal</button></div>
        ${state.goals.length ? `<ul class="list">${state.goals.map(goalCard).join('')}</ul>` : empty('Set daily, weekly or monthly targets — e.g. “Gym 4× this week”.')}</section>
      </div>`;
  },
  act: {
    newHabit: () => modal({
      title: 'New habit',
      body: field('Name', '<input name="name" autofocus placeholder="e.g. Workout">', 'Habits named gym/workout/run get a suggested time block on your Today plan.'),
      onSubmit: (v) => { if (!v.name) return false; update((s) => { s.habits.push({ id: uid(), name: v.name, log: {} }); logAction('habit', `Added habit “${v.name}”`); }); },
    }),
    toggleDay: (el) => update((s) => {
      const hb = s.habits.find((x) => x.id === el.dataset.id);
      hb.log ||= {};
      if (hb.log[el.dataset.date]) delete hb.log[el.dataset.date]; else hb.log[el.dataset.date] = true;
    }),
    delHabit: async (el) => {
      if (await confirmSheet('Delete habit?', 'Its check-in history will be removed.', 'Delete')) update((s) => { s.habits = s.habits.filter((x) => x.id !== el.dataset.id); });
    },
    newGoal: () => modal({
      title: 'New goal',
      body: `${field('Goal', '<input name="title" autofocus placeholder="e.g. Go to the gym">')}
        <div class="row">${field('Period', select('period', { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }, 'weekly'))}
        ${field('Target', '<input type="number" name="target" min="1" value="4">')}</div>
        ${field('Unit', '<input name="unit" placeholder="times, hours, chapters…">')}`,
      onSubmit: (v) => {
        if (!v.title || !(v.target > 0)) { toast('Add a goal and target'); return false; }
        update((s) => { s.goals.push({ id: uid(), title: v.title, period: v.period, target: v.target, unit: v.unit, progress: 0, periodKey: periodKey(v.period), history: [] }); logAction('goal', `Added goal “${v.title}”`); });
      },
    }),
    goalStep: (el) => update((s) => { const g = s.goals.find((x) => x.id === el.dataset.id); g.progress = Math.max(0, (g.progress || 0) + +el.dataset.d); }),
    delGoal: async (el) => {
      if (await confirmSheet('Delete goal?', 'Its progress history will be removed.', 'Delete')) update((s) => { s.goals = s.goals.filter((x) => x.id !== el.dataset.id); });
    },
  },
};
