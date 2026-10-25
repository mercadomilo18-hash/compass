# Compass: personal assistant

An installable web app (PWA) for iPhone and desktop covering your schedule, school, money, email, goals, Bible reading, and an AI assistant powered by Claude. There's no build step. Your data stays on your device, encrypted with your passcode. An optional private server ([server/SETUP.md](server/SETUP.md)) adds live Gmail, Outlook, Canvas and bank sync, plus exact-time notifications.

## Put it on your iPhone

1. Host the app folder on any free HTTPS static host. **GitHub Pages:** create a repository called `compass`, upload everything *except* the `server` and `tools` folders, then go to Settings → Pages → Deploy from branch → `main` / root.
2. Open the address in **Safari** on the iPhone, then tap Share → **Add to Home Screen**.
3. Open Compass from the Home Screen icon, enter your name and set a passcode.

Use **Settings → Export backup** now and then. Data lives on the device.

## First-time setup

- **Classes:** go to Calendar → + Event, choose *Repeats: Every week*, and set *Until* to the end of term. Add *Travel (min)* to get a "leave by" time.
- **Courses and grades:** go to School → Courses → + Course and enter the grade breakdown from each outline (e.g. Labs 20%, Midterm 30%, Final 30%). Add marks as they come back.
- **Canvas:** go to Canvas → Calendar → **Calendar Feed**, download the `.ics` file, then Settings → File imports → Canvas. Live sync is also available through the server.
- **TD transactions:** in TD EasyWeb, open the account → **Download** → *Spreadsheet (.csv)*. Then Money → Import. Do the same for a TD credit card. Then set your weekly spending money and category budgets.
- **Church schedule:** in Google Sheets, File → Download → CSV, then Settings → File imports.
- **Claude:** create a key at console.anthropic.com → API keys and paste it into Settings → AI. Set a monthly spend limit there too.
- **Bible plan (optional):** Bible → Reading plans → Start.

## What's included

| Area | Features |
|---|---|
| **Today** | Morning briefing and evening recap with bedtime, plus alerts: overdue work, conflicts, bunched deadlines, budget, bills, price increases, missed goals, failed syncs, missing Canvas work, unanswered important email. Suggested plan for free time. You choose which cards show and in what order. |
| **Calendar** | Day, week and month views; repeating events; conflict detection; free-time finder; leave-by times; `.ics` import/export with native iPhone alarms. |
| **School** | Tasks by urgency with step plans. Courses with percent weights, current grade, Ontario college letter grade, "what do I need on X", best/worst case. Upcoming tests and exam study plans placed in your free time. Canvas assignments link to their course automatically. |
| **Money** | TD CSV import (no duplicates). Auto-categories you can correct ("always use this"). Weekly spending money plus monthly category budgets. Bills and subscriptions detected, including price increases. Unusual purchases. Ways to save. End-of-month forecast. Savings goals. Read-only, always. |
| **Bible** | All 1,189 chapters, with OT/NT/book %. Rereads are never double-counted. Streaks, missed days, notes, favourite verses, search. Reading plans: whole Bible in a year, NT in 90 days, Gospels & Acts in 30 days, Psalms & Proverbs in 60 days, OT in a year, with catch-up. |
| **Goals** | Daily, weekly and monthly goals with history; habit streaks. A gym habit gets a suggested time block. |
| **Assistant** | Claude answers from your data and says where each answer came from. It proposes tasks, events, steps and Bible logs, and you **approve** each one. Paste an email to get a summary, deadlines, tasks and a reply draft (Copy or Open in Mail; you send it). Works offline for common questions. Voice input where the browser supports it. |
| **Security** | Passcode with AES-256 encryption and auto-lock. Keys are never put in backups. An activity and approval history. Disconnect any account, or delete all data. |
| **Live accounts** (optional server) | Gmail and Google Calendar, Outlook, Canvas (courses, assignments, grades, missing work, announcements), Plaid bank sync, and 7 AM / evening push notifications. See [server/SETUP.md](server/SETUP.md). |

### Honest limits

- **Gmail** sign-ins for personal apps expire every 7 days (a Google rule for unverified apps), so you'll reconnect weekly.
- **Mohawk Outlook** may need IT approval for third-party apps.
- **Plaid** real-bank access needs Plaid's production approval. Until then, use TD CSV.
- **Canvas live sync** needs a personal access token. If Mohawk has disabled those, use the calendar-feed import.
- **Traffic-aware departure times** need a paid maps API. Compass uses your travel minutes plus an Apple Maps link.
- **Without the server**, iPhone only alerts while the app is open or recently used. Use the Shortcuts automation (Settings explains it) or the server for exact times.

## Files

- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`: app shell and offline cache
- `js/store.js`: encrypted on-device storage
- `js/planner.js`: events, conflicts, priorities, free time, briefings, alerts
- `js/school.js`: grades, required scores, study plans
- `js/finance.js`: bank CSV, categories, budgets, recurring bills, forecast
- `js/bible.js`, `js/plans.js`: Bible progress and reading plans
- `js/ics.js`: calendar/CSV import and export
- `js/ai.js`: Claude integration (`claude-opus-5-5`; every action needs approval)
- `js/connect.js`: pairing and sync with your Compass server
- `js/views/*`: screens
- `server/`: the optional Cloudflare Worker, `keys.html` (local key generator) and `SETUP.md`
- `tools/serve.ps1`: local test server (`http://localhost:8080`); `tools/make-icons.ps1` regenerates icons

When you change app files, bump `CACHE` in `sw.js` so installed copies update.
