import ical from 'node-ical';
import type { Connector, RawEvent, RawShift } from './types.js';

/**
 * Generic iCal subscription. Sling, Homebase, 7shifts, When I Work, Google Calendar and Brightspace all
 * hand out a private .ics URL; this pulls it on a schedule and maps events to shifts or calendar events.
 */
export const icsConnector: Connector = {
  id: 'ics',
  label: 'Calendar feed (.ics)',
  description: 'Any iCal/webcal URL. Use it for your work schedule app or any class calendar.',
  needsBrowser: false,
  configFields: [
    { key: 'url', label: 'Feed URL', type: 'url', placeholder: 'https://… or webcal://…', required: true, help: 'In Sling: Settings → Calendar sync. Homebase: Schedule → Sync to calendar. 7shifts: My schedule → Sync calendar.' },
    { key: 'mode', label: 'Treat entries as', type: 'select', default: 'shifts', options: [{ value: 'shifts', label: 'Work shifts' }, { value: 'events', label: 'Calendar events' }] },
    { key: 'label', label: 'Location / job name', type: 'text', placeholder: 'Ford Dining Court', help: 'Shown on shifts when the feed has no location.' },
  ],
  async sync(ctx) {
    let url = String(ctx.config.url || '').trim();
    if (!url) throw new Error('Feed URL is required');
    url = url.replace(/^webcal:\/\//i, 'https://');
    const res = await fetch(url, { headers: { 'user-agent': 'nick-manager/0.1' } });
    if (!res.ok) throw new Error(`Fetching feed failed: HTTP ${res.status}`);
    const text = await res.text();
    const data = ical.sync.parseICS(text);

    const now = Date.now();
    const windowStart = new Date(now - 30 * 86400_000);
    const windowEnd = new Date(now + 180 * 86400_000);
    const mode = ctx.config.mode === 'events' ? 'events' : 'shifts';
    const fallbackLocation = ctx.config.label ? String(ctx.config.label) : null;

    const shifts: RawShift[] = [];
    const events: RawEvent[] = [];
    for (const item of Object.values(data)) {
      if (!item || (item as any).type !== 'VEVENT') continue;
      const ev = item as ical.VEvent;
      if (!ev.start) continue;
      const durationMs = ev.end ? ev.end.getTime() - ev.start.getTime() : 3600_000;
      const allDay = (ev as any).datetype === 'date';
      const occurrences: Date[] = ev.rrule ? ev.rrule.between(windowStart, windowEnd, true) : [ev.start];
      const exdates = new Set(Object.values(ev.exdate ?? {}).map((d) => (d as Date).getTime()));
      for (const start of occurrences) {
        if (exdates.has(start.getTime())) continue;
        if (start < windowStart || start > windowEnd) continue;
        const end = new Date(start.getTime() + durationMs);
        const externalId = `${ev.uid}@${start.toISOString()}`;
        const summary = (ev.summary ?? '').toString().trim();
        if (mode === 'shifts') {
          shifts.push({ externalId, startAt: start.toISOString(), endAt: end.toISOString(), location: (ev.location ? String(ev.location) : null) ?? fallbackLocation, notes: summary || null });
        } else {
          events.push({ externalId, title: summary || 'Event', startAt: start.toISOString(), endAt: end.toISOString(), allDay, location: ev.location ? String(ev.location) : null, notes: ev.description ? String(ev.description).slice(0, 2000) : null, kind: 'other' });
        }
      }
    }
    ctx.log(`ICS: ${shifts.length} shifts, ${events.length} events in window`);
    return mode === 'shifts' ? { shifts } : { events };
  },
};
