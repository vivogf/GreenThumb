import { test } from "node:test";
import assert from "node:assert/strict";
import { inferCareEvents, type CareDates } from "./careEvents";

// Owner report (0.8.2 investigation), replayed through the rule PATCH /api/plants/:id applies today:
// storage.updatePlantForUser inserts inferCareEvents(old, patch) and never removes or moves an event.
// Real data (plant created 2026-11-10, Europe/Moscow): fertilize events 2026-11-10 and 2026-11-11 from
// card taps, then last_fertilized_date was corrected to 2026-11-01; both events stay.
// Expected model: a date correction leaves at most one event of that type, on the corrected date,
// and clearing the date leaves none. Marked todo until the journal correction is implemented.
function replay(steps: CareDates[]) {
  let plant: CareDates = { last_fertilized_date: null };
  const journal: { type: string; occurred_on: string }[] = [];
  const after: string[][] = [];
  for (const patch of steps) {
    journal.push(...inferCareEvents(plant, patch));
    plant = { ...plant, ...patch };
    after.push(journal.filter((e) => e.type === "fertilize").map((e) => e.occurred_on));
  }
  return after;
}

test(
  "accidental taps, then a backward correction, then clearing the date leave no false fertilize events",
  { todo: "0.8.2: care journal corrections (review/0.8.2-care-journal.md)" },
  () => {
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
  },
);
