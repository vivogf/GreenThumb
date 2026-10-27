import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { createProgressHandler, type ProgressData, type ProgressStore } from "./route";
import type { StoredAchievement } from "./achievements";

const A = 1;
const B = 2;
let clock: Date;
let data: Map<number, Omit<ProgressData, "achievements">>;
let rows: { user_id: number; achievement_id: string; unlocked_at: Date }[];

const store: ProgressStore = {
  async getProgressData(userId) {
    const d = data.get(userId);
    if (!d) return null;
    const achievements: StoredAchievement[] = rows
      .filter((r) => r.user_id === userId)
      .map((r) => ({ achievement_id: r.achievement_id, unlocked_at: r.unlocked_at }));
    return { ...d, achievements };
  },
  async unlockAchievements(userId, ids, at) {
    await new Promise((r) => setTimeout(r, 1));
    for (const id of ids) {
      // Same semantics as INSERT ... ON CONFLICT DO NOTHING.
      if (!rows.some((r) => r.user_id === userId && r.achievement_id === id)) rows.push({ user_id: userId, achievement_id: id, unlocked_at: at });
    }
    return rows.filter((r) => r.user_id === userId).map((r) => ({ achievement_id: r.achievement_id, unlocked_at: r.unlocked_at }));
  },
};

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    const user = req.header("x-test-user");
    (req as any).session = user ? { userId: Number(user) } : {};
    next();
  });
  app.get("/api/progress", createProgressHandler({ store, now: () => clock }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const EMPTY = { user: { timezone: "UTC", season_mode: "auto" }, plants: [], events: [], timelinePhotoCount: 0 };

beforeEach(() => {
  clock = new Date("2026-06-15T09:00:00Z");
  rows = [];
  data = new Map([[A, structuredClone(EMPTY)], [B, structuredClone(EMPTY)]]);
});

async function get(user: number | null, query = "") {
  const res = await fetch(`${base}/api/progress${query}`, { headers: user ? { "x-test-user": String(user) } : {} });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test("progress route: 401 without a session, also with a user_id query, and no progress data in the body", async () => {
  for (const q of ["", `?user_id=${A}`, `?userId=${A}`]) {
    const r = await get(null, q);
    assert.equal(r.status, 401);
    assert.equal(r.json.streak, undefined);
    assert.equal(r.json.achievements, undefined);
  }
});

test("progress route: 401 when the session's user no longer exists", async () => {
  data.delete(A);
  assert.equal((await get(A)).status, 401);
});

test("progress route: a new user gets 0/0 and 9 locked ids, and nothing is stored", async () => {
  const r = await get(A);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.streak, { current: 0, best: 0 });
  assert.equal(r.json.achievements.length, 9);
  assert.ok(r.json.achievements.every((a: any) => a.unlocked === false && a.unlocked_at === null));
  assert.equal(rows.length, 0);
  assert.deepEqual((await get(A)).json, r.json);
});

test("progress route: first_plant unlocks once, is stored, and keeps its timestamp", async () => {
  data.get(A)!.plants.push({ id: "p", created_at: "2026-06-15T08:00:00Z", water_frequency_days: 7, last_watered_date: "2026-06-10", has_cover_photo: false });
  const first = await get(A);
  const fp = first.json.achievements.find((a: any) => a.id === "first_plant");
  assert.deepEqual(fp, { id: "first_plant", unlocked: true, unlocked_at: clock.toISOString() });
  assert.equal(first.json.achievements.filter((a: any) => a.unlocked).length, 1);
  clock = new Date("2026-06-15T10:00:00Z");
  const again = await get(A);
  assert.equal(again.json.achievements.find((a: any) => a.id === "first_plant").unlocked_at, fp.unlocked_at);
  assert.equal(rows.filter((r) => r.user_id === A).length, 1);
});

test("progress route: concurrent requests return the same timestamps and store one row per id", async () => {
  const a = data.get(A)!;
  a.plants.push({ id: "p", created_at: "2026-06-14T08:00:00Z", water_frequency_days: 7, last_watered_date: "2026-06-15", has_cover_photo: false });
  a.events.push({ plant_id: "p", type: "water", occurred_on: "2026-06-15" });
  const results = await Promise.all(Array.from({ length: 5 }, () => get(A)));
  assert.ok(results.every((r) => r.status === 200));
  const stamps = results.map((r) => JSON.stringify(r.json.achievements));
  assert.equal(new Set(stamps).size, 1);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.achievement_id).sort(), ["first_plant", "first_water"]);
});

test("progress route: users are isolated and query parameters cannot select another user", async () => {
  const a = data.get(A)!;
  a.plants.push({ id: "p", created_at: "2026-06-10T08:00:00Z", water_frequency_days: 30, last_watered_date: "2026-06-12", has_cover_photo: true });
  a.events.push({ plant_id: "p", type: "water", occurred_on: "2026-06-12" }, { plant_id: "p", type: "note", occurred_on: "2026-06-13" });
  const ra = await get(A);
  assert.equal(ra.json.achievements.filter((x: any) => x.unlocked).length, 4);
  assert.deepEqual(ra.json.streak, { current: 4, best: 4 });
  for (const q of ["", `?user_id=${A}`, `?userId=${A}`]) {
    const rb = await get(B, q);
    assert.deepEqual(rb.json.streak, { current: 0, best: 0 });
    assert.ok(rb.json.achievements.every((x: any) => !x.unlocked));
  }
  assert.ok(rows.every((r) => r.user_id === A));
  assert.deepEqual((await get(A)).json, ra.json);
});

test("progress route: a store failure gives 500 without details", async () => {
  const original = store.getProgressData;
  store.getProgressData = async () => { throw new Error("db down secret"); };
  const origErr = console.error;
  console.error = () => {};
  try {
    const r = await get(A);
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "Internal server error" });
  } finally {
    store.getProgressData = original;
    console.error = origErr;
  }
});
