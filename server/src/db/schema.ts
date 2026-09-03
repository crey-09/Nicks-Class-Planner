import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import type { AssignmentKind, AssignmentStatus, ConnectorId, EventKind, SourceStatus } from '@nick/shared';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const courses = sqliteTable('courses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  code: text('code'),
  color: text('color').notNull().default('#4f46e5'),
  term: text('term'),
  createdAt: text('created_at').notNull().default(now),
});

export const courseLinks = sqliteTable('course_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  url: text('url').notNull(),
  sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
}, (t) => [index('course_links_course_idx').on(t.courseId)]);

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  connector: text('connector').$type<ConnectorId>().notNull(),
  name: text('name').notNull(),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  status: text('status').$type<SourceStatus>().notNull().default('never'),
  lastSyncAt: text('last_sync_at'),
  lastError: text('last_error'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

export const assignments = sqliteTable('assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  dueAt: text('due_at'),
  dueText: text('due_text'),
  url: text('url'),
  kind: text('kind').$type<AssignmentKind>().notNull().default('other'),
  status: text('status').$type<AssignmentStatus>().notNull().default('todo'),
  points: real('points'),
  grade: text('grade'),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  linkedAssignmentId: integer('linked_assignment_id'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
}, (t) => [
  uniqueIndex('assignments_source_external_idx').on(t.sourceId, t.externalId),
  index('assignments_due_idx').on(t.dueAt),
]);

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  dueAt: text('due_at'),
  courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  assignmentId: integer('assignment_id').references(() => assignments.id, { onDelete: 'cascade' }),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
}, (t) => [index('tasks_due_idx').on(t.dueAt), uniqueIndex('tasks_assignment_idx').on(t.assignmentId)]);

export const shifts = sqliteTable('shifts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
  location: text('location'),
  notes: text('notes'),
}, (t) => [index('shifts_start_idx').on(t.startAt), uniqueIndex('shifts_source_external_idx').on(t.sourceId, t.externalId)]);

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  title: text('title').notNull(),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
  allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
  location: text('location'),
  attendees: text('attendees', { mode: 'json' }).$type<string[]>().notNull().default([]),
  googleEventId: text('google_event_id'),
  kind: text('kind').$type<EventKind>().notNull().default('other'),
  notes: text('notes'),
}, (t) => [index('events_start_idx').on(t.startAt), uniqueIndex('events_source_external_idx').on(t.sourceId, t.externalId)]);

export const planBlocks = sqliteTable('plan_blocks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
}, (t) => [index('plan_blocks_start_idx').on(t.startAt)]);

export const syncRuns = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  startedAt: text('started_at').notNull().default(now),
  finishedAt: text('finished_at'),
  ok: integer('ok', { mode: 'boolean' }),
  itemsSeen: integer('items_seen').notNull().default(0),
  error: text('error'),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Courses as a connector sees them (a Brightspace org unit, a Gradescope course), mapped onto our courses. */
export const sourceCourses = sqliteTable('source_courses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  externalKey: text('external_key').notNull(),
  name: text('name').notNull(),
  code: text('code'),
  url: text('url'),
  courseId: integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
}, (t) => [uniqueIndex('source_courses_key_idx').on(t.sourceId, t.externalKey)]);

/** Which Google event mirrors which local item ("task:12", "shift:3", "block:7"), with a content hash to skip no-op updates. */
export const googleEvents = sqliteTable('google_events', {
  key: text('key').primaryKey(),
  googleEventId: text('google_event_id').notNull(),
  hash: text('hash').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});
