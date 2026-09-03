import type {
  Assignment, CalendarEvent, ConnectorInfo, Course, CourseLink, DashboardData, PlanBlock,
  Settings, Shift, Source, SourceCourse, SyncRun, Task, TodoItem,
} from '@nick/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any).error ?? res.statusText);
  return data as T;
}

export type PlanBlockWithTask = PlanBlock & { task: Task };
export interface CalendarData { shifts: Shift[]; events: CalendarEvent[]; blocks: PlanBlockWithTask[]; due: TodoItem[] }

const q = (params: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const Api = {
  courses: () => api<Course[]>('/api/courses'),
  createCourse: (b: Partial<Course>) => api<Course>('/api/courses', { method: 'POST', json: b }),
  updateCourse: (id: number, b: Partial<Course>) => api<Course>(`/api/courses/${id}`, { method: 'PATCH', json: b }),
  deleteCourse: (id: number) => api<void>(`/api/courses/${id}`, { method: 'DELETE' }),

  links: () => api<CourseLink[]>('/api/links'),
  createLink: (b: { courseId: number; label: string; url: string }) => api<CourseLink>('/api/links', { method: 'POST', json: b }),
  deleteLink: (id: number) => api<void>(`/api/links/${id}`, { method: 'DELETE' }),

  todo: (p: { includeDone?: boolean } = {}) => api<TodoItem[]>(`/api/todo${q(p)}`),
  createTask: (b: Partial<Task>) => api<Task>('/api/tasks', { method: 'POST', json: b }),
  updateTask: (id: number, b: Partial<Task>) => api<Task>(`/api/tasks/${id}`, { method: 'PATCH', json: b }),
  deleteTask: (id: number) => api<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  updateAssignment: (id: number, b: Partial<Assignment>) => api<Assignment>(`/api/assignments/${id}`, { method: 'PATCH', json: b }),

  shifts: (p: { from?: string; to?: string } = {}) => api<Shift[]>(`/api/shifts${q(p)}`),
  createShift: (b: Partial<Shift>) => api<Shift>('/api/shifts', { method: 'POST', json: b }),
  updateShift: (id: number, b: Partial<Shift>) => api<Shift>(`/api/shifts/${id}`, { method: 'PATCH', json: b }),
  deleteShift: (id: number) => api<void>(`/api/shifts/${id}`, { method: 'DELETE' }),

  events: (p: { from?: string; to?: string } = {}) => api<CalendarEvent[]>(`/api/events${q(p)}`),
  createEvent: (b: Partial<CalendarEvent>) => api<CalendarEvent>('/api/events', { method: 'POST', json: b }),
  updateEvent: (id: number, b: Partial<CalendarEvent>) => api<CalendarEvent>(`/api/events/${id}`, { method: 'PATCH', json: b }),
  deleteEvent: (id: number) => api<void>(`/api/events/${id}`, { method: 'DELETE' }),

  createBlock: (b: { taskId: number; startAt: string; endAt: string }) => api<PlanBlockWithTask>('/api/plan-blocks', { method: 'POST', json: b }),
  updateBlock: (id: number, b: Partial<PlanBlock>) => api<PlanBlock>(`/api/plan-blocks/${id}`, { method: 'PATCH', json: b }),
  deleteBlock: (id: number) => api<void>(`/api/plan-blocks/${id}`, { method: 'DELETE' }),

  calendar: (from: string, to: string) => api<CalendarData>(`/api/calendar${q({ from, to })}`),
  dashboard: () => api<DashboardData>('/api/dashboard'),

  settings: () => api<Settings>('/api/settings'),
  saveSettings: (b: Partial<Settings>) => api<Settings>('/api/settings', { method: 'PUT', json: b }),

  connectors: () => api<ConnectorInfo[]>('/api/connectors'),
  sources: () => api<Source[]>('/api/sources'),
  createSource: (b: { connector: string; name: string; config: Record<string, unknown>; courseId?: number | null }) => api<Source>('/api/sources', { method: 'POST', json: b }),
  updateSource: (id: number, b: Partial<Source>) => api<Source>(`/api/sources/${id}`, { method: 'PATCH', json: b }),
  deleteSource: (id: number) => api<void>(`/api/sources/${id}`, { method: 'DELETE' }),
  syncSource: (id: number) => api<{ ok: boolean; error?: string }>(`/api/sources/${id}/sync`, { method: 'POST' }),
  syncAll: () => api<void>('/api/sync', { method: 'POST' }),
  connectSource: (id: number) => api<{ ok: boolean }>(`/api/sources/${id}/connect`, { method: 'POST' }),
  connectDone: (id: number) => api<{ ok: boolean; loggedIn: boolean }>(`/api/sources/${id}/connect/done`, { method: 'POST' }),
  sourceRuns: (id: number) => api<SyncRun[]>(`/api/sources/${id}/runs`),
  sourceCourses: (sourceId: number) => api<SourceCourse[]>(`/api/source-courses?sourceId=${sourceId}`),
  updateSourceCourse: (id: number, b: Partial<SourceCourse>) => api<SourceCourse>(`/api/source-courses/${id}`, { method: 'PATCH', json: b }),

  googleStatus: () => api<{ configured: boolean; connected: boolean; calendarId: string | null; email: string | null }>('/api/google/status'),
  googleConnect: () => api<{ ok: boolean; url?: string }>('/api/google/connect', { method: 'POST' }),
  googleDisconnect: () => api<void>('/api/google/disconnect', { method: 'POST' }),
  googleSync: () => api<{ pushed: number; pulled: number }>('/api/google/sync', { method: 'POST' }),
  createMeeting: (b: { title: string; startAt: string; endAt: string; attendees: string[]; location?: string; notes?: string; meet?: boolean }) =>
    api<CalendarEvent>('/api/google/meetings', { method: 'POST', json: b }),
};
