import { format, isToday, isTomorrow, isPast, differenceInCalendarDays, startOfDay, addDays } from 'date-fns';

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtDue(iso: string | null): string {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  const time = format(d, 'h:mm a');
  if (isToday(d)) return `Today ${time}`;
  if (isTomorrow(d)) return `Tomorrow ${time}`;
  const days = differenceInCalendarDays(d, new Date());
  if (days > 1 && days < 7) return `${format(d, 'EEE')} ${time}`;
  return format(d, 'MMM d, h:mm a');
}

export function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso), e = new Date(endIso);
  const sameDay = startOfDay(s).getTime() === startOfDay(e).getTime();
  return sameDay
    ? `${format(s, 'EEE MMM d')} · ${format(s, 'h:mm a')} – ${format(e, 'h:mm a')}`
    : `${format(s, 'MMM d h:mm a')} – ${format(e, 'MMM d h:mm a')}`;
}

export function fmtTime(iso: string): string { return format(new Date(iso), 'h:mm a'); }

export type DueBucket = 'Overdue' | 'Today' | 'Tomorrow' | 'This week' | 'Later' | 'No date';
export function dueBucket(iso: string | null): DueBucket {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (isPast(d) && !isToday(d)) return 'Overdue';
  if (isToday(d)) return isPast(d) ? 'Overdue' : 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (d < addDays(startOfDay(new Date()), 7)) return 'This week';
  return 'Later';
}
export const bucketOrder: DueBucket[] = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No date'];

/** Default end for a new 1-hour item starting at the next round half hour. */
export function defaultStart(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}
