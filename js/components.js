// Row renderers and briefing/recap blocks reused across screens.

import { h, fmtTime, fmtDate, relDue, parseLocal, fmtDuration } from './util.js';
import { leaveBy, taskScore } from './planner.js';
import { icon } from './ui.js';
import { fmtMoney } from './finance.js';

const mapsLink = (loc) => `https://maps.apple.com/?daddr=${encodeURIComponent(loc)}`;

export function eventRow(o, { conflict = false } = {}) {
  const lb = leaveBy(o);
  return `<li class="item ev cat-${h(o.category || 'personal')}${conflict ? ' conflict' : ''}" data-act="editEvent" data-id="${h(o.id)}">
    <div class="when">${o.allDay ? 'All day' : `${fmtTime(o.start)}<small>${fmtTime(o.end)}</small>`}</div>
    <div class="what">
      <strong>${h(o.title)}</strong>
      <div class="meta">
        ${o.location ? `<a href="${mapsLink(o.location)}" target="_blank" rel="noopener" data-stop>${icon('pin', 14)} ${h(o.location)}</a>` : ''}
        ${lb ? `<span class="chip">Leave by ${fmtTime(lb)}</span>` : ''}
        ${conflict ? `<span class="chip bad">Overlaps</span>` : ''}
        ${o.repeat && o.repeat !== 'none' ? `<span class="chip">↻ ${h(o.repeat)}</span>` : ''}
      </div>
    </div>
  </li>`;
}

export function taskRow(t, now = new Date()) {
  const due = parseLocal(t.due);
  const overdue = due && !t.done && due < now;
  const soon = due && !t.done && !overdue && due - now < 36 * 3.6e6;
  const subs = t.subtasks || [];
  const urgent = !t.done && taskScore(t, now) > 70;
  return `<li class="item task${t.done ? ' done' : ''}">
    <button class="check-btn" data-act="toggleTask" data-id="${h(t.id)}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${h(t.title)}" aria-pressed="${!!t.done}"></button>
    <div class="what" data-act="editTask" data-id="${h(t.id)}">
      <strong>${h(t.title)}</strong>
      <div class="meta">
        ${due ? `<span class="chip ${overdue ? 'bad' : soon ? 'warn' : ''}">${relDue(due, now)}</span>` : ''}
        ${t.priority === 3 ? '<span class="chip warn">High</span>' : ''}
        ${urgent && !overdue ? '<span class="chip warn">Do first</span>' : ''}
        ${t.estimate ? `<span class="muted">~${fmtDuration(t.estimate)}</span>` : ''}
        ${subs.length ? `<span class="muted">${subs.filter((s) => s.done).length}/${subs.length} steps</span>` : ''}
      </div>
    </div>
  </li>`;
}

export function subtaskList(t) {
  if (!t.subtasks?.length || t.done) return '';
  return `<li class="subs-wrap"><ul class="subs">${t.subtasks.map((s) => `<li><label><input type="checkbox" data-act="toggleSub" data-task="${h(t.id)}" data-id="${h(s.id)}" ${s.done ? 'checked' : ''}> ${h(s.title)}</label></li>`).join('')}</ul></li>`;
}

const list = (items, render, emptyText) => (items.length ? `<ul class="plain">${items.map(render).join('')}</ul>` : `<p class="muted">${emptyText}</p>`);

export function briefingHTML(b, now = new Date()) {
  return `
    <h3>Schedule</h3>
    ${list(b.events, (o) => `<li><b>${o.allDay ? 'All day' : fmtTime(o.start)}</b> ${h(o.title)}${o.location ? ` · ${h(o.location)}` : ''}${leaveBy(o) ? ` · <span class="chip">leave ${fmtTime(leaveBy(o))}</span>` : ''}</li>`, 'Nothing scheduled today.')}
    ${b.conflicts.length ? `<h3>Conflicts</h3>${list(b.conflicts, ([x, y]) => `<li class="bad-text">${h(x.title)} overlaps ${h(y.title)}</li>`, '')}` : ''}
    <h3>Due today</h3>
    ${list(b.dueToday, (t) => `<li>${h(t.title)} <span class="muted">${relDue(parseLocal(t.due), now)}</span></li>`, 'Nothing due today.')}
    ${b.tests.length ? `<h3>Tests, quizzes &amp; labs this week</h3>${list(b.tests, (x) => `<li>${h(x.title)} <span class="muted">${fmtDate(x.when)}</span></li>`, '')}` : ''}
    ${b.dueSoon.length ? `<h3>Next 3 days</h3>${list(b.dueSoon, (t) => `<li>${h(t.title)} <span class="muted">${relDue(parseLocal(t.due), now)}</span></li>`, '')}` : ''}
    <h3>Top priorities</h3>
    ${list(b.priorities, (t, i) => `<li>${i + 1}. ${h(t.title)}</li>`, 'No open tasks — nice.')}
    ${b.plan.length ? `<h3>Suggested plan</h3>${list(b.plan, (p) => `<li><b>${fmtTime(p.start)}–${fmtTime(p.end)}</b> ${h(p.title)}</li>`, '')}` : ''}
    <h3>Habits &amp; Bible</h3>
    <ul class="plain">
      ${b.habits.length ? `<li>Still to do: ${b.habits.map((x) => h(x.name)).join(', ')}</li>` : '<li>All habits done today.</li>'}
      <li>${b.bible.readToday ? `Read today ✓ (streak ${b.bible.current})` : `Next reading: ${b.bible.next.map((n) => `${h(n.name)} ${n.ch}`).join(', ') || 'complete!'}${b.bible.current ? ` · ${b.bible.current}-day streak` : ''}`}</li>
    </ul>
    ${b.emails.length ? `<h3>Important email</h3>${list(b.emails, (e) => `<li><b>${h(e.fromName || e.from)}</b> — ${h(e.subject)}</li>`, '')}` : ''}
    ${b.money ? `<h3>Money</h3><ul class="plain">
      ${b.money.week.allowance ? `<li>${b.money.week.left >= 0 ? `${fmtMoney(b.money.week.left)} left to spend this week` : `<span class="bad-text">${fmtMoney(-b.money.week.left)} over this week’s budget</span>`}</li>` : ''}
      ${b.money.bills.map((r) => `<li>${h(r.name)} ~${fmtMoney(r.amount)} due ${fmtDate(r.next)}</li>`).join('')}
      ${b.money.alerts.map((a) => `<li class="${a.level === 'bad' ? 'bad-text' : ''}">${h(a.text)}</li>`).join('')}</ul>` : ''}
    ${!b.money && !b.emails.length ? '<p class="muted small">Import bank transactions or connect email (Settings) to add money and email to this briefing.</p>' : ''}`;
}

export function recapHTML(r) {
  return `
    <h3>Done today</h3>
    ${list(r.done, (t) => `<li>✓ ${h(t.title)}</li>`, 'Nothing checked off today.')}
    <h3>Unfinished</h3>
    ${list(r.unfinished, (t) => `<li>${h(t.title)} <span class="muted">${relDue(parseLocal(t.due))}</span></li>`, 'Nothing left hanging.')}
    <h3>Tomorrow</h3>
    ${list(r.tomorrow, (o) => `<li><b>${o.allDay ? 'All day' : fmtTime(o.start)}</b> ${h(o.title)}${leaveBy(o) ? ` · leave ${fmtTime(leaveBy(o))}` : ''}</li>`, 'Nothing scheduled.')}
    ${r.upcoming.length ? `<h3>Coming deadlines</h3>${list(r.upcoming, (t) => `<li>${h(t.title)} <span class="muted">${relDue(parseLocal(t.due))}</span></li>`, '')}` : ''}
    <h3>Sleep</h3>
    <p>Aim for bed by <b>${fmtTime(r.bedtime)}</b> to wake at ${fmtTime(r.wake)}.</p>`;
}
