import { state, update, logAction } from '../store.js';
import * as Bible from '../bible.js';
import * as Plans from '../plans.js';
import { icon, modal, field, select, ring, bar, empty, toast, confirmSheet } from '../ui.js';
import { h, dayKey, parseLocal, fmtDate } from '../util.js';

let query = '';
let openT = { OT: false, NT: true };

function bookList(per, t) {
  return `<ul class="books">${per.filter((b) => b.t === t).map((b) => `<li><button class="book${b.read === b.chapters ? ' complete' : ''}" data-act="openBook" data-code="${b.code}">
    <span>${h(b.name)}</span><span class="muted small">${b.read}/${b.chapters}</span>${bar(b.pct)}</button></li>`).join('')}</ul>`;
}

function entry(e) {
  return `<li class="item log"><div class="what"><strong>${h(Bible.refLabel(state.bible, e))}</strong>
    <div class="meta"><span class="muted">${fmtDate(parseLocal(e.date))}</span></div>
    ${e.favorite ? `<blockquote>${h(e.favorite)}</blockquote>` : ''}
    ${e.note ? `<p class="note">${h(e.note)}</p>` : ''}</div>
    <button class="icon-btn" data-act="editLog" data-id="${h(e.id)}" aria-label="Edit entry">✎</button></li>`;
}

function planCard(b) {
  const st = Plans.status(b);
  if (!st) {
    return `<section class="card"><div class="card-head"><h2>Reading plans</h2><span class="muted small">optional</span></div>
      <ul class="list">${Object.entries(Plans.PLANS).map(([id, p]) => { const n = Plans.sequence(b, id).length; return `<li class="item"><div class="what"><strong>${h(p.name)}</strong>
        <div class="meta"><span class="muted">${n} chapters · about ${(n / p.days).toFixed(1)} a day</span></div></div><button class="btn small" data-act="startPlan" data-id="${id}">Start</button></li>`; }).join('')}</ul>
      <p class="muted small">Chapters you’ve already read count toward a plan.</p></section>`;
  }
  const chip = (c) => `<button class="ch-chip${c.read ? ' on' : ''}" data-act="planToggle" data-book="${c.book}" data-ch="${c.ch}" aria-pressed="${c.read}">${c.read ? '✓ ' : ''}${h(c.name)} ${c.ch}</button>`;
  return `<section class="card accent"><div class="card-head"><h2>${h(st.name)}</h2><button class="link" data-act="stopPlan">Stop plan</button></div>
    <p class="small">Day <b>${st.day}</b> of ${st.days} · ${st.done}/${st.total} chapters · finishes ${fmtDate(parseLocal(st.end))}</p>
    ${bar(st.pct)}
    <h3>Today</h3><div class="pills">${st.today.map(chip).join('') || '<span class="muted">Nothing assigned today.</span>'}</div>
    ${st.behind ? `<h3>Catch up <span class="muted">(${st.behind} behind)</span></h3><div class="pills">${st.overdue.slice(0, 6).map((c) => chip({ ...c, read: false })).join('')}${st.behind > 6 ? `<span class="muted small">+${st.behind - 6} more</span>` : ''}</div>` : '<p class="good-text small">On track ✓</p>'}
  </section>`;
}

function logForm(e = {}) {
  const books = Object.fromEntries(Bible.books(state.bible).map((b) => [b.code, b.name]));
  const next = Bible.nextReading(state.bible, 1)[0];
  const isNew = !e.id;
  modal({
    title: isNew ? 'Log reading' : 'Edit entry',
    body: `${field('Book', select('book', books, e.book || next?.book || 'GEN'))}
      <div class="row">${field('From chapter', `<input type="number" name="from" min="1" value="${e.from || next?.ch || 1}" required>`)}
      ${field('To chapter', `<input type="number" name="to" min="1" value="${e.to || e.from || next?.ch || 1}">`)}</div>
      <div class="row">${field('Date', `<input type="date" name="date" value="${e.date || dayKey(new Date())}">`)}
      ${field('Verses (optional)', `<input name="verses" value="${h(e.verses)}" placeholder="e.g. 1-18">`)}</div>
      ${field('Favorite verse', `<textarea name="favorite" rows="2" placeholder="Type or paste a verse you want to remember">${h(e.favorite)}</textarea>`)}
      ${field('Notes & reflections', `<textarea name="note" rows="4">${h(e.note)}</textarea>`)}
      <p class="muted small">Rereading a chapter adds to your log but never double-counts your percentage.</p>`,
    submit: isNew ? 'Log' : 'Save',
    onSubmit: (v) => {
      const b = Bible.book(state.bible, v.book);
      if (!(v.from >= 1 && v.from <= b.chapters)) { toast(`${b.name} has ${b.chapters} chapters`); return false; }
      update((s) => {
        if (isNew) {
          const en = Bible.logReading(s.bible, v);
          logAction('bible', `Logged ${Bible.refLabel(s.bible, en)}`);
        } else {
          const cur = s.bible.log.find((x) => x.id === e.id);
          Object.assign(cur, { favorite: v.favorite, note: v.note, verses: v.verses, date: v.date || cur.date });
        }
      });
      toast(isNew ? 'Reading logged' : 'Saved');
    },
  });
}

export default {
  id: 'bible',
  title: 'Bible',
  render() {
    const b = state.bible;
    const st = Bible.stats(b), sk = Bible.streak(b);
    const pace = Bible.planPace(b);
    const next = Plans.nextChapters(b);
    const results = Bible.search(b, query);
    const favs = b.log.filter((e) => e.favorite).slice(0, 5);
    return `<header class="page-head"><h1>Bible</h1><button class="btn primary" data-act="log">${icon('plus', 18)} Log reading</button></header>
    <div class="grid">
      <section class="card">
        <div class="ring-row">${ring(st.pct, 96, `${(st.pct * 100).toFixed(1)}% read`)}
          <div><div class="big">${(st.pct * 100).toFixed(1)}%</div><div class="muted">${st.total.read} of ${st.total.total} chapters</div></div></div>
        <div class="split">
          <div><div class="muted small">Old Testament</div>${bar(st.ot.read / st.ot.total)}<div class="small">${st.ot.read}/${st.ot.total} · ${((st.ot.read / st.ot.total) * 100).toFixed(1)}%</div></div>
          <div><div class="muted small">New Testament</div>${bar(st.nt.read / st.nt.total)}<div class="small">${st.nt.read}/${st.nt.total} · ${((st.nt.read / st.nt.total) * 100).toFixed(1)}%</div></div>
        </div>
      </section>
      <section class="card">
        <div class="stats3">
          <div><div class="big">${sk.current}</div><div class="muted small">day streak</div></div>
          <div><div class="big">${sk.todayChapters}/${b.dailyGoal}</div><div class="muted small">today’s goal</div></div>
          <div><div class="big">${sk.missed30}</div><div class="muted small">missed (30 days)</div></div>
        </div>
        ${next.length ? `<p>Next up: <b>${h(next.map((n) => `${n.name} ${n.ch}`).join(', '))}</b></p><button class="btn small" data-act="readNext">Mark as read</button>` : '<p class="good-text">You’ve read the whole Bible! 🎉</p>'}
        ${pace.perDay ? `<p class="muted small">To finish by ${fmtDate(parseLocal(b.plan.endDate))}: ${pace.perDay} chapter${pace.perDay > 1 ? 's' : ''}/day (${pace.remaining} left).</p>` : ''}
        <button class="link" data-act="planSettings">Reading goal &amp; plan</button>
      </section>
    </div>
    ${planCard(b)}
    <section class="card">
      <div class="seg wide">${['OT', 'NT'].map((t) => `<button class="${openT[t] ? 'on' : ''}" data-act="testament" data-t="${t}" aria-pressed="${openT[t]}">${t === 'OT' ? 'Old Testament' : 'New Testament'}</button>`).join('')}</div>
      ${openT.OT ? bookList(st.per, 'OT') : ''}${openT.NT ? bookList(st.per, 'NT') : ''}
    </section>
    <section class="card">
      <div class="card-head"><h2>Notes, verses &amp; history</h2></div>
      <label class="search">${icon('search', 18)}<input type="search" data-input="search" placeholder="Search notes and verses" value="${h(query)}" aria-label="Search notes and verses"></label>
      ${query ? (results.length ? `<ul class="list">${results.map(entry).join('')}</ul>` : '<p class="muted">No matches.</p>')
        : `${favs.length ? `<h3>Favorite verses</h3><ul class="list">${favs.map(entry).join('')}</ul>` : ''}
           <h3>Recent readings</h3>${b.log.length ? `<ul class="list">${b.log.slice(0, 12).map(entry).join('')}</ul>` : empty('Tap a chapter or “Log reading” to start.')}`}
    </section>`;
  },
  act: {
    startPlan: (el) => update((s) => { s.bible.readingPlan = { id: el.dataset.id, start: dayKey(new Date()) }; logAction('bible', `Started plan: ${Plans.PLANS[el.dataset.id].name}`); }),
    stopPlan: async () => {
      if (await confirmSheet('Stop this plan?', 'Your chapters stay marked as read.', 'Stop plan')) update((s) => { s.bible.readingPlan = null; });
    },
    planToggle: (el) => update((s) => {
      const c = +el.dataset.ch;
      if (Bible.isRead(s.bible, el.dataset.book, c)) Bible.unmark(s.bible, el.dataset.book, c);
      else Bible.logReading(s.bible, { book: el.dataset.book, from: c, to: c });
    }),
    log: () => logForm(),
    editLog: (el) => logForm(state.bible.log.find((x) => x.id === el.dataset.id)),
    testament: (el) => { openT[el.dataset.t] = !openT[el.dataset.t]; },
    readNext: () => update((s) => {
      Plans.nextChapters(s.bible).forEach((n) => Bible.logReading(s.bible, { book: n.book, from: n.ch, to: n.ch }));
    }),
    openBook: (el) => {
      const code = el.dataset.code;
      const draw = () => {
        const b = Bible.book(state.bible, code);
        return `<p class="muted small">Tap a chapter to mark it read (today’s date). Tap again to unmark.</p>
          <div class="chapters">${Array.from({ length: b.chapters }, (_, i) => i + 1).map((c) => {
            const d = state.bible.read[code]?.[c];
            return `<button type="button" class="ch${d ? ' on' : ''}" data-ch="${c}" aria-pressed="${!!d}" title="${d ? `Read ${d}` : 'Unread'}">${c}</button>`;
          }).join('')}</div>`;
      };
      modal({
        title: Bible.book(state.bible, code).name,
        body: `<div data-chapters>${draw()}</div>`,
        onOpen: (form) => form.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-ch]');
          if (!btn) return;
          const c = +btn.dataset.ch;
          update((s) => (Bible.isRead(s.bible, code, c) ? Bible.unmark(s.bible, code, c) : Bible.logReading(s.bible, { book: code, from: c, to: c })));
          form.querySelector('[data-chapters]').innerHTML = draw();
        }),
      });
    },
    planSettings: () => modal({
      title: 'Reading goal & plan',
      body: `${field('Daily goal (chapters)', `<input type="number" name="dailyGoal" min="1" max="50" value="${state.bible.dailyGoal}">`)}
        ${field('Reading order', select('order', { canonical: 'Genesis → Revelation', 'nt-first': 'New Testament first' }, state.bible.plan.order))}
        ${field('Finish by (optional)', `<input type="date" name="endDate" value="${h(state.bible.plan.endDate)}">`, 'Shows how many chapters a day you need')}
        ${field('Canon', select('canon', Object.fromEntries(Object.entries(Bible.CANONS).map(([k, c]) => [k, c.name])), state.bible.canon), 'Other canons can be added later')}`,
      onSubmit: (v) => update((s) => { s.bible.dailyGoal = v.dailyGoal || 1; s.bible.plan = { order: v.order, endDate: v.endDate }; s.bible.canon = v.canon; }),
    }),
  },
  input: {
    search: (el) => { query = el.value; return true; },
  },
};
