import { openDb } from './db/index.js';
import { seedDefaults } from './db/seed.js';
import { buildApp } from './app.js';
import { PORT, HOST, DATA_DIR } from './config.js';

const db = openDb();
seedDefaults(db);
const app = await buildApp(db, { logger: true, serveWeb: true, scheduler: true });
setTimeout(() => app.syncScheduler?.runAll().catch((e) => app.log.error(e)), 5000);

await app.listen({ port: PORT, host: HOST });
app.log.info(`Nick Manager running at http://${HOST}:${PORT} (data in ${DATA_DIR})`);
