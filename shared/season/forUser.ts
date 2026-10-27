// The season rule applied with a user's stored settings, the same way on the server and in the web client:
// NULL timezone → Europe/Moscow, missing or unknown season_mode → auto.
import { DEFAULT_TIMEZONE, addDaysToDateString, localDateInTz } from "../care/userDate";
import { isSeasonMode, isDormantWatering, effectiveWaterIntervalDays, type SeasonMode } from "./rule";

export type SeasonUser = { timezone?: string | null; season_mode?: string | null } | null | undefined;
export type WaterPlant = { last_watered_date: string; water_frequency_days: number };
export type WaterSchedule = { baseDays: number; effectiveDays: number; nextDue: string; adjusted: boolean };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function userZone(user: SeasonUser): string {
  return user?.timezone || DEFAULT_TIMEZONE;
}

export function userSeasonMode(user: SeasonUser): SeasonMode {
  return isSeasonMode(user?.season_mode) ? user.season_mode : "auto";
}

/** The user's calendar date at `now`. */
export function userToday(user: SeasonUser, now: Date): string {
  return localDateInTz(now, user?.timezone);
}

/** Null when the stored last-watered value is not a real calendar date. */
export function waterScheduleForUser(plant: WaterPlant, user: SeasonUser): WaterSchedule | null {
  const last = typeof plant.last_watered_date === "string" ? plant.last_watered_date.slice(0, 10) : "";
  if (!DATE_ONLY.test(last) || !Number.isInteger(plant.water_frequency_days)) return null;
  const [y, m, d] = last.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  const mode = userSeasonMode(user);
  const zone = userZone(user);
  const effectiveDays = effectiveWaterIntervalDays(plant.water_frequency_days, last, mode, zone);
  return {
    baseDays: plant.water_frequency_days,
    effectiveDays,
    nextDue: addDaysToDateString(last, effectiveDays),
    adjusted: isDormantWatering(last, mode, zone),
  };
}

export function isWaterDueForUser(plant: WaterPlant, user: SeasonUser, today: string): boolean {
  const s = waterScheduleForUser(plant, user);
  return s !== null && s.nextDue <= today;
}
