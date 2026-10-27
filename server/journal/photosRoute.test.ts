import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { jsonBodyParser } from "../http";
import { createTimelineHandlers, type NewTimelinePhoto, type TimelinePhotoRow, type TimelineStore } from "./photosRoute";
import type { CareEventRow } from "./eventsRoute";

const A = 1;
const B = 2;
const PLANT_A = randomUUID();
const PLANT_A2 = randomUUID();
const PLANT_B = randomUUID();
const owners = new Map([[PLANT_A, A], [PLANT_A2, A], [PLANT_B, B]]);
const BASE = "https://greenthumb.xmpp.site";
const JPEG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");

type Row = TimelinePhotoRow & { plant_id: string; user_id: string; object_key: string };
let photos: Row[];
let events: CareEventRow[];
let objects: Map<string, Buffer>;
let deletedKeys: string[];
let failInsert: boolean;
let tick: number;
let tz: string | null;
let storeConfigured: boolean;

function stamp() {
  tick += 1;
  return new Date(Date.UTC(2026, 9, 27, 0, 0, 0, tick)).toISOString().replace("Z", "000Z");
}

const store: TimelineStore = {
  async getPlantForUser(id, userId) {
    return owners.get(id) === userId ? { id } : null;
  },
  async listPhotos(plantId) {
    return photos
      .filter((p) => p.plant_id === plantId)
      .sort((a, b) => (a.taken_on === b.taken_on ? (a.created_at < b.created_at ? 1 : -1) : a.taken_on < b.taken_on ? 1 : -1))
      .map(({ id, url, taken_on, caption, created_at }) => ({ id, url, taken_on, caption, created_at }));
  },
  async insertPhotoWithEvent(plantId: string, userId: number, p: NewTimelinePhoto) {
    if (failInsert) throw new Error("db down");
    const row: Row = { id: randomUUID(), plant_id: plantId, user_id: String(userId), object_key: p.object_key, url: p.url, taken_on: p.taken_on, caption: p.caption, created_at: stamp() };
    photos.push(row);
    const event: CareEventRow = { id: randomUUID(), plant_id: plantId, user_id: String(userId), type: "photo", occurred_on: p.taken_on, note: null, photo_id: row.id, created_at: row.created_at };
    events.push(event);
    const { id, url, taken_on, caption, created_at } = row;
    return { photo: { id, url, taken_on, caption, created_at }, event };
  },
  async deletePhotoForUser(plantId, userId, photoId) {
    const row = photos.find((p) => p.id === photoId && p.plant_id === plantId && p.user_id === String(userId));
    if (!row) return null;
    photos = photos.filter((p) => p !== row);
    events = events.filter((e) => e.photo_id !== row.id);
    return { object_key: row.object_key };
  },
};

const objectStore = {
  async put(key: string, bytes: Buffer) { objects.set(key, bytes); },
  async deleteMany(keys: string[]) { for (const k of keys) { objects.delete(k); deletedKeys.push(k); } },
};

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(jsonBodyParser);
  app.use((req, _res, next) => {
    const user = req.header("x-test-user");
    (req as any).session = user ? { userId: Number(user) } : {};
    next();
  });
  const h = createTimelineHandlers({
    store,
    userTimezone: async () => tz,
    photos: () => (storeConfigured ? { store: objectStore, publicBaseUrl: BASE } : { store: null, publicBaseUrl: null }),
    now: () => new Date("2026-10-27T22:30:00Z"),
  });
  app.get("/api/plants/:id/photos", h.list);
  app.post("/api/plants/:id/photos", h.create);
  app.delete("/api/plants/:id/photos/:photoId", h.remove);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

beforeEach(() => {
  photos = [];
  events = [];
  objects = new Map();
  deletedKeys = [];
  failInsert = false;
  tick = 0;
  tz = null;
  storeConfigured = true;
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
  assert.equal((await call("GET", `/api/plants/${PLANT_A}/photos`, null)).status, 401);
  assert.equal((await call("POST", `/api/plants/${PLANT_A}/photos`, null, { photo: JPEG })).status, 401);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/photos/${randomUUID()}`, null)).status, 401);
});

test("create returns 201 with an https URL, user-local default date and one linked photo event", async () => {
  const r = await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG });
  assert.equal(r.status, 201);
  assert.match(r.json.url, /^https:\/\/greenthumb\.xmpp\.site\/photos\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(r.json.taken_on, "2026-10-28");
  assert.equal(r.json.caption, null);
  assert.equal(typeof r.json.created_at, "string");
  assert.equal(r.json.event.type, "photo");
  assert.equal(r.json.event.photo_id, r.json.id);
  assert.equal(r.json.event.occurred_on, "2026-10-28");
  assert.equal(objects.size, 1);
  assert.equal(events.length, 1);
  assert.equal([...objects.keys()][0], "p/" + r.json.url.split("/").pop());
  tz = "Pacific/Pago_Pago";
  const r2 = await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG, caption: "c", taken_on: "2026-01-02" });
  assert.equal(r2.json.taken_on, "2026-01-02");
  assert.equal(r2.json.event.occurred_on, "2026-01-02");
  assert.equal(r2.json.caption, "c");
  const r3 = await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG });
  assert.equal(r3.json.taken_on, "2026-10-27");
});

test("list is newest first by taken_on and only for that plant; empty plant gives []", async () => {
  for (const d of ["2026-03-01", "2026-05-01", "2026-01-01"]) {
    assert.equal((await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG, taken_on: d })).status, 201);
  }
  await call("POST", `/api/plants/${PLANT_B}/photos`, B, { photo: JPEG, taken_on: "2026-09-09" });
  const r = await call("GET", `/api/plants/${PLANT_A}/photos`, A);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.photos.map((p: any) => p.taken_on), ["2026-05-01", "2026-03-01", "2026-01-01"]);
  assert.deepEqual(Object.keys(r.json.photos[0]).sort(), ["caption", "created_at", "id", "taken_on", "url"]);
  assert.deepEqual((await call("GET", `/api/plants/${PLANT_A2}/photos`, A)).json, { photos: [] });
});

test("invalid input and oversized captions are 400 with no upload, row or event", async () => {
  for (const body of [
    { photo: "https://greenthumb.xmpp.site/photos/x.jpg" },
    { photo: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
    { photo: JPEG, caption: "x".repeat(301) },
    { photo: JPEG, taken_on: "nope" },
  ]) {
    const r = await call("POST", `/api/plants/${PLANT_A}/photos`, A, body);
    assert.equal(r.status, 400);
    assert.equal(typeof r.json.error, "string");
  }
  assert.equal(objects.size, 0);
  assert.equal(photos.length, 0);
  assert.equal(events.length, 0);
});

test("a failed DB insert removes the uploaded object", async () => {
  failInsert = true;
  const r = await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG });
  assert.equal(r.status, 500);
  assert.equal(objects.size, 0);
  assert.equal(deletedKeys.length, 1);
});

test("unconfigured photo storage gives 503 and writes nothing", async () => {
  storeConfigured = false;
  const r = await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG });
  assert.equal(r.status, 503);
  assert.equal(photos.length, 0);
});

test("delete gives 204 with no body and removes row, event and object; others stay", async () => {
  const keep = await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG });
  const gone = await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG });
  const goneKey = "p/" + gone.json.url.split("/").pop();
  const del = await call("DELETE", `/api/plants/${PLANT_A}/photos/${gone.json.id}`, A);
  assert.equal(del.status, 204);
  assert.equal(del.text, "");
  assert.deepEqual(photos.map((p) => p.id), [keep.json.id]);
  assert.deepEqual(events.map((e) => e.photo_id), [keep.json.id]);
  assert.equal(objects.has(goneKey), false);
  assert.equal(objects.size, 1);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/photos/${gone.json.id}`, A)).status, 404);
});

test("ownership: foreign plant, foreign photo and mismatched plant all give 404 and change nothing", async () => {
  const a = await call("POST", `/api/plants/${PLANT_A}/photos`, A, { photo: JPEG });
  const a2 = await call("POST", `/api/plants/${PLANT_A2}/photos`, A, { photo: JPEG });
  const b = await call("POST", `/api/plants/${PLANT_B}/photos`, B, { photo: JPEG });
  const missing = randomUUID();
  const gB = await call("GET", `/api/plants/${PLANT_A}/photos`, B);
  assert.equal(gB.status, 404);
  assert.deepEqual(gB.json, (await call("GET", `/api/plants/${missing}/photos`, B)).json);
  assert.equal((await call("GET", `/api/plants/not-a-uuid/photos`, A)).status, 404);
  assert.equal((await call("POST", `/api/plants/${PLANT_A}/photos`, B, { photo: JPEG })).status, 404);
  assert.equal((await call("POST", `/api/plants/${PLANT_A}/photos`, B, { photo: "bad" })).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/photos/${a.json.id}`, B)).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_B}/photos/${a.json.id}`, B)).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/photos/${b.json.id}`, A)).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/photos/${a2.json.id}`, A)).status, 404);
  assert.equal((await call("DELETE", `/api/plants/${PLANT_A}/photos/not-a-uuid`, A)).status, 404);
  assert.equal(photos.length, 3);
  assert.equal(events.length, 3);
  assert.equal(objects.size, 3);
  assert.deepEqual(deletedKeys, []);
});
