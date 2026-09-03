import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { settings } from './schema.js';
import { DEFAULT_TIMEZONE } from '../config.js';

export function getSetting(db: Db, key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string | null) {
  if (value === null) {
    db.delete(settings).where(eq(settings.key, key)).run();
    return;
  }
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export function getTimezone(db: Db): string {
  return getSetting(db, 'timezone') ?? DEFAULT_TIMEZONE;
}

export function getSyncIntervalMinutes(db: Db): number {
  const v = Number(getSetting(db, 'syncIntervalMinutes'));
  return Number.isFinite(v) && v > 0 ? v : 30;
}
