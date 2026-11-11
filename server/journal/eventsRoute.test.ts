import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { jsonBodyParser } from "../http";
import { createJournalHandlers, type CareEventRow, type JournalStore } from "./eventsRoute";
import { CARE_DATE_FIELDS, lastDateAfterDelete, type CursorKey } from "./careEvents";

const A = 1;
const B = 2;
const PLANT_A = randomUUID();
const PLANT_A2 = randomUUID();
const PLANT_B = randomUUID();
const owners = new Map([[PLANT_A, A], [PLANT_A2, A], [PLANT_B, B]]);

let rows: CareEventRow[];
const dates = new Map<string, Record<string, string | null>>();
let tick: number;

function keyOf(r: CareEventRow): CursorKey {
  return { occurred_on: r.occurred_on, created_at: r.created_at, id: r.id };
}
function cmpDesc(a: CursorKey, b: CursorKey): number {
  for (const f of ["occurred_on", "created_at", "id"] as const) {
    if (a[f] !== b[f]) return a[f] < b[f] ? 1 : -1;
  }
  return 0;
}

const store: JournalStore = {
  async getPlantForUser(id, userId) {
    return owners.get(id) === userId ? { id } : null;
  },
  async listEvents(plantId, limit, beforeKey) {
    return rows
      .filter((r) => r.plant_id === plantId)
      .filter((r) => !beforeKey || cmpDesc(keyOf(r), beforeKey) > 0)
      .sort((a, b) => cmpDesc(keyOf(a), keyOf(b)))
      .slice(0, limit);
  },
  async insertNote(plantId, userId, note, occurredOn) {
    const row = seed(plantId, userId, "note", occurredOn, note);
    return row;
  },
  async deleteEvent(plantId, userId, eventId) {
    const row = rows.find((r) => r.id === eventId && r.plant_id === plantId && r.user_id === String(userId));
    if (!row) return { status: "missing" };
    if (row.type === "photo") return { status: "photo" };
    rows = rows.filter((r) => r !== row);
    if (row.type === "note") return { status: "deleted", plant: null };
    const plant = { id: plantId, ...(dates.get(plantId) ?? {}) } as Record<string, string | null>;
    const field = CARE_DATE_FIELDS[row.type];
    const remaining = rows.filter((r) => r.plant_id === plantId && r.type === row.type).map((r) => r.occurred_on);
    const next = lastDateAfterDelete(row.type, row.occurred_on, plant[field] ?? null, remaining);
    if (next !== undefined) plant[field] = next;
    return { status: "deleted", plant };
  },
};

function seed(plantId: string, userId: number, type: CareEventRow["type"], occurred_on: string, note: string | null = null) {
  tick += 1;
  const row: CareEventRow = {
    id: randomUUID(),
    plant_id: plantId,
    user_id: String(userId),
    type,
    occurred_on,
    note,
    photo_id: null,
    created_at: new Date(Date.UTC(2026, 9, 27, 0, 0, 0, tick)).toISOString().replace("Z", "000Z"),
  };
  rows.push(row);
  return row;
}

let server: Server;
let base: string;
let tz: string | null;

before(async () => {
  const app = express();
  app.use(jsonBodyParser);
  app.use((req, _res, next) => {
    const user = req.header("x-test-user");
    (req as any).session = user ? { userId: Number(user) } : {};
    next();
  });
  const h = createJournalHandlers({ store, userTimezone: async () => tz, now: () => new Date("2026-10-27T22:30:00Z") });
  app.get("/api/plants/:id/events", h.list);
  app.post("/api/plants/:id/events", h.createNote);
  app.delete("/api/plants/:id/events/:eventId", h.remove);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

beforeEach(() => {
  rows = [];
  dates.clear();
  tick = 0;
  tz = null;
});

async function call(method: string, path: string, user: number | null, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": String(user) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

test("all routes require a session", async () => {
  assert.equal((await call("GET", `/api/plants/${PLANT_A}/events`, null)).status, 401);
  assert.equal((await call("POST", `/api/plants/${PLANT_A}/events`, null, { type: "note", note: "a" })).status, 401);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/events/${randomUUID()}`, null)).status, 401);
});

test("empty plant returns an empty list and a null cursor", async () => {
  const r = await call("GET", `/api/plants/${PLANT_A}/events`, A);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { events: [], nextCursor: null });
});

test("pagination is newest first and visits every event exactly once", async () => {
  const days = ["2026-10-01", "2026-10-05", "2026-10-05", "2026-10-05", "2026-10-09"];
  for (let i = 0; i < 55; i += 1) seed(PLANT_A, A, i % 2 ? "water" : "note", days[i % days.length], "n");
  seed(PLANT_A2, A, "water", "2026-10-30");
  const def = await call("GET", `/api/plants/${PLANT_A}/events`, A);
  assert.equal(def.json.events.length, 50);
  assert.equal(typeof def.json.nextCursor, "string");

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const q = cursor ? `?limit=2&before=${encodeURIComponent(cursor)}` : "?limit=2";
    const page = await call("GET", `/api/plants/${PLANT_A}/events${q}`, A);
    assert.equal(page.status, 200);
    assert.ok(page.json.events.length <= 2);
    seen.push(...page.json.events.map((e: CareEventRow) => e.id));
    cursor = page.json.nextCursor;
    pages += 1;
  } while (cursor && pages < 100);
  assert.equal(cursor, null);
  const expected = rows
    .filter((r) => r.plant_id === PLANT_A)
    .sort((a, b) => cmpDesc(keyOf(a), keyOf(b)))
    .map((r) => r.id);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, 55);
});

test("bad limit or cursor is a 400", async () => {
  assert.equal((await call("GET", `/api/plants/${PLANT_A}/events?limit=0`, A)).status, 400);
  assert.equal((await call("GET", `/api/plants/${PLANT_A}/events?before=garbage`, A)).status, 400);
});

test("note creation returns 201 with the persisted note; omitted date is user-local today", async () => {
  const r = await call("POST", `/api/plants/${PLANT_A}/events`, A, { type: "note", note: "hello" });
  assert.equal(r.status, 201);
  assert.equal(r.json.type, "note");
  assert.equal(r.json.note, "hello");
  assert.equal(r.json.plant_id, PLANT_A);
  assert.equal(r.json.user_id, String(A));
  assert.equal(r.json.occurred_on, "2026-10-28");
  tz = "Pacific/Pago_Pago";
  const r2 = await call("POST", `/api/plants/${PLANT_A}/events`, A, { type: "note", note: "x".repeat(1000) });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.occurred_on, "2026-10-27");
  const list = await call("GET", `/api/plants/${PLANT_A}/events`, A);
  assert.deepEqual(new Set(list.json.events.map((e: CareEventRow) => e.id)), new Set([r.json.id, r2.json.id]));
});

test("invalid notes and automatic types are rejected without changes", async () => {
  for (const body of [
    { type: "note", note: "" },
    { type: "note", note: "x".repeat(1001) },
    { type: "water", note: "a" },
    { type: "photo", note: "a" },
  ]) {
    const r = await call("POST", `/api/plants/${PLANT_A}/events`, A, body);
    assert.equal(r.status, 400);
  }
  assert.equal(rows.length, 0);
});

test("note and care entries can be deleted; a note gives 204, a care entry 200 with the plant", async () => {
  const note = seed(PLANT_A, A, "note", "2026-10-01", "n");
  const water = seed(PLANT_A, A, "water", "2026-10-01");
  const older = seed(PLANT_A, A, "fertilize", "2026-10-01");
  const tap = seed(PLANT_A, A, "fertilize", "2026-11-11");
  dates.set(PLANT_A, { last_watered_date: "2026-10-01", last_fertilized_date: "2026-11-11" });
  const del = await call("DELETE", `/api/plants/${PLANT_A}/events/${note.id}`, A);
  assert.equal(del.status, 204);
  assert.equal(del.text, "");
  const care = await call("DELETE", `/api/plants/${PLANT_A}/events/${tap.id}`, A);
  assert.equal(care.status, 200);
  assert.equal(care.json.id, PLANT_A);
  assert.equal(care.json.last_fertilized_date, "2026-10-01");
  const watered = await call("DELETE", `/api/plants/${PLANT_A}/events/${water.id}`, A);
  assert.equal(watered.status, 200);
  assert.equal(watered.json.last_watered_date, "2026-10-01");
  assert.deepEqual(rows.map((r) => r.id), [older.id]);
});

test("a photo entry is deleted with its photo, not through the journal", async () => {
  const photo = seed(PLANT_A, A, "photo", "2026-10-01");
  const r = await call("DELETE", `/api/plants/${PLANT_A}/events/${photo.id}`, A);
  assert.equal(r.status, 409);
  assert.deepEqual(rows.map((x) => x.id), [photo.id]);
});
test("ownership: foreign plant, foreign event and mismatched plant all give 404", async () => {
  const aEvent = seed(PLANT_A, A, "note", "2026-10-01", "secret");
  const aOther = seed(PLANT_A2, A, "note", "2026-10-01", "other");
  const bEvent = seed(PLANT_B, B, "note", "2026-10-01", "b");
  const missing = randomUUID();
  const gB = await call("GET", `/api/plants/${PLANT_A}/events`, B);
  const gMissing = await call("GET", `/api/plants/${missing}/events`, B);
  assert.equal(gB.status, 404);
  assert.deepEqual(gB.json, gMissing.json);
  assert.equal((await call("GET", `/api/plants/not-a-uuid/events`, B)).status, 404);
  assert.equal((await call("POST", `/api/plants/${PLANT_A}/events`, B, { type: "note", note: "a" })).status, 404);
  assert.equal((await call("POST", `/api/plants/${PLANT_A}/events`, B, { type: "note", note: "" })).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/events/${aEvent.id}`, B)).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_B}/events/${aEvent.id}`, B)).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/events/${bEvent.id}`, A)).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/events/${aOther.id}`, A)).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/events/not-a-uuid`, A)).status, 404);
  assert.equal(rows.length, 3);
});
