import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlantCreate, parsePlantPatch } from "./plantInput";

const KIRITIMATI = "Pacific/Kiritimati";

function ok<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  assert.equal(r.ok, true, r.ok ? "" : (r as any).error);
  return (r as { ok: true; data: T }).data;
}

function bad(r: { ok: boolean; error?: string }) {
  assert.equal(r.ok, false);
  assert.equal(typeof (r as any).error, "string");
}

const validCreate = {
  name: "Fern",
  location: "Kitchen",
  photo_url: "",
  water_frequency_days: 7,
  last_watered_date: "2026-10-20",
};

test("PATCH strips id, user_id, created_at and unknown keys", () => {
  const data = ok(parsePlantPatch({
    name: "ok",
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "42",
    created_at: "2000-01-01T00:00:00Z",
    is_admin: true,
    foo: { bar: 1 },
    recovery_key: "x",
  }, null));
  assert.deepEqual(data, { name: "ok" });
});

test("PATCH rejects wrong types", () => {
  bad(parsePlantPatch({ water_frequency_days: "abc" }, null));
  bad(parsePlantPatch({ name: 123 }, null));
  bad(parsePlantPatch({ last_watered_date: 42 }, null));
  bad(parsePlantPatch({ notes: ["x"] }, null));
  bad(parsePlantPatch(null, null));
  bad(parsePlantPatch([], null));
});

test("water_frequency_days accepts integers 1..365 only", () => {
  for (const v of [0, 366, -1, 1.5]) bad(parsePlantPatch({ water_frequency_days: v }, null));
  assert.deepEqual(ok(parsePlantPatch({ water_frequency_days: 1 }, null)), { water_frequency_days: 1 });
  assert.deepEqual(ok(parsePlantPatch({ water_frequency_days: 365 }, null)), { water_frequency_days: 365 });
  bad(parsePlantCreate({ ...validCreate, water_frequency_days: 0 }, null));
  bad(parsePlantCreate({ ...validCreate, water_frequency_days: 366 }, null));
  assert.equal(ok(parsePlantCreate({ ...validCreate, water_frequency_days: 365 }, null)).water_frequency_days, 365);
});

test("PATCH converts ISO care dates to the user-local date", () => {
  const iso = "2026-10-26T15:00:00.000Z";
  const data = ok(parsePlantPatch({
    last_watered_date: iso,
    last_fertilized_date: iso,
    last_repotted_date: iso,
    last_pruned_date: iso,
  }, KIRITIMATI));
  assert.deepEqual(data, {
    last_watered_date: "2026-10-27",
    last_fertilized_date: "2026-10-27",
    last_repotted_date: "2026-10-27",
    last_pruned_date: "2026-10-27",
  });
  assert.equal(ok(parsePlantPatch({ last_watered_date: "2026-10-26T22:30:00Z" }, null)).last_watered_date, "2026-10-27");
  assert.equal(ok(parsePlantPatch({ last_watered_date: "2026-10-26" }, KIRITIMATI)).last_watered_date, "2026-10-26");
});

test("PATCH rejects malformed care dates and a null last_watered_date", () => {
  bad(parsePlantPatch({ last_watered_date: "yesterday" }, null));
  bad(parsePlantPatch({ last_fertilized_date: "2026-02-30" }, null));
  bad(parsePlantPatch({ last_watered_date: null }, null));
});

test("PATCH clears optional care fields with null", () => {
  assert.deepEqual(ok(parsePlantPatch({
    fertilize_frequency_days: null,
    last_fertilized_date: null,
    repot_frequency_months: null,
    last_repotted_date: null,
    prune_frequency_months: null,
    last_pruned_date: null,
  }, null)), {
    fertilize_frequency_days: null,
    last_fertilized_date: null,
    repot_frequency_months: null,
    last_repotted_date: null,
    prune_frequency_months: null,
    last_pruned_date: null,
  });
});

test("PATCH stores a null photo_url as an empty string", () => {
  assert.deepEqual(ok(parsePlantPatch({ photo_url: null }, null)), { photo_url: "" });
});

test("PATCH rejects an empty name", () => {
  bad(parsePlantPatch({ name: "" }, null));
});

test("POST ignores id, user_id and created_at and normalizes ISO dates", () => {
  const data = ok(parsePlantCreate({
    ...validCreate,
    id: "22222222-2222-4222-8222-222222222222",
    user_id: "99",
    created_at: "2000-01-01T00:00:00Z",
    last_watered_date: "2026-10-26T15:00:00.000Z",
  }, KIRITIMATI));
  assert.equal("id" in data, false);
  assert.equal("user_id" in data, false);
  assert.equal("created_at" in data, false);
  assert.equal(data.last_watered_date, "2026-10-27");
  assert.equal(data.notes, "");
});

test("POST requires name and last_watered_date, defaults photo_url and location", () => {
  bad(parsePlantCreate({ ...validCreate, name: undefined }, null));
  bad(parsePlantCreate({ ...validCreate, last_watered_date: undefined }, null));
  const data = ok(parsePlantCreate({ name: "x", water_frequency_days: 3, last_watered_date: "2026-10-01", photo_url: null }, null));
  assert.equal(data.photo_url, "");
  assert.equal(data.location, "");
});
