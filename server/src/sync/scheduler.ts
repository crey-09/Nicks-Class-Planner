import { eq, desc } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { sources, syncRuns } from '../db/schema.js';
import { getSyncIntervalMinutes } from '../db/settings.js';
import { getConnector } from '../connectors/registry.js';
import { NeedsLoginError, type SourceRow } from '../connectors/types.js';
import { applySyncResult } from './reconcile.js';
import { withPage, isLoginWindowOpen } from '../browser/session.js';

export interface Scheduler {
  reschedule(): void;
  runSource(id: number): Promise<{ ok: boolean; error?: string; items?: number }>;
  runAll(): Promise<void>;
  stop(): void;
}

export function createScheduler(db: Db, log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void }): Scheduler {
  let timer: NodeJS.Timeout | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const inFlight = new Set<number>();

  async function runSourceNow(source: SourceRow) {
    const connector = getConnector(source.connector);
    if (connector.needsBrowser && isLoginWindowOpen()) return { ok: false, error: 'Login window open; skipped.' };
    const run = db.insert(syncRuns).values({ sourceId: source.id }).returning().get();
    const messages: string[] = [];
    try {
      const result = await connector.sync({
        db, source, config: source.config ?? {},
        withPage: connector.needsBrowser ? withPage : undefined,
        log: (m) => { messages.push(m); log.info(`[${source.name}] ${m}`); },
      });
      const items = applySyncResult(db, source, result);
      db.update(sources).set({ status: 'ok', lastSyncAt: new Date().toISOString(), lastError: null }).where(eq(sources.id, source.id)).run();
      db.update(syncRuns).set({ finishedAt: new Date().toISOString(), ok: true, itemsSeen: items, error: messages.join('\n') || null }).where(eq(syncRuns.id, run.id)).run();
      return { ok: true, items };
    } catch (err) {
      const needsLogin = err instanceof NeedsLoginError;
      const message = (err as Error).message ?? String(err);
      log.warn(`[${source.name}] sync failed: ${message}`);
      db.update(sources).set({ status: needsLogin ? 'needs_login' : 'error', lastError: message }).where(eq(sources.id, source.id)).run();
      db.update(syncRuns).set({ finishedAt: new Date().toISOString(), ok: false, error: [...messages, message].join('\n') }).where(eq(syncRuns.id, run.id)).run();
      return { ok: false, error: message };
    }
  }

  /** Serialize all syncs: one Playwright context at a time, and no double-runs of the same source. */
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  const scheduler: Scheduler = {
    async runSource(id) {
      const source = db.select().from(sources).where(eq(sources.id, id)).get();
      if (!source) return { ok: false, error: 'Source not found' };
      if (inFlight.has(id)) return { ok: false, error: 'Already syncing' };
      inFlight.add(id);
      try { return await enqueue(() => runSourceNow(source)); } finally { inFlight.delete(id); }
    },
    async runAll() {
      const list = db.select().from(sources).where(eq(sources.enabled, true)).all();
      for (const s of list) {
        if (s.status === 'needs_login') continue; // pointless until the user reconnects
        await scheduler.runSource(s.id);
      }
      pruneRuns();
    },
    reschedule() {
      if (timer) clearInterval(timer);
      const minutes = getSyncIntervalMinutes(db);
      timer = setInterval(() => { scheduler.runAll().catch((e) => log.error(String(e))); }, minutes * 60_000);
      log.info(`Sync scheduled every ${minutes} min`);
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };

  function pruneRuns() {
    // Keep the last 50 runs per source.
    for (const s of db.select({ id: sources.id }).from(sources).all()) {
      const old = db.select({ id: syncRuns.id }).from(syncRuns).where(eq(syncRuns.sourceId, s.id)).orderBy(desc(syncRuns.id)).offset(50).all();
      for (const r of old) db.delete(syncRuns).where(eq(syncRuns.id, r.id)).run();
    }
  }

  return scheduler;
}
