import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { sources } from './schema.js';
import { getSetting, setSetting } from './settings.js';
import { ENGR131_SCHEDULE } from '../connectors/engr131.js';

/**
 * First-launch defaults. The ENGR 131 site is public, so it is added automatically; the scheduler's
 * startup run then imports the whole semester before the user opens the app. Section days are a
 * guess until confirmed on the Sources page (flagged via config.sectionConfirmed).
 */
export function seedDefaults(db: Db): void {
  if (getSetting(db, 'seeded:engr131')) return;
  const existing = db.select({ id: sources.id }).from(sources).where(eq(sources.connector, 'engr131')).get();
  if (!existing) {
    db.insert(sources).values({
      connector: 'engr131',
      name: 'ENGR 131 site',
      config: { url: ENGR131_SCHEDULE, meetingDays: 'Mon,Wed', classTime: '08:30', sectionConfirmed: false },
      status: 'never',
    }).run();
  }
  setSetting(db, 'seeded:engr131', '1');
}
