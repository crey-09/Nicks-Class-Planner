import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { checkForUpdate, runUpdater, localVersion } from '../update.js';

export default async function updateRoutes(app: FastifyInstance) {
  app.get('/api/update/status', async (req) => {
    const q = z.object({ force: z.coerce.boolean().optional() }).parse(req.query);
    return checkForUpdate(q.force ?? false);
  });
  app.get('/api/update/version', async () => ({ local: localVersion() }));
  app.post('/api/update/run', async () => runUpdater());
}
