import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonthsToDateString,
  careDueOn,
  plantsDueForWatering,
  plantsNeedingCare,
  userToday,
  waterScheduleForUser,
  type SchedulePlant,
} from "./schedule";

function plant(id: string, over: Partial<SchedulePlant> = {}): SchedulePlant {
  return {
    id,
    name: id,
    water_frequency_days: 7,
    last_watered_date: "2026-01-01",
    fertilize_frequency_days: null,
    last_fertilized_date: null,
    repot_frequency_months: null,
    last_repotted_date: null,
    prune_frequency_months: null,
    last_pruned_date: null,
    ...over,
  };
}

test("today is the user's local date; NULL timezone uses Europe/Moscow", () => {
  const now = new Date("2026-01-10T22:30:00Z");
  assert.equal(userToday({ timezone: "Asia/Singapore" }, now), "2026-01-11");
  assert.equal(userToday({ timezone: "America/Los_Angeles" }, now), "2026-01-10");
  assert.equal(userToday({ timezone: null }, now), "2026-01-11");
  assert.equal(userToday({ timezone: null }, new Date("2026-01-10T20:30:00Z")), "2026-01-10");
});

test("at 2026-01-10T17:30Z the off-mode plant is due in Singapore and not in Los Angeles", () => {
  const now = new Date("2026-01-10T17:30:00Z");
  const p = plant("p", { last_watered_date: "2026-01-06", water_frequency_days: 5 });
  assert.equal(waterScheduleForUser(p, { timezone: "Asia/Singapore", season_mode: "off" })?.nextDue, "2026-01-11");
  assert.deepEqual(plantsDueForWatering([p], { timezone: "Asia/Singapore", season_mode: "off" }, now).map((x) => x.id), ["p"]);
  assert.deepEqual(plantsDueForWatering([p], { timezone: "America/Los_Angeles", season_mode: "off" }, now), []);
});

test("NULL timezone: Moscow date and Moscow hemisphere", () => {
  const p = plant("p", { last_watered_date: "2026-12-01", water_frequency_days: 10 });
  const s = waterScheduleForUser(p, { timezone: null, season_mode: "auto" });
  assert.deepEqual(s, { baseDays: 10, effectiveDays: 15, nextDue: "2026-12-16", adjusted: true });
});

test("missing or unknown season_mode behaves as auto", () => {
  const p = plant("p", { last_watered_date: "2026-12-01", water_frequency_days: 10 });
  assert.equal(waterScheduleForUser(p, { timezone: "Europe/Berlin" })?.effectiveDays, 15);
  assert.equal(waterScheduleForUser(p, { timezone: "Europe/Berlin", season_mode: "bogus" })?.effectiveDays, 15);
});

test("water-all selection follows the seasonal rule (VAL-SEASON-014 shape)", () => {
  // Berlin, D = 2026-01-20, mode north. L1 = 2026-01-13 (dormant), L3 = 2025-10-31 (not dormant).
  const now = new Date("2026-01-20T10:00:00Z");
  const p1 = plant("P1", { last_watered_date: "2026-01-13", water_frequency_days: 7 }); // E=11 → Jan 24
  const p2 = plant("P2", { last_watered_date: "2026-01-13", water_frequency_days: 4 }); // E=6 → Jan 19
  const p3 = plant("P3", { last_watered_date: "2025-10-31", water_frequency_days: 81 }); // E=81 → Jan 20
  const user = { timezone: "Europe/Berlin", season_mode: "north" };
  assert.deepEqual(plantsDueForWatering([p1, p2, p3], user, now).map((p) => p.id), ["P2", "P3"]);
  assert.deepEqual(plantsDueForWatering([p1, p2, p3], { ...user, season_mode: "off" }, now).map((p) => p.id), ["P1", "P2", "P3"]);
});

test("only watering is adjusted: fertilize, repot and prune ignore the mode", () => {
  const p = plant("p", {
    last_watered_date: "2026-01-19",
    last_fertilized_date: "2025-12-21",
    fertilize_frequency_days: 30,
    last_repotted_date: "2025-12-20",
    repot_frequency_months: 1,
    last_pruned_date: "2025-11-20",
    prune_frequency_months: 2,
  });
  for (const season_mode of ["auto", "north", "south", "off"]) {
    const due = careDueOn(p, { timezone: "Europe/Berlin", season_mode }, "2026-01-20");
    assert.deepEqual(due, { water: false, fertilize: true, repot: true, prune: true }, season_mode);
  }
  assert.equal(careDueOn(p, { timezone: "Europe/Berlin" }, "2026-01-19").fertilize, false);
});

test("month arithmetic keeps the old setMonth overflow", () => {
  assert.equal(addMonthsToDateString("2026-01-31", 1), "2026-03-03");
  assert.equal(addMonthsToDateString("2026-11-15", 3), "2027-02-15");
});

test("invalid stored dates are never due", () => {
  const p = plant("p", { last_watered_date: "not-a-date", last_fertilized_date: "2026-02-30", fertilize_frequency_days: 1 });
  assert.equal(waterScheduleForUser(p, null), null);
  assert.deepEqual(careDueOn(p, null, "2030-01-01"), { water: false, fertilize: false, repot: false, prune: false });
});

test("plantsNeedingCare lists a plant once when several kinds are due", () => {
  const p = plant("p", { last_watered_date: "2026-01-01", last_fertilized_date: "2026-01-01", fertilize_frequency_days: 5 });
  assert.deepEqual(plantsNeedingCare([p], { timezone: "UTC", season_mode: "off" }, new Date("2026-01-20T12:00:00Z")).map((x) => x.id), ["p"]);
});
