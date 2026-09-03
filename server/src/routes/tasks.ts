import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lt, isNull, or, asc, sql, desc, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { tasks, assignments, courses } from '../db/schema.js';
import { idParam, parseBody, notFound, nullableIso, nowIso } from '../lib/http.js';
import type { TodoItem } from '@nick/shared';

const taskBody = z.object({
  title: z.string().min(1),
  dueAt: nullableIso.optional(),
  courseId: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  done: z.boolean().optional(),
});

const assignmentPatch = z.object({
  status: z.enum(['todo', 'done', 'submitted']).optional(),
  hidden: z.boolean().optional(),
  courseId: z.number().int().nullable().optional(),
  kind: z.enum(['homework', 'quiz', 'exam', 'lab', 'project', 'reading', 'other']).optional(),
  dueAt: nullableIso.optional(),
});

/** Unified to-do rows: every task, hydrated with its assignment and course. */
export function listTodo(db: Db, where?: SQL): TodoItem[] {
  const rows = db
    .select({ task: tasks, assignment: assignments, course: courses })
    .from(tasks)
    .leftJoin(assignments, eq(tasks.assignmentId, assignments.id))
    .leftJoin(courses, eq(tasks.courseId, courses.id))
    .where(where)
    .orderBy(sql`${tasks.dueAt} is null`, asc(tasks.dueAt), desc(tasks.createdAt))
    .all();
  return rows.map((r) => ({ ...r.task, assignment: r.assignment ?? null, course: r.course ?? null }));
}

export default async function taskRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get('/api/todo', async (req) => {
    const q = z.object({ includeDone: z.coerce.boolean().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const conds: SQL[] = [or(isNull(assignments.id), eq(assignments.hidden, false))!];
    if (!q.includeDone) conds.push(eq(tasks.done, false));
    if (q.from) conds.push(gte(tasks.dueAt, q.from));
    if (q.to) conds.push(lt(tasks.dueAt, q.to));
    return listTodo(db, and(...conds));
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = parseBody(taskBody, req.body);
    const row = db.insert(tasks).values(body).returning().get();
    return reply.code(201).send(row);
  });

  app.patch('/api/tasks/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(taskBody.partial(), req.body);
    const row = db.update(tasks).set({ ...body, updatedAt: nowIso() }).where(eq(tasks.id, id)).returning().get();
    if (!row) return notFound(reply);
    // Keep the mirrored assignment status in step with the task checkbox.
    if (row.assignmentId != null && body.done !== undefined) {
      db.update(assignments)
        .set({ status: body.done ? 'done' : 'todo', updatedAt: nowIso() })
        .where(and(eq(assignments.id, row.assignmentId), body.done ? sql`1` : eq(assignments.status, 'done')))
        .run();
    }
    return row;
  });

  app.delete('/api/tasks/:id', async (req, reply) => {
    const id = idParam(req.params);
    const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) return notFound(reply);
    if (row.assignmentId != null) {
      // Synced items can't be deleted (they'd come back). Hide the assignment instead.
      db.update(assignments).set({ hidden: true }).where(eq(assignments.id, row.assignmentId)).run();
    } else {
      db.delete(tasks).where(eq(tasks.id, id)).run();
    }
    return reply.code(204).send();
  });

  app.get('/api/assignments', async () => db.select().from(assignments).orderBy(asc(assignments.dueAt)).all());

  app.patch('/api/assignments/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(assignmentPatch, req.body);
    const row = db.update(assignments).set({ ...body, updatedAt: nowIso() }).where(eq(assignments.id, id)).returning().get();
    if (!row) return notFound(reply);
    const taskPatch: Partial<typeof tasks.$inferInsert> = {};
    if (body.status !== undefined) taskPatch.done = body.status !== 'todo';
    if (body.courseId !== undefined) taskPatch.courseId = body.courseId;
    if (body.dueAt !== undefined) taskPatch.dueAt = body.dueAt;
    if (Object.keys(taskPatch).length) db.update(tasks).set({ ...taskPatch, updatedAt: nowIso() }).where(eq(tasks.assignmentId, id)).run();
    return row;
  });
}
