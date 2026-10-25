// Course grades (percent weights), required scores and exam study plans.

import { parseLocal, startOfDay, addDays, addMinutes, minutesBetween, toLocalInput, fmtDate } from './util.js';
import { freeSlots } from './planner.js';

// Common Ontario college scale (as used by Mohawk). Course outlines are the final word.
const SCALE = [[90, 'A+'], [85, 'A'], [80, 'A-'], [77, 'B+'], [73, 'B'], [70, 'B-'], [67, 'C+'], [63, 'C'], [60, 'C-'], [57, 'D+'], [53, 'D'], [50, 'D-'], [0, 'F']];
export const letter = (pct) => (pct == null || isNaN(pct) ? '—' : SCALE.find(([min]) => pct >= min)[1]);

export const ITEM_TYPES = { assignment: 'Assignment', quiz: 'Quiz', test: 'Test', midterm: 'Midterm', exam: 'Final exam', lab: 'Lab', project: 'Project', participation: 'Participation' };
const EXAMISH = /test|midterm|exam|quiz/;

export const isGraded = (it) => it.score !== '' && it.score != null && !isNaN(+it.score);

export function grade(course) {
  const items = course.items || [];
  const totalW = items.reduce((a, i) => a + (+i.weight || 0), 0);
  const graded = items.filter(isGraded);
  const gradedW = graded.reduce((a, i) => a + (+i.weight || 0), 0);
  const earned = graded.reduce((a, i) => a + ((+i.weight || 0) * +i.score) / 100, 0);
  const remainingW = Math.max(0, totalW - gradedW);
  const current = gradedW ? (earned / gradedW) * 100 : null;
  const target = +course.target || 70;
  // Average needed on everything not yet graded to finish at the target.
  const needed = remainingW ? ((target * totalW) / 100 - earned) / remainingW * 100 : null;
  return {
    totalW, gradedW, remainingW, earned, current, target, needed,
    letter: letter(current),
    // If every remaining item scored 100 / 0:
    best: totalW ? ((earned + remainingW) / totalW) * 100 : null,
    worst: totalW ? (earned / totalW) * 100 : null,
    weightOk: Math.abs(totalW - 100) < 0.01,
  };
}

// "What do I need on <item> to reach X%?", assuming other ungraded items score `others`.
export function neededOn(course, itemId, targetPct, others = null) {
  const items = course.items || [];
  const totalW = items.reduce((a, i) => a + (+i.weight || 0), 0);
  const it = items.find((i) => i.id === itemId);
  if (!it || !+it.weight) return null;
  const g = grade(course);
  const assumeOthers = others ?? (g.current ?? 75);
  const rest = items.filter((i) => i.id !== itemId && !isGraded(i)).reduce((a, i) => a + ((+i.weight || 0) * assumeOthers) / 100, 0);
  return ((targetPct * totalW) / 100 - g.earned - rest) / (+it.weight) * 100;
}

// Matches "[COMP-10205]" style codes from Canvas task titles to a course.
export function matchCourse(courses, text) {
  const t = String(text || '').toUpperCase().replace(/\s+/g, '');
  return courses.find((c) => c.code && t.includes(c.code.toUpperCase().replace(/\s+/g, '')));
}

export const upcomingExams = (state, now = new Date(), days = 21) =>
  state.courses.flatMap((c) => (c.items || []).filter((i) => EXAMISH.test(i.type) && !isGraded(i) && i.due)
    .map((i) => ({ course: c, item: i, when: parseLocal(i.due) })))
    .filter((x) => x.when > now && x.when < addDays(now, days))
    .sort((a, b) => a.when - b.when);

// Spreads study hours over the days before an exam, using free time only.
// Later days get more time; the day before is a review session.
export function studyPlan(state, { title, when, hours = 6, now = new Date(), maxPerDay = 120 }) {
  const examDay = startOfDay(when);
  const days = [];
  for (let d = addDays(examDay, -1); d >= startOfDay(now) && days.length < 7; d = addDays(d, -1)) days.unshift(d);
  if (!days.length) return [];
  let left = hours * 60;
  const weights = days.map((_, i) => i + 1);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const blocks = [];
  days.forEach((d, i) => {
    let want = Math.min(maxPerDay, Math.round((hours * 60 * weights[i]) / wsum / 15) * 15, left);
    for (const [s, e] of freeSlots(state.events, d, state.settings, now)) {
      if (want < 30) break;
      const len = Math.min(want, 90, minutesBetween(s, e));
      if (len < 30) continue;
      const last = i === days.length - 1;
      blocks.push({ start: s, end: addMinutes(s, len), title: `${last ? 'Review' : 'Study'}: ${title}`, kind: 'study' });
      want -= len; left -= len;
    }
  });
  return blocks;
}

// Default step plan for an assignment: steps with suggested finish dates before the due date.
export function stepPlan(task, now = new Date()) {
  const due = parseLocal(task.due);
  const steps = ['Read the instructions & rubric', 'Research / gather materials', 'Outline or plan', 'First draft / do the work', 'Review against rubric & fix', 'Submit'];
  if (!due || due <= now) return steps.map((title) => ({ title }));
  const span = due - now;
  const marks = [0.1, 0.25, 0.4, 0.7, 0.9, 1];
  return steps.map((title, i) => {
    const by = new Date(now.getTime() + span * marks[i]);
    return { title: `${title} (by ${fmtDate(by)})` };
  });
}

export const blockToEvent = (b, id) => ({ id, title: b.title, start: toLocalInput(b.start), end: toLocalInput(b.end), allDay: false, category: b.kind || 'study', repeat: 'none', source: 'plan' });
