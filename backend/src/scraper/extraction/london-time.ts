import { DateTime } from 'luxon';
import type { Weekday } from '../../common/scraper.enums';

export const LONDON = 'Europe/London';

const WEEKDAY_BY_LUXON: Record<number, Weekday> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 7: 'sun' };

export function isIsoDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value, { zone: LONDON }).isValid;
}

// Offers start at 00:00 London time on their start date.
export function londonStartOfDay(date: string): Date {
  return DateTime.fromISO(date, { zone: LONDON }).startOf('day').toJSDate();
}

// Spec §6: endDate is inclusive and the offer expires at 23:59:59 London time.
export function londonEndOfDay(date: string): Date {
  return DateTime.fromISO(date, { zone: LONDON }).endOf('day').toJSDate();
}

export function londonDate(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: LONDON }).toISODate()!;
}

export function londonWeekday(instant: Date): Weekday {
  return WEEKDAY_BY_LUXON[DateTime.fromJSDate(instant, { zone: LONDON }).weekday];
}

export function toIsoDate(year: number, month: number, day: number): string | undefined {
  const dt = DateTime.fromObject({ year, month, day }, { zone: LONDON });
  return dt.isValid ? dt.toISODate()! : undefined;
}

export function lastDayOfMonth(year: number, month: number): string {
  return DateTime.fromObject({ year, month, day: 1 }, { zone: LONDON }).endOf('month').toISODate()!;
}

// Next date (today included) that falls on `weekday`, in London time.
export function nextWeekdayDate(from: Date, weekday: Weekday): string {
  const target = Object.entries(WEEKDAY_BY_LUXON).find(([, w]) => w === weekday)![0];
  let dt = DateTime.fromJSDate(from, { zone: LONDON }).startOf('day');
  while (dt.weekday !== Number(target)) dt = dt.plus({ days: 1 });
  return dt.toISODate()!;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return DateTime.fromISO(toIso, { zone: LONDON }).diff(DateTime.fromISO(fromIso, { zone: LONDON }), 'days').days;
}
