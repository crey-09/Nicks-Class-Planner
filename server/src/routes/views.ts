import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lt, asc, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { shifts, events, planBlocks, tasks, sources, assignments } from '../db/schema.js';
import { rangeQuery } from '../lib/http.js';
import { dayBounds } from '../lib/time.js';
import { getTimezone, getSetting, setSetting, getSyncIntervalMinutes } from '../db/settings.js';
import { listTodo } from './tasks.js';
import type { DashboardData, Settings } from '@nick/shared';

const settingsBody = z.object({
  syncIntervalMinutes: z.number().int().min(5).max(24 * 60).optional(),
  timezone: z.string().min(1).optional(),
  googleClientId: z.string().nullable().optional(),
  googleClientSecret: z.string().nullable().optional(),
});

export function readSettings(db: Db): Settings {
  return {
    syncIntervalMinutes: getSyncIntervalMinutes(db),
    timezone: getTimezone(db),
    googleClientId: getSetting(db, 'googleClientId'),
    googleClientSecret: getSetting(db, 'googleClientSecret') ? '••••••' : null,
    googleConnected: getSetting(db, 'googleConnected') === '1',
    googleCalendarId: getSetting(db, 'googleCalendarId'),
  };
}

export default async function viewRoutes(app: FastifyInstance, { db }: { db: Db }) {
  /** Everything the calendar/planner needs for a date range in one call. */
  app.get('/api/calendar', async (req) => {
    const q = rangeQuery.parse(req.query);
    const from = q.from ?? '0000';
    const to = q.to ?? '9999';
    const shiftRows = db.select().from(shifts).where(and(lt(shifts.startAt, to), gte(shifts.endAt, from))).orderBy(asc(shifts.startAt)).all();
    const eventRows = db.select().from(events).where(and(lt(events.startAt, to), gte(events.endAt, from))).orderBy(asc(events.startAt)).all();
    const blockRows = db.select({ block: planBlocks, task: tasks }).from(planBlocks)
      .innerJoin(tasks, eq(planBlocks.taskId, tasks.id))
      .where(and(lt(planBlocks.startAt, to), gte(planBlocks.endAt, from))).all()
      .map((r) => ({ ...r.block, task: r.task }));
    const dueRows = listTodo(db, and(gte(tasks.dueAt, from), lt(tasks.dueAt, to), or(isNull(assignments.id), eq(assignments.hidden, false))));
    return { shifts: shiftRows, events: eventRows, blocks: blockRows, due: dueRows };
  });

  app.get('/api/dashboard', async (): Promise<DashboardData> => {
    const tz = getTimezone(db);
    const now = new Date();
    const today = dayBounds(now, tz);
    const week = dayBounds(now, tz, 7);
    const visible = or(isNull(assignments.id), eq(assignments.hidden, false))!;
    return {
      needsLogin: db.select().from(sources).where(and(eq(sources.status, 'needs_login'), eq(sources.enabled, true))).all() as any,
      setup: db.select().from(sources).where(eq(sources.connector, 'engr131')).all()
        .filter((s) => s.enabled && !(s.config as any)?.sectionConfirmed)
        .map((s) => ({ sourceId: s.id, message: `Confirm which days your ${s.name.replace(/ site$/, '')} section meets. Until then, "Class 2A"-style due dates assume Mon/Wed at 8:30.` })),
      overdue: listTodo(db, and(eq(tasks.done, false), lt(tasks.dueAt, now.toISOString()), visible)),
      dueSoon: listTodo(db, and(eq(tasks.done, false), gte(tasks.dueAt, now.toISOString()), lt(tasks.dueAt, week.to), visible)),
      todayShifts: db.select().from(shifts).where(and(lt(shifts.startAt, today.to), gte(shifts.endAt, today.from))).orderBy(asc(shifts.startAt)).all(),
      todayEvents: db.select().from(events).where(and(lt(events.startAt, today.to), gte(events.endAt, today.from))).orderBy(asc(events.startAt)).all(),
      todayBlocks: db.select({ block: planBlocks, task: tasks }).from(planBlocks)
        .innerJoin(tasks, eq(planBlocks.taskId, tasks.id))
        .where(and(lt(planBlocks.startAt, today.to), gte(planBlocks.endAt, today.from))).orderBy(asc(planBlocks.startAt)).all()
        .map((r) => ({ ...r.block, task: r.task })),
    };
  });

  app.get('/api/settings', async () => readSettings(db));
  app.put('/api/settings', async (req) => {
    const body = settingsBody.parse(req.body);
    if (body.syncIntervalMinutes !== undefined) setSetting(db, 'syncIntervalMinutes', String(body.syncIntervalMinutes));
    if (body.timezone !== undefined) setSetting(db, 'timezone', body.timezone);
    if (body.googleClientId !== undefined) setSetting(db, 'googleClientId', body.googleClientId);
    if (body.googleClientSecret !== undefined && body.googleClientSecret !== '••••••') setSetting(db, 'googleClientSecret', body.googleClientSecret);
    app.syncScheduler?.reschedule?.();
    return readSettings(db);
  });

  app.get('/api/health', async () => ({ ok: true, now: sql`1` && new Date().toISOString() }));
}
