// Event and task editors shared by every screen.

import { update, state, logAction } from './store.js';
import { modal, field, select, toast, icon } from './ui.js';
import { CATEGORIES } from './planner.js';
import { matchCourse, stepPlan } from './school.js';
import { h, uid, dayKey, pad, parseLocal, addDays, addMinutes, toLocalInput } from './util.js';

const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function openEvent(ev = {}) {
  const isNew = !ev.id;
  const s = parseLocal(ev.start) || (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
  const e = parseLocal(ev.end) || addMinutes(s, 60);
  const body = `
    ${field('Title', `<input name="title" required autofocus value="${h(ev.title)}" placeholder="e.g. COMP-10205 Lecture">`)}
    <div class="row">
      ${field('Date', `<input type="date" name="date" value="${dayKey(s)}" required>`)}
      <label class="check"><input type="checkbox" name="allDay" ${ev.allDay ? 'checked' : ''}> All day</label>
    </div>
    <div class="row">
      ${field('Start', `<input type="time" name="startTime" value="${hm(s)}">`)}
      ${field('End', `<input type="time" name="endTime" value="${hm(e)}">`)}
    </div>
    <div class="row">
      ${field('Repeats', select('repeat', { none: 'Never', daily: 'Every day', weekdays: 'Weekdays', weekly: 'Every week' }, ev.repeat || 'none'))}
      ${field('Until', `<input type="date" name="until" value="${h(ev.until || '')}">`)}
    </div>
    <div class="row">
      ${field('Category', select('category', CATEGORIES, ev.category || 'personal'))}
      ${field('Travel (min)', `<input type="number" name="travelMin" min="0" max="300" value="${ev.travelMin || ''}" placeholder="0">`, 'Sets a “leave by” time')}
    </div>
    ${field('Location', `<input name="location" value="${h(ev.location)}" placeholder="Room / address">`)}
    ${field('Notes', `<textarea name="notes" rows="2">${h(ev.notes)}</textarea>`)}
    ${ev.source && ev.source !== 'manual' ? `<p class="muted small">Imported from ${h(ev.source)}. Re-importing updates it instead of duplicating.</p>` : ''}`;
  modal({
    title: isNew ? 'New event' : 'Edit event',
    body,
    extra: isNew ? '' : `<button type="button" class="btn danger" data-del>${icon('trash', 18)} Delete</button>`,
    onSubmit: (v) => {
      if (!v.title) { toast('Add a title'); return false; }
      let start, end;
      if (v.allDay) { start = v.date; end = dayKey(addDays(parseLocal(v.date), 1)); }
      else {
        const st = parseLocal(`${v.date}T${v.startTime || '09:00'}`);
        let en = parseLocal(`${v.date}T${v.endTime || hm(addMinutes(st, 60))}`);
        if (en <= st) en = addDays(en, 1);
        start = toLocalInput(st); end = toLocalInput(en);
      }
      const data = { title: v.title, allDay: v.allDay, start, end, repeat: v.repeat, until: v.repeat === 'none' ? '' : v.until, category: v.category, travelMin: +v.travelMin || 0, location: v.location, notes: v.notes };
      update((st) => {
        if (isNew) st.events.push({ id: uid(), source: 'manual', ...data });
        else Object.assign(st.events.find((x) => x.id === ev.id), data);
        logAction('event', `${isNew ? 'Added' : 'Edited'} event “${v.title}”`);
      });
      toast(isNew ? 'Event added' : 'Event saved');
    },
    onOpen: (form, close) => {
      form.querySelector('[data-del]')?.addEventListener('click', () => {
        update((st) => { st.events = st.events.filter((x) => x.id !== ev.id); logAction('event', `Deleted event “${ev.title}”`); });
        close(); toast('Event deleted');
      });
    },
  });
}

export function openTask(t = {}) {
  const isNew = !t.id;
  const due = parseLocal(t.due);
  const body = `
    ${field('Task', `<input name="title" required autofocus value="${h(t.title)}" placeholder="e.g. Lab 4 report">`)}
    <div class="row">
      ${field('Due date', `<input type="date" name="dueDate" value="${due ? dayKey(due) : ''}">`)}
      ${field('Time', `<input type="time" name="dueTime" value="${due ? hm(due) : '23:59'}">`)}
    </div>
    <div class="row">
      ${field('Priority', select('priority', { 3: 'High', 2: 'Normal', 1: 'Low' }, t.priority || 2))}
      ${field('Estimate (min)', `<input type="number" name="estimate" min="5" step="5" value="${t.estimate || 60}">`)}
    </div>
    ${field('Category', select('category', { school: 'School', study: 'Study', work: 'Work', church: 'Church', personal: 'Personal' }, t.category || 'school'))}
    ${state.courses.length ? field('Course', select('courseId', { '': 'None', ...Object.fromEntries(state.courses.map((c) => [c.id, c.code])) }, t.courseId || matchCourse(state.courses, t.title)?.id || '')) : ''}
    ${field('Steps', `<textarea name="subtasks" rows="3" placeholder="One step per line">${h((t.subtasks || []).map((x) => x.title).join('\n'))}</textarea>`, 'Break big work into smaller pieces · <button type="button" class="link" data-steps>Suggest steps</button>')}
    ${field('Notes', `<textarea name="notes" rows="2">${h(t.notes)}</textarea>`)}
    ${t.link ? `<p class="small"><a href="${h(t.link)}" target="_blank" rel="noopener">Open in Canvas</a></p>` : ''}`;
  modal({
    title: isNew ? 'New task' : 'Edit task',
    body,
    extra: isNew ? '' : `<button type="button" class="btn danger" data-del>${icon('trash', 18)} Delete</button>`,
    onSubmit: (v) => {
      if (!v.title) { toast('Add a title'); return false; }
      const prev = new Map((t.subtasks || []).map((x) => [x.title, x]));
      const subtasks = v.subtasks.split('\n').map((x) => x.trim()).filter(Boolean).map((title) => prev.get(title) || { id: uid(), title, done: false });
      const data = { title: v.title, due: v.dueDate ? `${v.dueDate}T${v.dueTime || '23:59'}` : '', priority: +v.priority, estimate: +v.estimate || 60, category: v.category, notes: v.notes, subtasks, courseId: v.courseId || t.courseId || '' };
      update((st) => {
        if (isNew) st.tasks.push({ id: uid(), done: false, created: new Date().toISOString(), source: 'manual', ...data });
        else Object.assign(st.tasks.find((x) => x.id === t.id), data);
        logAction('task', `${isNew ? 'Added' : 'Edited'} task “${v.title}”`);
      });
      toast(isNew ? 'Task added' : 'Task saved');
    },
    onOpen: (form, close) => {
      form.querySelector('[data-steps]').addEventListener('click', () => {
        const due = form.dueDate.value ? `${form.dueDate.value}T${form.dueTime.value || '23:59'}` : '';
        form.subtasks.value = stepPlan({ due }).map((s) => s.title).join('\n');
        form.subtasks.rows = 6;
      });
      form.querySelector('[data-del]')?.addEventListener('click', () => {
        update((st) => { st.tasks = st.tasks.filter((x) => x.id !== t.id); logAction('task', `Deleted task “${t.title}”`); });
        close(); toast('Task deleted');
      });
    },
  });
}

export function toggleTask(id) {
  update((st) => {
    const t = st.tasks.find((x) => x.id === id);
    t.done = !t.done;
    t.doneAt = t.done ? new Date().toISOString() : null;
  });
}

export function toggleSubtask(taskId, subId) {
  update((st) => {
    const s = st.tasks.find((x) => x.id === taskId)?.subtasks.find((x) => x.id === subId);
    if (s) s.done = !s.done;
  });
}

// Merge imported items by uid so re-importing never creates duplicates.
export function mergeImported({ events = [], tasks = [] }) {
  let added = 0, updated = 0;
  update((st) => {
    for (const e of events) {
      const cur = st.events.find((x) => x.uid && x.uid === e.uid);
      if (cur) { Object.assign(cur, { ...e, travelMin: cur.travelMin, category: cur.category }); updated++; }
      else { st.events.push({ id: uid(), ...e }); added++; }
    }
    for (const t of tasks) {
      const cur = st.tasks.find((x) => x.uid && x.uid === t.uid);
      if (cur) { Object.assign(cur, { title: t.title, due: t.due, link: t.link, notes: cur.notes || t.notes }); updated++; }
      else { st.tasks.push({ id: uid(), priority: 2, estimate: 90, done: false, subtasks: [], created: new Date().toISOString(), courseId: matchCourse(st.courses, t.title)?.id || '', ...t }); added++; }
    }
    logAction('import', `Imported ${added} new, ${updated} updated`);
  });
  return { added, updated };
}
