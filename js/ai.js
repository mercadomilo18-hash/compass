// Claude integration. The key is entered by the user in Settings, kept in on-device
// (encrypted when a passcode is set) storage, and sent only to api.anthropic.com.
// Every change Claude proposes goes through the approval cards in the chat.

import { state } from './store.js';
import * as Bible from './bible.js';
import * as Fin from './finance.js';
import * as School from './school.js';
import * as Plans from './plans.js';
import { occurrences, openTasks, freeSlots, briefing } from './planner.js';
import { startOfDay, addDays, parseLocal, fmtTime, fmtDate, toLocalInput, relDue, dayKey, fmtDuration } from './util.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.132.1/+esm';
export const MODEL = 'claude-opus-5-5';

let sdk;
const loadSDK = () => (sdk ||= import(SDK_URL).then((m) => m.default || m.Anthropic));

export const TOOLS = [
  {
    name: 'create_task',
    description: 'Propose adding a task or assignment. The user must approve before it is saved.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        due: { type: 'string', description: 'Local due date-time, YYYY-MM-DDTHH:mm. Omit if none.' },
        priority: { type: 'integer', enum: [1, 2, 3], description: '1 low, 2 normal, 3 high' },
        estimate_minutes: { type: 'integer' },
        category: { type: 'string', enum: ['school', 'study', 'work', 'church', 'personal'] },
        subtasks: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_event',
    description: 'Propose adding a calendar event or time block (study, gym, etc). The user must approve.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'Local YYYY-MM-DDTHH:mm' },
        end: { type: 'string', description: 'Local YYYY-MM-DDTHH:mm' },
        location: { type: 'string' },
        category: { type: 'string', enum: ['class', 'school', 'study', 'work', 'church', 'gym', 'personal'] },
        notes: { type: 'string' },
      },
      required: ['title', 'start', 'end'],
    },
  },
  {
    name: 'add_subtasks',
    description: 'Propose breaking an existing task into smaller steps. Use the task id from the context.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, subtasks: { type: 'array', items: { type: 'string' } } },
      required: ['task_id', 'subtasks'],
    },
  },
  {
    name: 'complete_task',
    description: 'Propose marking an existing task done.',
    input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'draft_reply',
    description: 'Show the user a draft email reply they can copy into their mail app. Compass never sends email itself.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address if known' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['subject', 'body'],
    },
  },
  {
    name: 'log_bible_reading',
    description: 'Propose logging Bible chapters as read, with an optional note or favorite verse.',
    input_schema: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'Book name, e.g. "John" or "1 Corinthians"' },
        chapter_start: { type: 'integer' },
        chapter_end: { type: 'integer' },
        note: { type: 'string' },
        favorite_verse: { type: 'string' },
      },
      required: ['book', 'chapter_start'],
    },
  },
];

const INSTRUCTIONS = `You are Compass, a proactive personal assistant for a college student (Mohawk College, Ontario) who also tracks church commitments, habits and Bible reading.
Be warm, brief and practical; this is read on a phone. Use short paragraphs or bullet lists, no tables.
Ground every answer in the CONTEXT block, and when you use it say where the answer comes from (e.g. "from your calendar", "from your tasks"). If something isn't in the context, say so plainly — never invent events, grades, emails or balances.
The CONTEXT says which sources are connected. Money comes from bank CSV imports or a read-only Plaid connection; you can never move money, pay bills or cancel subscriptions — only advise. Email is read-only: you can draft replies with draft_reply, but the user sends them. If a source isn't connected, say so and suggest how to add it (Settings → Connections). Never pretend a source is connected.
When the user pastes or forwards an email: give a 2–3 line summary, list any deadlines and required actions, propose create_task / create_event for each concrete one, and offer a reply with draft_reply when a reply is expected.
For money questions use the Money section of the context: weekly spending left, budgets, recurring bills/subscriptions (with price increases), and the end-of-month forecast. When asked what to cancel, rank subscriptions by cost and point out overlaps (e.g. several streaming services) and increases.
For school, use the Courses section: current grade, letter, and what average is needed on remaining work.
To add or change anything, call a tool — every tool call is shown to the user as a proposal they approve or decline; never claim something was saved until a tool result confirms it.
When planning study time, place blocks inside the free slots listed in the context, split big work into 30–90 minute blocks, and leave buffers before deadlines.`;

export function contextBlock(now = new Date()) {
  const s = state;
  const from = startOfDay(now), to = addDays(from, 15);
  const occ = occurrences(s.events, from, to);
  const ev = occ.map((o) => `- ${fmtDate(o.start)} ${o.allDay ? 'all day' : `${fmtTime(o.start)}–${fmtTime(o.end)}`} ${o.title} [${o.category || 'personal'}]${o.location ? ` @ ${o.location}` : ''}${o.travelMin ? ` (travel ${o.travelMin}m)` : ''}`);
  const tasks = openTasks(s.tasks, now).slice(0, 40).map((t) =>
    `- id=${t.id} "${t.title}"${t.due ? ` due ${t.due} (${relDue(parseLocal(t.due), now)})` : ''} p${t.priority || 2}${t.estimate ? ` ~${fmtDuration(t.estimate)}` : ''} [${t.category || 'personal'}]${t.subtasks?.length ? ` subtasks ${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length}` : ''}`);
  const done = s.tasks.filter((t) => t.done && t.doneAt?.startsWith(dayKey(now))).map((t) => `- ${t.title}`);
  const slots = [0, 1, 2].flatMap((i) => freeSlots(s.events, addDays(from, i), s.settings, now).map(([a, b]) => `- ${fmtDate(a)} ${fmtTime(a)}–${fmtTime(b)}`));
  const bs = Bible.stats(s.bible), st = Bible.streak(s.bible, now);
  const habits = s.habits.map((hb) => `- ${hb.name}: ${hb.log?.[dayKey(now)] ? 'done today' : 'not yet today'}`);
  const goals = s.goals.map((g) => `- ${g.title} (${g.period}): ${g.progress || 0}/${g.target} ${g.unit || ''}`);
  return `CONTEXT (now ${now.toString()}, timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone})
User name: ${s.settings.name || 'unknown'}
Calendar, next 15 days:
${ev.join('\n') || '- (nothing scheduled)'}
Open tasks by urgency:
${tasks.join('\n') || '- (none)'}
Completed today:
${done.join('\n') || '- (none)'}
Free slots (next 3 days, within ${s.settings.dayStart}–${s.settings.dayEnd}):
${slots.join('\n') || '- (none)'}
Habits:
${habits.join('\n') || '- (none)'}
Goals:
${goals.join('\n') || '- (none)'}
Bible: ${bs.total.read}/${bs.total.total} unique chapters (${(bs.pct * 100).toFixed(1)}%), OT ${bs.ot.read}/${bs.ot.total}, NT ${bs.nt.read}/${bs.nt.total}; streak ${st.current} days; read today: ${st.readToday ? 'yes' : 'no'}; daily goal ${s.bible.dailyGoal} chapter(s); next unread: ${Bible.nextReading(s.bible, 3).map((n) => `${n.name} ${n.ch}`).join(', ')}
Books started: ${bs.per.filter((b) => b.read).map((b) => `${b.name} ${b.read}/${b.chapters}`).join(', ') || 'none'}
${s.bible.readingPlan ? `Bible reading plan: ${Plans.status(s.bible, now).summary}` : ''}
Courses:
${s.courses.map((c) => { const g = School.grade(c); return `- ${c.code} ${c.name || ''}: current ${g.current == null ? 'n/a' : g.current.toFixed(1) + '%'} (${g.letter}), ${g.gradedW}% marked, target ${g.target}%, needs ${g.needed == null ? 'n/a' : g.needed.toFixed(1) + '%'} avg on remaining ${g.remainingW}%; unmarked: ${c.items.filter((i) => !School.isGraded(i)).map((i) => `${i.name || i.type} ${i.weight}%${i.due ? ` due ${i.due.slice(0, 10)}` : ''}`).join(', ') || 'none'}`; }).join('\n') || '- (no courses added)'}
${moneyContext(s, now)}
Email (${Object.keys(s.meta.sync || {}).some((k) => /^(google|microsoft):/.test(k)) ? 'connected, read-only' : 'not connected'}):
${(s.emails || []).slice(0, 25).map((e) => `- [${e.important ? 'important' : 'normal'}${e.unread ? ', unread' : ''}] ${e.date?.slice(0, 16)} to ${e.account || 'inbox'} from ${e.fromName || e.from}: "${e.subject}" — ${(e.snippet || '').slice(0, 160)}`).join('\n') || '- (none)'}
Sources: calendar ${s.meta.lastImport?.canvas ? 'incl. Canvas import' : ''}${s.meta.sync?.canvas ? ', Canvas live' : ''}; bank ${s.meta.sync?.plaid ? 'Plaid (read-only)' : s.meta.lastImport?.bank ? 'CSV import ' + s.meta.lastImport.bank.slice(0, 10) : 'none'}.`;
}

function moneyContext(s, now) {
  const fin = s.finance;
  if (!fin.txns.length) return 'Money: no bank data imported.';
  const w = Fin.weekStatus(fin, now), m = Fin.monthStatus(fin, now), fc = Fin.forecast(fin, now);
  const rec = Fin.recurring(fin, now);
  return `Money (read-only):
- This week: spent ${Fin.fmtMoney(w.spent)} of ${Fin.fmtMoney(w.allowance)} allowance, ${Fin.fmtMoney(w.left)} left (${w.daysLeft} days left)
- This month by category: ${m.cats.map((c) => `${c.name} ${Fin.fmtMoney(c.spent)}${c.budget ? `/${Fin.fmtMoney(c.budget)}` : ''}`).join(', ') || 'none'}
- Accounts: ${fin.accounts.map((a) => `${a.name} (${a.type}) ${a.balance === '' ? 'balance unknown' : Fin.fmtMoney(+a.balance)}`).join('; ')}
- End-of-month forecast: ${fc.hasBalance ? Fin.fmtMoney(fc.projected) : 'unknown (no balance)'}
- Recurring: ${rec.map((r) => `${r.name} ${Fin.fmtMoney(r.amount)} ${r.interval}${r.income ? ' (income)' : ''}${r.increase ? ` UP ${Fin.fmtMoney(r.increase)}` : ''} next ${dayKey(r.next)} [${r.category}]`).join('; ') || 'none detected'}
- Unusual: ${Fin.unusual(fin, now).map((x) => `${x.t.desc} ${Fin.fmtMoney(x.t.amount)} ${x.t.date} (${x.why})`).join('; ') || 'none'}
- Savings goals: ${fin.savings.map((g) => `${g.name} ${Fin.fmtMoney(+g.saved || 0)}/${Fin.fmtMoney(+g.target)}`).join('; ') || 'none'}`;
}

export const emailPrompt = (email) => `Here’s an email. Summarize it, list deadlines and required actions, propose tasks/events for anything concrete, and draft a reply if one is expected.\n\n---\n${email.slice(0, 12000)}`;

// Sends the whole conversation; returns the API message.
export async function send(messages, { effort = 'low', extraSystem = '' } = {}) {
  const Anthropic = await loadSDK();
  const client = new Anthropic({ apiKey: state.settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    return await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      system: [{ type: 'text', text: INSTRUCTIONS + extraSystem }, { type: 'text', text: contextBlock() }],
      tools: TOOLS,
      messages,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Your Claude API key was rejected. Check it in Settings.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('This API key is not allowed to use this model.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude is rate-limiting requests right now. Try again in a minute.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Couldn’t reach Claude. Check your internet connection.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude error ${e.status ?? ''}: ${e.message}`);
    throw e;
  }
}

// Shrinks a photo/screenshot so it's quick to send (Claude reads ~1568 px on the long side well).
export async function imageToBase64(file, max = 1568) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

const SCAN_PROMPT = `Read this image (it may be a photo of a handwritten or printed schedule, a syllabus, a timetable, a flyer, a whiteboard, or a screenshot of an email or app).
Find every dated event, class, shift, deadline, exam, quiz or task. For each one call create_event (things at a time) or create_task (deadlines / to-dos), using the CONTEXT's current date and timezone to resolve dates like "Friday" or "Oct 3". For weekly classes, create the next occurrence and mention in your text that it repeats.
If a date or time is unclear, make your best guess and say so in the notes field. Don't invent items that aren't in the image.
After the tool calls, write one short sentence summarizing what you found. If you found nothing, say so.`;

// One-off request (kept out of the chat history so photos don't fill up the phone's storage).
// Returns { text, proposals: tool_use blocks } for the user to approve.
export async function scanImage(base64, note = '') {
  const res = await send([{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
    { type: 'text', text: SCAN_PROMPT + (note ? `\n\nThe user added: ${note}` : '') },
  ] }], { effort: 'medium' });
  if (res.stop_reason === 'refusal') throw new Error('Claude couldn’t process that image.');
  return {
    text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim(),
    proposals: res.content.filter((b) => b.type === 'tool_use' && ['create_event', 'create_task'].includes(b.name)),
  };
}

export async function testKey() {
  const res = await send([{ role: 'user', content: 'Reply with just: Connected.' }]);
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Offline answers for the common commands when no key is set (or Claude is unreachable).
export function localAnswer(q, now = new Date()) {
  const t = q.toLowerCase();
  const s = state;
  const list = (items) => items.map((x) => `- ${x}`).join('\n');
  const day = /tomorrow/.test(t) ? addDays(now, 1) : now;
  if (/schedule|calendar|what.*(today|tomorrow)|my day/.test(t)) {
    const occ = occurrences(s.events, startOfDay(day), addDays(startOfDay(day), 1));
    const label = /tomorrow/.test(t) ? 'Tomorrow' : 'Today';
    return occ.length ? `**${label}** (from your calendar):\n${list(occ.map((o) => `${o.allDay ? 'All day' : fmtTime(o.start)} — ${o.title}${o.location ? ` @ ${o.location}` : ''}`))}` : `Nothing on your calendar ${label.toLowerCase()}.`;
  }
  if (/due|assignment|homework|deadline/.test(t)) {
    const open = openTasks(s.tasks, now).filter((x) => x.due).slice(0, 8);
    return open.length ? `**Coming up** (from your tasks):\n${list(open.map((x) => `${x.title} — ${relDue(parseLocal(x.due), now)}`))}` : 'No tasks with due dates. Import your Canvas calendar in Settings to pull in assignments.';
  }
  if (/bible|chapter|read/.test(t)) {
    const st = Bible.stats(s.bible), sk = Bible.streak(s.bible, now);
    return `You've read **${st.total.read} of ${st.total.total}** chapters (**${(st.pct * 100).toFixed(1)}%**).\n- Old Testament: ${st.ot.read}/${st.ot.total}\n- New Testament: ${st.nt.read}/${st.nt.total}\n- Streak: ${sk.current} day(s)`;
  }
  if (/plan|study|free/.test(t)) {
    const plan = briefing(s, now).plan;
    return plan.length ? `**Suggested plan for today:**\n${list(plan.map((b) => `${fmtTime(b.start)}–${fmtTime(b.end)} ${b.title}`))}\nYou can add these from the Today screen.` : 'No free time left today, or no tasks to plan.';
  }
  if (/spend|budget|money|subscription|bank|cancel|afford|bill/.test(t)) {
    const fin = s.finance;
    if (!fin.txns.length) return 'No bank data yet. Import a TD CSV on the Money screen (or connect Plaid in Settings) and I can answer that.';
    if (/subscri|cancel/.test(t)) {
      const subs = Fin.recurring(fin, now).filter((r) => !r.income).sort((a, b) => b.monthly - a.monthly);
      return subs.length ? `**Recurring charges** (from your transactions), most expensive first:\n${list(subs.map((r) => `${r.name} — ${Fin.fmtMoney(r.amount)} ${r.interval}${r.increase ? ` (up ${Fin.fmtMoney(r.increase)})` : ''}`))}\nCancel anything you haven’t used in the last month.` : 'No repeating charges detected yet — import 2–3 months of history.';
    }
    const w = Fin.weekStatus(fin, now);
    if (!w.allowance) return 'Set a weekly spending amount on the Money screen first.';
    return w.left >= 0
      ? `You have **${Fin.fmtMoney(w.left)}** left to spend this week (${Fin.fmtMoney(w.spent)} of ${Fin.fmtMoney(w.allowance)} used) — about ${Fin.fmtMoney(w.perDay)}/day for ${w.daysLeft} day(s). (From your bank transactions.)`
      : `You’re **${Fin.fmtMoney(-w.left)} over** this week’s ${Fin.fmtMoney(w.allowance)} spending money (${Fin.fmtMoney(w.spent)} spent). The week resets ${w.to.toLocaleDateString([], { weekday: 'long' })}. (From your bank transactions.)`;
  }
  if (/grade|mark|need on|gpa|course/.test(t)) {
    if (!s.courses.length) return 'Add your courses (School → Courses) with their grade breakdowns and I’ll work out where you stand.';
    return `**Your courses:**\n${list(s.courses.map((c) => { const g = School.grade(c); return `${c.code}: ${g.current == null ? 'no marks yet' : `${g.current.toFixed(1)}% (${g.letter})`}${g.needed != null ? ` — need ${Math.max(0, g.needed).toFixed(1)}% avg on the remaining ${g.remainingW}% for ${g.target}%` : ''}`; }))}`;
  }
  if (/email|gmail|outlook|inbox/.test(t)) return 'With a Claude key set, paste an email here (or tap ✉ Paste email) and I’ll summarize it, pull out tasks and events, and draft a reply.';
  return 'I can answer questions about your schedule, due work, study plans and Bible progress offline. Add your Claude API key in Settings for full conversations and planning.';
}

// Applies an approved tool call; returns a short summary for the tool_result.
export function applyTool(s, name, input) {
  const id = () => crypto.randomUUID?.() || String(Date.now() + Math.random());
  const validDate = (v) => !v || parseLocal(v) ? v : null;
  switch (name) {
    case 'create_task': {
      if (validDate(input.due) === null) throw new Error('Invalid due date');
      const t = { id: id(), title: input.title, due: input.due || '', priority: input.priority || 2, estimate: input.estimate_minutes || 60, category: input.category || 'personal', notes: input.notes || '', subtasks: (input.subtasks || []).map((x) => ({ id: id(), title: x, done: false })), done: false, created: new Date().toISOString(), source: 'assistant' };
      s.tasks.push(t);
      return `Task "${t.title}" added (id=${t.id}).`;
    }
    case 'create_event': {
      const st = parseLocal(input.start), en = parseLocal(input.end);
      if (!st || !en || en <= st) throw new Error('Invalid start/end');
      s.events.push({ id: id(), title: input.title, start: toLocalInput(st), end: toLocalInput(en), allDay: false, location: input.location || '', category: input.category || 'personal', notes: input.notes || '', repeat: 'none', source: 'assistant' });
      return `Event "${input.title}" added ${fmtDate(st)} ${fmtTime(st)}–${fmtTime(en)}.`;
    }
    case 'add_subtasks': {
      const t = s.tasks.find((x) => x.id === input.task_id);
      if (!t) throw new Error('Task not found');
      t.subtasks = [...(t.subtasks || []), ...input.subtasks.map((x) => ({ id: id(), title: x, done: false }))];
      return `Added ${input.subtasks.length} subtasks to "${t.title}".`;
    }
    case 'complete_task': {
      const t = s.tasks.find((x) => x.id === input.task_id);
      if (!t) throw new Error('Task not found');
      t.done = true; t.doneAt = new Date().toISOString();
      return `Marked "${t.title}" done.`;
    }
    case 'draft_reply':
      return 'The user took the draft to send it themselves.';
    case 'log_bible_reading': {
      const b = Bible.findBook(s.bible, input.book);
      if (!b) throw new Error(`Unknown book "${input.book}"`);
      const e = Bible.logReading(s.bible, { book: b.code, from: input.chapter_start, to: input.chapter_end || input.chapter_start, note: input.note || '', favorite: input.favorite_verse || '' });
      return `Logged ${Bible.refLabel(s.bible, e)}.`;
    }
    default: throw new Error(`Unknown tool ${name}`);
  }
}

export function describeTool(name, input) {
  switch (name) {
    case 'create_task': return { title: 'Add task', body: `${input.title}${input.due ? ` — due ${relDue(parseLocal(input.due))}` : ''}${input.subtasks?.length ? ` · ${input.subtasks.length} steps` : ''}` };
    case 'create_event': { const st = parseLocal(input.start), en = parseLocal(input.end); return { title: 'Add to calendar', body: `${input.title} — ${st ? `${fmtDate(st)} ${fmtTime(st)}` : input.start}${en ? `–${fmtTime(en)}` : ''}` }; }
    case 'add_subtasks': { const t = state.tasks.find((x) => x.id === input.task_id); return { title: 'Break down task', body: `${t?.title || 'Task'}: ${input.subtasks.join(' · ')}` }; }
    case 'complete_task': { const t = state.tasks.find((x) => x.id === input.task_id); return { title: 'Mark done', body: t?.title || input.task_id }; }
    case 'draft_reply': return { title: 'Reply draft', body: input.subject };
    case 'log_bible_reading': return { title: 'Log Bible reading', body: `${input.book} ${input.chapter_start}${input.chapter_end && input.chapter_end !== input.chapter_start ? `–${input.chapter_end}` : ''}` };
    default: return { title: name, body: JSON.stringify(input) };
  }
}
