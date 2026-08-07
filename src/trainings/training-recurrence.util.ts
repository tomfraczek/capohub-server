// Pure date arithmetic behind TrainingSeries generation/regeneration (see
// TrainingSeriesService). Every date is handled as a UTC calendar date -
// this codebase has no timezone-conversion library (Event itself stores
// only client-supplied, already-offset-aware timestamps and never converts
// by Section.timezone either - see events/entities/event.entity.ts), so a
// series' `startDate`/`dayOfWeek`/`startTime` are combined as plain UTC
// wall-clock values, consistently with how every other date in this
// codebase is stored and compared.

const MAX_SERIES_DURATION_YEARS = 3;

/** Truncates to a UTC calendar date (midnight). */
export function toUtcDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** The latest date a series' `endDate` may be, given its `startDate`. */
export function maxSeriesEndDate(startDate: Date): Date {
  const max = toUtcDateOnly(startDate);
  max.setUTCFullYear(max.getUTCFullYear() + MAX_SERIES_DURATION_YEARS);
  return max;
}

/** The first `dayOfWeek` (0=Sun..6=Sat) match on or after `startDate`. */
export function firstOccurrenceDate(startDate: Date, dayOfWeek: number): Date {
  const date = toUtcDateOnly(startDate);
  const diff = (dayOfWeek - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

/**
 * Every calendar date matching `dayOfWeek`, weekly, from `startDate`
 * through `endDate` inclusive (both bounds normalized to UTC calendar
 * dates first).
 */
export function generateOccurrenceDates(
  startDate: Date,
  endDate: Date,
  dayOfWeek: number,
): Date[] {
  const boundedEnd = toUtcDateOnly(endDate);
  const dates: Date[] = [];
  let cursor = firstOccurrenceDate(startDate, dayOfWeek);
  while (cursor.getTime() <= boundedEnd.getTime()) {
    dates.push(new Date(cursor));
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return dates;
}

/** Combines a UTC calendar date with a "HH:mm" wall-clock time. */
export function buildStartsAt(dateOnly: Date, startTime: string): Date {
  const [hours, minutes] = startTime.split(':').map(Number);
  const result = toUtcDateOnly(dateOnly);
  result.setUTCHours(hours, minutes, 0, 0);
  return result;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** "YYYY-MM-DD" key for de-duplicating occurrences by calendar date. */
export function dateKey(date: Date): string {
  return toUtcDateOnly(date).toISOString().slice(0, 10);
}
