import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import type { Db } from './db/index.js';
import { HttpError } from './lib/http.js';
import courseRoutes from './routes/courses.js';
import taskRoutes from './routes/tasks.js';
import scheduleRoutes from './routes/schedule.js';
import viewRoutes from './routes/views.js';
import sourceRoutes from './routes/sources.js';
import googleRoutes from './routes/google.js';
import updateRoutes from './routes/update.js';
import { createScheduler, type Scheduler } from './sync/scheduler.js';
import { WEB_DIST } from './config.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    syncScheduler?: Scheduler;
  }
}

export async function buildApp(db: Db, opts: { logger?: boolean; serveWeb?: boolean; scheduler?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  app.decorate('db', db);
  const scheduler = createScheduler(db, app.log);
  app.syncScheduler = scheduler;
  if (opts.scheduler) { scheduler.reschedule(); app.addHook('onClose', async () => scheduler.stop()); }
  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    app.log.error(err);
    return reply.code(500).send({ error: (err as Error).message ?? 'Internal error' });
  });

  await app.register(courseRoutes, { db });
  await app.register(taskRoutes, { db });
  await app.register(scheduleRoutes, { db });
  await app.register(viewRoutes, { db });
  await app.register(sourceRoutes, { db, scheduler });
  await app.register(googleRoutes, { db });
  await app.register(updateRoutes);

  if (opts.serveWeb && fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
