import crypto from 'node:crypto';
import { google, type calendar_v3 } from 'googleapis';
import { and, eq, gte, lt, isNull, or, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { assignments, courses, events, googleEvents, planBlocks, shifts, sources, tasks } from '../db/schema.js';
import { getSetting, setSetting, getTimezone } from '../db/settings.js';
import { authorizedClient } from './auth.js';
import type { RawEvent } from '../connectors/types.js';

const CAL_NAME = 'Nick Manager';

function api(db: Db): calendar_v3.Calendar {
  const auth = authorizedClient(db);
  if (!auth) throw new Error('Google Calendar is not connected.');
  return google.calendar({ version: 'v3', auth });
}

/** Our own calendar in the user's Google account, created on first use. */
export async function ensureCalendar(db: Db): Promise<string> {
  const existing = getSetting(db, 'googleCalendarId');
  const cal = api(db);
  if (existing) {
    try { await cal.calendars.get({ calendarId: existing }); return existing; } catch { /* deleted by user; recreate */ }
  }
  const list = await cal.calendarList.list();
  const found = list.data.items?.find((c) => c.summary === CAL_NAME);
  const id = found?.id ?? (await cal.calendars.insert({ requestBody: { summary: CAL_NAME, timeZone: getTimezone(db) } })).data.id!;
  setSetting(db, 'googleCalendarId', id);
  return id;
}

type Desired = { key: string; body: calendar_v3.Schema$Event };

function dateOnly(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }); // yyyy-mm-dd
}

/** Everything we mirror into the Nick Manager calendar, in a window around now. */
function desiredEvents(db: Db): Desired[] {
  const tz = getTimezone(db);
  const now = Date.now();
  const from = new Date(now - 14 * 86400_000).toISOString();
  const to = new Date(now + 120 * 86400_000).toISOString();
  const out: Desired[] = [];

  const due = db.select({ t: tasks, a: assignments, c: courses }).from(tasks)
    .leftJoin(assignments, eq(tasks.assignmentId, assignments.id))
    .leftJoin(courses, eq(tasks.courseId, courses.id))
    .where(and(eq(tasks.done, false), gte(tasks.dueAt, from), lt(tasks.dueAt, to), or(isNull(assignments.id), eq(assignments.hidden, false)))).all();
  for (const { t, a, c } of due) {
    const label = c?.code ? `[${c.code}] ` : '';
    out.push({
      key: `task:${t.id}`,
      body: {
        summary: `${label}Due: ${t.title}`,
        description: a?.url ?? undefined,
        start: { dateTime: t.dueAt!, timeZone: tz },
        end: { dateTime: new Date(new Date(t.dueAt!).getTime() + 30 * 60_000).toISOString(), timeZone: tz },
        colorId: '11',
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }, { method: 'popup', minutes: 120 }] },
      },
    });
  }
  for (const s of db.select().from(shifts).where(and(gte(shifts.endAt, from), lt(shifts.startAt, to))).all()) {
    out.push({ key: `shift:${s.id}`, body: { summary: `Work${s.location ? ` · ${s.location}` : ''}`, location: s.location ?? undefined, description: s.notes ?? undefined, start: { dateTime: s.startAt }, end: { dateTime: s.endAt }, colorId: '5' } });
  }
  const blocks = db.select({ b: planBlocks, t: tasks }).from(planBlocks).innerJoin(tasks, eq(planBlocks.taskId, tasks.id))
    .where(and(gte(planBlocks.endAt, from), lt(planBlocks.startAt, to))).all();
  for (const { b, t } of blocks) {
    out.push({ key: `block:${b.id}`, body: { summary: `📝 ${t.title}`, start: { dateTime: b.startAt }, end: { dateTime: b.endAt }, colorId: '9' } });
  }
  void dateOnly;
  return out;
}

function hashOf(body: calendar_v3.Schema$Event): string {
  return crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex');
}

/** Mirror tasks, shifts and plan blocks into the Nick Manager calendar. Returns the number of writes. */
export async function pushToGoogle(db: Db): Promise<number> {
  const cal = api(db);
  const calendarId = await ensureCalendar(db);
  const desired = desiredEvents(db);
  const known = new Map(db.select().from(googleEvents).all().map((r) => [r.key, r]));
  let writes = 0;
  for (const d of desired) {
    const h = hashOf(d.body);
    const k = known.get(d.key);
    if (k && k.hash === h) continue;
    try {
      if (k) {
        await cal.events.patch({ calendarId, eventId: k.googleEventId, requestBody: d.body });
        db.update(googleEvents).set({ hash: h, updatedAt: new Date().toISOString() }).where(eq(googleEvents.key, d.key)).run();
      } else {
        const created = await cal.events.insert({ calendarId, requestBody: d.body });
        db.insert(googleEvents).values({ key: d.key, googleEventId: created.data.id!, hash: h }).run();
      }
      writes++;
    } catch (err) {
      if ((err as any).code === 404 && k) {
        // The user deleted it in Google; recreate next time.
        db.delete(googleEvents).where(eq(googleEvents.key, d.key)).run();
      } else throw err;
    }
  }
  const keep = new Set(desired.map((d) => d.key));
  for (const [key, row] of known) {
    if (keep.has(key)) continue;
    await cal.events.delete({ calendarId, eventId: row.googleEventId }).catch(() => {});
    db.delete(googleEvents).where(eq(googleEvents.key, key)).run();
    writes++;
  }
  return writes;
}

/** Read the user's primary calendar so meetings and classes show up in the planner. */
export async function pullFromGoogle(db: Db): Promise<RawEvent[]> {
  const cal = api(db);
  const ours = getSetting(db, 'googleCalendarId');
  const now = Date.now();
  const res = await cal.events.list({
    calendarId: 'primary', singleEvents: true, orderBy: 'startTime', maxResults: 500,
    timeMin: new Date(now - 7 * 86400_000).toISOString(), timeMax: new Date(now + 60 * 86400_000).toISOString(),
  });
  const out: RawEvent[] = [];
  for (const e of res.data.items ?? []) {
    if (!e.id || e.status === 'cancelled') continue;
    if (e.organizer?.id && e.organizer.id === ours) continue;
    const allDay = !!e.start?.date;
    const start = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : null);
    const end = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00` : null);
    if (!start || !end) continue;
    const isMeeting = (e.attendees?.length ?? 0) > 1 || !!e.hangoutLink;
    out.push({
      externalId: e.id, title: e.summary ?? '(no title)',
      startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), allDay,
      location: e.location ?? null, notes: e.hangoutLink ?? e.htmlLink ?? null, kind: isMeeting ? 'meeting' : 'other',
    });
  }
  return out;
}

export async function createMeeting(db: Db, input: { title: string; startAt: string; endAt: string; attendees: string[]; location?: string; notes?: string; meet?: boolean }) {
  const cal = api(db);
  const body: calendar_v3.Schema$Event = {
    summary: input.title,
    location: input.location,
    description: input.notes,
    start: { dateTime: input.startAt, timeZone: getTimezone(db) },
    end: { dateTime: input.endAt, timeZone: getTimezone(db) },
    attendees: input.attendees.map((email) => ({ email })),
  };
  if (input.meet) body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  const created = await cal.events.insert({ calendarId: 'primary', requestBody: body, sendUpdates: 'all', conferenceDataVersion: input.meet ? 1 : 0 });
  return created.data;
}

export function googleSourceId(db: Db): number | null {
  return db.select({ id: sources.id }).from(sources).where(eq(sources.connector, 'google')).get()?.id ?? null;
}

export function ensureGoogleSource(db: Db): number {
  const id = googleSourceId(db);
  if (id != null) return id;
  return db.insert(sources).values({ connector: 'google', name: 'Google Calendar', config: {}, status: 'ok' }).returning().get().id;
}

export { events, notInArray, sql };
