import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DORMANT_MONTHS,
  SEASON_MODES,
  effectiveWaterIntervalDays,
  hemisphere,
  hemisphereForLatitude,
  isSeasonMode,
  nextWaterDue,
  type SeasonMode,
} from "./rule";

type Vector = {
  name: string;
  tz: string;
  mode: SeasonMode;
  lastWatered: string;
  baseDays: number;
  hemisphere: string;
  effectiveDays: number;
  nextDue: string;
};

// Read the shared file itself (not a copy): the KMP app runs the same bytes.
const vectors: Vector[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("./season-vectors.json", import.meta.url)), "utf8"),
);

test("vector file has at least 40 cases", () => {
  assert.ok(vectors.length >= 40, `only ${vectors.length}`);
});

for (const [i, v] of vectors.entries()) {
  test(`vector ${i}: ${v.name}`, () => {
    assert.equal(hemisphere(v.tz), v.hemisphere, "hemisphere");
    assert.equal(effectiveWaterIntervalDays(v.baseDays, v.lastWatered, v.mode, v.tz), v.effectiveDays, "effectiveDays");
    assert.equal(nextWaterDue(v.lastWatered, v.baseDays, v.mode, v.tz), v.nextDue, "nextDue");
  });
}

const zoneCases: Array<[string, string]> = [
  ["Asia/Singapore", "tropical"],
  ["Singapore", "tropical"],
  ["Africa/Nairobi", "tropical"],
  ["America/Guayaquil", "tropical"],
  ["Australia/Darwin", "tropical"],
  ["Europe/Moscow", "north"],
  ["Asia/Calcutta", "north"],
  ["US/Eastern", "north"],
  ["Atlantic/Reykjavik", "north"],
  ["Iceland", "north"],
  ["Australia/Sydney", "south"],
  ["Australia/ACT", "south"],
  ["America/Sao_Paulo", "south"],
  ["Pacific/Auckland", "south"],
  ["Antarctica/Syowa", "south"],
  ["UTC", "none"],
  ["Etc/UTC", "none"],
  ["Etc/GMT+5", "none"],
  ["GMT", "none"],
  ["", "none"],
  ["Mars/Olympus", "none"],
  ["constructor", "none"],
];
for (const [tz, expected] of zoneCases) {
  test(`hemisphere(${JSON.stringify(tz)}) is ${expected}`, () => {
    assert.equal(hemisphere(tz), expected);
  });
}

test("hemisphere(null) is none", () => {
  assert.equal(hemisphere(null), "none");
  assert.equal(hemisphere(undefined), "none");
});

test("±15° threshold", () => {
  assert.equal(hemisphereForLatitude(15), "north");
  assert.equal(hemisphereForLatitude(-15), "south");
  assert.equal(hemisphereForLatitude(14.99), "tropical");
  assert.equal(hemisphereForLatitude(-14.99), "tropical");
  assert.equal(hemisphereForLatitude(0), "tropical");
  assert.equal(hemisphereForLatitude(undefined), "none");
  assert.equal(hemisphereForLatitude(Number.NaN), "none");
});

test("dormant months: north Nov–Feb, south May–Aug", () => {
  assert.deepEqual([...DORMANT_MONTHS.north], [11, 12, 1, 2]);
  assert.deepEqual([...DORMANT_MONTHS.south], [5, 6, 7, 8]);
});

test("odd base intervals round up", () => {
  for (const [base, expected] of [[1, 2], [3, 5], [7, 11], [9, 14], [2, 3], [10, 15]]) {
    assert.equal(effectiveWaterIntervalDays(base, "2026-12-01", "north", "UTC"), expected, `base ${base}`);
  }
});

test("season comes from the last watering month, not from today", () => {
  assert.equal(nextWaterDue("2026-10-31", 7, "auto", "Europe/Moscow"), "2026-11-07");
  assert.equal(nextWaterDue("2026-11-01", 7, "auto", "Europe/Moscow"), "2026-11-12");
});

test("modes are exactly auto, north, south, off", () => {
  assert.deepEqual([...SEASON_MODES], ["auto", "north", "south", "off"]);
  for (const m of SEASON_MODES) assert.equal(isSeasonMode(m), true);
  for (const bad of ["NORTH", "winter", "", null, 5, ["north"], undefined]) assert.equal(isSeasonMode(bad), false);
});
