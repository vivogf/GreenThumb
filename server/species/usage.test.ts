import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryUsageStore, plantNetLimits, remainingAfter, utcDay } from "./usage";

test("limits default to 450 global and 20 per user", () => {
  assert.deepEqual(plantNetLimits({}), { globalLimit: 450, userLimit: 20 });
  assert.deepEqual(plantNetLimits({ PLANTNET_DAILY_LIMIT: "3", PLANTNET_USER_DAILY_LIMIT: "2" }), { globalLimit: 3, userLimit: 2 });
  assert.deepEqual(plantNetLimits({ PLANTNET_DAILY_LIMIT: "abc", PLANTNET_USER_DAILY_LIMIT: "0" }), { globalLimit: 450, userLimit: 20 });
});

test("utcDay uses the UTC calendar day", () => {
  assert.equal(utcDay(new Date("2026-10-27T23:59:59Z")), "2026-10-27");
  assert.equal(utcDay(new Date("2026-10-28T00:00:00Z")), "2026-10-28");
});

test("remainingToday is the smaller of the user and global headroom", () => {
  assert.equal(remainingAfter({ userCount: 1, globalCount: 1 }, { userLimit: 20, globalLimit: 450 }), 19);
  assert.equal(remainingAfter({ userCount: 1, globalCount: 449 }, { userLimit: 20, globalLimit: 450 }), 1);
});

test("release gives back a reservation, removes the empty row and never goes below zero", async () => {
  const store = new MemoryUsageStore();
  const base = { day: "2026-10-27", kind: "identify" as const, userLimit: 20, globalLimit: 450 };
  await store.reserve({ ...base, userId: "7" });
  await store.reserve({ ...base, userId: "7" });
  await store.release({ day: base.day, userId: "7", kind: base.kind });
  assert.equal(store.count("2026-10-27", "7", "identify"), 1);
  await store.release({ day: base.day, userId: "7", kind: base.kind });
  assert.equal(store.count("2026-10-27", "7", "identify"), 0);
  assert.equal(store.rows.size, 0);
  await store.release({ day: base.day, userId: "7", kind: base.kind });
  assert.equal(store.count("2026-10-27", "7", "identify"), 0);
  assert.equal(store.total("2026-10-27", "identify"), 0);
});

test("folding a user keeps the day total and empties the user's rows", async () => {
  const store = new MemoryUsageStore();
  const base = { day: "2026-10-27", kind: "identify" as const, userLimit: 20, globalLimit: 450 };
  await store.reserve({ ...base, userId: "7" });
  await store.reserve({ ...base, userId: "7" });
  await store.reserve({ ...base, userId: "__deleted__" });
  await store.reserve({ ...base, userId: "8" });
  const before = store.total("2026-10-27", "identify");
  store.foldUser("7");
  assert.equal(store.count("2026-10-27", "7", "identify"), 0);
  assert.equal(store.count("2026-10-27", "__deleted__", "identify"), 3);
  assert.equal(store.total("2026-10-27", "identify"), before);
});
