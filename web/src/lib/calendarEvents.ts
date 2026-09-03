import type { EventInput } from '@fullcalendar/core';
import type { CalendarData } from '../api/client';
import type { Course } from '@nick/shared';

export type ItemType = 'shift' | 'event' | 'block' | 'due';

export const colors: Record<ItemType, string> = {
  shift: '#f59e0b',
  event: '#0284c7',
  block: '#7c3aed',
  due: '#dc2626',
};

/** Map the /api/calendar payload to FullCalendar events. Every event carries {type, id} in extendedProps. */
export function toFcEvents(data: CalendarData, courses: Course[], opts: { dueAllDay?: boolean; editable?: Partial<Record<ItemType, boolean>> } = {}): EventInput[] {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const ed = (t: ItemType) => opts.editable?.[t] ?? false;
  const out: EventInput[] = [];
  for (const s of data.shifts) {
    out.push({ id: `shift-${s.id}`, title: `Work${s.location ? ` · ${s.location}` : ''}`, start: s.startAt, end: s.endAt, backgroundColor: colors.shift, borderColor: colors.shift, editable: ed('shift'), extendedProps: { type: 'shift', id: s.id, data: s } });
  }
  for (const e of data.events) {
    out.push({ id: `event-${e.id}`, title: e.title, start: e.startAt, end: e.endAt, allDay: e.allDay, backgroundColor: colors.event, borderColor: colors.event, editable: ed('event'), extendedProps: { type: 'event', id: e.id, data: e } });
  }
  for (const b of data.blocks) {
    const c = b.task.courseId ? courseById.get(b.task.courseId) : undefined;
    const color = c?.color ?? colors.block;
    out.push({ id: `block-${b.id}`, title: `📝 ${b.task.title}`, start: b.startAt, end: b.endAt, backgroundColor: color, borderColor: color, editable: ed('block'), extendedProps: { type: 'block', id: b.id, data: b } });
  }
  for (const t of data.due) {
    if (!t.dueAt) continue;
    const c = t.course ?? undefined;
    const color = c?.color ?? colors.due;
    out.push({
      id: `due-${t.id}`, title: `${t.done ? '✓ ' : ''}Due: ${t.title}`, start: t.dueAt, allDay: opts.dueAllDay ?? false,
      backgroundColor: 'transparent', borderColor: color, textColor: color, display: 'list-item',
      classNames: t.done ? ['fc-done'] : [], editable: false,
      extendedProps: { type: 'due', id: t.id, data: t },
    });
  }
  return out;
}
