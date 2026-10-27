// Watering streak (architecture §2.11, §8.8). Pure: the plants, care events, user settings and "now" are
// parameters, so the live endpoint and an exported fixture give the same answer.
//
// Rules:
// - Days are the user's calendar dates (users.timezone, NULL → Europe/Moscow); occurred_on is already one.
// - Counting starts on the day of the user's first care event (any type); earlier days never count.
// - A plant exists from its creation date (user-local). Its waterings are its `water` events plus its current
//   last_watered_date (an implicit watering when no event matches it, e.g. pre-journal data).
// - On day d the plant's reference watering is the latest watering on or before d; with none, the creation date.
//   The plant is overdue on d when reference + effective interval (season rule) is before d. A plant due on d is
//   not overdue on d, so today is clean when nothing is overdue at request time.
// - A day is clean when no existing plant is overdue on it. current = clean run ending today; best = longest
//   clean run, recomputed from current data every time (it may drop after a plant is deleted).
import { addDaysToDateString, localDateInTz } from "@shared/care/userDate";
import { effectiveWaterIntervalDays } from "@shared/season/rule";
import { userSeasonMode, userZone, type SeasonUser } from "@shared/season/forUser";

export type StreakPlant = {
  id: string;
  /** Instant of creation: a Date or an ISO string (a string without a zone is read as UTC). */
  created_at: string | Date;
  water_frequency_days: number;
  last_watered_date: string;
};

export type StreakEventType = "water" | "fertilize" | "repot" | "prune" | "note" | "photo";
export type StreakEvent = { plant_id: string; type: StreakEventType | string; occurred_on: string };
export type Streak = { current: number; best: number };

export type StreakInput = {
  plants: StreakPlant[];
  events: StreakEvent[];
  user: SeasonUser;
  now: Date;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarDate(value: unknown): string | null {
  const s = typeof value === "string" ? value.slice(0, 10) : "";
  const m = DATE_ONLY.exec(s);
  if (!m) return null;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]) ? s : null;
}

function instantOf(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const t = new Date(hasZone || !value.includes("T") ? value : `${value}Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

type Timeline = {
  created: string;
  baseDays: number;
  /** Ascending, unique. */
  waterings: string[];
  /** Index of the next watering after the current day. */
  next: number;
};

function buildTimeline(plant: StreakPlant, waterDates: string[], timezone: string | null | undefined): Timeline | null {
  const base = plant.water_frequency_days;
  if (!Number.isInteger(base) || base < 1) return null;
  const instant = instantOf(plant.created_at);
  if (!instant) return null;
  const set = new Set(waterDates);
  const implicit = calendarDate(plant.last_watered_date);
  if (implicit) set.add(implicit);
  return { created: localDateInTz(instant, timezone), baseDays: base, waterings: Array.from(set).sort(), next: 0 };
}

/** Days must be passed in ascending order: the timeline cursor only moves forward. */
function overdueOn(t: Timeline, day: string, mode: ReturnType<typeof userSeasonMode>, zone: string): boolean {
  if (day < t.created) return false;
  while (t.next < t.waterings.length && t.waterings[t.next] <= day) t.next += 1;
  const reference = t.next > 0 ? t.waterings[t.next - 1] : t.created;
  const due = addDaysToDateString(reference, effectiveWaterIntervalDays(t.baseDays, reference, mode, zone));
  return due < day;
}

export function computeStreak({ plants, events, user, now }: StreakInput): Streak {
  const today = localDateInTz(now, user?.timezone);
  let first: string | null = null;
  const waterByPlant = new Map<string, string[]>();
  for (const e of events) {
    const day = calendarDate(e.occurred_on);
    if (!day) continue;
    if (first === null || day < first) first = day;
    if (e.type === "water") {
      const list = waterByPlant.get(e.plant_id) ?? [];
      list.push(day);
      waterByPlant.set(e.plant_id, list);
    }
  }
  if (first === null || first > today) return { current: 0, best: 0 };

  const mode = userSeasonMode(user);
  const zone = userZone(user);
  const timelines = plants
    .map((p) => buildTimeline(p, waterByPlant.get(p.id) ?? [], user?.timezone))
    .filter((t): t is Timeline => t !== null);

  let run = 0;
  let best = 0;
  for (let day = first; day <= today; day = addDaysToDateString(day, 1)) {
    let clean = true;
    // Every timeline must see every day so its cursor stays in step.
    for (const t of timelines) if (overdueOn(t, day, mode, zone)) clean = false;
    run = clean ? run + 1 : 0;
    if (run > best) best = run;
  }
  return { current: run, best };
}
