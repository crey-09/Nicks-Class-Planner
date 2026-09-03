import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '../src/db/index.js';
import { assignments, courses, sources, tasks, shifts } from '../src/db/schema.js';
import { applySyncResult, normalizeCode, engrCode } from '../src/sync/reconcile.js';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

function mkSource(connector: 'engr131' | 'gradescope' | 'ics', courseId: number | null = null) {
  return db.insert(sources).values({ connector, name: connector, config: {}, courseId }).returning().get();
}

describe('normalizeCode', () => {
  it('collapses Purdue codes', () => {
    expect(normalizeCode('MA 16500')).toBe('MA165');
    expect(normalizeCode('MA165')).toBe('MA165');
    expect(normalizeCode('ENGR 13100 Fall 2026')).toBe('ENGR131');
    expect(normalizeCode('Analytic Geometry And Calculus I')).toBeNull();
  });
  it('finds ENGR assignment codes', () => {
    expect(engrCode('EX 3.1.2 · PCA: Calculations')).toBe('EX 3.1.2');
    expect(engrCode('Homework 3')).toBeNull();
  });
});

describe('applySyncResult', () => {
  it('creates assignments with mirrored tasks and is idempotent', () => {
    const course = db.insert(courses).values({ name: 'ENGR 131', code: 'ENGR 131' }).returning().get();
    const src = mkSource('engr131', course.id);
    const result = { assignments: [{ externalId: 'EX 1', title: 'EX 1 · Thing', dueAt: '2026-09-10T12:30:00.000Z', points: 5 }] };
    expect(applySyncResult(db, src, result)).toBe(1);
    applySyncResult(db, src, result);
    expect(db.select().from(assignments).all()).toHaveLength(1);
    const t = db.select().from(tasks).all();
    expect(t).toHaveLength(1);
    expect(t[0].courseId).toBe(course.id);
    expect(t[0].dueAt).toBe('2026-09-10T12:30:00.000Z');
  });

  it('keeps user done state, updates due dates, hides vanished items', () => {
    const src = mkSource('engr131');
    applySyncResult(db, src, { assignments: [{ externalId: 'A', title: 'A', dueAt: null }, { externalId: 'B', title: 'B', dueAt: null }] });
    const a = db.select().from(assignments).where(eq(assignments.externalId, 'A')).get()!;
    db.update(tasks).set({ done: true }).where(eq(tasks.assignmentId, a.id)).run();
    applySyncResult(db, src, { assignments: [{ externalId: 'A', title: 'A renamed', dueAt: '2026-10-01T00:00:00.000Z' }] });
    const ta = db.select().from(tasks).where(eq(tasks.assignmentId, a.id)).get()!;
    expect(ta.done).toBe(true);
    expect(ta.title).toBe('A renamed');
    expect(ta.dueAt).toBe('2026-10-01T00:00:00.000Z');
    const b = db.select().from(assignments).where(eq(assignments.externalId, 'B')).get()!;
    expect(b.hidden).toBe(true);
  });

  it('auto-creates courses from multi-course connectors and matches by code', () => {
    const existing = db.insert(courses).values({ name: 'Calculus I', code: 'MA 165' }).returning().get();
    const src = mkSource('gradescope');
    applySyncResult(db, src, {
      courses: [{ key: '1', name: 'MA 16500', code: 'MA16500' }, { key: '2', name: 'PHYS 17200 Modern Mechanics', code: 'PHYS 17200' }],
      assignments: [{ externalId: '1:hw1', title: 'HW 1', dueAt: null, courseKey: '1' }, { externalId: '2:hw1', title: 'HW 1', dueAt: null, courseKey: '2' }],
    });
    const all = db.select().from(courses).all();
    expect(all).toHaveLength(2);
    const ma = db.select().from(assignments).where(eq(assignments.externalId, '1:hw1')).get()!;
    expect(ma.courseId).toBe(existing.id);
    const phys = all.find((c) => c.id !== existing.id)!;
    expect(phys.name).toBe('PHYS 17200 Modern Mechanics');
  });

  it('folds ENGR site items into the submission site copy', () => {
    const course = db.insert(courses).values({ name: 'ENGR 131', code: 'ENGR 131' }).returning().get();
    const site = mkSource('engr131', course.id);
    const gs = mkSource('gradescope');
    applySyncResult(db, site, { assignments: [{ externalId: 'EX 3.1.2', title: 'EX 3.1.2 · PCA: Charting', dueAt: '2026-08-26T12:30:00.000Z', points: 5 }] });
    applySyncResult(db, gs, { courses: [{ key: '9', name: 'ENGR 13100', code: 'ENGR13100' }], assignments: [{ externalId: '9:77', title: 'EX 3.1.2 Charting', dueAt: null, courseKey: '9', status: 'submitted' }] });
    const visible = db.select().from(assignments).where(eq(assignments.hidden, false)).all();
    expect(visible).toHaveLength(1);
    expect(visible[0].sourceId).toBe(gs.id);
    expect(visible[0].dueAt).toBe('2026-08-26T12:30:00.000Z'); // carried over from the site
    expect(visible[0].points).toBe(5);
    const folded = db.select().from(assignments).where(eq(assignments.sourceId, site.id)).get()!;
    expect(folded.linkedAssignmentId).toBe(visible[0].id);
    const t = db.select().from(tasks).where(eq(tasks.assignmentId, visible[0].id)).get()!;
    expect(t.done).toBe(true);
  });

  it('treats a feed as authoritative for shifts', () => {
    const src = mkSource('ics');
    applySyncResult(db, src, { shifts: [{ externalId: 's1', startAt: '2026-09-05T20:00:00.000Z', endAt: '2026-09-06T01:00:00.000Z' }, { externalId: 's2', startAt: '2026-09-06T20:00:00.000Z', endAt: '2026-09-07T01:00:00.000Z' }] });
    expect(db.select().from(shifts).all()).toHaveLength(2);
    applySyncResult(db, src, { shifts: [{ externalId: 's2', startAt: '2026-09-06T21:00:00.000Z', endAt: '2026-09-07T01:00:00.000Z' }] });
    const left = db.select().from(shifts).all();
    expect(left).toHaveLength(1);
    expect(left[0].startAt).toBe('2026-09-06T21:00:00.000Z');
  });
});
