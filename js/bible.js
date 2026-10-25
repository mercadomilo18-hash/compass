// Bible data and progress math. Percentages count unique chapters only,
// so rereading a chapter never inflates progress.

import { dayKey, addDays, parseLocal, startOfDay } from './util.js';

// [code, name, chapters]
const OT = [
  ['GEN', 'Genesis', 50], ['EXO', 'Exodus', 40], ['LEV', 'Leviticus', 27], ['NUM', 'Numbers', 36],
  ['DEU', 'Deuteronomy', 34], ['JOS', 'Joshua', 24], ['JDG', 'Judges', 21], ['RUT', 'Ruth', 4],
  ['1SA', '1 Samuel', 31], ['2SA', '2 Samuel', 24], ['1KI', '1 Kings', 22], ['2KI', '2 Kings', 25],
  ['1CH', '1 Chronicles', 29], ['2CH', '2 Chronicles', 36], ['EZR', 'Ezra', 10], ['NEH', 'Nehemiah', 13],
  ['EST', 'Esther', 10], ['JOB', 'Job', 42], ['PSA', 'Psalms', 150], ['PRO', 'Proverbs', 31],
  ['ECC', 'Ecclesiastes', 12], ['SNG', 'Song of Solomon', 8], ['ISA', 'Isaiah', 66], ['JER', 'Jeremiah', 52],
  ['LAM', 'Lamentations', 5], ['EZK', 'Ezekiel', 48], ['DAN', 'Daniel', 12], ['HOS', 'Hosea', 14],
  ['JOL', 'Joel', 3], ['AMO', 'Amos', 9], ['OBA', 'Obadiah', 1], ['JON', 'Jonah', 4],
  ['MIC', 'Micah', 7], ['NAM', 'Nahum', 3], ['HAB', 'Habakkuk', 3], ['ZEP', 'Zephaniah', 3],
  ['HAG', 'Haggai', 2], ['ZEC', 'Zechariah', 14], ['MAL', 'Malachi', 4],
];
const NT = [
  ['MAT', 'Matthew', 28], ['MRK', 'Mark', 16], ['LUK', 'Luke', 24], ['JHN', 'John', 21],
  ['ACT', 'Acts', 28], ['ROM', 'Romans', 16], ['1CO', '1 Corinthians', 16], ['2CO', '2 Corinthians', 13],
  ['GAL', 'Galatians', 6], ['EPH', 'Ephesians', 6], ['PHP', 'Philippians', 4], ['COL', 'Colossians', 4],
  ['1TH', '1 Thessalonians', 5], ['2TH', '2 Thessalonians', 3], ['1TI', '1 Timothy', 6], ['2TI', '2 Timothy', 4],
  ['TIT', 'Titus', 3], ['PHM', 'Philemon', 1], ['HEB', 'Hebrews', 13], ['JAS', 'James', 5],
  ['1PE', '1 Peter', 5], ['2PE', '2 Peter', 3], ['1JN', '1 John', 5], ['2JN', '2 John', 1],
  ['3JN', '3 John', 1], ['JUD', 'Jude', 1], ['REV', 'Revelation', 22],
];

// Canons are data so others can be added later; only the 66-book canon ships now.
export const CANONS = {
  protestant: {
    name: 'Protestant (66 books)',
    books: [...OT.map(([code, name, chapters]) => ({ code, name, chapters, t: 'OT' })),
            ...NT.map(([code, name, chapters]) => ({ code, name, chapters, t: 'NT' }))],
  },
};

export const books = (bible) => CANONS[bible.canon]?.books || CANONS.protestant.books;
export const book = (bible, code) => books(bible).find((b) => b.code === code);

export function findBook(bible, text) {
  const t = String(text).toLowerCase().replace(/\s+/g, '');
  return books(bible).find((b) => b.code.toLowerCase() === t || b.name.toLowerCase().replace(/\s+/g, '') === t)
    || books(bible).find((b) => b.name.toLowerCase().replace(/\s+/g, '').startsWith(t));
}

export function stats(bible) {
  const all = books(bible);
  const per = all.map((b) => {
    const read = Object.keys(bible.read[b.code] || {}).filter((c) => +c >= 1 && +c <= b.chapters).length;
    return { ...b, read, pct: read / b.chapters };
  });
  const sum = (list) => list.reduce((a, b) => ({ read: a.read + b.read, total: a.total + b.chapters }), { read: 0, total: 0 });
  const total = sum(per), ot = sum(per.filter((b) => b.t === 'OT')), nt = sum(per.filter((b) => b.t === 'NT'));
  return { per, total, ot, nt, pct: total.read / total.total };
}

export const isRead = (bible, code, ch) => !!bible.read[code]?.[ch];

// Marks chapters read (first-read date kept) and appends a reading log entry.
export function logReading(bible, { book: code, from, to, date, verses = '', note = '', favorite = '' }) {
  const b = book(bible, code);
  if (!b) throw new Error('Unknown book');
  from = Math.max(1, Math.min(b.chapters, +from || 1));
  to = Math.max(from, Math.min(b.chapters, +to || from));
  date = date || dayKey(new Date());
  bible.read[code] ||= {};
  for (let c = from; c <= to; c++) bible.read[code][c] ||= date;
  const entry = { id: crypto.randomUUID?.() || String(Date.now()), date, book: code, from, to, verses, note, favorite };
  bible.log.unshift(entry);
  return entry;
}

// Undo a mistaken tap: drop the mark and the plain one-chapter log entry it created (entries with notes are kept).
export function unmark(bible, code, ch) {
  if (bible.read[code]) delete bible.read[code][ch];
  const i = bible.log.findIndex((e) => e.book === code && e.from === ch && e.to === ch && !e.note && !e.favorite && !e.verses);
  if (i >= 0) bible.log.splice(i, 1);
}

export const refLabel = (bible, e) =>
  `${book(bible, e.book)?.name || e.book} ${e.from}${e.to > e.from ? `–${e.to}` : ''}${e.verses ? `:${e.verses}` : ''}`;

export function readingDays(bible) {
  const days = new Set(bible.log.map((e) => e.date));
  Object.values(bible.read).forEach((chs) => Object.values(chs).forEach((d) => days.add(d)));
  return days;
}

// Current streak counts today if read, otherwise runs through yesterday (today isn't missed yet).
export function streak(bible, now = new Date()) {
  const days = readingDays(bible);
  let d = startOfDay(now);
  if (!days.has(dayKey(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
  const todayChapters = bible.log.filter((e) => e.date === dayKey(now)).reduce((a, e) => a + (e.to - e.from + 1), 0);
  let missed = 0;
  for (let i = 1; i <= 30; i++) if (!days.has(dayKey(addDays(now, -i)))) missed++;
  return { current: n, readToday: days.has(dayKey(now)), todayChapters, missed30: missed };
}

// Next unread chapters following the chosen plan order.
export function nextReading(bible, count = 1) {
  const all = books(bible);
  const ordered = bible.plan.order === 'nt-first' ? [...all.filter((b) => b.t === 'NT'), ...all.filter((b) => b.t === 'OT')] : all;
  const out = [];
  for (const b of ordered) {
    for (let c = 1; c <= b.chapters && out.length < count; c++) if (!isRead(bible, b.code, c)) out.push({ book: b.code, name: b.name, ch: c });
    if (out.length >= count) break;
  }
  return out;
}

export function planPace(bible, now = new Date()) {
  const { total } = stats(bible);
  const remaining = total.total - total.read;
  const end = parseLocal(bible.plan.endDate);
  if (!end || end <= now) return { remaining, perDay: null };
  const days = Math.max(1, Math.ceil((startOfDay(end) - startOfDay(now)) / 86400000) + 1);
  return { remaining, days, perDay: Math.ceil(remaining / days) };
}

export function search(bible, q) {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return bible.log.filter((e) => [refLabel(bible, e), e.note, e.favorite, e.verses].join(' ').toLowerCase().includes(t));
}
