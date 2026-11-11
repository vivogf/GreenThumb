import { test } from "node:test";
import assert from "node:assert/strict";
import { lastDateAfterDelete, planCareJournal, type CareDates, type JournalEvent } from "./careEvents";

// Owner report (0.8.2): two card taps wrote fertilize events 2026-11-10 and 2026-11-11, then
// last_fertilized_date was corrected to 2026-11-01 and later cleared. A date correction must leave
// at most one event of that type, on the corrected date; clearing the date leaves none.
function replay(steps: CareDates[]) {
  let plant: CareDates = { last_fertilized_date: null };
  let journal: JournalEvent[] = [];
  let next = 0;
  const after: string[][] = [];
  for (const patch of steps) {
    const plan = planCareJournal(plant, patch, journal);
    journal = journal
      .filter((e) => !plan.remove.includes(e.id))
      .map((e) => {
        const moved = plan.move.find((m) => m.id === e.id);
        return moved ? { ...e, occurred_on: moved.occurred_on } : e;
      });
    journal.push(...plan.insert.map((e) => ({ id: `e${++next}`, ...e })));
    plant = { ...plant, ...patch };
    after.push(journal.filter((e) => e.type === "fertilize").map((e) => e.occurred_on).sort());
  }
  return after;
}

test("accidental taps, then a backward correction, then clearing the date leave no false fertilize events", () => {
  const [tap1, tap2, corrected, cleared] = replay([
    { last_fertilized_date: "2026-11-10" }, // 1. tap on the card (0.8.0: tap = today)
    { last_fertilized_date: "2026-11-11" }, // 1'. second tap the next day
    { last_fertilized_date: "2026-11-01" }, // 2. "last fertilized 10 days ago"
    { last_fertilized_date: null }, // 3. care removed together with its date
  ]);
  assert.deepEqual(tap1, ["2026-11-10"]);
  assert.deepEqual(tap2, ["2026-11-10", "2026-11-11"]);
  assert.deepEqual(corrected, ["2026-11-01"]);
  assert.deepEqual(cleared, []);
});

const ev = (id: string, type: JournalEvent["type"], occurred_on: string): JournalEvent => ({ id, type, occurred_on });

test("a backward correction onto a date that already has an event removes the later ones and moves nothing", () => {
  const plan = planCareJournal(
    { last_repotted_date: "2026-11-11" },
    { last_repotted_date: "2026-10-01" },
    [ev("old", "repot", "2026-10-01"), ev("tap", "repot", "2026-11-11")],
  );
  assert.deepEqual(plan, { insert: [], remove: ["tap"], move: [] });
});

test("a backward correction with no later event changes nothing; older events stay", () => {
  const plan = planCareJournal(
    { last_pruned_date: "2026-11-11" },
    { last_pruned_date: "2026-11-05" },
    [ev("a", "prune", "2026-09-01")],
  );
  assert.deepEqual(plan, { insert: [], remove: [], move: [] });
});

test("corrections touch only their own type; water is never corrected (Postpone moves it back)", () => {
  const events = [ev("w", "water", "2026-11-11"), ev("f", "fertilize", "2026-11-11"), ev("n", "note", "2026-11-11")];
  const plan = planCareJournal(
    { last_watered_date: "2026-11-11", last_fertilized_date: "2026-11-11" },
    { last_watered_date: "2026-11-01", last_fertilized_date: null },
    events,
  );
  assert.deepEqual(plan, { insert: [], remove: ["f"], move: [] });
});

test("forward moves still record one event and keep the earlier ones", () => {
  const plan = planCareJournal(
    { last_fertilized_date: "2026-10-01" },
    { last_fertilized_date: "2026-11-11" },
    [ev("a", "fertilize", "2026-10-01")],
  );
  assert.deepEqual(plan, { insert: [{ type: "fertilize", occurred_on: "2026-11-11" }], remove: [], move: [] });
});

test("deleting the event that holds the current date falls back to the newest remaining one, else null", () => {
  assert.equal(lastDateAfterDelete("fertilize", "2026-11-11", "2026-11-11", ["2026-10-01", "2026-09-01"]), "2026-10-01");
  assert.equal(lastDateAfterDelete("fertilize", "2026-11-11", "2026-11-11", []), null);
  // Another event on the same day keeps the date.
  assert.equal(lastDateAfterDelete("repot", "2026-11-11", "2026-11-11", ["2026-11-11"]), "2026-11-11");
});

test("deleting an event that does not hold the current date leaves the date; water and notes never move a date", () => {
  // The owner's case: date corrected to 11-01, stray events 11-10 and 11-11.
  assert.equal(lastDateAfterDelete("fertilize", "2026-11-11", "2026-11-01", ["2026-11-10"]), undefined);
  assert.equal(lastDateAfterDelete("water", "2026-11-11", "2026-11-11", []), undefined);
  assert.equal(lastDateAfterDelete("note", "2026-11-11", null, []), undefined);
});
