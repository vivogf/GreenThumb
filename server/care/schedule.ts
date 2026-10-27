// The one place the server decides what care is due (architecture §2.9): the hourly push check for all
// channels, water-all and postpone-all. "Today" is the user's calendar date in users.timezone (NULL →
// Europe/Moscow). Only watering gets the seasonal interval.
import { addDaysToDateString } from "@shared/care/userDate";
import { isWaterDueForUser, userToday, waterScheduleForUser, type SeasonUser } from "@shared/season/forUser";

export { userToday, waterScheduleForUser };
export type ScheduleUser = SeasonUser;

export type SchedulePlant = {
  id: string;
  name: string;
  water_frequency_days: number;
  last_watered_date: string;
  fertilize_frequency_days: number | null;
  last_fertilized_date: string | null;
  repot_frequency_months: number | null;
  last_repotted_date: string | null;
  prune_frequency_months: number | null;
  last_pruned_date: string | null;
};

export type CareDue = { water: boolean; fertilize: boolean; repot: boolean; prune: boolean };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarDate(value: string | null | undefined): string | null {
  const s = typeof value === "string" ? value.slice(0, 10) : "";
  const m = DATE_ONLY.exec(s);
  if (!m) return null;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]) ? s : null;
}

/** Month arithmetic as before (Date#setMonth overflow: Jan 31 + 1 month → Mar 3). */
export function addMonthsToDateString(date: string, months: number): string {
  const m = DATE_ONLY.exec(date);
  if (!m) throw new Error("expected YYYY-MM-DD");
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, Number(m[3])));
  return t.toISOString().slice(0, 10);
}

function dueByDays(last: string | null | undefined, days: number | null | undefined, today: string): boolean {
  const d = calendarDate(last);
  return !!d && !!days && addDaysToDateString(d, days) <= today;
}

function dueByMonths(last: string | null | undefined, months: number | null | undefined, today: string): boolean {
  const d = calendarDate(last);
  return !!d && !!months && addMonthsToDateString(d, months) <= today;
}

export function careDueOn(plant: SchedulePlant, user: ScheduleUser, today: string): CareDue {
  return {
    water: isWaterDueForUser(plant, user, today),
    fertilize: dueByDays(plant.last_fertilized_date, plant.fertilize_frequency_days, today),
    repot: dueByMonths(plant.last_repotted_date, plant.repot_frequency_months, today),
    prune: dueByMonths(plant.last_pruned_date, plant.prune_frequency_months, today),
  };
}

/** Plants water-all and postpone-all act on: watering due on the user's date at `now`. */
export function plantsDueForWatering<P extends Pick<SchedulePlant, "last_watered_date" | "water_frequency_days">>(
  plants: P[],
  user: ScheduleUser,
  now: Date,
): P[] {
  const today = userToday(user, now);
  return plants.filter((p) => isWaterDueForUser(p, user, today));
}

/** Plants a care reminder mentions: any kind of care due on the user's date at `now`. */
export function plantsNeedingCare<P extends SchedulePlant>(plants: P[], user: ScheduleUser, now: Date): P[] {
  const today = userToday(user, now);
  return plants.filter((p) => {
    const due = careDueOn(p, user, today);
    return due.water || due.fertilize || due.repot || due.prune;
  });
}
