// Care dates are calendar dates (YYYY-MM-DD) in the user's own timezone.
// Shared by the server (normalization, bulk actions) and the web client.

export const DEFAULT_TIMEZONE = "Europe/Moscow";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/;

function isRealDate(value: string): boolean {
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function formatInTz(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Calendar date of `instant` in `timezone`; NULL or unknown zones use Europe/Moscow. */
export function localDateInTz(instant: Date, timezone: string | null | undefined): string {
  if (timezone) {
    try {
      return formatInTz(instant, timezone);
    } catch {
      // Unknown zone string: fall through to the default.
    }
  }
  return formatInTz(instant, DEFAULT_TIMEZONE);
}

/**
 * Accepts YYYY-MM-DD (kept as is) or an ISO datetime. A datetime with Z or an
 * offset is a point in time and becomes the user-local date; a datetime without
 * an offset is already wall-clock time, so its date part is kept.
 * Returns null for anything else.
 */
export function normalizeCareDate(value: string, timezone: string | null | undefined): string | null {
  if (DATE_ONLY.test(value)) return isRealDate(value) ? value : null;
  const m = ISO_DATETIME.exec(value);
  if (!m || !isRealDate(m[1])) return null;
  if (!m[3]) return m[1];
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return localDateInTz(instant, timezone);
}

export function addDaysToDateString(date: string, days: number): string {
  const m = DATE_ONLY.exec(date);
  if (!m) throw new Error("expected YYYY-MM-DD");
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return t.toISOString().slice(0, 10);
}

/** True when the next watering (last watered + frequency) is today or earlier. */
export function isWaterDue(lastWatered: string, frequencyDays: number, today: string): boolean {
  const last = typeof lastWatered === "string" ? lastWatered.slice(0, 10) : "";
  if (!isRealDate(last)) return false;
  return addDaysToDateString(last, frequencyDays) <= today;
}

/** YYYY-MM-DD from the Date's local (browser/device) fields. */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Local-midnight Date for a stored care date. `new Date("2026-10-26")` would be
 * UTC midnight and show the previous day west of Greenwich.
 */
export function parseCareDate(value: string): Date {
  const m = DATE_ONLY.exec(String(value).slice(0, 10));
  if (!m) return new Date(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
