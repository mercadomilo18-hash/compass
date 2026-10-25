import { state, update, logAction } from '../store.js';
import * as AI from '../ai.js';
import { icon, toast, modal, field } from '../ui.js';
import { h, md, $ } from '../util.js';

const EXAMPLES = [
  'What’s my schedule tomorrow?',
  'What assignments are due?',
  'How much can I spend this week?',
  'What subscriptions should I cancel?',
  'What do I need on my final?',
  'Plan study time for my exam',
  'What percentage of the Bible have I read?',
];

let busy = false;
let draft = '';
const decisions = {}; // tool_use id -> { ok, summary }
let rerender = () => {};

const apiHistory = () => state.chat.filter((m) => !m.local).map(({ role, content }) => ({ role, content }));

const findTool = (id) => state.chat.flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content : [])).find((b) => b.type === 'tool_use' && b.id === id);

function lastToolUses() {
  const last = state.chat.filter((m) => !m.local).at(-1);
  if (last?.role !== 'assistant') return [];
  return last.content.filter((b) => b.type === 'tool_use');
}

// Past results live in the following user message; pending ones in `decisions`.
function resultFor(id) {
  for (const m of state.chat) {
    if (m.role === 'user' && Array.isArray(m.content)) {
      const r = m.content.find((b) => b.type === 'tool_result' && b.tool_use_id === id);
      if (r) return { done: true, ok: !r.is_error && String(r.content).startsWith('Approved'), text: r.content };
    }
  }
  return decisions[id] ? { pending: true, ...decisions[id] } : null;
}

function draftCard(b) {
  const r = resultFor(b.id);
  const { to = '', subject = '', body = '' } = b.input;
  const mailto = `mailto:${/^[^\s@<>"]+@[^\s@<>"]+$/.test(to) ? to : ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `<div class="draft"><div class="muted small">Reply draft — you send it from your mail app</div>
    <div class="small">${to ? `To: ${h(to)}<br>` : ''}<b>${h(subject)}</b></div><div class="draft-body">${h(body)}</div>
    <div class="approval-btns">
      <button class="btn small" data-act="copyDraft" data-id="${h(b.id)}">${icon('copy', 16)} Copy</button>
      <a class="btn small" href="${h(mailto)}" data-act="mailDraft" data-id="${h(b.id)}">${icon('mail', 16)} Open in Mail</a>
      ${r ? '' : `<button class="btn small ghost" data-act="decide" data-id="${h(b.id)}" data-ok="0">Dismiss</button>`}
    </div></div>`;
}

function toolCard(b) {
  if (b.name === 'draft_reply') return draftCard(b);
  const d = AI.describeTool(b.name, b.input);
  const r = resultFor(b.id);
  const status = r ? (r.ok ? '<span class="chip good">Approved</span>' : '<span class="chip">Declined</span>') : '';
  return `<div class="approval${r ? ' decided' : ''}"><div><div class="muted small">Compass wants to · ${h(d.title)}</div><strong>${h(d.body)}</strong></div>
    ${r ? status : `<div class="approval-btns"><button class="btn small ghost" data-act="decide" data-id="${h(b.id)}" data-ok="0">Decline</button><button class="btn small primary" data-act="decide" data-id="${h(b.id)}" data-ok="1">Approve</button></div>`}</div>`;
}

function messageHTML(m) {
  if (m.role === 'user') {
    const text = typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return text ? `<div class="msg user">${h(text)}</div>` : '';
  }
  const parts = (Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]).map((b) =>
    b.type === 'text' ? `<div class="msg bot${m.error ? ' error' : ''}">${md(b.text)}</div>` : b.type === 'tool_use' ? toolCard(b) : '').join('');
  return parts + (m.note ? `<div class="muted small">${h(m.note)}</div>` : '');
}

function speak(text) {
  if (!state.settings.voiceReplies || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, '')));
}

async function callClaude() {
  busy = true; rerender();
  try {
    const res = await AI.send(apiHistory());
    const note = res.stop_reason === 'refusal' ? 'Claude declined to answer this one.' : res.stop_reason === 'max_tokens' ? 'Reply was cut off.' : '';
    update((s) => s.chat.push({ role: 'assistant', content: res.content, ...(note && { note }) }));
    speak(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' '));
    return true;
  } catch (e) {
    toast(e.message, 5000);
    return false;
  } finally {
    busy = false; rerender();
  }
}

function toolResults() {
  return lastToolUses().map((b) => {
    const d = decisions[b.id] || { ok: false, summary: 'User skipped this proposal.' };
    delete decisions[b.id];
    return { type: 'tool_result', tool_use_id: b.id, content: d.ok ? `Approved. ${d.summary}` : d.error ? d.summary : `Declined by user. ${d.summary || ''}`.trim(),...(d.error && { is_error: true }) };
  });
}

async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  draft = '';
  if (!state.settings.apiKey) {
    update((s) => s.chat.push({ role: 'user', content: text, local: true }, { role: 'assistant', content: [{ type: 'text', text: AI.localAnswer(text) }], local: true }));
    speak(AI.localAnswer(text));
    return;
  }
  // If the last turn is already ours (e.g. a reply failed after approvals), add to it instead of stacking turns.
  const last = state.chat.filter((m) => !m.local).at(-1);
  const merge = last?.role === 'user';
  const results = toolResults();
  update((s) => (merge ? last.content.push({ type: 'text', text }) : s.chat.push({ role: 'user', content: [...results, { type: 'text', text }] })));
  if (!(await callClaude())) {
    // Roll back so the conversation stays valid; keep the text for a retry.
    update((s) => (merge ? last.content.pop() : s.chat.pop()));
    draft = text; rerender();
  }
}

async function decide(id, ok) {
  const b = lastToolUses().find((x) => x.id === id);
  if (!b) return;
  if (ok) {
    try {
      let summary;
      update((s) => { summary = AI.applyTool(s, b.name, b.input); logAction('ai', summary, 'approved', 'Compass AI'); });
      decisions[id] = { ok: true, summary };
      toast('Done');
    } catch (e) {
      decisions[id] = { ok: false, error: true, summary: `Could not apply: ${e.message}` };
      toast(e.message);
    }
  } else {
    decisions[id] = { ok: false, summary: '' };
    update((s) => logAction('ai', `Declined: ${AI.describeTool(b.name, b.input).body}`, 'declined', 'Compass AI'));
  }
  const pending = lastToolUses().filter((x) => !decisions[x.id]);
  if (pending.length) { rerender(); return; }
  update((s) => s.chat.push({ role: 'user', content: toolResults() }));
  await callClaude();
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input isn’t supported here — use the keyboard’s mic button instead.'); return; }
  const rec = new SR();
  rec.lang = navigator.language || 'en-CA';
  rec.interimResults = false;
  const btn = $('[data-act="voice"]');
  btn?.classList.add('listening');
  rec.onresult = (e) => ask(e.results[0][0].transcript);
  rec.onerror = (e) => toast(`Voice: ${e.error}`);
  rec.onend = () => btn?.classList.remove('listening');
  rec.start();
}

export default {
  id: 'chat',
  title: 'Assistant',
  render(ctx) {
    rerender = ctx.rerender;
    const pre = sessionStorage.getItem('compass:prompt');
    if (pre) { sessionStorage.removeItem('compass:prompt'); setTimeout(() => ask(pre)); }
    const msgs = state.chat.map(messageHTML).join('');
    return `<header class="page-head"><h1>Assistant</h1><span class="row">
        ${state.settings.apiKey ? `<button class="btn small" data-act="pasteEmail">${icon('mail', 16)} Paste email</button>` : ''}
        ${state.chat.length ? '<button class="btn ghost small" data-act="newChat">New chat</button>' : ''}</span></header>
      ${state.settings.apiKey ? '' : '<p class="notice">Offline mode: quick answers from your own data. Add a Claude API key in <a href="#settings">Settings</a> for full conversations, planning and email-to-task extraction.</p>'}
      <div class="chat" id="chat-log" aria-live="polite">
        ${msgs || `<div class="empty"><p>Ask about your day, deadlines, plans or Bible reading. Paste an email and I’ll pull out events and tasks for you to approve.</p></div>`}
        ${busy ? '<div class="msg bot typing"><i></i><i></i><i></i></div>' : ''}
      </div>
      ${state.chat.length ? '' : `<div class="pills examples">${EXAMPLES.map((e) => `<button class="pill" data-act="example">${h(e)}</button>`).join('')}</div>`}
      <form class="composer" data-form="ask">
        <button type="button" class="icon-btn" data-act="voice" aria-label="Speak">${icon('mic')}</button>
        <textarea name="q" rows="1" data-input="draft" placeholder="Message Compass…" aria-label="Message">${h(draft)}</textarea>
        <button class="icon-btn primary" aria-label="Send" ${busy ? 'disabled' : ''}>${icon('send')}</button>
      </form>`;
  },
  after() {
    const log = $('#chat-log');
    if (log) log.scrollTop = log.scrollHeight;
    const ta = $('.composer textarea');
    ta?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); ask(ta.value); } });
  },
  act: {
    copyDraft: async (el) => {
      const b = findTool(el.dataset.id);
      try { await navigator.clipboard.writeText(`${b.input.subject}\n\n${b.input.body}`); toast('Copied'); } catch { toast('Couldn’t copy — select the text instead'); }
      if (!resultFor(b.id)) decide(b.id, true);
    },
    mailDraft: (el) => {
      const b = findTool(el.dataset.id);
      location.href = el.getAttribute('href');
      if (!resultFor(b.id)) decide(b.id, true);
    },
    pasteEmail: () => modal({
      title: 'Paste an email',
      body: `${field('Email', '<textarea name="email" rows="10" autofocus placeholder="Paste the whole email, including who it’s from and the subject"></textarea>')}
        <p class="muted small">Compass summarizes it, pulls out deadlines and tasks for you to approve, and drafts a reply you send yourself.</p>`,
      submit: 'Analyze',
      onSubmit: (v) => { if (!v.email) return false; ask(AI.emailPrompt(v.email)); },
    }),
    example: (el) => ask(el.textContent),
    decide: (el) => decide(el.dataset.id, el.dataset.ok === '1'),
    voice: () => startVoice(),
    newChat: () => update((s) => { s.chat = []; }),
  },
  input: { draft: (el) => { draft = el.value; return false; } },
  forms: { ask: (v) => ask(v.q) },
};
