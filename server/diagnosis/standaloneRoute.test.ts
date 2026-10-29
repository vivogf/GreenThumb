import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { jsonBodyParser, jsonErrorHandler } from "../http";
import { DELETED_USAGE_USER, MemoryUsageStore, utcDay } from "../species/usage";
import { createDiagnoseHandler, type DiagnoseStore } from "./route";
import { createStandaloneDiagnoseHandler } from "./standaloneRoute";
import { DiagnosisUnavailableError, type DiagnosisProvider, type DiagnosisRequest } from "./types";

const U = 1;
const V = 2;
const PLANT_U = randomUUID();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("standalone-photo-bytes-0123456789")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-bytes-0123456789")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.from("webp-bytes-0123")]);
const PHOTO = "data:image/jpeg;base64," + JPEG.toString("base64");
const RESULT = {
  causes: [{ title: "Leaf spot", likelihood: "medium", explanation: "Brown spots.", advice: "Remove the affected leaves." }],
  summary: "Probably a fungal leaf spot.",
};

let usage: MemoryUsageStore;
let failUsage: boolean;
let providerCalls: DiagnosisRequest[];
let behavior: () => Promise<unknown>;
let providerEnabled: boolean;
let env: NodeJS.ProcessEnv;
let clock: Date;
let plantLookups: number;

const store: DiagnoseStore = {
  async getPlantForUser(id, userId) {
    plantLookups++;
    return id === PLANT_U && userId === U
      ? { id: PLANT_U, name: "Balcony rose", species_name: "Rosa chinensis", water_frequency_days: 4, last_watered_date: "2026-10-20" }
      : null;
  },
  async getUserById(id) {
    return { id, timezone: "Europe/Berlin", season_mode: "north" };
  },
  async listEvents() {
    return [];
  },
  async usageCount(day, userId, kind) {
    if (failUsage) throw new Error("db down");
    return usage.usageCount(day, userId, kind);
  },
  async usageTotal(day, kind) {
    if (failUsage) throw new Error("db down");
    return usage.usageTotal(day, kind);
  },
  async recordUsage(day, userId, kind) {
    return usage.recordUsage(day, userId, kind);
  },
};

const fakeProvider: DiagnosisProvider = {
  name: "fake",
  model: "fake-model",
  async diagnose(input) {
    providerCalls.push(input);
    return behavior();
  },
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
  const deps = {
    provider: () => (providerEnabled ? fakeProvider : null),
    env: () => env,
    now: () => clock,
    log: () => {},
  };
  app.post("/api/plants/:id/diagnose", createDiagnoseHandler({ store, ...deps }));
  // The standalone handler gets only the usage counter: it cannot look up plants, users or events.
  app.post("/api/diagnose", createStandaloneDiagnoseHandler({
    store: { usageCount: store.usageCount, usageTotal: store.usageTotal, recordUsage: store.recordUsage },
    ...deps,
  }));
  app.use(jsonErrorHandler);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  usage = new MemoryUsageStore();
  failUsage = false;
  providerCalls = [];
  behavior = async () => structuredClone(RESULT);
  providerEnabled = true;
  env = {};
  clock = new Date("2026-10-29T12:00:00Z");
  plantLookups = 0;
});

async function call(path: string, body: unknown, user: number | null = U) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": String(user) } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const standalone = (body: unknown, user: number | null = U) => call("/api/diagnose", body, user);
const plantRoute = (body: unknown, user: number | null = U) => call(`/api/plants/${PLANT_U}/diagnose`, body, user);

const valid = { photo: PHOTO, note: "Пятна на листьях", language: "ru" };
const day = () => utcDay(clock);
const count = (user: number | string) => usage.count(day(), String(user), "diagnosis");

test("POST /api/diagnose: 200 with exactly causes and summary, one usage, neutral context without plant data", async () => {
  const r = await standalone(valid);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, RESULT);
  assert.deepEqual(Object.keys(r.body).sort(), ["causes", "summary"]);
  assert.equal(count(U), 1);
  assert.equal(providerCalls.length, 1);
  const sent = providerCalls[0];
  assert.equal(sent.photoDataUrl, PHOTO);
  assert.equal(sent.language, "ru");
  assert.equal(sent.subject, "unknown");
  assert.match(sent.context, /Пятна на листьях/);
  for (const forbidden of [/Balcony rose/, /Rosa/, /water/i, /interval/i, /care event/i, /species/i, new RegExp(`\\b${U}\\b`)]) {
    assert.doesNotMatch(sent.context, forbidden);
  }
  assert.equal(plantLookups, 0);
});

test("POST /api/diagnose: 401 without a session, no provider call, no usage", async () => {
  const r = await standalone(valid, null);
  assert.equal(r.status, 401);
  assert.equal(typeof r.body.error, "string");
  assert.equal(r.body.causes, undefined);
  assert.equal(providerCalls.length, 0);
  assert.equal(usage.rows.size, 0);
});

test("POST /api/diagnose: invalid bodies give 400 with the plant route's errors, no provider call, no usage", async () => {
  const gif = "data:image/gif;base64," + Buffer.from("GIF89a\x01\x00\x01\x00", "latin1").toString("base64");
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  const bodies: Array<[string, unknown]> = [
    ["empty", {}],
    ["missing photo", { language: "en" }],
    ["https photo", { photo: "https://example.com/p.jpg", language: "en" }],
    ["malformed base64", { photo: "data:image/jpeg;base64,!!!!", language: "en" }],
    ["mime mismatch", { photo: PHOTO.replace("image/jpeg", "image/png"), language: "en" }],
    ["gif", { photo: gif, language: "en" }],
    ["over 5 MB", { photo: "data:image/jpeg;base64," + big.toString("base64"), language: "en" }],
    ["501-character note", { photo: PHOTO, note: "ж".repeat(501), language: "ru" }],
    ["numeric note", { photo: PHOTO, note: 42, language: "en" }],
    ["missing language", { photo: PHOTO }],
    ["de", { photo: PHOTO, language: "de" }],
    ["RU", { photo: PHOTO, language: "RU" }],
    ["123", { photo: PHOTO, language: 123 }],
  ];
  for (const [name, body] of bodies) {
    const a = await standalone(body);
    const b = await plantRoute(body);
    assert.equal(a.status, 400, name);
    assert.equal(typeof a.body.error, "string", name);
    assert.deepEqual(a.body, b.body, name);
  }
  assert.equal(providerCalls.length, 0);
  assert.equal(count(U), 0);
  for (const [mime, bytes] of [["image/jpeg", JPEG], ["image/png", PNG], ["image/webp", WEBP]] as const) {
    const ok = await standalone({ photo: `data:${mime};base64,${bytes.toString("base64")}`, language: "en" });
    assert.equal(ok.status, 200, mime);
  }
  assert.equal((await standalone({ photo: PHOTO, note: "ж".repeat(500), language: "ru" })).status, 200);
});

test("POST /api/diagnose: order 401 → 400 → 503 → 429 → provider", async () => {
  env = { DIAGNOSIS_USER_DAILY_LIMIT: "1" };
  assert.equal((await standalone(valid)).status, 200);
  // Over the limit with a bad body: 400 first.
  assert.equal((await standalone({ photo: PHOTO })).status, 400);
  assert.equal((await standalone({ photo: PHOTO }, null)).status, 401);
  providerEnabled = false;
  const off = await standalone(valid);
  assert.equal(off.status, 503);
  assert.equal(off.body.code, "diagnosis_unavailable");
  providerEnabled = true;
  assert.equal((await standalone(valid)).status, 429);
  assert.equal(providerCalls.length, 1);
  assert.equal(count(U), 1);
});

test("POST /api/diagnose: provider failure and invalid output give 503 and record nothing", async () => {
  behavior = async () => { throw new DiagnosisUnavailableError("upstream_unavailable"); };
  assert.equal((await standalone(valid)).status, 503);
  behavior = async () => ({ causes: [], summary: "S" });
  assert.equal((await standalone(valid)).status, 503);
  assert.equal(count(U), 0);
  failUsage = true;
  behavior = async () => structuredClone(RESULT);
  const before = providerCalls.length;
  assert.equal((await standalone(valid)).status, 503);
  assert.equal(providerCalls.length, before);
});

test("per-user limit 10 is shared: 6 plant + 4 standalone, the 11th on either route is 429 scope user", async () => {
  for (let i = 0; i < 6; i++) assert.equal((await plantRoute({ ...valid, language: "en" })).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await standalone(valid)).status, 200);
  assert.equal(count(U), 10);
  const calls = providerCalls.length;
  for (const send of [standalone, plantRoute]) {
    const r = await send(valid);
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, { error: "Daily diagnosis limit reached", code: "daily_limit", scope: "user" });
  }
  assert.equal(providerCalls.length, calls);
  assert.equal(count(U), 10);
  assert.equal((await standalone(valid, V)).status, 200);
  clock = new Date("2026-10-30T00:00:01Z");
  assert.equal((await standalone(valid)).status, 200);
  assert.equal((await plantRoute(valid)).status, 200);
});

test("global cap DIAGNOSIS_DAILY_LIMIT: total over all users incl. __deleted__ gives 429 scope global on both routes", async () => {
  env = { DIAGNOSIS_DAILY_LIMIT: "3" };
  await usage.recordUsage(day(), DELETED_USAGE_USER, "diagnosis");
  assert.equal((await standalone(valid, V)).status, 200);
  assert.equal((await plantRoute(valid)).status, 200);
  assert.equal(usage.total(day(), "diagnosis"), 3);
  const calls = providerCalls.length;
  for (const r of [await standalone(valid), await plantRoute(valid), await standalone(valid, 99)]) {
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, { error: "Daily diagnosis limit reached", code: "daily_limit", scope: "global" });
  }
  assert.equal(providerCalls.length, calls);
  assert.equal(usage.total(day(), "diagnosis"), 3);
  clock = new Date("2026-10-30T00:00:01Z");
  assert.equal((await standalone(valid)).status, 200);
  assert.equal((await plantRoute(valid)).status, 200);
});

test("the user scope wins when both limits are reached", async () => {
  env = { DIAGNOSIS_DAILY_LIMIT: "2", DIAGNOSIS_USER_DAILY_LIMIT: "2" };
  assert.equal((await standalone(valid)).status, 200);
  assert.equal((await standalone(valid)).status, 200);
  assert.equal((await standalone(valid)).body.scope, "user");
  assert.equal((await standalone(valid, V)).body.scope, "global");
});

test("the plant route keeps exactly causes and summary", async () => {
  const r = await plantRoute(valid);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["causes", "summary"]);
  assert.equal(providerCalls[0].subject, "own");
});
