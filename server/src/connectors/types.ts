import type { Page } from 'playwright';
import type { AssignmentKind, AssignmentStatus, ConnectorId, ConnectorInfo, EventKind } from '@nick/shared';
import type { Db } from '../db/index.js';
import type { sources } from '../db/schema.js';

export interface RawCourse {
  /** Stable key within the connector (org unit id, Gradescope course id, or a slug). */
  key: string;
  name: string;
  code?: string | null;
  url?: string | null;
  links?: { label: string; url: string }[];
}

export interface RawAssignment {
  externalId: string;
  title: string;
  dueAt: string | null;
  /** The site's own wording when it can't be resolved to a timestamp ("Class 1B"). */
  dueText?: string | null;
  url?: string | null;
  kind?: AssignmentKind;
  points?: number | null;
  grade?: string | null;
  status?: AssignmentStatus | null;
  /** RawCourse.key this belongs to; omitted for single-course sources. */
  courseKey?: string | null;
}

export interface RawShift { externalId: string; startAt: string; endAt: string; location?: string | null; notes?: string | null }
export interface RawEvent { externalId: string; title: string; startAt: string; endAt: string; allDay?: boolean; location?: string | null; notes?: string | null; kind?: EventKind; courseKey?: string | null }

export interface SyncResult {
  courses?: RawCourse[];
  assignments?: RawAssignment[];
  shifts?: RawShift[];
  events?: RawEvent[];
}

export type SourceRow = typeof sources.$inferSelect;

export interface SyncContext {
  db: Db;
  source: SourceRow;
  config: Record<string, unknown>;
  /** Present when the connector declares needsBrowser. Serialized: one page at a time. */
  withPage?: <T>(fn: (page: Page) => Promise<T>) => Promise<T>;
  log: (msg: string) => void;
}

export class NeedsLoginError extends Error {
  constructor(msg = 'Session expired. Reconnect to log in again.') { super(msg); this.name = 'NeedsLoginError'; }
}

export interface Connector extends Omit<ConnectorInfo, 'id'> {
  id: ConnectorId;
  loginUrl?: string;
  /** For browser connectors: is the persisted session still valid? */
  isLoggedIn?(page: Page, config: Record<string, unknown>): Promise<boolean>;
  sync(ctx: SyncContext): Promise<SyncResult>;
}
