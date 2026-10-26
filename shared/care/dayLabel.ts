// Day-granular labels for care dates. Care dates are calendar days, so the
// distance is counted in local calendar days, never in hours.
import { addMonths, format } from "date-fns";
import type { Locale } from "date-fns";
import { addDaysToDateString, localDateString, parseCareDate } from "./userDate";

export type CareDayLabel =
  | { key: "today" }
  | { key: "yesterday" }
  | { key: "tomorrow" }
  | { key: "daysAgo"; count: number }
  | { key: "inDays"; count: number };

function dayNumber(date: string): number {
  const d = date.slice(0, 10);
  const [y, m, day] = d.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86_400_000);
}

/** Whole calendar days from `today` to `date` (negative = in the past). */
export function calendarDaysFrom(today: string, date: string): number {
  return dayNumber(date) - dayNumber(today);
}

export function careDayLabel(date: string, today: string): CareDayLabel {
  const diff = calendarDaysFrom(today, date);
  if (diff === 0) return { key: "today" };
  if (diff === -1) return { key: "yesterday" };
  if (diff === 1) return { key: "tomorrow" };
  return diff < 0 ? { key: "daysAgo", count: -diff } : { key: "inDays", count: diff };
}

export function nextCareDateByDays(last: string, days: number): string {
  return addDaysToDateString(last.slice(0, 10), days);
}

export function nextCareDateByMonths(last: string, months: number): string {
  return localDateString(addMonths(parseCareDate(last), months));
}

/** Long absolute label ("PPP") that shows the stored calendar day. */
export function formatCareDate(date: string, locale?: Locale): string {
  return format(parseCareDate(date), "PPP", locale ? { locale } : undefined);
}
