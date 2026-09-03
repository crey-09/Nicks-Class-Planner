import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import open from 'open';
import type { Db } from '../db/index.js';
import { events } from '../db/schema.js';
import { getSetting } from '../db/settings.js';
import { authUrl, exchangeCode, clearTokens, hasClient, authorizedClient } from '../google/auth.js';
import { createMeeting, ensureGoogleSource, googleSourceId, pullFromGoogle, pushToGoogle } from '../google/calendar.js';
import { applySyncResult } from '../sync/reconcile.js';
import { parseBody, isoDate, HttpError } from '../lib/http.js';
import { eq } from 'drizzle-orm';
import { sources } from '../db/schema.js';

const meetingBody = z.object({
  title: z.string().min(1),
  startAt: isoDate,
  endAt: isoDate,
  attendees: z.array(z.string().email()).default([]),
  location: z.string().optional(),
  notes: z.string().optional(),
  meet: z.boolean().optional(),
});

export default async function googleRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get('/api/google/status', async () => ({
    configured: hasClient(db),
    connected: !!authorizedClient(db),
    calendarId: getSetting(db, 'googleCalendarId'),
    email: getSetting(db, 'googleEmail'),
  }));

  app.post('/api/google/connect', async () => {
    const url = authUrl(db);
    open(url).catch(() => {});
    return { ok: true, url };
  });

  app.get('/api/google/callback', async (req, reply) => {
    const q = z.object({ code: z.string().optional(), error: z.string().optional() }).parse(req.query);
    if (q.error || !q.code) return reply.type('text/html').send(`<p>Google sign-in failed: ${q.error ?? 'no code'}. You can close this tab.</p>`);
    const email = await exchangeCode(db, q.code);
    ensureGoogleSource(db);
    app.syncScheduler?.runSource(googleSourceId(db)!).catch(() => {});
    return reply.type('text/html').send(`<body style="font-family:sans-serif;padding:40px"><h2>Connected${email ? ` as ${email}` : ''} ✓</h2><p>You can close this tab and go back to Nick Manager.</p></body>`);
  });

  app.post('/api/google/disconnect', async (_req, reply) => {
    clearTokens(db);
    const id = googleSourceId(db);
    if (id != null) db.delete(sources).where(eq(sources.id, id)).run();
    return reply.code(204).send();
  });

  app.post('/api/google/sync', async () => {
    if (!authorizedClient(db)) throw new HttpError(400, 'Google Calendar is not connected.');
    const id = ensureGoogleSource(db);
    const source = db.select().from(sources).where(eq(sources.id, id)).get()!;
    const pulled = await pullFromGoogle(db);
    applySyncResult(db, source, { events: pulled });
    const pushed = await pushToGoogle(db);
    db.update(sources).set({ status: 'ok', lastSyncAt: new Date().toISOString(), lastError: null }).where(eq(sources.id, id)).run();
    return { pushed, pulled: pulled.length };
  });

  app.post('/api/google/meetings', async (req, reply) => {
    const body = parseBody(meetingBody, req.body);
    if (!authorizedClient(db)) throw new HttpError(400, 'Google Calendar is not connected.');
    const created = await createMeeting(db, body);
    const sourceId = ensureGoogleSource(db);
    const row = db.insert(events).values({
      sourceId, externalId: created.id ?? null, title: body.title, startAt: body.startAt, endAt: body.endAt,
      location: body.location ?? null, attendees: body.attendees, googleEventId: created.id ?? null, kind: 'meeting',
      notes: created.hangoutLink ?? created.htmlLink ?? body.notes ?? null,
    }).returning().get();
    return reply.code(201).send(row);
  });
}
