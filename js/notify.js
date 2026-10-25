// Local notifications while Compass is open or in the background (no server).
// Each alert fires once, tracked in state.meta.notified.

import { state, update, save } from './store.js';
import { briefing, recap, occurrences, leaveBy } from './planner.js';
import { toast } from './ui.js';
import { dayKey, fmtTime, addMinutes, parseLocal } from './util.js';

const supported = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function enableNotifications() {
  if (!supported()) {
    toast('On iPhone, add Compass to your Home Screen first (Share → Add to Home Screen), then turn on notifications from there.', 6000);
    return;
  }
  const perm = await Notification.requestPermission();
  update((s) => { s.settings.notifications = perm === 'granted'; });
  if (perm === 'granted') show('Compass notifications are on', 'You’ll get your briefing, reminders and alerts here.', 'test');
  else toast('Notifications are blocked. Enable them in iPhone Settings → Notifications → Compass.', 6000);
}

async function show(title, body, tag) {
  if (!state.settings.notifications || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#today' } });
}

function once(key, fn) {
  if (state.meta.notified[key]) return;
  state.meta.notified[key] = Date.now();
  fn();
}

// Called every minute and whenever the app comes to the foreground.
export function checkReminders(now = new Date()) {
  if (!state) return;
  const k = dayKey(now);
  const n = state.meta.notified;
  // Drop markers older than 3 days.
  for (const key of Object.keys(n)) if (Date.now() - n[key] > 3 * 86400000) delete n[key];

  if (now.getHours() >= state.settings.briefingHour && now.getHours() < 12) {
    once(`briefing:${k}`, () => {
      const b = briefing(state, now);
      const first = b.events.find((o) => !o.allDay);
      show('Your daily briefing', [
        b.events.length ? `${b.events.length} events${first ? `, first ${first.title} at ${fmtTime(first.start)}` : ''}` : 'Clear calendar',
        b.dueToday.length ? `${b.dueToday.length} due today` : '',
        b.conflicts.length ? `${b.conflicts.length} conflict(s)` : '',
        b.priorities[0] ? `Start with: ${b.priorities[0].title}` : '',
      ].filter(Boolean).join(' · '), 'briefing');
    });
  }
  if (state.settings.recap && now.getHours() >= state.settings.recapHour) {
    once(`recap:${k}`, () => {
      const r = recap(state, now);
      show('Evening recap', `${r.done.length} done, ${r.unfinished.length} unfinished. Bed by ${fmtTime(r.bedtime)}.`, 'recap');
    });
  }
  for (const o of occurrences(state.events, now, addMinutes(now, 90))) {
    if (o.allDay) continue;
    const lb = leaveBy(o);
    const alertAt = addMinutes(lb || o.start, -15);
    if (now >= alertAt && now < o.start) {
      once(`ev:${o.occId}`, () => show(o.title, lb ? `Leave by ${fmtTime(lb)}${o.location ? ` for ${o.location}` : ''}` : `Starts at ${fmtTime(o.start)}${o.location ? ` · ${o.location}` : ''}`, o.occId));
    }
  }
  for (const t of state.tasks) {
    const due = parseLocal(t.due);
    if (t.done || !due) continue;
    const mins = (due - now) / 60000;
    if (mins > 0 && mins <= 120) once(`due:${t.id}:${t.due}`, () => show('Due soon', `${t.title} — ${fmtTime(due)}`, `due-${t.id}`));
  }
  save(); // persist markers without re-rendering (keeps any typing intact)
}
