import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lt, asc, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { shifts, events, planBlocks, tasks } from '../db/schema.js';
import { idParam, parseBody, notFound, isoDate, rangeQuery } from '../lib/http.js';

const shiftBody = z.object({
  startAt: isoDate,
  endAt: isoDate,
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const eventBody = z.object({
  title: z.string().min(1),
  startAt: isoDate,
  endAt: isoDate,
  allDay: z.boolean().optional(),
  location: z.string().nullable().optional(),
  attendees: z.array(z.string().email()).optional(),
  kind: z.enum(['class', 'meeting', 'other']).optional(),
  notes: z.string().nullable().optional(),
});

const blockBody = z.object({
  taskId: z.number().int(),
  startAt: isoDate,
  endAt: isoDate,
});

function overlap(startCol: any, endCol: any, q: { from?: string; to?: string }): SQL | undefined {
  const conds: SQL[] = [];
  if (q.to) conds.push(lt(startCol, q.to));
  if (q.from) conds.push(gte(endCol, q.from));
  return conds.length ? and(...conds) : undefined;
}

export default async function scheduleRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // Shifts
  app.get('/api/shifts', async (req) => {
    const q = rangeQuery.parse(req.query);
    return db.select().from(shifts).where(overlap(shifts.startAt, shifts.endAt, q)).orderBy(asc(shifts.startAt)).all();
  });
  app.post('/api/shifts', async (req, reply) => {
    const body = parseBody(shiftBody, req.body);
    return reply.code(201).send(db.insert(shifts).values(body).returning().get());
  });
  app.patch('/api/shifts/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(shiftBody.partial(), req.body);
    return db.update(shifts).set(body).where(eq(shifts.id, id)).returning().get() ?? notFound(reply);
  });
  app.delete('/api/shifts/:id', async (req, reply) => {
    db.delete(shifts).where(eq(shifts.id, idParam(req.params))).run();
    return reply.code(204).send();
  });

  // Events
  app.get('/api/events', async (req) => {
    const q = rangeQuery.parse(req.query);
    return db.select().from(events).where(overlap(events.startAt, events.endAt, q)).orderBy(asc(events.startAt)).all();
  });
  app.post('/api/events', async (req, reply) => {
    const body = parseBody(eventBody, req.body);
    return reply.code(201).send(db.insert(events).values(body).returning().get());
  });
  app.patch('/api/events/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(eventBody.partial(), req.body);
    return db.update(events).set(body).where(eq(events.id, id)).returning().get() ?? notFound(reply);
  });
  app.delete('/api/events/:id', async (req, reply) => {
    db.delete(events).where(eq(events.id, idParam(req.params))).run();
    return reply.code(204).send();
  });

  // Plan blocks
  app.get('/api/plan-blocks', async (req) => {
    const q = rangeQuery.parse(req.query);
    const rows = db.select({ block: planBlocks, task: tasks }).from(planBlocks)
      .innerJoin(tasks, eq(planBlocks.taskId, tasks.id))
      .where(overlap(planBlocks.startAt, planBlocks.endAt, q)).orderBy(asc(planBlocks.startAt)).all();
    return rows.map((r) => ({ ...r.block, task: r.task }));
  });
  app.post('/api/plan-blocks', async (req, reply) => {
    const body = parseBody(blockBody, req.body);
    const block = db.insert(planBlocks).values(body).returning().get();
    const task = db.select().from(tasks).where(eq(tasks.id, block.taskId)).get();
    return reply.code(201).send({ ...block, task });
  });
  app.patch('/api/plan-blocks/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(blockBody.partial(), req.body);
    return db.update(planBlocks).set(body).where(eq(planBlocks.id, id)).returning().get() ?? notFound(reply);
  });
  app.delete('/api/plan-blocks/:id', async (req, reply) => {
    db.delete(planBlocks).where(eq(planBlocks.id, idParam(req.params))).run();
    return reply.code(204).send();
  });
}
