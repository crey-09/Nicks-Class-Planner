// Shared API types between server and web. All timestamps are ISO 8601 strings in UTC.

export type ConnectorId = 'brightspace' | 'gradescope' | 'ics' | 'engr131' | 'link' | 'google';
export type SourceStatus = 'ok' | 'needs_login' | 'error' | 'never';
export type AssignmentKind = 'homework' | 'quiz' | 'exam' | 'lab' | 'project' | 'reading' | 'other';
export type AssignmentStatus = 'todo' | 'done' | 'submitted';
export type EventKind = 'class' | 'meeting' | 'other';

export interface Course {
  id: number;
  name: string;
  code: string | null;
  color: string;
  term: string | null;
  createdAt: string;
}

export interface CourseLink {
  id: number;
  courseId: number;
  label: string;
  url: string;
  sourceId: number | null;
}

export interface Source {
  id: number;
  connector: ConnectorId;
  name: string;
  config: Record<string, unknown>;
  courseId: number | null;
  status: SourceStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  enabled: boolean;
}

export interface Assignment {
  id: number;
  sourceId: number;
  externalId: string;
  courseId: number | null;
  title: string;
  dueAt: string | null;
  dueText: string | null;
  url: string | null;
  kind: AssignmentKind;
  status: AssignmentStatus;
  points: number | null;
  grade: string | null;
  hidden: boolean;
  linkedAssignmentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: number;
  title: string;
  dueAt: string | null;
  courseId: number | null;
  assignmentId: number | null;
  done: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row on the unified to-do list: a task, optionally hydrated with its assignment. */
export interface TodoItem extends Task {
  assignment: Assignment | null;
  course: Course | null;
}

export interface Shift {
  id: number;
  sourceId: number | null;
  externalId: string | null;
  startAt: string;
  endAt: string;
  location: string | null;
  notes: string | null;
}

export interface CalendarEvent {
  id: number;
  sourceId: number | null;
  externalId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  attendees: string[];
  googleEventId: string | null;
  kind: EventKind;
  notes: string | null;
}

export interface PlanBlock {
  id: number;
  taskId: number;
  startAt: string;
  endAt: string;
}

export interface SyncRun {
  id: number;
  sourceId: number;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  itemsSeen: number;
  error: string | null;
}

export interface ConnectorInfo {
  id: ConnectorId;
  label: string;
  description: string;
  needsBrowser: boolean;
  configFields: ConfigField[];
}

export interface DashboardData {
  needsLogin: Source[];
  /** One-time setup nudges, e.g. confirm ENGR 131 section days. */
  setup: { sourceId: number; message: string }[];
  dueSoon: TodoItem[];
  overdue: TodoItem[];
  todayShifts: Shift[];
  todayEvents: CalendarEvent[];
  todayBlocks: (PlanBlock & { task: Task })[];
}

export interface Settings {
  syncIntervalMinutes: number;
  timezone: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleConnected: boolean;
  googleCalendarId: string | null;
}

export interface ConfigField {
  key: string;
  label: string;
  type?: 'text' | 'url' | 'time' | 'select' | 'password';
  placeholder?: string;
  required?: boolean;
  help?: string;
  default?: string;
  options?: { value: string; label: string }[];
}

export interface SourceCourse {
  id: number;
  sourceId: number;
  externalKey: string;
  name: string;
  code: string | null;
  url: string | null;
  courseId: number | null;
  ignored: boolean;
}

export interface UpdateStatus {
  local: string | null;
  remote: string | null;
  remoteDate: string | null;
  remoteMessage: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  error: string | null;
}
