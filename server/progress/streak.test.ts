import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysToDateString } from "@shared/care/userDate";
import { computeStreak, type StreakEvent, type StreakPlant } from "./streak";

// Fixed "now": 2026-06-15 09:00 UTC. In UTC the user's today is 2026-06-15.
const NOW = new Date("2026-06-15T09:00:00Z");
const TODAY = "2026-06-15";
const UTC = { timezone: "UTC", season_mode: "auto" };
const d = (daysAgo: number) => addDaysToDateString(TODAY, -daysAgo);

function plant(id: string, over: Partial<StreakPlant> = {}): StreakPlant {
  return { id, created_at: `${d(60)}T08:00:00.000000Z`, water_frequency_days: 7, last_watered_date: d(60), ...over };
}
function water(plant_id: string, occurred_on: string): StreakEvent {
  return { plant_id, type: "water", occurred_on };
}
function ev(plant_id: string, type: StreakEvent["type"], occurred_on: string): StreakEvent {
  return { plant_id, type, occurred_on };
}

test("streak: no care events gives 0/0, with or without plants", () => {
  assert.deepEqual(computeStreak({ plants: [], events: [], user: UTC, now: NOW }), { current: 0, best: 0 });
  const p = plant("p", { last_watered_date: d(1), water_frequency_days: 30 });
  assert.deepEqual(computeStreak({ plants: [p], events: [], user: UTC, now: NOW }), { current: 0, best: 0 });
});

test("streak: counting starts at the first care event; 4 clean days and a plant due today give current 5", () => {
  // Created 20 days ago and never overdue, but only days from the first event (4 days ago) count.
  const p = plant("p", { created_at: `${d(20)}T08:00:00Z`, last_watered_date: d(4), water_frequency_days: 4 });
  const r = computeStreak({ plants: [p], events: [water("p", d(4))], user: UTC, now: NOW });
  assert.deepEqual(r, { current: 5, best: 5 });
});

test("streak: a plant overdue since yesterday gives current 0", () => {
  // Watered 5 days ago, interval 3: due 2 days ago, overdue yesterday and today.
  const p = plant("p", { last_watered_date: d(5), water_frequency_days: 3 });
  const r = computeStreak({ plants: [p], events: [water("p", d(5))], user: UTC, now: NOW });
  assert.deepEqual(r, { current: 0, best: 4 });
});

test("streak: a plant due later today is not overdue yet at request time, so today counts", () => {
  // America/Los_Angeles: 2026-06-16T06:30Z is 2026-06-15 23:30 local; the plant is due on 2026-06-15.
  const la = { timezone: "America/Los_Angeles", season_mode: "auto" };
  const p = plant("p", { created_at: "2026-06-10T20:00:00Z", last_watered_date: "2026-06-10", water_frequency_days: 5 });
  const events = [water("p", "2026-06-10")];
  assert.deepEqual(computeStreak({ plants: [p], events, user: la, now: new Date("2026-06-16T06:30:00Z") }), { current: 6, best: 6 });
  // An hour later the local date is 2026-06-16 and the plant is overdue.
  assert.deepEqual(computeStreak({ plants: [p], events, user: la, now: new Date("2026-06-16T07:30:00Z") }), { current: 0, best: 6 });
});

test("streak: an overdue run breaks current, best keeps the longest run, late watering does not clean past days", () => {
  // Interval 9 from the first watering 20 days ago: due d(11), overdue d(10)..d(3); watered late at d(2).
  const p = plant("p", { last_watered_date: d(2), water_frequency_days: 9 });
  const r = computeStreak({ plants: [p], events: [water("p", d(20)), water("p", d(2))], user: UTC, now: NOW });
  assert.deepEqual(r, { current: 3, best: 10 });
});

test("streak: gap days without any care event stay clean when nothing is overdue", () => {
  const p = plant("p", { last_watered_date: d(6), water_frequency_days: 30 });
  assert.deepEqual(computeStreak({ plants: [p], events: [water("p", d(6))], user: UTC, now: NOW }), { current: 7, best: 7 });
});

test("streak: non-water events start the count but never reset a plant's watering clock", () => {
  // Fertilizing does not water: interval 5 from d(10) → due d(5), overdue d(4)..today.
  const p = plant("p", { last_watered_date: d(10), water_frequency_days: 5 });
  const events = [water("p", d(10)), ev("p", "fertilize", d(5)), ev("p", "note", d(3)), ev("p", "photo", d(1))];
  assert.deepEqual(computeStreak({ plants: [p], events, user: UTC, now: NOW }), { current: 0, best: 6 });
});

// Season rule (shared/season): base 10, watered 2025-12-01 and 2025-12-15, now 2025-12-20.
function seasonFixture(user: { timezone: string | null; season_mode: string }) {
  const p = plant("p", { created_at: "2025-12-01T06:00:00Z", last_watered_date: "2025-12-15", water_frequency_days: 10 });
  const events = [water("p", "2025-12-01"), water("p", "2025-12-15")];
  return computeStreak({ plants: [p], events, user, now: new Date("2025-12-20T09:00:00Z") });
}

test("streak season: dormant December in Europe/Moscow (auto) uses ceil(10 × 1.5) = 15, so no day breaks", () => {
  assert.deepEqual(seasonFixture({ timezone: "Europe/Moscow", season_mode: "auto" }), { current: 20, best: 20 });
  assert.deepEqual(seasonFixture({ timezone: "Europe/Moscow", season_mode: "north" }), { current: 20, best: 20 });
});

test("streak season: mode off uses the base 10, so 2025-12-12..14 are overdue", () => {
  // Clean 2025-12-01..11 (11 days), break 12..14, clean 15..20 (6 days).
  assert.deepEqual(seasonFixture({ timezone: "Europe/Moscow", season_mode: "off" }), { current: 6, best: 11 });
  // South hemisphere: December is not dormant there.
  assert.deepEqual(seasonFixture({ timezone: "Europe/Moscow", season_mode: "south" }), { current: 6, best: 11 });
});

test("streak season: tropical and UTC zones keep the base interval", () => {
  assert.deepEqual(seasonFixture({ timezone: "Asia/Singapore", season_mode: "auto" }), { current: 6, best: 11 });
  assert.deepEqual(seasonFixture({ timezone: "UTC", season_mode: "auto" }), { current: 6, best: 11 });
});

test("streak timezone: the same instant is a different local date in Pacific/Auckland and America/Los_Angeles", () => {
  // 2026-06-15T12:30Z = 2026-06-16 00:30 in Auckland, 2026-06-15 05:30 in Los Angeles.
  const instant = new Date("2026-06-15T12:30:00Z");
  const p = plant("p", { created_at: "2026-06-09T12:00:00Z", last_watered_date: "2026-06-10", water_frequency_days: 5 });
  const events = [water("p", "2026-06-10")];
  // Mode off: June is dormant in the south, and this test is about the date boundary only.
  const la = computeStreak({ plants: [p], events, user: { timezone: "America/Los_Angeles", season_mode: "off" }, now: instant });
  const akl = computeStreak({ plants: [p], events, user: { timezone: "Pacific/Auckland", season_mode: "off" }, now: instant });
  assert.deepEqual(la, { current: 6, best: 6 });
  assert.deepEqual(akl, { current: 0, best: 6 });
});

test("streak timezone: NULL timezone is evaluated in Europe/Moscow", () => {
  // 2026-06-15T22:30Z is 2026-06-16 in Moscow and 2026-06-15 in UTC.
  const instant = new Date("2026-06-15T22:30:00Z");
  const p = plant("p", { created_at: "2026-06-09T12:00:00Z", last_watered_date: "2026-06-10", water_frequency_days: 5 });
  const events = [water("p", "2026-06-10")];
  const nullTz = computeStreak({ plants: [p], events, user: { timezone: null, season_mode: "auto" }, now: instant });
  const moscow = computeStreak({ plants: [p], events, user: { timezone: "Europe/Moscow", season_mode: "auto" }, now: instant });
  const utc = computeStreak({ plants: [p], events, user: { timezone: "UTC", season_mode: "auto" }, now: instant });
  assert.deepEqual(nullTz, { current: 0, best: 6 });
  assert.deepEqual(nullTz, moscow);
  assert.deepEqual(utc, { current: 6, best: 6 });
  assert.deepEqual(computeStreak({ plants: [p], events, user: null, now: instant }), moscow);
});

test("streak timezone: occurred_on is a local calendar date with no UTC shift", () => {
  // Auckland today = 2026-06-16; first event 2026-06-11 → exactly 6 counted days.
  const instant = new Date("2026-06-15T12:30:00Z");
  const p = plant("p", { created_at: "2026-06-01T00:00:00Z", last_watered_date: "2026-06-11", water_frequency_days: 30 });
  const r = computeStreak({ plants: [p], events: [water("p", "2026-06-11")], user: { timezone: "Pacific/Auckland", season_mode: "auto" }, now: instant });
  assert.deepEqual(r, { current: 6, best: 6 });
});

test("streak anchor: a plant is never overdue before its creation date", () => {
  // Plant b was created 3 days ago with a stale last watering (40 days ago, interval 7): overdue from its creation day only.
  const a = plant("a", { last_watered_date: d(10), water_frequency_days: 30 });
  const b = plant("b", { created_at: `${d(3)}T10:00:00Z`, last_watered_date: d(40), water_frequency_days: 7 });
  const r = computeStreak({ plants: [a, b], events: [water("a", d(10))], user: UTC, now: NOW });
  assert.deepEqual(r, { current: 0, best: 7 });
});

test("streak anchor: the current last_watered_date counts as an implicit watering when no water event matches it", () => {
  // Pre-M4 data: last watered 3 days ago, interval 7, no water events; a note 5 days ago starts the count.
  const p = plant("p", { created_at: `${d(20)}T10:00:00Z`, last_watered_date: d(3), water_frequency_days: 7 });
  const r = computeStreak({ plants: [p], events: [ev("p", "note", d(5))], user: UTC, now: NOW });
  // From creation (d(20)) the plant would be due d(13) without the implicit watering; with it, nothing is overdue
  // after d(3). Days d(5) and d(4) are still overdue (the only known watering before them is the creation anchor).
  assert.deepEqual(r, { current: 4, best: 4 });
});

test("streak anchor: with no watering before a day, the creation date is the reference", () => {
  // Created 6 days ago, interval 7; its only watering is in the future of every counted day except today.
  const p = plant("p", { created_at: `${d(6)}T10:00:00Z`, last_watered_date: d(0), water_frequency_days: 7 });
  const r = computeStreak({ plants: [p], events: [ev("p", "note", d(6)), water("p", d(0))], user: UTC, now: NOW });
  assert.deepEqual(r, { current: 7, best: 7 });
});

test("streak anchor: a second plant created mid-run and watered on time keeps a 10-day run unbroken", () => {
  const a = plant("a", { last_watered_date: d(9), water_frequency_days: 30 });
  const b = plant("b", { created_at: `${d(5)}T10:00:00Z`, last_watered_date: d(2), water_frequency_days: 3 });
  const events = [water("a", d(9)), water("b", d(5)), water("b", d(2))];
  assert.deepEqual(computeStreak({ plants: [a, b], events, user: UTC, now: NOW }), { current: 10, best: 10 });
});

test("streak best is recomputed: another plant's overdue days inside a 31-day run of plant X lower best", () => {
  const x = plant("x", { last_watered_date: d(30), water_frequency_days: 60 });
  const y = plant("y", { created_at: `${d(30)}T10:00:00Z`, last_watered_date: d(0), water_frequency_days: 5 });
  // y: created and watered d(30), due d(25), overdue d(24)..d(16), then watered every 5 days from d(15).
  const eventsXY = [water("x", d(30)), water("y", d(30)), water("y", d(15)), water("y", d(10)), water("y", d(5)), water("y", d(0))];
  assert.deepEqual(computeStreak({ plants: [x], events: [water("x", d(30))], user: UTC, now: NOW }), { current: 31, best: 31 });
  assert.deepEqual(computeStreak({ plants: [x, y], events: eventsXY, user: UTC, now: NOW }), { current: 16, best: 16 });
});

test("streak best is recomputed: deleting the plant with the first care event drops best", () => {
  const p = plant("p", { last_watered_date: d(20), water_frequency_days: 60 });
  const q = plant("q", { last_watered_date: d(5), water_frequency_days: 60 });
  const both = computeStreak({ plants: [p, q], events: [water("p", d(20)), water("q", d(5))], user: UTC, now: NOW });
  assert.deepEqual(both, { current: 21, best: 21 });
  // A deleted plant contributes nothing: its row and its events are gone.
  const afterDelete = computeStreak({ plants: [q], events: [water("q", d(5))], user: UTC, now: NOW });
  assert.deepEqual(afterDelete, { current: 6, best: 6 });
});

test("streak: invalid stored values never throw and never count as overdue", () => {
  const p = plant("p", { last_watered_date: "not-a-date", water_frequency_days: 0 });
  const r = computeStreak({ plants: [p], events: [ev("p", "note", d(2)), water("p", "garbage")], user: UTC, now: NOW });
  assert.deepEqual(r, { current: 3, best: 3 });
});
