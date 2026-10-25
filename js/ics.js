// Calendar file import/export (.ics) and CSV schedule import.
// .ics works with Canvas calendar feeds, Google Calendar and Apple Calendar exports.

import { pad, dayKey, toLocalInput, parseLocal, addDays, addMinutes, parseCSV } from './util.js';

const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const escapeText = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

function parseDate(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  if (!m[4]) return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
  // UTC times convert to local; TZID / floating times are taken as local wall-clock time.
  const d = m[7]
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))
    : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return { date: d, allDay: params.includes('VALUE=DATE') && !params.includes('DATE-TIME') };
}

function mapRepeat(rrule) {
  if (!rrule) return { repeat: 'none' };
  const p = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=')));
  let repeat = 'none';
  if (p.FREQ === 'DAILY') repeat = 'daily';
  if (p.FREQ === 'WEEKLY') repeat = p.BYDAY && p.BYDAY.split(',').length === 5 && !/SA|SU/.test(p.BYDAY) ? 'weekdays' : 'weekly';
  const u = p.UNTIL && parseDate(p.UNTIL, '');
  return { repeat, until: u ? dayKey(u.date) : '', complexRule: p.FREQ === 'WEEKLY' && p.BYDAY?.includes(',') && repeat === 'weekly' };
}

// Returns { events, tasks } in Compass shape. Canvas assignments become tasks.
export function parseICS(text, source = 'ics') {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [], tasks = [];
  let cur = null, nested = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    // Skip VALARM and other components nested inside an event.
    if (cur && line.startsWith('BEGIN:')) { nested++; continue; }
    if (cur && nested && line.startsWith('END:')) { nested--; continue; }
    if (nested) continue;
    if (line === 'END:VEVENT') {
      if (cur.start) {
        const uidVal = cur.uid || `${cur.title}-${toLocalInput(cur.start.date)}`;
        const isAssignment = /assignment|quiz|discussion_topic/i.test(uidVal) || (source === 'canvas' && /\b(due|assignment)\b/i.test(cur.title || ''));
        if (isAssignment) {
          const due = cur.start.allDay ? `${dayKey(cur.start.date)}T23:59` : toLocalInput(cur.start.date);
          tasks.push({ uid: uidVal, title: cur.title || 'Assignment', due, category: 'school', notes: cur.notes || '', link: cur.url || '', source });
        } else {
          const end = cur.end?.date || (cur.start.allDay ? addDays(cur.start.date, 1) : addMinutes(cur.start.date, 60));
          const all = cur.start.allDay;
          events.push({
            uid: uidVal, title: cur.title || 'Event', allDay: all,
            start: all ? dayKey(cur.start.date) : toLocalInput(cur.start.date),
            end: all ? dayKey(end) : toLocalInput(end),
            location: cur.location || '', notes: cur.notes || '', category: source === 'canvas' ? 'class' : 'personal',
            ...mapRepeat(cur.rrule), source,
          });
        }
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [name, ...params] = line.slice(0, idx).split(';');
    const value = line.slice(idx + 1);
    const p = params.join(';');
    if (name === 'UID') cur.uid = value;
    else if (name === 'SUMMARY') cur.title = unescapeText(value);
    else if (name === 'LOCATION') cur.location = unescapeText(value);
    else if (name === 'DESCRIPTION') cur.notes = unescapeText(value).slice(0, 2000);
    else if (name === 'URL') cur.url = value;
    else if (name === 'DTSTART') cur.start = parseDate(value, p);
    else if (name === 'DTEND') cur.end = parseDate(value, p);
    else if (name === 'RRULE') cur.rrule = value;
  }
  return { events, tasks };
}

const icsDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const icsDay = (s) => s.replaceAll('-', '').slice(0, 8);
const fold = (line) => line.match(/.{1,73}/g).join('\r\n ');

// Export so Apple Calendar can deliver native reminders (VALARM) even when Compass is closed.
export function toICS(events, tasks, alarmMinutes = 15) {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Compass//Personal Assistant//EN', 'CALSCALE:GREGORIAN'];
  const stamp = icsDate(new Date());
  const alarm = (min, text) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(text)}`, `TRIGGER:-PT${min}M`, 'END:VALARM'];
  for (const e of events) {
    const rr = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY' }[e.repeat];
    out.push('BEGIN:VEVENT', `UID:${e.uid || e.id}@compass`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(e.title)}`);
    if (e.allDay) out.push(`DTSTART;VALUE=DATE:${icsDay(e.start)}`, `DTEND;VALUE=DATE:${icsDay(e.end || dayKey(addDays(parseLocal(e.start), 1)))}`);
    else out.push(`DTSTART:${icsDate(parseLocal(e.start))}`, `DTEND:${icsDate(parseLocal(e.end) || addMinutes(parseLocal(e.start), 60))}`);
    if (rr) out.push(`RRULE:${rr}${e.until ? `;UNTIL=${icsDay(e.until)}T235959Z` : ''}`);
    if (e.location) out.push(`LOCATION:${escapeText(e.location)}`);
    if (e.notes) out.push(`DESCRIPTION:${escapeText(e.notes)}`);
    if (!e.allDay) out.push(...alarm((e.travelMin || 0) + alarmMinutes, e.travelMin ? `Leave soon for ${e.title}` : e.title));
    out.push('END:VEVENT');
  }
  for (const t of tasks.filter((x) => !x.done && x.due)) {
    const due = parseLocal(t.due);
    out.push('BEGIN:VEVENT', `UID:task-${t.uid || t.id}@compass`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(`Due: ${t.title}`)}`,
      `DTSTART:${icsDate(addMinutes(due, -30))}`, `DTEND:${icsDate(due)}`, ...alarm(24 * 60, `Due tomorrow: ${t.title}`), ...alarm(120, `Due soon: ${t.title}`), 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n');
}

// CSV with a header row, e.g. a Google Sheets church schedule:
// Date, Start, End, Title/Event/Role, Location
export function parseScheduleCSV(text, category = 'church') {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((x) => x.trim().toLowerCase());
  const col = (...names) => head.findIndex((x) => names.some((n) => x.includes(n)));
  const ci = { date: col('date', 'day'), start: col('start', 'time'), end: col('end'), title: col('title', 'event', 'role', 'service', 'what', 'name'), loc: col('location', 'where', 'place') };
  if (ci.date < 0) throw new Error('CSV needs a "Date" column');
  const toTime = (s) => {
    const m = String(s || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
    if (!m) return null;
    let hh = +m[1]; const ap = m[3]?.[0].toLowerCase();
    if (ap === 'p' && hh < 12) hh += 12;
    if (ap === 'a' && hh === 12) hh = 0;
    return `${pad(hh)}:${m[2] || '00'}`;
  };
  const toDate = (s) => {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); // M/D/YYYY (Google Sheets default in North America)
    if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}`;
    const d = new Date(s);
    return isNaN(d) ? null : dayKey(d);
  };
  const out = [];
  for (const r of rows.slice(1)) {
    const date = toDate(r[ci.date]);
    if (!date) continue;
    const title = (ci.title >= 0 && r[ci.title]?.trim()) || 'Church';
    const st = ci.start >= 0 ? toTime(r[ci.start]) : null;
    const en = ci.end >= 0 ? toTime(r[ci.end]) : null;
    const start = st ? `${date}T${st}` : date;
    out.push({
      uid: `csv-${date}-${st || 'all'}-${title}`.toLowerCase().replace(/\s+/g, '-'),
      title, allDay: !st, start,
      end: st ? (en ? `${date}T${en}` : toLocalInput(addMinutes(parseLocal(start), 90))) : dayKey(addDays(parseLocal(date), 1)),
      location: ci.loc >= 0 ? r[ci.loc]?.trim() || '' : '', category, repeat: 'none', source: 'csv',
    });
  }
  return out;
}
