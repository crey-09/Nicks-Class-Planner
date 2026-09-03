# Nick Manager

A personal planner that runs on your own laptop. It pulls assignments from every course site into one
to-do list and calendar, keeps your work shifts next to your schoolwork, lets you block out time to get
things done, and can put meetings on your Google Calendar.

Nothing leaves your computer. You never type a password into this app: for sites that need a login you
sign in yourself in a separate browser window, and only that browser's session is kept on your disk.

## Setup (Windows)

1. Install Node.js LTS from https://nodejs.org (accept the defaults).
2. Download or clone this folder somewhere permanent, e.g. `C:\Users\you\nick-manager`.
3. Double-click `scripts\install-windows.cmd`. It installs everything, builds the app, registers it to
   start when you log in, and opens it in your browser.
4. Bookmark http://127.0.0.1:3000

To stop it: `scripts\stop-windows.cmd`. To start it by hand: `scripts\start.cmd`.

## First-time use

Go to **Sources** and add, in this order:

| Source | What it gives you | Login? |
| --- | --- | --- |
| ENGR 131 course site | Every assignment on the course schedule, with due dates. Added automatically. | No |
| Brightspace | Assignments, quizzes and dated content from all courses | Yes, once |
| Gradescope | Assignments, due dates, whether you submitted, scores | Yes, once |
| Calendar feed (.ics) | Your work shifts from Sling / Homebase / 7shifts | No |

**ENGR 131 site:** added for you on first launch, and the whole semester's schedule is imported
before you even open the app. Click **Edit** on it once to set the two days your section meets (for
example `Mon,Wed`) and the class start time. The schedule says things like "Due: Class 2A"; that
becomes the first meeting of week 2 at your class time.

**Brightspace and Gradescope:** click **Connect**. A browser window opens at the login page. Sign in
like normal (Purdue SSO and Duo), wait until you see the site's home page, then come back and click
**Done, I'm logged in**. Syncing starts right away. When the site eventually logs you out, the source
shows "Needs login" and a banner appears on Today. Click Reconnect and do it again. Duo's "remember me
for 30 days" makes this rare.

**Work schedule:** find the calendar-sync link in your scheduling app and paste it in.
- Sling: Settings → Calendar sync → copy the iCal URL
- Homebase: Schedule → Sync to calendar → copy the link
- 7shifts: My schedule → Sync calendar → copy the link
- When I Work: My schedule → Sync to calendar

Everything syncs every 30 minutes (change it in Settings), or hit **Sync all**.

## Google Calendar (optional)

This pushes your due dates, shifts and planned work blocks to a "Nick Manager" calendar in your Google
account, pulls your Google events into the planner, and lets you create meetings that email invites to
people. It needs a one-time setup because Google wants each app to have its own credentials:

1. Go to https://console.cloud.google.com and create a project (any name).
2. APIs & Services → Library → enable **Google Calendar API**.
3. APIs & Services → OAuth consent screen → External → fill in the app name and your email → add
   yourself under Test users.
4. APIs & Services → Credentials → Create credentials → OAuth client ID → Application type
   **Desktop app**. Copy the client ID and client secret.
5. In Nick Manager → Settings, paste both, Save, then **Connect Google Calendar** and approve.

## Pages

- **Today**: overdue, due this week, today's shifts, events and planned blocks. Quick add.
- **To-do**: everything in one list, grouped by due date or course. Click a row to edit, tick to finish.
  Synced items link back to the site they came from.
- **Calendar**: month / week / day. Drag to move, click empty space to add a shift or event.
- **Planner**: drag a to-do onto the week to block time for it.
- **Courses**: one card per class with links to every site it uses. "Open all sites" opens them at once.
- **Sources**: connections, sync log, and course mapping for Brightspace / Gradescope.

## For whoever maintains this

Node + TypeScript monorepo (npm workspaces):

```
shared/   API types shared by server and web
server/   Fastify API, SQLite (Drizzle), sync engine, Playwright session, Google integration
web/      Vite + React front end
scripts/  Windows install / start / stop
data/     created at runtime: nick.db, browser-profile/, google-tokens.json, server.log (gitignored)
```

```bash
npm install
npx playwright install chromium
npm run dev        # server on :3000 with reload, web on :5173 proxying /api
npm test           # vitest: connector parsers and reconcile logic
npm run build      # web/dist + server/dist; `npm start` serves both on :3000
npm run db:generate  # after editing server/src/db/schema.ts
```

Adding a connector: one file in `server/src/connectors/` implementing `Connector` from `types.ts`,
registered in `registry.ts`. Return raw courses/assignments/shifts/events and `sync/reconcile.ts` does
the upserts, task mirroring, course auto-creation and cross-site dedupe. Sites that need a login get
`needsBrowser: true`, a `loginUrl`, and an `isLoggedIn` check; the sync runs inside `ctx.withPage`.

Known gaps:
- Brightspace and Gradescope connectors were written against their known API and page structure but
  have not been run against a real Purdue account yet. First live run should be done together; failures
  land in the source's sync log, and Gradescope saves the page it saw to `data/debug/` when it finds nothing.
- Courses are discovered from Brightspace and Gradescope on first sync. If a class uses a site with no
  connector, add it as "Link only" on the Courses page so it still shows up on that course's hub.
