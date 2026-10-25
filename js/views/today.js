import { state, update, logAction } from '../store.js';
import { briefing, recap, alerts, dayOccurrences, conflicts, openTasks, importantEmails } from '../planner.js';
import * as Bible from '../bible.js';
import * as Fin from '../finance.js';
import * as Plans from '../plans.js';
import { eventRow, taskRow, briefingHTML, recapHTML } from '../components.js';
import { icon, modal, ring, empty, toast, bar } from '../ui.js';
import { openEvent, openTask } from '../forms.js';
import { emailPrompt, applyTool, describeTool } from '../ai.js';
import { dismissInbox } from '../connect.js';
import { h, fmtDate, fmtTime, dayKey, toLocalInput, uid, relDue } from '../util.js';

let plan = [];

const greeting = (d) => (d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening');
const isEvening = (now) => state.settings.recap && now.getHours() >= state.settings.recapHour;

const cards = {
  briefing(now) {
    const b = briefing(state, now);
    plan = b.plan;
    if (isEvening(now)) {
      const r = recap(state, now);
      return `<section class="card accent"><div class="card-head"><h2>${icon('moon', 18)} Evening recap</h2><button class="link" data-act="openRecap">Open</button></div>
        <p>${r.done.length} done today${r.unfinished.length ? `, ${r.unfinished.length} unfinished` : ''}. ${r.tomorrow.length ? `Tomorrow starts ${r.tomorrow[0].allDay ? 'with an all-day event' : `at ${fmtTime(r.tomorrow[0].start)}`}.` : 'Tomorrow is clear.'} Bed by <b>${fmtTime(r.bedtime)}</b>.</p></section>`;
    }
    const first = b.events.find((o) => !o.allDay);
    const bits = [
      b.events.length ? `${b.events.length} event${b.events.length > 1 ? 's' : ''}${first ? `, first at ${fmtTime(first.start)}` : ''}` : 'a clear calendar',
      b.dueToday.length ? `${b.dueToday.length} due today` : null,
      b.tests.length ? `${b.tests.length} ${b.tests.length > 1 ? 'tests/labs' : 'test/lab'} this week` : null,
      b.conflicts.length ? `<span class="bad-text">${b.conflicts.length} conflict${b.conflicts.length > 1 ? 's' : ''}</span>` : null,
      b.emails.length ? `${b.emails.length} important email${b.emails.length > 1 ? 's' : ''}` : null,
      b.money?.week.allowance ? (b.money.week.left >= 0 ? `${Fin.fmtMoney(b.money.week.left)} to spend this week` : `<span class="bad-text">${Fin.fmtMoney(-b.money.week.left)} over this week’s budget</span>`) : null,
    ].filter(Boolean);
    return `<section class="card accent"><div class="card-head"><h2>${icon('sun', 18)} Daily briefing</h2><button class="link" data-act="openBriefing">Full briefing</button></div>
      <p>You have ${bits.join(' · ')}.${b.priorities[0] ? ` Start with <b>${h(b.priorities[0].title)}</b>.` : ''}</p>
      ${state.settings.apiKey ? `<button class="btn small" data-act="aiBriefing">Ask Compass to talk me through today</button>` : ''}</section>`;
  },
  alerts(now) {
    const a = alerts(state, now);
    if (!a.length) return '';
    return `<section class="card"><div class="card-head"><h2>${icon('alert', 18)} Heads up</h2></div>
      <ul class="alerts">${a.map((x) => `<li class="${x.level}"><a href="#${x.go}">${h(x.text)}</a></li>`).join('')}</ul></section>`;
  },
  schedule(now) {
    const occ = dayOccurrences(state.events, now);
    const clash = new Set(conflicts(occ).flat().map((o) => o.occId));
    return `<section class="card"><div class="card-head"><h2>Today’s schedule</h2><button class="icon-btn" data-act="newEvent" aria-label="Add event">${icon('plus', 20)}</button></div>
      ${occ.length ? `<ul class="list">${occ.map((o) => eventRow(o, { conflict: clash.has(o.occId) })).join('')}</ul>` : empty('Nothing on the calendar today.')}</section>`;
  },
  tasks(now) {
    const open = openTasks(state.tasks, now).slice(0, 5);
    return `<section class="card"><div class="card-head"><h2>Focus tasks</h2><span><a class="link" href="#tasks">All</a><button class="icon-btn" data-act="newTask" aria-label="Add task">${icon('plus', 20)}</button></span></div>
      ${open.length ? `<ul class="list">${open.map((t) => taskRow(t, now)).join('')}</ul>` : empty('No open tasks.')}</section>`;
  },
  plan() {
    if (!plan.length) return '';
    return `<section class="card"><div class="card-head"><h2>Suggested plan</h2><button class="link" data-act="addAllPlan">Add all</button></div>
      <p class="muted small">Built from your free time and most urgent work. Nothing is added unless you tap it.</p>
      <ul class="list">${plan.map((p, i) => `<li class="item ev cat-${p.kind}"><div class="when">${fmtTime(p.start)}<small>${fmtTime(p.end)}</small></div><div class="what"><strong>${h(p.title)}</strong></div><button class="btn small" data-act="addPlan" data-i="${i}">Add</button></li>`).join('')}</ul></section>`;
  },
  money(now) {
    const fin = state.finance;
    if (!fin.txns.length) return '';
    const w = Fin.weekStatus(fin, now);
    const bills = Fin.recurring(fin, now).filter((r) => !r.income && (r.next - now) / 86400000 <= 5);
    return `<section class="card"><div class="card-head"><h2>${icon('money', 18)} Money</h2><a class="link" href="#money">Open</a></div>
      ${!w.allowance ? '' : w.left >= 0
        ? `<div class="big">${Fin.fmtMoney(w.left)}</div><div class="muted small">left to spend this week</div>${bar(w.spent / w.allowance)}`
        : `<div class="big bad-text">${Fin.fmtMoney(-w.left)} over</div><div class="muted small">this week’s ${Fin.fmtMoney(w.allowance)} spending money</div>${bar(w.spent / w.allowance)}`}
      ${bills.length ? `<ul class="plain small">${bills.map((r) => `<li>${h(r.name)} ~${Fin.fmtMoney(r.amount)} · ${fmtDate(r.next)}</li>`).join('')}</ul>` : ''}</section>`;
  },
  emails(now) {
    const list = importantEmails(state, now).filter((e) => e.unread).slice(0, 4);
    if (!list.length) return '';
    return `<section class="card"><div class="card-head"><h2>${icon('mail', 18)} Important email</h2></div>
      <ul class="list">${list.map((e) => `<li class="item"><div class="what"><strong>${h(e.subject)}</strong><div class="meta"><span class="muted">${h(e.fromName || e.from)} · ${relDue(new Date(e.date), now).replace('overdue', 'ago')}</span></div></div>
      <button class="btn small" data-act="emailHelp" data-id="${h(e.id)}">Help</button></li>`).join('')}</ul></section>`;
  },
  habits(now) {
    if (!state.habits.length) return '';
    const k = dayKey(now);
    return `<section class="card"><div class="card-head"><h2>Habits</h2><a class="link" href="#habits">Manage</a></div>
      <div class="pills">${state.habits.map((hb) => `<button class="pill${hb.log?.[k] ? ' on' : ''}" data-act="toggleHabit" data-id="${h(hb.id)}" aria-pressed="${!!hb.log?.[k]}">${hb.log?.[k] ? '✓ ' : ''}${h(hb.name)}</button>`).join('')}</div></section>`;
  },
  bible(now) {
    const st = Bible.stats(state.bible), sk = Bible.streak(state.bible, now);
    const next = Plans.nextChapters(state.bible);
    return `<section class="card bible-card"><div class="card-head"><h2>Bible</h2><a class="link" href="#bible">Open</a></div>
      <div class="ring-row">${ring(st.pct, 72, `${(st.pct * 100).toFixed(1)}% of the Bible read`)}<div>
        <div class="big">${(st.pct * 100).toFixed(1)}%</div>
        <div class="muted small">${st.total.read}/${st.total.total} chapters · ${sk.current}-day streak</div>
        ${sk.readToday ? '<div class="good-text small">Read today ✓</div>' : next.length ? `<button class="btn small" data-act="readNext">Mark ${h(next.map((n) => `${n.name} ${n.ch}`).join(', '))} read</button>` : ''}
      </div></div></section>`;
  },
};

// Things you asked Siri to add, waiting for a yes/no.
function voiceInboxCard() {
  const items = state.voiceInbox || [];
  if (!items.length) return '';
  return `<section class="card accent"><div class="card-head"><h2>${icon('mic', 18)} From Siri — approve?</h2></div>
    ${items.map((x) => { const d = describeTool(x.name, x.input); return `<div class="approval"><div><div class="muted small">“${h(x.question)}” · ${h(d.title)}</div><strong>${h(d.body)}</strong></div>
      <div class="approval-btns"><button class="btn small ghost" data-act="voiceDecline" data-id="${h(x.id)}">Decline</button><button class="btn small primary" data-act="voiceApprove" data-id="${h(x.id)}">Approve</button></div></div>`; }).join('')}</section>`;
}

const blockFromPlan = (p) => ({ id: uid(), title: p.title, start: toLocalInput(p.start), end: toLocalInput(p.end), allDay: false, category: p.kind, repeat: 'none', source: 'plan', taskId: p.taskId || '' });

export default {
  id: 'today',
  title: 'Today',
  render() {
    const now = new Date();
    const on = state.settings.homeCards.filter((c) => c.on).map((c) => c.id);
    if (!on.includes('briefing')) plan = briefing(state, now).plan;
    return `<header class="page-head"><div><p class="muted">${fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1>${greeting(now)}${state.settings.name ? `, ${h(state.settings.name)}` : ''}</h1></div></header>
      ${voiceInboxCard()}
      <div class="grid">${on.map((id) => cards[id]?.(now) || '').join('')}</div>`;
  },
  act: {
    voiceApprove: async (el) => {
      const item = state.voiceInbox.find((x) => x.id === el.dataset.id);
      if (!item) return;
      try {
        update((s) => { const summary = applyTool(s, item.name, item.input); logAction('ai', `From Siri: ${summary}`, 'approved', 'Compass voice'); s.voiceInbox = s.voiceInbox.filter((x) => x.id !== item.id); });
        toast('Added');
      } catch (e) { toast(e.message); return; }
      dismissInbox(item.id).catch(() => {});
    },
    voiceDecline: (el) => {
      update((s) => { s.voiceInbox = s.voiceInbox.filter((x) => x.id !== el.dataset.id); logAction('ai', 'Declined a Siri request', 'declined', 'Compass voice'); });
      dismissInbox(el.dataset.id).catch(() => {});
    },
    newEvent: () => openEvent({ start: toLocalInput(new Date()) }),
    newTask: () => openTask(),
    openBriefing: () => modal({ title: `Briefing · ${fmtDate(new Date())}`, body: `<div class="prose">${briefingHTML(briefing(state, new Date()))}</div>` }),
    openRecap: () => modal({ title: 'Evening recap', body: `<div class="prose">${recapHTML(recap(state, new Date()))}</div>` }),
    emailHelp: (el) => {
      const e = state.emails.find((x) => x.id === el.dataset.id);
      sessionStorage.setItem('compass:prompt', emailPrompt(`From: ${e.fromName || ''} <${e.from}>\nSubject: ${e.subject}\nDate: ${e.date}\n\n${e.body || e.snippet}`));
      location.hash = 'chat';
    },
    aiBriefing: () => { sessionStorage.setItem('compass:prompt', 'Give me my daily briefing and tell me what to focus on first.'); location.hash = 'chat'; },
    addPlan: (el) => {
      const p = plan[+el.dataset.i];
      update((s) => { s.events.push(blockFromPlan(p)); logAction('plan', `Added plan block “${p.title}” ${fmtTime(p.start)}`); });
      toast('Added to calendar');
    },
    addAllPlan: () => {
      update((s) => { plan.forEach((p) => s.events.push(blockFromPlan(p))); logAction('plan', `Added ${plan.length} suggested blocks`); });
      toast(`Added ${plan.length} blocks`);
    },
    toggleHabit: (el) => update((s) => {
      const hb = s.habits.find((x) => x.id === el.dataset.id);
      const k = dayKey(new Date());
      hb.log ||= {};
      if (hb.log[k]) delete hb.log[k]; else hb.log[k] = true;
    }),
    readNext: () => update((s) => {
      Plans.nextChapters(s.bible).forEach((n) => Bible.logReading(s.bible, { book: n.book, from: n.ch, to: n.ch }));
    }),
  },
};
