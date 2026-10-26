import { test } from "node:test";
import assert from "node:assert/strict";
import { ru } from "date-fns/locale";
import {
  calendarDaysFrom,
  careDayLabel,
  formatCareDate,
  nextCareDateByDays,
  nextCareDateByMonths,
} from "./dayLabel";
import { localDateString, parseCareDate } from "./userDate";

const fixtures = {
  today: "2026-10-26",
  yesterday: "2026-10-25",
  fiveAgo: "2026-10-21",
  inThree: "2026-10-29",
};

// "now" near both ends of the local day; hour-based maths breaks at these.
for (const [label, hour, minute] of [
  ["00:30", 0, 30],
  ["12:00", 12, 0],
  ["23:30", 23, 30],
] as const) {
  test(`labels by calendar day with now at ${label} local`, () => {
    const now = new Date(2026, 9, 26, hour, minute);
    const today = localDateString(now);
    assert.equal(today, "2026-10-26");
    assert.deepEqual(careDayLabel(fixtures.today, today), { key: "today" });
    assert.deepEqual(careDayLabel(fixtures.yesterday, today), { key: "yesterday" });
    assert.deepEqual(careDayLabel(fixtures.fiveAgo, today), { key: "daysAgo", count: 5 });
    assert.deepEqual(careDayLabel(fixtures.inThree, today), { key: "inDays", count: 3 });
    assert.deepEqual(careDayLabel("2026-10-27", today), { key: "tomorrow" });
  });
}

test("accepts ISO datetimes by their date part", () => {
  assert.deepEqual(careDayLabel("2026-10-23T00:00:00.000Z", "2026-10-26"), { key: "daysAgo", count: 3 });
});

test("counts across month, year and DST boundaries", () => {
  assert.equal(calendarDaysFrom("2026-10-30", "2026-11-02"), 3);
  assert.equal(calendarDaysFrom("2026-12-31", "2027-01-01"), 1);
  assert.equal(calendarDaysFrom("2026-03-07", "2026-03-09"), 2);
  assert.equal(calendarDaysFrom("2026-03-28", "2026-03-30"), 2);
});

test("next care dates stay calendar days", () => {
  assert.equal(nextCareDateByDays("2026-10-26", 7), "2026-11-02");
  assert.equal(nextCareDateByDays("2026-10-23", 7), "2026-10-30");
  assert.equal(nextCareDateByMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(nextCareDateByMonths("2026-10-26", 3), "2027-01-26");
});

test("absolute label keeps the stored day", () => {
  for (const d of Object.values(fixtures)) {
    assert.equal(localDateString(parseCareDate(d)), d);
  }
  assert.equal(formatCareDate(fixtures.today), "October 26th, 2026");
  assert.equal(formatCareDate(fixtures.yesterday), "October 25th, 2026");
  assert.equal(formatCareDate(fixtures.fiveAgo), "October 21st, 2026");
  assert.equal(formatCareDate(fixtures.inThree), "October 29th, 2026");
  assert.equal(formatCareDate(fixtures.today, ru), "26 октября 2026 г.");
});
