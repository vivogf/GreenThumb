import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_MAX_CHARS,
  decodeCursor,
  encodeCursor,
  inferCareEvents,
  parseEventsQuery,
  parseNoteInput,
} from "./careEvents";

const base = {
  last_watered_date: "2026-10-20",
  last_fertilized_date: null,
  last_repotted_date: "2026-01-10",
  last_pruned_date: null,
};

test("advancing last_watered_date infers one water event on the new date", () => {
  assert.deepEqual(inferCareEvents(base, { last_watered_date: "2026-10-27" }), [
    { type: "water", occurred_on: "2026-10-27" },
  ]);
});

test("same or backward care dates infer nothing", () => {
  assert.deepEqual(inferCareEvents(base, { last_watered_date: "2026-10-20" }), []);
  assert.deepEqual(inferCareEvents(base, { last_watered_date: "2026-10-19" }), []);
  assert.deepEqual(inferCareEvents(base, { last_repotted_date: "2026-01-10" }), []);
  assert.deepEqual(inferCareEvents(base, { last_repotted_date: "2025-12-31" }), []);
});

test("clearing a nullable care date infers nothing", () => {
  assert.deepEqual(inferCareEvents(base, { last_repotted_date: null }), []);
});

test("null-to-date transitions infer fertilize and prune", () => {
  assert.deepEqual(inferCareEvents(base, { last_fertilized_date: "2026-10-01", last_pruned_date: "2026-10-02" }), [
    { type: "fertilize", occurred_on: "2026-10-01" },
    { type: "prune", occurred_on: "2026-10-02" },
  ]);
});

test("a PATCH advancing several fields infers one event per advanced field", () => {
  const events = inferCareEvents(base, {
    last_watered_date: "2026-10-27",
    last_fertilized_date: "2026-10-27",
    last_repotted_date: "2026-10-27",
    last_pruned_date: "2026-10-27",
  });
  assert.deepEqual(events.map((e) => e.type), ["water", "fertilize", "repot", "prune"]);
});

test("non-care fields infer nothing", () => {
  assert.deepEqual(inferCareEvents(base, { name: "Fern", notes: "x" } as any), []);
});

test("legacy old values with a time part compare by calendar date", () => {
  const old = { ...base, last_watered_date: "2026-10-27T00:00:00.000Z" };
  assert.deepEqual(inferCareEvents(old, { last_watered_date: "2026-10-27" }), []);
  assert.equal(inferCareEvents(old, { last_watered_date: "2026-10-28" }).length, 1);
});

const NOW = new Date("2026-10-27T12:00:00Z");

test("note: one char and NOTE_MAX_CHARS chars are accepted", () => {
  const one = parseNoteInput({ type: "note", note: "a", occurred_on: "2026-10-01" }, null, NOW);
  assert.deepEqual(one, { ok: true, data: { note: "a", occurred_on: "2026-10-01" } });
  const max = parseNoteInput({ type: "note", note: "x".repeat(NOTE_MAX_CHARS) }, null, NOW);
  assert.equal(max.ok, true);
  assert.equal(NOTE_MAX_CHARS, 1000);
});

test("note: empty, blank and 1001-char notes are rejected", () => {
  for (const note of ["", "   ", "x".repeat(1001), 5, null, undefined]) {
    assert.equal(parseNoteInput({ type: "note", note }, null, NOW).ok, false, String(note).slice(0, 10));
  }
});

test("note: length counts code points like Postgres char_length", () => {
  assert.equal(parseNoteInput({ type: "note", note: "🌿".repeat(1000) }, null, NOW).ok, true);
  assert.equal(parseNoteInput({ type: "note", note: "🌿".repeat(1001) }, null, NOW).ok, false);
});

test("note: automatic types and unknown types are rejected", () => {
  for (const type of ["water", "fertilize", "repot", "prune", "photo", "other", undefined]) {
    assert.equal(parseNoteInput({ type, note: "hello" }, null, NOW).ok, false, String(type));
  }
});

test("note: omitted occurred_on is today in the user's zone (NULL -> Moscow)", () => {
  const late = new Date("2026-10-27T22:30:00Z");
  assert.deepEqual(parseNoteInput({ type: "note", note: "a" }, null, late), {
    ok: true,
    data: { note: "a", occurred_on: "2026-10-28" },
  });
  assert.deepEqual(parseNoteInput({ type: "note", note: "a" }, "Pacific/Pago_Pago", late), {
    ok: true,
    data: { note: "a", occurred_on: "2026-10-27" },
  });
  assert.deepEqual(parseNoteInput({ type: "note", note: "a", occurred_on: null }, "Pacific/Kiritimati", NOW), {
    ok: true,
    data: { note: "a", occurred_on: "2026-10-28" },
  });
});

test("note: invalid occurred_on is rejected, ISO datetimes become user-local", () => {
  assert.equal(parseNoteInput({ type: "note", note: "a", occurred_on: "2026-02-30" }, null, NOW).ok, false);
  assert.equal(parseNoteInput({ type: "note", note: "a", occurred_on: 20261027 }, null, NOW).ok, false);
  assert.deepEqual(
    parseNoteInput({ type: "note", note: "a", occurred_on: "2026-10-27T20:00:00Z" }, "Pacific/Kiritimati", NOW),
    { ok: true, data: { note: "a", occurred_on: "2026-10-28" } },
  );
});

test("note: non-object bodies are rejected", () => {
  for (const body of [null, [], "note", 1]) assert.equal(parseNoteInput(body, null, NOW).ok, false);
});

test("cursor round-trips and rejects garbage", () => {
  const key = { occurred_on: "2026-10-27", created_at: "2026-10-27T10:00:00.123456Z", id: "0b6a3a2e-8a35-4d3b-9b9e-0e8f6c1d2a3b" };
  assert.deepEqual(decodeCursor(encodeCursor(key)), key);
  assert.equal(decodeCursor("not-a-cursor"), null);
  assert.equal(decodeCursor(Buffer.from(JSON.stringify({ ...key, id: "x" })).toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from(JSON.stringify({ ...key, created_at: "now" })).toString("base64url")), null);
});

test("events query: default 50, bounds 1..100, invalid cursor rejected", () => {
  assert.deepEqual(parseEventsQuery({}), { ok: true, data: { limit: 50, before: null } });
  assert.deepEqual(parseEventsQuery({ limit: "2" }), { ok: true, data: { limit: 2, before: null } });
  for (const limit of ["0", "101", "abc", "1.5", ["1", "2"]]) {
    assert.equal(parseEventsQuery({ limit }).ok, false, String(limit));
  }
  assert.equal(parseEventsQuery({ before: "zzz" }).ok, false);
});
