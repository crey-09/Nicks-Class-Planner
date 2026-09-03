import type { FastifyInstance } from 'fastify';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { sources, syncRuns, sourceCourses, courses } from '../db/schema.js';
import { idParam, parseBody, notFound, HttpError } from '../lib/http.js';
import { getConnector, listConnectors } from '../connectors/registry.js';
import { openLoginWindow, closeLoginWindow, withPage } from '../browser/session.js';
import type { Scheduler } from '../sync/scheduler.js';

const sourceBody = z.object({
  connector: z.enum(['brightspace', 'gradescope', 'ics', 'engr131', 'link']),  // google is created via OAuth, not here
  name: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  courseId: z.number().int().nullable().optional(),
  enabled: z.boolean().optional(),
});

export default async function sourceRoutes(app: FastifyInstance, { db, scheduler }: { db: Db; scheduler: Scheduler }) {
  app.get('/api/connectors', async () => listConnectors());

  app.get('/api/sources', async () => db.select().from(sources).orderBy(sources.id).all());

  app.post('/api/sources', async (req, reply) => {
    const body = parseBody(sourceBody, req.body);
    const connector = getConnector(body.connector);
    for (const f of connector.configFields) {
      if (f.required && !body.config[f.key] && !f.default) throw new HttpError(400, `${f.label} is required`);
      if (!body.config[f.key] && f.default) body.config[f.key] = f.default;
    }
    const row = db.insert(sources).values({ ...body, status: 'never' }).returning().get();
    if (!connector.needsBrowser) scheduler.runSource(row.id).catch(() => {});
    return reply.code(201).send(row);
  });

  app.patch('/api/sources/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(sourceBody.partial().omit({ connector: true }), req.body);
    const current = db.select().from(sources).where(eq(sources.id, id)).get();
    if (!current) return notFound(reply);
    if (body.config && current.connector === 'engr131') body.config = { ...body.config, sectionConfirmed: true };
    const row = db.update(sources).set(body).where(eq(sources.id, id)).returning().get()!;
    if (body.config) scheduler.runSource(id).catch(() => {});
    return row;
  });

  app.delete('/api/sources/:id', async (req, reply) => {
    db.delete(sources).where(eq(sources.id, idParam(req.params))).run();
    return reply.code(204).send();
  });

  app.post('/api/sources/:id/sync', async (req) => scheduler.runSource(idParam(req.params)));
  app.post('/api/sync', async () => { scheduler.runAll().catch(() => {}); return { started: true }; });

  app.get('/api/sources/:id/runs', async (req) => {
    const id = idParam(req.params);
    return db.select().from(syncRuns).where(eq(syncRuns.sourceId, id)).orderBy(desc(syncRuns.id)).limit(20).all();
  });

  /** Open a visible browser at the site's login page. The user signs in, then calls /connect/done. */
  app.post('/api/sources/:id/connect', async (req, reply) => {
    const id = idParam(req.params);
    const source = db.select().from(sources).where(eq(sources.id, id)).get();
    if (!source) return notFound(reply);
    const connector = getConnector(source.connector);
    if (!connector.needsBrowser || !connector.loginUrl) throw new HttpError(400, 'This source does not use a browser login');
    await openLoginWindow(connector.loginUrl);
    return { ok: true };
  });

  app.post('/api/sources/:id/connect/done', async (req, reply) => {
    const id = idParam(req.params);
    const source = db.select().from(sources).where(eq(sources.id, id)).get();
    if (!source) return notFound(reply);
    const connector = getConnector(source.connector);
    await closeLoginWindow();
    let loggedIn = true;
    if (connector.isLoggedIn) {
      loggedIn = await withPage((page) => connector.isLoggedIn!(page, source.config ?? {})).catch(() => false);
    }
    db.update(sources).set({ status: loggedIn ? 'ok' : 'needs_login', lastError: loggedIn ? null : 'Login not detected. Try again and make sure you reach the site home page.' }).where(eq(sources.id, id)).run();
    if (loggedIn) scheduler.runSource(id).catch(() => {});
    return { ok: true, loggedIn };
  });

  app.post('/api/sources/connect/cancel', async () => { await closeLoginWindow(); return { ok: true }; });

  // Course mapping for multi-course connectors.
  app.get('/api/source-courses', async (req) => {
    const q = z.object({ sourceId: z.coerce.number().int().optional() }).parse(req.query);
    return db.select().from(sourceCourses).where(q.sourceId ? eq(sourceCourses.sourceId, q.sourceId) : undefined).orderBy(sourceCourses.name).all();
  });

  app.patch('/api/source-courses/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(z.object({ courseId: z.number().int().nullable().optional(), ignored: z.boolean().optional() }), req.body);
    const row = db.update(sourceCourses).set(body).where(eq(sourceCourses.id, id)).returning().get();
    if (!row) return notFound(reply);
    // Re-point this source's assignments/tasks at the new course.
    if (body.courseId !== undefined) {
      const { assignments, tasks } = await import('../db/schema.js');
      const ids = db.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.sourceId, row.sourceId), eq(assignments.courseId, row.courseId ?? -1))).all();
      db.update(assignments).set({ courseId: body.courseId }).where(eq(assignments.sourceId, row.sourceId)).run();
      for (const a of ids) db.update(tasks).set({ courseId: body.courseId }).where(eq(tasks.assignmentId, a.id)).run();
    }
    return row;
  });

  app.get('/api/source-courses/unmapped', async () =>
    db.select().from(sourceCourses).leftJoin(courses, eq(sourceCourses.courseId, courses.id)).where(eq(sourceCourses.ignored, false)).all());
}
