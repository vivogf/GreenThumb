import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryUsageStore } from "../species/usage";
import { DEFAULT_DIAGNOSIS_DAILY_LIMIT, diagnosisLimitScope, diagnosisLimits } from "./limits";

test("defaults: 10 per user, 100 per day in total", () => {
  assert.equal(DEFAULT_DIAGNOSIS_DAILY_LIMIT, 100);
  assert.deepEqual(diagnosisLimits({}), { userLimit: 10, globalLimit: 100 });
  assert.deepEqual(diagnosisLimits({ DIAGNOSIS_DAILY_LIMIT: "", DIAGNOSIS_USER_DAILY_LIMIT: " " }), { userLimit: 10, globalLimit: 100 });
  assert.deepEqual(diagnosisLimits({ DIAGNOSIS_DAILY_LIMIT: "0" }).globalLimit, 100);
  assert.deepEqual(diagnosisLimits({ DIAGNOSIS_DAILY_LIMIT: "abc" }).globalLimit, 100);
  assert.deepEqual(diagnosisLimits({ DIAGNOSIS_DAILY_LIMIT: "3", DIAGNOSIS_USER_DAILY_LIMIT: "2" }), { userLimit: 2, globalLimit: 3 });
});

test("scope: null under both limits, user before global; the user cap counts results, the global cap attempts", async () => {
  const usage = new MemoryUsageStore();
  const day = "2026-10-29";
  const limits = { userLimit: 2, globalLimit: 3 };
  assert.equal(await diagnosisLimitScope(usage, day, "1", limits), null);
  // A shown result counts twice: the user's own two, and the day's paid attempts.
  for (let i = 0; i < 2; i++) {
    await usage.recordUsage(day, "1", "diagnosis");
    await usage.recordUsage(day, "1", "diagnosis_attempt");
  }
  assert.equal(await diagnosisLimitScope(usage, day, "1", limits), "user");
  assert.equal(await diagnosisLimitScope(usage, day, "2", limits), null);
  await usage.recordUsage(day, "2", "diagnosis_attempt");
  assert.equal(await diagnosisLimitScope(usage, day, "2", limits), "global");
  assert.equal(await diagnosisLimitScope(usage, day, "1", limits), "user");
  // Another day, an identification, and a result row without an attempt never reach the global attempt count.
  await usage.recordUsage("2026-10-28", "3", "diagnosis_attempt");
  await usage.recordUsage(day, "3", "identify");
  await usage.recordUsage(day, "3", "diagnosis");
  assert.equal(await usage.usageTotal(day, "diagnosis_attempt"), 3);
  assert.equal(await diagnosisLimitScope(usage, day, "2", limits), "global");
});
