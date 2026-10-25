import { state, update, logAction } from '../store.js';
import { openTasks } from '../planner.js';
import { taskRow, subtaskList } from '../components.js';
import { icon, empty, modal, field, select, toast, bar, confirmSheet } from '../ui.js';
import { openTask } from '../forms.js';
import { scanButton } from '../scan.js';
import * as School from '../school.js';
import { h, uid, parseLocal, startOfDay, addDays, fmtDate, fmtTime, relDue } from '../util.js';

let tab = 'open';

function groups(now) {
  const open = openTasks(state.tasks, now);
  const tomorrow = addDays(startOfDay(now), 1);
  const week = addDays(startOfDay(now), 7);
  const by = (fn) => open.filter(fn);
  return [
    ['Overdue', by((t) => t.due && parseLocal(t.due) < now)],
    ['Today', by((t) => t.due && parseLocal(t.due) >= now && parseLocal(t.due) < tomorrow)],
    ['This week', by((t) => t.due && parseLocal(t.due) >= tomorrow && parseLocal(t.due) < week)],
    ['Later', by((t) => t.due && parseLocal(t.due) >= week)],
    ['No due date', by((t) => !t.due)],
  ].filter(([, items]) => items.length);
}

const pct = (v) => (v == null || isNaN(v) ? '—' : `${v.toFixed(1)}%`);

function courseCard(c) {
  const g = School.grade(c);
  const need = g.needed;
  const needText = need == null ? 'All items graded'
    : need > 100 ? `<span class="bad-text">${c.target}% is out of reach (needs ${need.toFixed(0)}%)</span>`
    : need <= 0 ? `<span class="good-text">${c.target}% is locked in</span>`
    : `Need <b>${need.toFixed(1)}%</b> avg on the remaining ${g.remainingW}% to reach ${c.target}%`;
  const due = state.tasks.filter((t) => !t.done && t.courseId === c.id).length;
  return `<li class="item course" data-act="openCourse" data-id="${h(c.id)}">
    <div class="grade-badge">${g.letter}</div>
    <div class="what"><strong>${h(c.code)}${c.name ? ` · ${h(c.name)}` : ''}</strong>
      <div class="meta"><span>${pct(g.current)} so far · ${g.gradedW}% of grade marked</span>${due ? `<span class="chip">${due} open task${due > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="small">${needText}</div>
      ${g.weightOk ? '' : `<div class="small warn-text">Weights add up to ${g.totalW}% (should be 100%)</div>`}
    </div></li>`;
}

function courseEditor(c = {}) {
  const isNew = !c.id;
  const items = c.items?.length ? c.items : [{ id: uid(), name: '', type: 'assignment', weight: '', score: '', due: '' }];
  const row = (it) => `<div class="grade-row" data-row="${h(it.id)}">
    <input name="n" value="${h(it.name)}" placeholder="Item (e.g. Lab 1)" aria-label="Item name">
    ${select('t', School.ITEM_TYPES, it.type || 'assignment').replace('<select', '<select aria-label="Type"')}
    <input name="w" type="number" min="0" max="100" step="0.5" value="${h(it.weight)}" placeholder="Wt %" aria-label="Weight percent">
    <input name="s" type="number" min="0" max="150" step="0.1" value="${h(it.score)}" placeholder="Score %" aria-label="Score percent">
    <input name="d" type="date" value="${h((it.due || '').slice(0, 10))}" aria-label="Due date">
    <button type="button" class="icon-btn" data-delrow aria-label="Remove item">${icon('close', 16)}</button>
  </div>`;
  modal({
    title: isNew ? 'Add course' : `Edit ${c.code}`,
    body: `<div class="row">${field('Course code', `<input name="code" value="${h(c.code)}" placeholder="COMP-10205" autofocus required>`)}
      ${field('Target %', `<input type="number" name="target" min="50" max="100" value="${c.target || 80}">`)}</div>
      ${field('Course name', `<input name="name" value="${h(c.name)}" placeholder="Intro to Programming">`)}
      ${field('Professor / notes', `<input name="notes" value="${h(c.notes)}">`)}
      <h3>Grade breakdown <span class="muted small">(from your course outline)</span></h3>
      <div class="grade-head small muted"><span>Item</span><span>Type</span><span>Weight</span><span>Score</span><span>Due</span><span></span></div>
      <div data-rows>${items.map(row).join('')}</div>
      <button type="button" class="btn small" data-addrow>${icon('plus', 16)} Add item</button>
      <p class="muted small" data-total></p>`,
    extra: isNew ? '' : `<button type="button" class="btn danger" data-delcourse>${icon('trash', 18)}</button>`,
    onOpen: (form, close) => {
      const total = () => {
        const sum = [...form.querySelectorAll('[name="w"]')].reduce((a, i) => a + (+i.value || 0), 0);
        form.querySelector('[data-total]').innerHTML = `Weights total <b class="${Math.abs(sum - 100) < 0.01 ? 'good-text' : 'warn-text'}">${sum}%</b>`;
      };
      total();
      form.addEventListener('input', total);
      form.querySelector('[data-addrow]').addEventListener('click', () => {
        form.querySelector('[data-rows]').insertAdjacentHTML('beforeend', row({ id: uid(), type: 'assignment' }));
      });
      form.addEventListener('click', (e) => { if (e.target.closest('[data-delrow]')) { e.target.closest('.grade-row').remove(); total(); } });
      form.querySelector('[data-delcourse]')?.addEventListener('click', async () => {
        close();
        if (await confirmSheet(`Delete ${c.code}?`, 'Its grade breakdown will be removed. Tasks stay.', 'Delete')) {
          update((s) => { s.courses = s.courses.filter((x) => x.id !== c.id); });
        }
      });
    },
    onSubmit: (v, form) => {
      if (!v.code) { toast('Add a course code'); return false; }
      const rows = [...form.querySelectorAll('.grade-row')].map((r) => ({
        id: r.dataset.row, name: r.querySelector('[name="n"]').value.trim(), type: r.querySelector('[name="t"]').value,
        weight: r.querySelector('[name="w"]').value === '' ? '' : +r.querySelector('[name="w"]').value,
        score: r.querySelector('[name="s"]').value === '' ? '' : +r.querySelector('[name="s"]').value,
        due: r.querySelector('[name="d"]').value ? `${r.querySelector('[name="d"]').value}T23:59` : '',
      })).filter((r) => r.name || r.weight !== '');
      const data = { code: v.code.toUpperCase(), name: v.name, target: +v.target || 80, notes: v.notes, items: rows };
      update((s) => {
        if (isNew) s.courses.push({ id: uid(), ...data });
        else Object.assign(s.courses.find((x) => x.id === c.id), data);
        // Link existing tasks that mention the course code.
        const course = s.courses.find((x) => x.code === data.code);
        s.tasks.forEach((t) => { if (!t.courseId && School.matchCourse([course], t.title)) t.courseId = course.id; });
        logAction('school', `${isNew ? 'Added' : 'Updated'} course ${data.code}`);
      });
      toast('Course saved');
    },
  });
}

function courseDetail(c) {
  const g = School.grade(c);
  const pending = c.items.filter((i) => !School.isGraded(i) && +i.weight);
  const tasks = state.tasks.filter((t) => t.courseId === c.id && !t.done);
  const exams = School.upcomingExams(state).filter((x) => x.course.id === c.id);
  modal({
    title: `${c.code}${c.name ? ` · ${c.name}` : ''}`,
    body: `<div class="stats3"><div><div class="big">${pct(g.current)}</div><div class="muted small">current (${g.letter})</div></div>
        <div><div class="big">${g.gradedW}%</div><div class="muted small">marked</div></div>
        <div><div class="big">${g.needed == null ? '—' : `${Math.max(0, g.needed).toFixed(0)}%`}</div><div class="muted small">needed avg</div></div></div>
      ${bar((g.current || 0) / 100)}
      <p class="small muted">Range if you score 0–100% on the rest: <b>${pct(g.worst)}</b> to <b>${pct(g.best)}</b> (${letter2(g.worst)}–${letter2(g.best)}).</p>
      <h3>Items</h3>
      <ul class="plain">${c.items.map((i) => `<li>${h(i.name || School.ITEM_TYPES[i.type])} <span class="muted">· ${i.weight || 0}%</span>
        ${School.isGraded(i) ? `<b>${i.score}%</b>` : `<span class="chip">${i.due ? relDue(parseLocal(i.due)) : 'not marked'}</span>`}</li>`).join('') || '<li class="muted">No items yet — tap Edit.</li>'}</ul>
      ${pending.length ? `<h3>What do I need?</h3>
        <div class="row">${field('On', select('calcItem', Object.fromEntries(pending.map((i) => [i.id, `${i.name || School.ITEM_TYPES[i.type]} (${i.weight}%)`])), pending.at(-1).id))}
        ${field('To finish with', `<input type="number" name="calcTarget" value="${c.target}" min="0" max="100">`)}</div>
        <p data-calc class="calc"></p>` : ''}
      ${exams.length ? `<h3>Upcoming tests</h3>${exams.map((x) => `<div class="row exam-row"><span class="grow">${h(x.item.name || School.ITEM_TYPES[x.item.type])} — ${fmtDate(x.when)}</span>
        <button type="button" class="btn small" data-plan="${h(x.item.id)}">Study plan</button></div>`).join('')}` : ''}
      ${tasks.length ? `<h3>Open tasks</h3><ul class="plain">${tasks.map((t) => `<li>${h(t.title)} <span class="muted">${t.due ? relDue(parseLocal(t.due)) : ''}</span></li>`).join('')}</ul>` : ''}`,
    extra: '<button type="button" class="btn" data-edit>Edit</button>',
    submit: 'Done',
    onSubmit: () => {},
    onOpen: (form, close) => {
      const calc = () => {
        const out = form.querySelector('[data-calc]');
        if (!out) return;
        const need = School.neededOn(c, form.calcItem.value, +form.calcTarget.value);
        const others = c.items.filter((i) => !School.isGraded(i) && i.id !== form.calcItem.value && +i.weight).length;
        out.innerHTML = need == null ? '' : need > 100 ? `<span class="bad-text">You'd need ${need.toFixed(1)}% — not possible${others ? ' unless other items go better' : ''}.</span>`
          : need <= 0 ? '<span class="good-text">You already have that, even with a 0.</span>'
          : `You need <b>${need.toFixed(1)}%</b>${others ? ` (assuming ${pct(g.current ?? 75)} on the other ${others} unmarked item${others > 1 ? 's' : ''})` : ''}.`;
      };
      calc();
      form.addEventListener('input', calc);
      form.addEventListener('change', calc);
      form.querySelector('[data-edit]').addEventListener('click', () => { close(); courseEditor(c); });
      form.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => {
        const x = exams.find((e) => e.item.id === b.dataset.plan);
        close();
        planSheet(`${c.code} ${x.item.name || School.ITEM_TYPES[x.item.type]}`, x.when);
      }));
    },
  });
}

const letter2 = (v) => School.letter(v);

export function planSheet(title, when) {
  const draw = (hours) => School.studyPlan(state, { title, when, hours });
  let blocks = draw(6);
  const list = () => (blocks.length ? `<ul class="plain">${blocks.map((b) => `<li><b>${fmtDate(b.start)} ${fmtTime(b.start)}–${fmtTime(b.end)}</b> ${h(b.title)}</li>`).join('')}</ul>`
    : '<p class="muted">No free time found before the test. Try fewer hours or free up your calendar.</p>');
  modal({
    title: `Study plan · ${title}`,
    body: `${field('Total study hours', '<input type="number" name="hours" min="1" max="30" value="6">', 'More time closer to the test; the last session is a review.')}
      <div data-blocks>${list()}</div>`,
    submit: 'Add to calendar',
    onOpen: (form) => form.hours.addEventListener('input', () => { blocks = draw(+form.hours.value || 1); form.querySelector('[data-blocks]').innerHTML = list(); }),
    onSubmit: () => {
      if (!blocks.length) return false;
      update((s) => { blocks.forEach((b) => s.events.push(School.blockToEvent(b, uid()))); logAction('school', `Added ${blocks.length}-block study plan for ${title}`); });
      toast(`Added ${blocks.length} study sessions`);
    },
  });
}

export default {
  id: 'tasks',
  title: 'Tasks',
  render() {
    const now = new Date();
    const seg = `<div class="seg">${[['open', 'To do'], ['courses', 'Courses'], ['done', 'Done']].map(([f, l]) => `<button class="${tab === f ? 'on' : ''}" aria-pressed="${tab === f}" data-act="tab" data-f="${f}">${l}</button>`).join('')}</div>`;
    if (tab === 'courses') {
      const exams = School.upcomingExams(state, now, 14);
      return `<header class="page-head"><h1>School</h1><button class="btn primary" data-act="newCourse">${icon('plus', 18)} Course</button></header>
        <div class="toolbar">${seg}</div>
        ${exams.length ? `<section class="card accent"><h2>Tests in the next 2 weeks</h2>${exams.map((x) => `<div class="row exam-row"><span class="grow"><b>${h(x.course.code)}</b> ${h(x.item.name || School.ITEM_TYPES[x.item.type])} · ${relDue(x.when, now)}</span><button class="btn small" data-act="examPlan" data-c="${h(x.course.id)}" data-i="${h(x.item.id)}">Study plan</button></div>`).join('')}</section>` : ''}
        <section class="card">${state.courses.length ? `<ul class="list">${state.courses.map(courseCard).join('')}</ul>`
          : empty('Add each course with the grade breakdown from its outline (e.g. Labs 20%, Midterm 25%, Final 35%). Compass works out your current grade and what you need.', `<button class="btn" data-act="newCourse">Add a course</button>`)}</section>
        <p class="muted small">Letter grades use the common Ontario college scale (A+ 90+, A 85, A- 80, B+ 77 … D- 50). Your course outline is the final word.</p>`;
    }
    const head = `<header class="page-head"><h1>Tasks</h1><span class="row">${state.settings.apiKey ? scanButton('Scan') : ''}<button class="btn primary" data-act="newTask">${icon('plus', 18)} Task</button></span></header>
      <div class="toolbar">${seg}<span class="muted small">Sorted by urgency</span></div>`;
    if (tab === 'done') {
      const done = state.tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
      return head + `<section class="card">${done.length ? `<ul class="list">${done.map((t) => taskRow(t, now)).join('')}</ul>` : empty('Nothing completed yet.')}</section>`;
    }
    const g = groups(now);
    if (!g.length) return head + `<section class="card">${empty('No open tasks. Add one, or import your Canvas calendar in Settings to pull in assignments.', `<button class="btn" data-act="newTask">Add a task</button>`)}</section>`;
    return head + g.map(([name, items]) => `<section class="card"><h2>${name} <span class="count">${items.length}</span></h2>
      <ul class="list">${items.map((t) => taskRow(t, now) + subtaskList(t)).join('')}</ul></section>`).join('');
  },
  act: {
    newTask: () => openTask(),
    tab: (el) => { tab = el.dataset.f; },
    newCourse: () => courseEditor(),
    openCourse: (el) => courseDetail(state.courses.find((c) => c.id === el.dataset.id)),
    examPlan: (el) => {
      const c = state.courses.find((x) => x.id === el.dataset.c);
      const it = c.items.find((x) => x.id === el.dataset.i);
      planSheet(`${c.code} ${it.name || School.ITEM_TYPES[it.type]}`, parseLocal(it.due));
    },
  },
};
