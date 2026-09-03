import { and, eq, inArray, notInArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { assignments, courses, courseLinks, events, shifts, sourceCourses, tasks } from '../db/schema.js';
import type { RawAssignment, RawCourse, RawEvent, RawShift, SourceRow, SyncResult } from '../connectors/types.js';

const nowIso = () => new Date().toISOString();

/** "MA 16500", "MA165", "ma-165-001" → "MA165" so the same class from two sites lands on one course. */
export function normalizeCode(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.toUpperCase().match(/\b([A-Z]{2,4})\s*-?\s*(\d{3})(\d{2})?\b/);
  if (!m) return null;
  return `${m[1]}${m[2]}`;
}

/** Assignment code shared between the ENGR 131 site and the submission site: "EX 3.1.2", "PP 1.1", "TM 2.1.0". */
export const ENGR_CODE = /\b(EX|PP|TM|AI|PY|HW|PCM|PCA)\s*(\d+(?:\.\d+)*)\b/i;
export function engrCode(title: string): string | null {
  const m = title.match(ENGR_CODE);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
}

function findCourseByCode(db: Db, code: string | null): number | null {
  if (!code) return null;
  for (const c of db.select().from(courses).all()) {
    if (normalizeCode(c.code) === code || normalizeCode(c.name) === code) return c.id;
  }
  return null;
}

/** Upsert the connector's view of courses, auto-creating ours the first time. Returns key → courseId. */
function reconcileCourses(db: Db, source: SourceRow, raw: RawCourse[]): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const rc of raw) {
    let row = db.select().from(sourceCourses).where(and(eq(sourceCourses.sourceId, source.id), eq(sourceCourses.externalKey, rc.key))).get();
    if (!row) {
      const code = normalizeCode(rc.code) ?? normalizeCode(rc.name);
      let courseId = source.courseId ?? findCourseByCode(db, code);
      if (courseId == null) {
        courseId = db.insert(courses).values({ name: rc.name, code: rc.code ?? (code ? code.replace(/(\d)/, ' $1') : null) }).returning().get().id;
      }
      row = db.insert(sourceCourses).values({ sourceId: source.id, externalKey: rc.key, name: rc.name, code: rc.code ?? null, url: rc.url ?? null, courseId }).returning().get();
    } else {
      db.update(sourceCourses).set({ name: rc.name, code: rc.code ?? row.code, url: rc.url ?? row.url }).where(eq(sourceCourses.id, row.id)).run();
    }
    const courseId = row.ignored ? null : row.courseId;
    map.set(rc.key, courseId);
    if (courseId != null) {
      const links = [...(rc.links ?? [])];
      if (rc.url) links.unshift({ label: source.name, url: rc.url });
      for (const l of links) {
        const exists = db.select().from(courseLinks).where(and(eq(courseLinks.courseId, courseId), eq(courseLinks.url, l.url))).get();
        if (!exists) db.insert(courseLinks).values({ courseId, label: l.label, url: l.url, sourceId: source.id }).run();
      }
    }
  }
  return map;
}

function reconcileAssignments(db: Db, source: SourceRow, raw: RawAssignment[], courseMap: Map<string, number | null>): number {
  const seen: number[] = [];
  for (const ra of raw) {
    const courseId = ra.courseKey != null ? (courseMap.get(ra.courseKey) ?? null) : source.courseId;
    if (ra.courseKey != null && courseMap.has(ra.courseKey) && courseId == null) continue; // ignored course
    const existing = db.select().from(assignments).where(and(eq(assignments.sourceId, source.id), eq(assignments.externalId, ra.externalId))).get();
    const fields = {
      title: ra.title,
      dueAt: ra.dueAt,
      dueText: ra.dueText ?? null,
      url: ra.url ?? null,
      kind: ra.kind ?? 'other',
      points: ra.points ?? null,
      grade: ra.grade ?? null,
      updatedAt: nowIso(),
    };
    if (!existing) {
      const row = db.insert(assignments).values({ ...fields, sourceId: source.id, externalId: ra.externalId, courseId, status: ra.status ?? 'todo' }).returning().get();
      db.insert(tasks).values({ title: row.title, dueAt: row.dueAt, courseId: row.courseId, assignmentId: row.id, done: row.status !== 'todo' }).run();
      seen.push(row.id);
    } else {
      // The site is the truth for what and when; the user is the truth for done/hidden/course.
      const status = existing.status === 'todo' && ra.status && ra.status !== 'todo' ? ra.status : existing.status;
      const patch: Partial<typeof assignments.$inferInsert> = { ...fields, status };
      if (existing.courseId == null && courseId != null) patch.courseId = courseId;
      db.update(assignments).set(patch).where(eq(assignments.id, existing.id)).run();
      const taskPatch: Partial<typeof tasks.$inferInsert> = { title: ra.title, dueAt: ra.dueAt, updatedAt: nowIso() };
      if (patch.courseId != null) taskPatch.courseId = patch.courseId;
      if (status !== 'todo') taskPatch.done = true;
      db.update(tasks).set(taskPatch).where(eq(tasks.assignmentId, existing.id)).run();
      if (!db.select().from(tasks).where(eq(tasks.assignmentId, existing.id)).get()) {
        db.insert(tasks).values({ title: ra.title, dueAt: ra.dueAt, courseId: existing.courseId ?? courseId, assignmentId: existing.id, done: status !== 'todo' }).run();
      }
      seen.push(existing.id);
    }
  }
  // Items that vanished from the site get hidden, never deleted, so user notes survive a site hiccup.
  if (seen.length) {
    db.update(assignments).set({ hidden: true, updatedAt: nowIso() })
      .where(and(eq(assignments.sourceId, source.id), notInArray(assignments.id, seen), eq(assignments.hidden, false))).run();
  }
  return seen.length;
}

function reconcileShifts(db: Db, source: SourceRow, raw: RawShift[]): number {
  const seen: number[] = [];
  for (const rs of raw) {
    const existing = db.select().from(shifts).where(and(eq(shifts.sourceId, source.id), eq(shifts.externalId, rs.externalId))).get();
    const fields = { startAt: rs.startAt, endAt: rs.endAt, location: rs.location ?? null, notes: rs.notes ?? null };
    if (existing) { db.update(shifts).set(fields).where(eq(shifts.id, existing.id)).run(); seen.push(existing.id); }
    else seen.push(db.insert(shifts).values({ ...fields, sourceId: source.id, externalId: rs.externalId }).returning().get().id);
  }
  // A feed is authoritative: a shift that disappears was dropped or swapped.
  db.delete(shifts).where(and(eq(shifts.sourceId, source.id), seen.length ? notInArray(shifts.id, seen) : sql`1`)).run();
  return seen.length;
}

function reconcileEvents(db: Db, source: SourceRow, raw: RawEvent[]): number {
  const seen: number[] = [];
  for (const re of raw) {
    const existing = db.select().from(events).where(and(eq(events.sourceId, source.id), eq(events.externalId, re.externalId))).get();
    const fields = { title: re.title, startAt: re.startAt, endAt: re.endAt, allDay: re.allDay ?? false, location: re.location ?? null, notes: re.notes ?? null, kind: re.kind ?? 'other' };
    if (existing) { db.update(events).set(fields).where(eq(events.id, existing.id)).run(); seen.push(existing.id); }
    else seen.push(db.insert(events).values({ ...fields, sourceId: source.id, externalId: re.externalId }).returning().get().id);
  }
  db.delete(events).where(and(eq(events.sourceId, source.id), seen.length ? notInArray(events.id, seen) : sql`1`)).run();
  return seen.length;
}

/**
 * The ENGR 131 site lists work that is turned in on Brightspace or Gradescope. When both describe the
 * same code in the same course, keep the submission site's copy on the to-do list and fold the other in.
 */
export function linkDuplicates(db: Db) {
  const rows = db.select({ a: assignments, connector: sql<string>`(select connector from sources where sources.id = ${assignments.sourceId})` })
    .from(assignments).where(and(ne(assignments.courseId, -1), sql`${assignments.courseId} is not null`)).all();
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const code = engrCode(r.a.title);
    if (!code) continue;
    const k = `${r.a.courseId}|${code}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const primary = group.find((g) => g.connector !== 'engr131') ?? group[0];
    for (const g of group) {
      if (g === primary) continue;
      if (g.a.linkedAssignmentId !== primary.a.id || !g.a.hidden) {
        db.update(assignments).set({ linkedAssignmentId: primary.a.id, hidden: true }).where(eq(assignments.id, g.a.id)).run();
      }
      // Carry the richer fields onto the primary if it lacks them.
      const patch: Partial<typeof assignments.$inferInsert> = {};
      if (primary.a.points == null && g.a.points != null) patch.points = g.a.points;
      if (primary.a.dueAt == null && g.a.dueAt != null) { patch.dueAt = g.a.dueAt; db.update(tasks).set({ dueAt: g.a.dueAt }).where(and(eq(tasks.assignmentId, primary.a.id), isNull(tasks.dueAt))).run(); }
      if (primary.a.kind === 'other' && g.a.kind !== 'other') patch.kind = g.a.kind;
      if (Object.keys(patch).length) db.update(assignments).set(patch).where(eq(assignments.id, primary.a.id)).run();
    }
  }
}

export function applySyncResult(db: Db, source: SourceRow, result: SyncResult): number {
  return db.transaction((tx) => {
    const courseMap = reconcileCourses(tx as unknown as Db, source, result.courses ?? []);
    let n = 0;
    if (result.assignments) n += reconcileAssignments(tx as unknown as Db, source, result.assignments, courseMap);
    if (result.shifts) n += reconcileShifts(tx as unknown as Db, source, result.shifts);
    if (result.events) n += reconcileEvents(tx as unknown as Db, source, result.events);
    linkDuplicates(tx as unknown as Db);
    return n;
  });
}

export { inArray };
