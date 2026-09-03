import type { FastifyInstance } from 'fastify';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { courses, courseLinks } from '../db/schema.js';
import { idParam, parseBody, notFound } from '../lib/http.js';

const courseBody = z.object({
  name: z.string().min(1),
  code: z.string().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  term: z.string().nullable().optional(),
});

const linkBody = z.object({
  courseId: z.number().int(),
  label: z.string().min(1),
  url: z.string().url(),
});

export default async function courseRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get('/api/courses', async () => db.select().from(courses).orderBy(asc(courses.name)).all());

  app.post('/api/courses', async (req, reply) => {
    const body = parseBody(courseBody, req.body);
    const row = db.insert(courses).values(body).returning().get();
    return reply.code(201).send(row);
  });

  app.patch('/api/courses/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(courseBody.partial(), req.body);
    const row = db.update(courses).set(body).where(eq(courses.id, id)).returning().get();
    return row ?? notFound(reply);
  });

  app.delete('/api/courses/:id', async (req, reply) => {
    const id = idParam(req.params);
    db.delete(courses).where(eq(courses.id, id)).run();
    return reply.code(204).send();
  });

  app.get('/api/links', async () => db.select().from(courseLinks).orderBy(asc(courseLinks.label)).all());

  app.post('/api/links', async (req, reply) => {
    const body = parseBody(linkBody, req.body);
    const row = db.insert(courseLinks).values(body).returning().get();
    return reply.code(201).send(row);
  });

  app.patch('/api/links/:id', async (req, reply) => {
    const id = idParam(req.params);
    const body = parseBody(linkBody.partial(), req.body);
    const row = db.update(courseLinks).set(body).where(eq(courseLinks.id, id)).returning().get();
    return row ?? notFound(reply);
  });

  app.delete('/api/links/:id', async (req, reply) => {
    const id = idParam(req.params);
    db.delete(courseLinks).where(eq(courseLinks.id, id)).run();
    return reply.code(204).send();
  });
}
