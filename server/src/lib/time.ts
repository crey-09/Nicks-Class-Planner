import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addDays, startOfDay } from 'date-fns';

/** [start, end) of the local day containing `at` in `tz`, as ISO UTC strings. */
export function dayBounds(at: Date, tz: string, days = 1): { from: string; to: string } {
  const localStart = startOfDay(toZonedTime(at, tz));
  const from = fromZonedTime(localStart, tz);
  const to = fromZonedTime(addDays(localStart, days), tz);
  return { from: from.toISOString(), to: to.toISOString() };
}
