import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysToDateString } from "@shared/care/userDate";
import {
  ACHIEVEMENT_IDS,
  evaluateAchievements,
  metAchievements,
  progressFacts,
  type AchievementFacts,
} from "./achievements";
import { computeStreak, type StreakEvent } from "./streak";

const NOW = new Date("2026-06-15T09:00:00Z");
const NONE: AchievementFacts = { plantCount: 0, waterEventCount: 0, hasNote: false, hasPhoto: false, bestStreak: 0 };
const met = (over: Partial<AchievementFacts>) => metAchievements({ ...NONE, ...over });

test("achievements: the fixed list has exactly the 9 ids", () => {
  assert.deepEqual([...ACHIEVEMENT_IDS], [
    "first_plant", "plants_5", "first_water", "waterings_25", "waterings_100",
    "streak_7", "streak_30", "first_note", "first_photo",
  ]);
});

test("achievements: a new user gets 9 locked entries with null timestamps", () => {
  const r = evaluateAchievements(NONE, [], NOW);
  assert.deepEqual(r.newlyUnlocked, []);
  assert.equal(r.achievements.length, 9);
  for (const a of r.achievements) assert.deepEqual({ unlocked: a.unlocked, unlocked_at: a.unlocked_at }, { unlocked: false, unlocked_at: null });
  assert.deepEqual(r.achievements.map((a) => a.id), [...ACHIEVEMENT_IDS]);
});

test("achievements threshold: plants_5 locked at 4 plants, unlocked at 5", () => {
  assert.ok(!met({ plantCount: 4 }).includes("plants_5"));
  assert.ok(met({ plantCount: 5 }).includes("plants_5"));
  assert.ok(met({ plantCount: 1 }).includes("first_plant"));
  assert.ok(!met({ plantCount: 0 }).includes("first_plant"));
});

test("achievements threshold: waterings_25 locked at 24 water events, unlocked at 25", () => {
  assert.ok(!met({ waterEventCount: 24 }).includes("waterings_25"));
  assert.ok(met({ waterEventCount: 25 }).includes("waterings_25"));
});

test("achievements threshold: waterings_100 locked at 99 water events, unlocked at 100", () => {
  assert.ok(!met({ waterEventCount: 99 }).includes("waterings_100"));
  assert.ok(met({ waterEventCount: 100 }).includes("waterings_100"));
  assert.ok(met({ waterEventCount: 1 }).includes("first_water"));
});

test("achievements threshold: streak_7 locked at a best run of 6, unlocked at 7", () => {
  assert.ok(!met({ bestStreak: 6 }).includes("streak_7"));
  assert.ok(met({ bestStreak: 7 }).includes("streak_7"));
});

test("achievements threshold: streak_30 locked at a best run of 29, unlocked at 30", () => {
  assert.ok(!met({ bestStreak: 29 }).includes("streak_30"));
  assert.ok(met({ bestStreak: 30 }).includes("streak_30"));
});

test("achievements: streak thresholds from real streak fixtures (6/7 and 29/30 clean days)", () => {
  const user = { timezone: "UTC", season_mode: "auto" };
  const bestFor = (days: number) => {
    const first = addDaysToDateString("2026-06-15", -(days - 1));
    const p = { id: "p", created_at: `${first}T08:00:00Z`, water_frequency_days: 60, last_watered_date: first };
    return computeStreak({ plants: [p], events: [{ plant_id: "p", type: "water", occurred_on: first }], user, now: NOW }).best;
  };
  assert.equal(bestFor(6), 6);
  assert.ok(!met({ bestStreak: bestFor(6) }).includes("streak_7"));
  assert.ok(met({ bestStreak: bestFor(7) }).includes("streak_7"));
  assert.ok(!met({ bestStreak: bestFor(29) }).includes("streak_30"));
  assert.ok(met({ bestStreak: bestFor(30) }).includes("streak_30"));
});

function events(type: StreakEvent["type"], n: number): StreakEvent[] {
  return Array.from({ length: n }, (_, i) => ({ plant_id: "p", type, occurred_on: addDaysToDateString("2026-01-01", i) }));
}

test("achievements facts: only water events count toward the watering thresholds", () => {
  const nonWater = [...events("fertilize", 30), ...events("repot", 30), ...events("prune", 30), ...events("note", 30), ...events("photo", 30)];
  const facts = progressFacts({ plants: [], events: nonWater, timelinePhotoCount: 0 }, 0);
  assert.equal(facts.waterEventCount, 0);
  assert.ok(!metAchievements(facts).some((id) => id === "first_water" || id === "waterings_25" || id === "waterings_100"));
  const f25 = progressFacts({ plants: [], events: [...nonWater, ...events("water", 25)], timelinePhotoCount: 0 }, 0);
  assert.equal(f25.waterEventCount, 25);
  assert.ok(metAchievements(f25).includes("waterings_25"));
});

test("achievements facts: plants_5 counts plants that exist now", () => {
  const plant = (id: string) => ({ id, has_cover_photo: false });
  assert.equal(progressFacts({ plants: ["a", "b", "c", "d"].map(plant), events: [], timelinePhotoCount: 0 }, 0).plantCount, 4);
});

test("achievements facts: first_note from a note event; first_photo from a cover or a timeline photo", () => {
  const withNote = progressFacts({ plants: [{ id: "p", has_cover_photo: false }], events: events("note", 1), timelinePhotoCount: 0 }, 0);
  assert.ok(metAchievements(withNote).includes("first_note"));
  assert.ok(!metAchievements(withNote).includes("first_photo"));
  const cover = progressFacts({ plants: [{ id: "p", has_cover_photo: true }], events: [], timelinePhotoCount: 0 }, 0);
  assert.ok(metAchievements(cover).includes("first_photo"));
  const timeline = progressFacts({ plants: [{ id: "p", has_cover_photo: false }], events: [], timelinePhotoCount: 1 }, 0);
  assert.ok(metAchievements(timeline).includes("first_photo"));
});

test("achievements: newly met ids get the evaluation time; stored ids keep their stored unlocked_at", () => {
  const stored = [{ achievement_id: "first_plant", unlocked_at: new Date("2026-06-01T10:00:00.123Z") }];
  const r = evaluateAchievements({ ...NONE, plantCount: 1, waterEventCount: 1 }, stored, NOW);
  assert.deepEqual(r.newlyUnlocked, ["first_water"]);
  const byId = Object.fromEntries(r.achievements.map((a) => [a.id, a]));
  assert.deepEqual(byId.first_plant, { id: "first_plant", unlocked: true, unlocked_at: "2026-06-01T10:00:00.123Z" });
  assert.deepEqual(byId.first_water, { id: "first_water", unlocked: true, unlocked_at: NOW.toISOString() });
});

test("achievements never re-lock: streak_7 stays unlocked with its timestamp when the recomputed best drops below 7", () => {
  const at = new Date("2026-05-01T08:00:00Z");
  const stored = [{ achievement_id: "streak_7", unlocked_at: at }, { achievement_id: "first_plant", unlocked_at: at }];
  const r = evaluateAchievements({ ...NONE, bestStreak: 3 }, stored, NOW);
  assert.deepEqual(r.newlyUnlocked, []);
  const s7 = r.achievements.find((a) => a.id === "streak_7")!;
  assert.deepEqual(s7, { id: "streak_7", unlocked: true, unlocked_at: at.toISOString() });
  // Plants all deleted: first_plant is no longer met but stays unlocked.
  assert.equal(r.achievements.find((a) => a.id === "first_plant")!.unlocked, true);
});

test("achievements: unknown stored ids are ignored and the list stays 9 entries", () => {
  const r = evaluateAchievements(NONE, [{ achievement_id: "legacy_id", unlocked_at: new Date("2026-01-01T00:00:00Z") }], NOW);
  assert.equal(r.achievements.length, 9);
  assert.ok(r.achievements.every((a) => !a.unlocked));
});
