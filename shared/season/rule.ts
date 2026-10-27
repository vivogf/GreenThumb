// Seasonal watering rule (architecture §2.9). The KMP app has a Kotlin twin; both must pass every case in
// season-vectors.json. Pure: the zone and dates are parameters, nothing reads a clock.
import tzLatitudes from "./tz-latitudes.json";
import { addDaysToDateString } from "../care/userDate";

export const SEASON_MODES = ["auto", "north", "south", "off"] as const;
export type SeasonMode = (typeof SEASON_MODES)[number];
export type Hemisphere = "north" | "south" | "tropical" | "none";

/** |latitude| at or above this is outside the tropics. */
export const TROPICS_LIMIT_DEGREES = 15;
export const DORMANT_MONTHS: Readonly<Record<"north" | "south", readonly number[]>> = {
  north: [11, 12, 1, 2],
  south: [5, 6, 7, 8],
};

const ZONES = (tzLatitudes as { zones: Record<string, number> }).zones;

export function isSeasonMode(value: unknown): value is SeasonMode {
  return typeof value === "string" && (SEASON_MODES as readonly string[]).includes(value);
}

/** Latitude of an IANA zone id (aliases included); undefined for unknown, UTC, Etc/* and GMT ids. */
export function zoneLatitude(tz: string | null | undefined): number | undefined {
  if (!tz || !Object.prototype.hasOwnProperty.call(ZONES, tz)) return undefined;
  return ZONES[tz];
}

export function hemisphereForLatitude(latitude: number | null | undefined): Hemisphere {
  if (latitude === null || latitude === undefined || !Number.isFinite(latitude)) return "none";
  if (latitude >= TROPICS_LIMIT_DEGREES) return "north";
  if (latitude <= -TROPICS_LIMIT_DEGREES) return "south";
  return "tropical";
}

/** Geographic result for the zone alone, whatever the mode. */
export function hemisphere(tz: string | null | undefined): Hemisphere {
  return hemisphereForLatitude(zoneLatitude(tz));
}

/** The hemisphere whose dormant months apply, or null when the mode gives no adjustment. */
export function seasonHemisphere(mode: SeasonMode, tz: string | null | undefined): "north" | "south" | null {
  if (mode === "off") return null;
  if (mode === "north" || mode === "south") return mode;
  const h = hemisphere(tz);
  return h === "north" || h === "south" ? h : null;
}

function monthOf(date: string): number {
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(date);
  if (!m) throw new Error("expected YYYY-MM-DD");
  return Number(m[1]);
}

/** True when the month of the last watering is dormant for the applied hemisphere. */
export function isDormantWatering(lastWatered: string, mode: SeasonMode, tz: string | null | undefined): boolean {
  const h = seasonHemisphere(mode, tz);
  return h !== null && DORMANT_MONTHS[h].includes(monthOf(lastWatered));
}

/** Watering interval only; fertilize, repot and prune intervals are never adjusted. */
export function effectiveWaterIntervalDays(
  baseDays: number,
  lastWatered: string,
  mode: SeasonMode,
  tz: string | null | undefined,
): number {
  return isDormantWatering(lastWatered, mode, tz) ? Math.ceil((baseDays * 3) / 2) : baseDays;
}

export function nextWaterDue(
  lastWatered: string,
  baseDays: number,
  mode: SeasonMode,
  tz: string | null | undefined,
): string {
  return addDaysToDateString(lastWatered.slice(0, 10), effectiveWaterIntervalDays(baseDays, lastWatered, mode, tz));
}
