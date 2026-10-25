import { state, update, hasPasscode, setPasscode, exportBackup, importBackup, wipe, flush, logAction } from '../store.js';
import { icon, modal, field, select, toast, confirmSheet } from '../ui.js';
import { mergeImported } from '../forms.js';
import { parseICS, parseScheduleCSV, toICS } from '../ics.js';
import * as AI from '../ai.js';
import { h, download, pickFile, dayKey, fmtDate } from '../util.js';
import { enableNotifications } from '../notify.js';
import * as Connect from '../connect.js';

const CARD_NAMES = { briefing: 'Daily briefing / recap', alerts: 'Alerts', schedule: 'Today’s schedule', tasks: 'Focus tasks', plan: 'Suggested plan', money: 'Money this week', emails: 'Important email', habits: 'Habits', bible: 'Bible progress' };

const FILE_IMPORTS = [
  { name: 'Canvas calendar (.ics)', how: 'Canvas → Calendar → Calendar Feed. Assignments become tasks; re-importing updates instead of duplicating.', action: 'importCanvas', src: 'canvas' },
  { name: 'Google / Apple Calendar (.ics)', how: 'Import an .ics export. Export Compass back to Apple Calendar for native reminders.', action: 'importIcs', src: 'ics' },
  { name: 'Church schedule (Google Sheets CSV)', how: 'In Sheets: File → Download → CSV. Columns: Date, Start, End, Title, Location.', action: 'importCsv', src: 'csv' },
  { name: 'Bank transactions (TD CSV)', how: 'On the Money screen → Import.', href: '#money', src: 'bank' },
];

const LIVE = [
  { key: 'canvas', name: 'Canvas (live)', how: 'Courses, assignments, grades, missing work and announcements, checked every time Compass syncs.' },
  { key: 'plaid', name: 'Bank (Plaid, read-only)', how: 'Balances and transactions. Sign-in happens in Plaid’s window; Compass never sees your bank password and can’t move money.' },
  { key: 'push', name: 'Exact-time notifications', how: '7 AM briefing and evening recap even when Compass is closed.' },
];

const lastImport = (src) => state.meta.lastImport?.[src];
let srv = { loaded: false, data: null, error: null };
let rerender = () => {};

async function loadServer() {
  srv = { loaded: true, data: null, error: null, loading: true };
  try { srv.data = await Connect.serverStatus(); } catch (e) { srv.error = e.message; }
  srv.loading = false;
  rerender();
}

function liveHTML() {
  if (!Connect.isPaired()) return '<p class="muted small">Pair a Compass server above to connect live accounts. Setup guide: <code>server/SETUP.md</code>.</p>';
  if (srv.loading || !srv.loaded) return '<p class="muted">Checking server…</p>';
  if (srv.error) return `<p class="bad-text small">${h(srv.error)}</p><button class="btn small" data-act="refreshServer">Retry</button>`;
  const st = srv.data.status || {};
  const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
  const acctRow = (a) => {
    const s = st[a.id] || {};
    return `<li class="item integ"><div class="what"><strong>${a.provider === 'google' ? 'Gmail' : 'Outlook'} · ${h(a.email)}</strong>
      <div class="meta">${s.error ? '<span class="chip bad">Error</span>' : '<span class="chip good">Connected</span>'}<span class="muted small">last sync ${ago(s.lastSync)}</span></div>
      ${s.error ? `<p class="bad-text small">${h(s.error)}${a.provider === 'google' ? ' — Google makes personal apps sign in again every 7 days; tap Reconnect.' : ''}</p>` : ''}</div>
      <div class="stack-btns">${s.error ? `<button class="btn small primary" data-act="addAccount" data-p="${a.provider}">Reconnect</button>` : ''}<button class="btn small ghost" data-act="removeAccount" data-id="${h(a.id)}">Remove</button></div></li>`;
  };
  const feedRow = (f) => {
    const err = state.meta.syncErrors?.[`feed:${f.id}`];
    return `<li class="item integ"><div class="what"><strong>${h(f.name)}</strong>
      <div class="meta">${err ? '<span class="chip bad">Error</span>' : '<span class="chip good">Syncing</span>'}<span class="chip">${f.kind === 'canvas' ? 'Canvas' : f.type === 'csv' ? 'Sheet (CSV)' : 'Calendar'}</span><span class="muted small">last sync ${ago(st.feeds?.lastSync)}</span></div>
      ${err ? `<p class="bad-text small">${h(err)}</p>` : ''}</div><button class="btn small ghost" data-act="removeFeed" data-id="${h(f.id)}">Remove</button></li>`;
  };
  return `<h3>Email &amp; calendar accounts</h3>
  <ul class="list">${srv.data.accounts.map(acctRow).join('') || '<li class="muted small">No email accounts yet. Add as many Gmail and Outlook accounts as you like.</li>'}</ul>
  <div class="row wrap">
    ${srv.data.configured.google ? '<button class="btn small" data-act="addAccount" data-p="google">+ Gmail account</button>' : '<span class="chip">Gmail: not set up on server</span>'}
    ${srv.data.configured.microsoft ? '<button class="btn small" data-act="addAccount" data-p="microsoft">+ Outlook account</button>' : '<span class="chip">Outlook: not set up on server</span>'}
  </div>
  <p class="muted small">Read-only. Other providers (Yahoo, iCloud Mail…) aren’t supported yet — forward them to Gmail.</p>
  <h3>Calendar links <span class="muted">(auto-sync, never expire)</span></h3>
  <ul class="list">${srv.data.feeds.map(feedRow).join('') || '<li class="muted small">Add Canvas, Google Calendar, Outlook, iCloud or a published Google Sheet — no more manual imports.</li>'}</ul>
  <button class="btn small" data-act="addFeed">+ Calendar link</button>
  <h3>School, bank &amp; notifications</h3>
  <ul class="list">${LIVE.map((x) => {
    const s = st[x.key] || {};
    const configured = srv.data.configured[x.key];
    const chip = !configured ? '<span class="chip">Not set up on server</span>'
      : s.error ? `<span class="chip bad">Error</span>` : s.connected ? `<span class="chip good">Connected</span>` : '<span class="chip">Not connected</span>';
    const btn = !configured ? '' : s.connected
      ? `${x.key === 'push' ? '<button class="btn small" data-act="testPush">Test</button>' : ''}<button class="btn small ghost" data-act="disconnect" data-k="${x.key}">Disconnect</button>`
      : `<button class="btn small primary" data-act="connect" data-k="${x.key}">Connect</button>`;
    return `<li class="item integ"><div class="what"><strong>${h(x.name)}</strong>
      <div class="meta">${chip}${s.connected && x.key !== 'push' ? `<span class="muted small">last sync ${ago(s.lastSync)}</span>` : ''}${x.key === 'plaid' && srv.data.plaidEnv === 'sandbox' ? '<span class="chip warn">sandbox</span>' : ''}</div>
      ${s.error ? `<p class="bad-text small">${h(s.error)}</p>` : ''}<p class="muted small">${h(x.how)}</p></div><div class="stack-btns">${btn}</div></li>`;
  }).join('')}</ul>
  <h3>Voice — “Hey Siri, ask Compass”</h3>
  ${!srv.data.configured.voice ? '<p class="muted small">Not set up on the server yet (needs ANTHROPIC_API_KEY — see server/SETUP.md).</p>'
    : `<label class="check"><input type="checkbox" data-act="toggleVoice" ${state.settings.voiceShare ? 'checked' : ''}> Share a summary of my schedule, tasks, money and goals with my server so Siri can answer</label>
      <p class="muted small">Stored encrypted on your own server and refreshed each sync. Turn off to delete it. Anything Siri wants to add waits for your approval on the Today screen.</p>
      ${state.settings.voiceShare ? '<button class="btn small" data-act="siriHelp">Set up the Siri Shortcut</button>' : ''}`}
  <div class="row top-gap"><button class="btn small" data-act="syncNow">Sync now</button><button class="btn small ghost danger" data-act="wipeServer">Delete all server data</button></div>`;
}

export default {
  id: 'settings',
  title: 'Settings',
  render(ctx) {
    rerender = ctx.rerender;
    if (Connect.isPaired() && !srv.loaded) setTimeout(loadServer);
    const s = state.settings;
    const ok = (src) => (lastImport(src) ? `<span class="chip good">Imported ${fmtDate(new Date(lastImport(src)))}</span>` : '<span class="chip">Not imported</span>');
    return `<header class="page-head"><h1>Settings</h1></header>
    <div class="grid">
    <section class="card"><h2>You</h2>
      <form data-form="profile" class="stack">
        ${field('Name', `<input name="name" value="${h(s.name)}" placeholder="What should Compass call you?">`)}
        <div class="row">${field('Theme', select('theme', { auto: 'Match device', light: 'Light', dark: 'Dark' }, s.theme))}
        ${field('Sleep goal (hours)', `<input type="number" name="sleepHours" min="5" max="11" step="0.5" value="${s.sleepHours}">`)}</div>
        <div class="row">${field('Day starts', `<input type="time" name="dayStart" value="${s.dayStart}">`)}${field('Day ends', `<input type="time" name="dayEnd" value="${s.dayEnd}">`, 'Used to find free time')}</div>
        <button class="btn primary">Save</button>
      </form></section>

    <section class="card"><h2>Briefings &amp; notifications</h2>
      <form data-form="notify" class="stack">
        <div class="row">${field('Morning briefing', select('briefingHour', Object.fromEntries([5, 6, 7, 8, 9, 10].map((x) => [x, `${x}:00 AM`])), s.briefingHour))}
        ${field('Evening recap', select('recapHour', Object.fromEntries([19, 20, 21, 22].map((x) => [x, `${x - 12}:00 PM`])), s.recapHour))}</div>
        <label class="check"><input type="checkbox" name="recap" ${s.recap ? 'checked' : ''}> Show the evening recap</label>
        <button class="btn primary">Save</button>
      </form>
      <div class="stack top-gap">
        <button class="btn" data-act="notifications">${s.notifications ? 'Notifications on ✓ — test' : 'Turn on notifications'}</button>
        <p class="muted small">iPhone limits web apps: alerts fire while Compass is open or recently used, not on an exact schedule. For dependable reminders, export your calendar to Apple Calendar below (it carries alarms), and add an iPhone Shortcuts automation: <b>Automation → Time of Day 7:00 → Open URL</b> with this app’s address + <code>#today</code>.</p>
        <button class="btn" data-act="exportIcs">Export calendar &amp; deadlines to Apple Calendar (.ics)</button>
      </div></section>

    <section class="card"><h2>Home screen cards</h2>
      <ul class="list">${s.homeCards.map((c, i) => `<li class="item"><label class="check grow"><input type="checkbox" data-act="toggleCard" data-i="${i}" ${c.on ? 'checked' : ''}> ${CARD_NAMES[c.id] || c.id}</label>
        <button class="icon-btn" data-act="moveCard" data-i="${i}" data-d="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 18)}</button>
        <button class="icon-btn" data-act="moveCard" data-i="${i}" data-d="1" aria-label="Move down" ${i === s.homeCards.length - 1 ? 'disabled' : ''}>${icon('down', 18)}</button></li>`).join('')}</ul></section>

    <section class="card"><h2>AI (Claude)</h2>
      <p class="muted small">Your key is stored only on this device${hasPasscode() ? ', encrypted with your passcode' : ' — set a passcode below to encrypt it'}. It is sent only to Anthropic, never included in backups. Anthropic doesn’t train on API data by default. Set a monthly spend limit in the Anthropic Console.</p>
      <form data-form="ai" class="stack">
        ${field('Claude API key', `<input name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${s.apiKey ? '•••••••• saved — paste to replace' : 'sk-ant-…'}">`, 'Create one at console.anthropic.com → API keys')}
        <label class="check"><input type="checkbox" name="voiceReplies" ${s.voiceReplies ? 'checked' : ''}> Read replies aloud</label>
        <div class="row"><button class="btn primary">Save</button>${s.apiKey ? '<button type="button" class="btn" data-act="testKey">Test</button><button type="button" class="btn danger" data-act="removeKey">Remove key</button>' : ''}</div>
      </form>
      <p class="muted small">Model: ${AI.MODEL}. Every change the AI suggests needs your approval.</p></section>

    <section class="card"><h2>Compass server</h2>
      <p class="muted small">Your own private server (free Cloudflare account) that connects Gmail, Outlook, Canvas and your bank read-only, and sends exact-time notifications. Set it up with <code>server/SETUP.md</code>.</p>
      <form data-form="server" class="stack">
        ${field('Server address', `<input name="serverUrl" type="url" inputmode="url" autocomplete="off" value="${h(s.serverUrl)}" placeholder="https://compass-server.yourname.workers.dev">`)}
        ${field('Pairing token', `<input name="serverToken" type="password" autocomplete="off" spellcheck="false" placeholder="${s.serverToken ? '•••••••• saved — paste to replace' : 'APP_TOKEN from keys.html'}">`, 'This is your own server’s token — not a password for any account.')}
        <div class="row"><button class="btn primary">Save &amp; check</button>${Connect.isPaired() ? '<button type="button" class="btn ghost danger" data-act="unpair">Unpair</button>' : ''}</div>
      </form></section>

    <section class="card"><h2>Live connections</h2>${liveHTML()}</section>

    <section class="card"><h2>File imports</h2>
      <p class="muted small">Works without the server.</p>
      <ul class="list">${FILE_IMPORTS.map((x) => `<li class="item integ"><div class="what"><strong>${h(x.name)}</strong>
        <div class="meta">${ok(x.src)}</div>
        <p class="muted small">${h(x.how)}</p></div>${x.action ? `<button class="btn small" data-act="${x.action}">Import</button>` : `<a class="btn small" href="${x.href}">Open</a>`}</li>`).join('')}</ul></section>

    <section class="card"><h2>Security</h2>
      <p class="muted small">${hasPasscode() ? 'All data on this device is encrypted (AES-256) with your passcode. Compass locks itself after inactivity.' : 'Set a passcode to encrypt everything on this device and lock the app.'}</p>
      <div class="row">
        <button class="btn" data-act="passcode">${hasPasscode() ? 'Change passcode' : 'Set passcode'}</button>
        ${hasPasscode() ? '<button class="btn ghost" data-act="removePasscode">Remove</button>' : ''}
      </div>
      ${hasPasscode() ? `<form data-form="lock" class="row top-gap">${field('Auto-lock after', select('autoLockMin', { 1: '1 minute', 5: '5 minutes', 15: '15 minutes', 60: '1 hour' }, s.autoLockMin))}<button class="btn">Save</button></form>` : ''}
    </section>

    <section class="card"><h2>AI approvals &amp; activity</h2>
      ${state.actions.length ? `<ul class="list compact">${state.actions.slice(0, 25).map((a) => `<li class="item"><div class="what"><strong>${h(a.summary)}</strong><div class="meta"><span class="chip ${a.status === 'approved' ? 'good' : ''}">${h(a.status)}</span><span class="muted small">${h(a.source)} · ${new Date(a.ts).toLocaleString()}</span></div></div></li>`).join('')}</ul>` : '<p class="muted">No activity yet.</p>'}
    </section>

    <section class="card"><h2>Your data</h2>
      <p class="muted small">Everything stays on this device. Back up regularly — there’s no cloud copy yet.</p>
      <div class="row wrap">
        <button class="btn" data-act="backup">Export backup</button>
        <button class="btn" data-act="restore">Restore backup</button>
        <button class="btn danger" data-act="wipe">Delete all data</button>
      </div></section>
    </div>`;
  },
  forms: {
    profile: (v) => { update((s) => Object.assign(s.settings, { name: v.name, theme: v.theme, sleepHours: v.sleepHours || 8, dayStart: v.dayStart || '08:00', dayEnd: v.dayEnd || '22:00' })); toast('Saved'); },
    notify: (v) => { update((s) => Object.assign(s.settings, { briefingHour: +v.briefingHour, recapHour: +v.recapHour, recap: v.recap })); toast('Saved'); },
    ai: (v) => {
      update((s) => { if (v.apiKey) s.settings.apiKey = v.apiKey; s.settings.voiceReplies = v.voiceReplies; });
      toast(v.apiKey ? 'Key saved' : 'Saved');
    },
    lock: (v) => { update((s) => { s.settings.autoLockMin = +v.autoLockMin; }); toast('Saved'); },
    server: (v) => {
      if (v.serverUrl && !/^https:\/\//.test(v.serverUrl)) { toast('The server address must start with https://'); return; }
      update((s) => { s.settings.serverUrl = v.serverUrl.replace(/\/+$/, ''); if (v.serverToken) s.settings.serverToken = v.serverToken; logAction('security', 'Server pairing updated'); });
      srv = { loaded: false };
      if (Connect.isPaired()) loadServer().then(() => { if (srv.data) { toast('Server connected'); Connect.sync(); } });
    },
  },
  act: {
    refreshServer: () => loadServer(),
    toggleVoice: async (el) => {
      update((s) => { s.settings.voiceShare = el.checked; logAction('security', `Voice sharing ${el.checked ? 'on' : 'off'}`); });
      try { if (el.checked) { await Connect.pushContext(); toast('Voice ready'); } else { await Connect.clearContext(); toast('Summary deleted from server'); } } catch (e) { toast(e.message); }
    },
    siriHelp: () => modal({
      title: 'Set up “Ask Compass” in Siri',
      body: `<ol class="steps small">
        <li>Open the <b>Shortcuts</b> app → <b>+</b> (new shortcut).</li>
        <li>Add action <b>Dictate Text</b>.</li>
        <li>Add action <b>Get Contents of URL</b>. Set the URL to <code>${h(state.settings.serverUrl)}/ask</code>, then tap <b>Show More</b>:
          <ul><li>Method: <b>POST</b></li><li>Headers: add <b>Authorization</b> = <code>Bearer</code> + a space + your pairing token (from keys.html)</li><li>Request Body: <b>JSON</b>, add a Text field <b>question</b> = <i>Dictated Text</i></li></ul></li>
        <li>Add action <b>Get Dictionary Value</b>: key <b>answer</b>.</li>
        <li>Add action <b>Speak Text</b> (Dictionary Value).</li>
        <li>Name the shortcut <b>Ask Compass</b>.</li></ol>
        <p>Then say: <b>“Hey Siri, Ask Compass”</b> — and ask “What’s on tomorrow?”, “How much can I spend this week?”, or “Remind me to email my prof Friday at 3”.</p>
        <p class="muted small">Works from your iPhone, AirPods, Apple Watch and CarPlay. The token stays inside your shortcut on your phone.</p>`,
    }),
    addAccount: async (el) => { try { await Connect.startOAuth(el.dataset.p); } catch (e) { toast(e.message, 6000); } },
    removeAccount: async (el) => {
      if (!(await confirmSheet('Remove this account?', 'Access is revoked and its emails and calendar events are removed from Compass.', 'Remove'))) return;
      try { await Connect.removeAccount(el.dataset.id); update((s) => logAction('security', `Removed account ${el.dataset.id.split(':').slice(1).join(':')}`)); await Connect.sync(); } catch (e) { toast(e.message); }
      loadServer();
    },
    addFeed: () => modal({
      title: 'Add a calendar link',
      body: `${field('What is it?', select('kind', { canvas: 'Canvas (Mohawk)', google: 'Google Calendar', outlook: 'Outlook / Mohawk calendar', icloud: 'Apple iCloud calendar', sheet: 'Google Sheet (church schedule)', other: 'Other .ics link' }, 'canvas'))}
        <div class="feed-help small" data-help></div>
        ${field('Name', '<input name="name" placeholder="e.g. Canvas, Church schedule">')}
        ${field('Private link', '<input name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://… or webcal://…" required>', 'Stored encrypted on your server. Anyone with this link can see that calendar, so don’t share it.')}
        ${field('Category for events', select('category', { class: 'Class', school: 'School', work: 'Work', church: 'Church', personal: 'Personal' }, 'class'))}`,
      submit: 'Add & sync',
      onOpen: (form) => {
        const HELP = {
          canvas: 'Canvas → <b>Calendar</b> → <b>Calendar Feed</b> (bottom right) → copy the link. Assignments become tasks.',
          google: 'On a computer: Google Calendar → ⚙ Settings → click your calendar → <b>Integrate calendar</b> → copy <b>Secret address in iCal format</b>.',
          outlook: 'Outlook on the web → ⚙ Settings → Calendar → <b>Shared calendars</b> → <b>Publish a calendar</b> → “Can view all details” → copy the <b>ICS</b> link. (Mohawk may have publishing turned off.)',
          icloud: 'iPhone Calendar app → Calendars → ⓘ next to the calendar → turn on <b>Public Calendar</b> → Share Link → Copy.',
          sheet: 'Google Sheets → <b>File → Share → Publish to web</b> → pick the sheet → <b>Comma-separated values (.csv)</b> → Publish → copy the link. Columns: Date, Start, End, Title, Location.',
          other: 'Any calendar that gives you an .ics or webcal:// link.',
        };
        const cat = { canvas: 'class', google: 'personal', outlook: 'school', icloud: 'personal', sheet: 'church', other: 'personal' };
        const name = { canvas: 'Canvas', google: 'Google Calendar', outlook: 'Outlook calendar', icloud: 'iCloud calendar', sheet: 'Church schedule', other: 'Calendar' };
        const sync = () => { form.querySelector('[data-help]').innerHTML = HELP[form.kind.value]; form.category.value = cat[form.kind.value]; form.name.placeholder = name[form.kind.value]; };
        form.kind.addEventListener('change', sync); sync();
      },
      onSubmit: async (v, form) => {
        try {
          await Connect.addFeed({ name: v.name || form.name.placeholder, url: v.url, category: v.category, kind: v.kind === 'canvas' ? 'canvas' : '', type: v.kind === 'sheet' ? 'csv' : undefined });
          toast('Calendar added — syncing…');
          await Connect.sync();
          loadServer();
        } catch (e) { toast(e.message, 6000); return false; }
      },
    }),
    removeFeed: async (el) => {
      if (!(await confirmSheet('Remove this calendar link?', 'Its events are removed from Compass and the link is deleted from your server.', 'Remove'))) return;
      try { await Connect.removeFeed(el.dataset.id); await Connect.sync(); } catch (e) { toast(e.message); }
      loadServer();
    },
    unpair: async () => {
      if (!(await confirmSheet('Unpair server?', 'Compass stops syncing. Your accounts stay connected on the server until you disconnect them there.', 'Unpair'))) return;
      update((s) => { s.settings.serverToken = ''; });
      srv = { loaded: false };
    },
    connect: async (el) => {
      const k = el.dataset.k;
      try {
        if (k === 'google' || k === 'microsoft') return await Connect.startOAuth(k);
        if (k === 'canvas') {
          return modal({
            title: 'Connect Canvas',
            body: `<ol class="small steps"><li>Open Canvas in a browser → <b>Account</b> → <b>Settings</b>.</li><li>Under <b>Approved Integrations</b>, tap <b>+ New Access Token</b>, purpose “Compass”, pick an expiry date (e.g. end of term).</li><li>Copy the token and paste it below. It goes straight to your server, encrypted — Compass doesn’t keep it.</li></ol>
              ${field('Canvas address', `<input name="baseUrl" value="${h(srv.data?.canvasBase || 'https://mohawkcollege.instructure.com')}">`)}
              ${field('Access token', '<input name="token" type="password" autocomplete="off" autofocus>')}
              <p class="muted small">If you don’t see “New Access Token”, Mohawk has turned it off — keep using the calendar-feed import instead.</p>`,
            submit: 'Connect',
            onSubmit: async (v) => {
              try { const r = await Connect.connectCanvas(v.baseUrl, v.token); toast(`Canvas connected (${r.name})`); srv.loaded = false; Connect.sync(); } catch (e) { toast(e.message, 6000); return false; }
            },
          });
        }
        if (k === 'plaid') {
          const name = await Connect.connectBank();
          if (name) { toast(`${name} connected`); await Connect.sync(); }
        }
        if (k === 'push') { await Connect.enableServerPush(); toast('Exact-time notifications on'); }
        loadServer();
      } catch (e) { toast(e.message, 6000); }
    },
    disconnect: async (el) => {
      const k = el.dataset.k;
      if (!(await confirmSheet('Disconnect?', 'Access is revoked and the tokens are deleted from your server. Data already on this device stays until you delete it.', 'Disconnect'))) return;
      try { await Connect.disconnect(k); update((s) => logAction('security', `Disconnected ${k}`)); toast('Disconnected'); } catch (e) { toast(e.message); }
      loadServer();
    },
    testPush: async () => { try { const r = await Connect.testPush(); toast(r.sent ? 'Test notification sent' : `Not sent: ${r.reason || r.status}`); } catch (e) { toast(e.message); } },
    syncNow: async () => { toast('Syncing…'); try { await Connect.sync({ quiet: false }); toast('Synced'); } catch (e) { toast(e.message, 5000); } loadServer(); },
    wipeServer: async () => {
      if (!(await confirmSheet('Delete all server data?', 'Disconnects every account and erases all tokens stored on your Compass server.', 'Delete'))) return;
      try { await Connect.deleteServerData(); toast('Server data deleted'); } catch (e) { toast(e.message); }
      loadServer();
    },
    toggleCard: (el) => update((s) => { s.settings.homeCards[+el.dataset.i].on = el.checked; }),
    moveCard: (el) => update((s) => {
      const i = +el.dataset.i, j = i + +el.dataset.d, c = s.settings.homeCards;
      [c[i], c[j]] = [c[j], c[i]];
    }),
    notifications: () => enableNotifications(),
    exportIcs: () => { download(`compass-${dayKey(new Date())}.ics`, toICS(state.events, state.tasks), 'text/calendar'); toast('Open the file to add it to Calendar'); },
    testKey: async () => { toast('Testing…'); try { toast(`Claude says: ${await AI.testKey()}`); } catch (e) { toast(e.message, 5000); } },
    removeKey: () => { update((s) => { s.settings.apiKey = ''; }); toast('Key removed'); },
    importCanvas: () => importFile('canvas'),
    importIcs: () => importFile('ics'),
    importCsv: () => importFile('csv'),
    passcode: () => modal({
      title: hasPasscode() ? 'Change passcode' : 'Set passcode',
      body: `${field('New passcode', '<input type="password" name="p1" inputmode="numeric" autocomplete="new-password" minlength="6" autofocus>', 'At least 6 characters. If you forget it, your data can’t be recovered — keep a backup.')}
        ${field('Repeat passcode', '<input type="password" name="p2" inputmode="numeric" autocomplete="new-password">')}`,
      onSubmit: async (v) => {
        if (v.p1.length < 6) { toast('Use at least 6 characters'); return false; }
        if (v.p1 !== v.p2) { toast('Passcodes don’t match'); return false; }
        await setPasscode(v.p1);
        update((s) => logAction('security', 'Passcode set'));
        toast('Passcode set — data encrypted');
      },
    }),
    removePasscode: async () => {
      if (!(await confirmSheet('Remove passcode?', 'Your data will be stored unencrypted on this device.', 'Remove'))) return;
      await setPasscode('');
      update((s) => logAction('security', 'Passcode removed'));
      toast('Passcode removed');
    },
    backup: () => download(`compass-backup-${dayKey(new Date())}.json`, exportBackup(), 'application/json'),
    restore: async () => {
      const f = await pickFile('.json,application/json');
      if (!f) return;
      try { await importBackup(f.text); location.reload(); } catch (e) { toast(e.message); }
    },
    wipe: async () => {
      if (!(await confirmSheet('Delete all data?', 'This permanently erases every event, task, note and setting on this device. Export a backup first if you might want it back.', 'Delete everything'))) return;
      wipe(); await flush(); location.reload();
    },
  },
};

async function importFile(source) {
  const f = await pickFile(source === 'csv' ? '.csv,text/csv' : '.ics,text/calendar');
  if (!f) return;
  try {
    const data = source === 'csv' ? { events: parseScheduleCSV(f.text) } : parseICS(f.text, source);
    const n = (data.events?.length || 0) + (data.tasks?.length || 0);
    if (!n) { toast('No events found in that file'); return; }
    const { added, updated } = mergeImported(data);
    update((s) => { (s.meta.lastImport ||= {})[source] = new Date().toISOString(); });
    toast(`${added} added, ${updated} updated`);
  } catch (e) {
    toast(`Import failed: ${e.message}`, 5000);
  }
}
