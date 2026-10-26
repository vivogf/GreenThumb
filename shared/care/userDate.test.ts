import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIMEZONE,
  addDaysToDateString,
  isWaterDue,
  localDateInTz,
  localDateString,
  normalizeCareDate,
  parseCareDate,
} from "./userDate";

test("default timezone is Europe/Moscow", () => {
  assert.equal(DEFAULT_TIMEZONE, "Europe/Moscow");
});

test("localDateInTz uses the user's zone", () => {
  const t = new Date("2026-10-26T15:00:00.000Z");
  assert.equal(localDateInTz(t, "Pacific/Kiritimati"), "2026-10-27");
  assert.equal(localDateInTz(t, "Pacific/Pago_Pago"), "2026-10-26");
  assert.equal(localDateInTz(t, "UTC"), "2026-10-26");
});

test("localDateInTz falls back to Moscow for NULL and unknown zones", () => {
  const t = new Date("2026-10-26T22:30:00Z");
  assert.equal(localDateInTz(t, null), "2026-10-27");
  assert.equal(localDateInTz(t, undefined), "2026-10-27");
  assert.equal(localDateInTz(t, "Not/AZone"), "2026-10-27");
});

test("normalizeCareDate keeps a plain YYYY-MM-DD value", () => {
  assert.equal(normalizeCareDate("2026-10-26", "Pacific/Kiritimati"), "2026-10-26");
  assert.equal(normalizeCareDate("2024-02-29", null), "2024-02-29");
});

test("normalizeCareDate converts ISO datetimes to the user-local date", () => {
  assert.equal(normalizeCareDate("2026-10-26T15:00:00.000Z", "Pacific/Kiritimati"), "2026-10-27");
  assert.equal(normalizeCareDate("2026-10-26T15:00:00.000Z", "Pacific/Pago_Pago"), "2026-10-26");
  assert.equal(normalizeCareDate("2026-10-26T22:30:00Z", null), "2026-10-27");
  assert.equal(normalizeCareDate("2026-10-26T01:30:00+03:00", "UTC"), "2026-10-25");
});

test("normalizeCareDate rejects garbage and impossible dates", () => {
  for (const bad of ["", "abc", "2026-13-01", "2026-02-30", "26-10-2026", "2026-10-26T99:00:00Z", "2026-10-26 garbage"]) {
    assert.equal(normalizeCareDate(bad, null), null, bad);
  }
});

test("addDaysToDateString crosses month and year boundaries", () => {
  assert.equal(addDaysToDateString("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToDateString("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysToDateString("2026-10-26", 30), "2026-11-25");
});

test("isWaterDue compares calendar dates, legacy ISO values included", () => {
  assert.equal(isWaterDue("2026-10-19", 7, "2026-10-26"), true);
  assert.equal(isWaterDue("2026-10-20", 7, "2026-10-26"), false);
  assert.equal(isWaterDue("2026-09-26", 7, "2026-10-26"), true);
  assert.equal(isWaterDue("2026-10-19T21:00:00.000Z", 7, "2026-10-26"), true);
  assert.equal(isWaterDue("not a date", 7, "2026-10-26"), false);
});

test("localDateString formats a Date with its local fields", () => {
  const d = new Date(2026, 0, 5, 23, 59);
  assert.equal(localDateString(d), "2026-01-05");
});

test("parseCareDate reads the calendar date as a local midnight", () => {
  const d = parseCareDate("2026-10-26");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 26);
  assert.equal(d.getHours(), 0);
  const legacy = parseCareDate("2026-10-26T15:00:00.000Z");
  assert.equal(legacy.getDate(), 26);
});
