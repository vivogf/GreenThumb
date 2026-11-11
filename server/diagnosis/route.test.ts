import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { jsonBodyParser, jsonErrorHandler } from "../http";
import { MemoryUsageStore, utcDay } from "../species/usage";
import { DEFAULT_DIAGNOSIS_USER_DAILY_LIMIT, DIAGNOSIS_DEADLINE_MS, createDiagnoseHandler, diagnosisUserDailyLimit, type DiagnoseStore } from "./route";
import { createOpenAIDiagnosisProvider } from "./openai";
import { createDiagnosisProvider } from "./provider";
import { DiagnosisNotApplicableError, DiagnosisUnavailableError, type DiagnosisProvider, type DiagnosisRequest } from "./types";

const SENTINEL = "changeme-openai-sentinel-route-55aa";
const A = 1;
const B = 2;
const V = 3;
const PLANT_A = randomUUID();
const PLANT_B = randomUUID();
const PLANT_V = randomUUID();
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("photo-bytes-marker-0123456789abcdefghijklmnop")]);
const PHOTO = "data:image/jpeg;base64," + JPEG_BYTES.toString("base64");
const PHOTO_B64 = JPEG_BYTES.toString("base64");
const RESULT = {
  causes: [{ title: "Overwatering", likelihood: "high", explanation: "Wet soil.", advice: "Reduce watering by 20%." }],
  summary: "Likely overwatering.",
};

const plants = new Map([
  [PLANT_A, { owner: A, plant: { id: PLANT_A, name: "Fern", species_name: "Nephrolepis exaltata", water_frequency_days: 10, last_watered_date: "2025-12-10" } }],
  [PLANT_B, { owner: B, plant: { id: PLANT_B, name: "Cactus", species_name: null, water_frequency_days: 20, last_watered_date: "2026-10-01" } }],
  [PLANT_V, { owner: V, plant: { id: PLANT_V, name: "Ivy", species_name: null, water_frequency_days: 7, last_watered_date: "2026-10-01" } }],
]);

let usage: MemoryUsageStore;
let failUsage: boolean;
let providerCalls: DiagnosisRequest[];
let behavior: (n: number, signal: AbortSignal) => Promise<unknown>;
let providerEnabled: boolean;
let realProvider: DiagnosisProvider | null;
let env: NodeJS.ProcessEnv;
let clock: Date;
let deadlineMs: number;
let logs: string[];
const original = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };

const store: DiagnoseStore = {
  async getPlantForUser(id, userId) {
    const row = plants.get(id);
    return row && row.owner === userId ? row.plant : null;
  },
  async getUserById(id) {
    return { id, timezone: "Europe/Berlin", season_mode: "north" };
  },
  async listEvents(plantId, limit) {
    return [{ plant_id: plantId, type: "water", occurred_on: "2025-12-10", created_at: "2025-12-10T08:00:00.000000Z", note: null }].slice(0, limit);
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
  async diagnose(input, { signal }) {
    providerCalls.push(input);
    return behavior(providerCalls.length, signal);
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
  app.post("/api/plants/:id/diagnose", createDiagnoseHandler({
    store,
    provider: () => (realProvider ?? (providerEnabled ? fakeProvider : null)),
    env: () => env,
    now: () => clock,
    deadlineMs: () => deadlineMs,
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
  realProvider = null;
  env = {};
  clock = new Date("2026-10-27T12:00:00Z");
  deadlineMs = DIAGNOSIS_DEADLINE_MS;
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  Object.assign(console, { log: capture, warn: capture, error: capture, info: capture, debug: capture });
});

afterEach(() => {
  Object.assign(console, original);
  for (const line of logs) {
    assert.ok(!line.includes(SENTINEL), "key leaked to logs");
    assert.ok(!line.includes(PHOTO_B64.slice(0, 40)) && !line.includes("data:image"), "photo leaked to logs");
  }
});

async function post(plantId: string, body: unknown, user: number | null = A) {
  const res = await fetch(`${base}/api/plants/${plantId}/diagnose`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": String(user) } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  assert.ok(!text.includes(SENTINEL), "key leaked to a response");
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const valid = { photo: PHOTO, note: "Leaves turn yellow from the bottom", language: "en" };
const day = () => utcDay(clock);
const count = (user: number) => usage.count(day(), String(user), "diagnosis");
/** Paid provider calls of the day, over all users: what the global spend cap reads. */
const attempts = () => usage.total(day(), "diagnosis_attempt");

test("returns the validated result, sends context and the request data URL, and counts usage", async () => {
  const r = await post(PLANT_A, valid);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, RESULT);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].photoDataUrl, PHOTO);
  assert.equal(providerCalls[0].language, "en");
  assert.match(providerCalls[0].context, /Nephrolepis exaltata/);
  assert.match(providerCalls[0].context, /every 15 days/);
  assert.match(providerCalls[0].context, /- 2025-12-10: water/);
  assert.match(providerCalls[0].context, /Leaves turn yellow from the bottom/);
  assert.equal(count(A), 1);
});

test("401 without a session, 404 for foreign, missing and invalid ids: no provider call, no usage", async () => {
  const checks: Array<[string, number | null, number]> = [
    [PLANT_A, null, 401],
    [PLANT_A, B, 404],
    [randomUUID(), A, 404],
    ["not-a-uuid", A, 404],
  ];
  for (const [id, user, status] of checks) {
    const r = await post(id, valid, user);
    assert.equal(r.status, status, `${id} as ${user}`);
    assert.equal(typeof r.body.error, "string");
    if (status === 404) assert.deepEqual(r.body, { error: "Plant not found" });
  }
  // A foreign plant is checked before the body: an invalid body still gives 404.
  assert.equal((await post(PLANT_A, { photo: "x" }, B)).status, 404);
  assert.equal(providerCalls.length, 0);
  assert.equal(usage.rows.size, 0);
});

test("invalid input gives 400 with no provider call and no usage", async () => {
  const gif = "data:image/gif;base64," + Buffer.from("GIF89a\x01\x00\x01\x00", "latin1").toString("base64");
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  const bodies: Array<[string, unknown]> = [
    ["missing photo", { language: "en" }],
    ["https photo", { photo: "https://example.com/p.jpg", language: "en" }],
    ["malformed base64", { photo: "data:image/jpeg;base64,!!!!", language: "en" }],
    ["mime mismatch", { photo: PHOTO.replace("image/jpeg", "image/png"), language: "en" }],
    ["gif", { photo: gif, language: "en" }],
    ["over 5 MB", { photo: "data:image/jpeg;base64," + big.toString("base64"), language: "en" }],
    ["501 Cyrillic note", { photo: PHOTO, note: "ж".repeat(501), language: "ru" }],
    ["numeric note", { photo: PHOTO, note: 42, language: "en" }],
    ["missing language", { photo: PHOTO }],
    ["de", { photo: PHOTO, language: "de" }],
    ["RU", { photo: PHOTO, language: "RU" }],
    ["123", { photo: PHOTO, language: 123 }],
  ];
  for (const [name, body] of bodies) {
    const r = await post(PLANT_A, body);
    assert.equal(r.status, 400, name);
    assert.equal(typeof r.body.error, "string", name);
  }
  assert.equal(providerCalls.length, 0);
  assert.equal(count(A), 0);
  const ok = await post(PLANT_A, { photo: PHOTO, note: "ж".repeat(500), language: "ru" });
  assert.equal(ok.status, 200);
});

test("output validation: 4 causes are cut to 3; invalid output and provider failures give 503", async () => {
  const cause = (n: number, likelihood = "medium") => ({ title: `C${n}`, likelihood, explanation: "E", advice: "A" });
  behavior = async () => ({ causes: [cause(1), cause(2), cause(3), cause(4)], summary: "S" });
  const four = await post(PLANT_A, valid);
  assert.equal(four.status, 200);
  assert.deepEqual(four.body.causes.map((c: any) => c.title), ["C1", "C2", "C3"]);
  behavior = async () => ({ causes: [{ ...cause(1), confidence: 0.8 }], summary: "S" });
  const extra = await post(PLANT_A, valid);
  assert.equal(extra.status, 200);
  assert.equal(extra.body.causes[0].confidence, undefined);

  const before = count(A);
  const failing: Array<[string, () => Promise<unknown>]> = [
    ["very high", async () => ({ causes: [cause(1, "very high")], summary: "S" })],
    ["missing advice", async () => ({ causes: [{ title: "T", likelihood: "low", explanation: "E" }], summary: "S" })],
    ["incomplete", async () => { throw new DiagnosisUnavailableError("incomplete"); }],
    ["non-JSON", async () => { throw new DiagnosisUnavailableError("invalid_output"); }],
    ["unexpected throw", async () => { throw new Error(`boom ${SENTINEL}`); }],
  ];
  for (const [name, fn] of failing) {
    behavior = fn;
    const r = await post(PLANT_A, valid);
    assert.equal(r.status, 503, name);
    assert.deepEqual(r.body, { error: "Diagnosis is temporarily unavailable", code: "diagnosis_unavailable" }, name);
  }
  assert.equal(count(A), before);
});

test("a photo without a plant answers 422 no_plant, costs no daily check, and counts as a paid attempt", async () => {
  const before = count(A);
  const paid = attempts();
  const empty = { causes: [], summary: "No plant is visible in the photo." };
  behavior = async () => empty;
  const r = await post(PLANT_A, valid);
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { error: "No plant or disease signs recognised", code: "no_plant" });
  assert.equal(count(A), before, "the user's own limit is untouched");
  assert.equal(attempts(), paid + 1, "the provider was paid: the spend cap sees it");

  // The provider declining to analyse the photo is not a verdict about it: retry later, and the call was paid.
  behavior = async () => { throw new DiagnosisNotApplicableError("refusal"); };
  const refused = await post(PLANT_A, valid);
  assert.equal(refused.status, 503);
  assert.deepEqual(refused.body, { error: "Diagnosis is temporarily unavailable", code: "diagnosis_unavailable" });
  assert.equal(count(A), before);
  assert.equal(attempts(), paid + 2);

  // An empty causes list with an unreadable summary is still a broken answer, not a verdict.
  behavior = async () => ({ causes: [], summary: "  " });
  assert.equal((await post(PLANT_A, valid)).status, 503);
  assert.equal(count(A), before);
  assert.equal(attempts(), paid + 3, "a billed answer that failed validation still costs money");
});

test("a disabled provider gives 503 with no provider call and no usage", async () => {
  providerEnabled = false;
  for (const e of [{}, { DIAGNOSIS_PROVIDER: "" }, { DIAGNOSIS_PROVIDER: "gemini", OPENAI_API_KEY: SENTINEL }]) {
    realProvider = createDiagnosisProvider(e);
    const r = await post(PLANT_A, valid);
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "diagnosis_unavailable");
  }
  assert.equal(providerCalls.length, 0);
  assert.equal(count(A), 0);
});

test("daily limit: only 200s count, 429 daily_limit without a provider call, per user, UTC day", async () => {
  env = { DIAGNOSIS_USER_DAILY_LIMIT: "2" };
  behavior = async (n) => {
    if (n === 1) throw new DiagnosisUnavailableError("upstream_unavailable");
    return structuredClone(RESULT);
  };
  assert.equal((await post(PLANT_A, valid)).status, 503);
  assert.equal((await post(PLANT_A, { language: "en" })).status, 400);
  assert.equal(count(A), 0);
  assert.equal((await post(PLANT_A, valid)).status, 200);
  assert.equal((await post(PLANT_A, valid)).status, 200);
  assert.equal(count(A), 2);
  const callsBefore = providerCalls.length;
  const limited = await post(PLANT_A, valid);
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { error: "Daily diagnosis limit reached", code: "daily_limit", scope: "user" });
  assert.equal(providerCalls.length, callsBefore);
  assert.equal(count(A), 2);
  assert.equal((await post(PLANT_V, valid, V)).status, 200);
  // 23:59 UTC is already the next day in Europe/Berlin, but the limit follows UTC.
  clock = new Date("2026-10-27T23:59:00Z");
  assert.equal((await post(PLANT_A, valid)).status, 429);
  clock = new Date("2026-10-28T00:00:01Z");
  assert.equal((await post(PLANT_A, valid)).status, 200);
});

test("the default limit is 10", async () => {
  assert.equal(DEFAULT_DIAGNOSIS_USER_DAILY_LIMIT, 10);
  assert.equal(diagnosisUserDailyLimit({}), 10);
  assert.equal(diagnosisUserDailyLimit({ DIAGNOSIS_USER_DAILY_LIMIT: "abc" }), 10);
  for (let i = 0; i < 10; i++) assert.equal((await post(PLANT_A, valid)).status, 200);
  assert.equal((await post(PLANT_A, valid)).status, 429);
  assert.equal(count(A), 10);
  assert.equal(providerCalls.length, 10);
});

test("a failing usage store gives 503 without a provider call", async () => {
  failUsage = true;
  const r = await post(PLANT_A, valid);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "diagnosis_unavailable");
  assert.equal(providerCalls.length, 0);
});

test("the overall deadline is 60 s and aborts a provider that never answers", async () => {
  assert.equal(DIAGNOSIS_DEADLINE_MS, 60_000);
  deadlineMs = 100;
  let aborted = false;
  behavior = (_n, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new DiagnosisUnavailableError("aborted")); }, { once: true });
  });
  const started = Date.now();
  const r = await post(PLANT_A, valid);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "diagnosis_unavailable");
  assert.ok(Date.now() - started < 2000);
  assert.equal(aborted, true);
  assert.equal(count(A), 0);
});

// Real OpenAI adapter behind the route with a fake transport.
type Upstream = (n: number, init: RequestInit) => Promise<Response>;
function adapterWith(upstream: Upstream) {
  const attempts: number[] = [];
  const fetchImpl = (async (_url: string | URL, init: RequestInit = {}) => {
    attempts.push(Date.now());
    return upstream(attempts.length, init);
  }) as unknown as typeof fetch;
  realProvider = createOpenAIDiagnosisProvider({ apiKey: SENTINEL, fetch: fetchImpl });
  return attempts;
}

const upstreamError = (status: number, error: Record<string, unknown>, retryAfterMs = "5") =>
  new Response(JSON.stringify({ error: { message: `denied for key ${SENTINEL}`, param: null, ...error } }), {
    status,
    headers: { "content-type": "application/json", "retry-after-ms": retryAfterMs },
  });
const upstreamOk = () => new Response(JSON.stringify({
  id: "resp", object: "response", status: "completed",
  output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(RESULT), annotations: [] }] }],
}), { status: 200, headers: { "content-type": "application/json" } });

test("adapter behind the route: provider failure types map to 503 with the right attempt counts", async () => {
  const cases: Array<[string, Upstream, number]> = [
    ["insufficient_quota", async () => upstreamError(429, { type: "insufficient_quota", code: "insufficient_quota" }), 1],
    ["credit_balance_exhausted", async () => upstreamError(429, { type: "billing_error", code: "credit_balance_exhausted" }), 1],
    ["rate limit", async () => upstreamError(429, { type: "requests", code: "rate_limit_exceeded" }), 3],
    ["500", async () => upstreamError(500, { type: "server_error", code: null }), 3],
    ["503 overloaded", async () => upstreamError(503, { type: "server_error", code: "server_is_overloaded" }), 3],
    ["401", async () => upstreamError(401, { type: "invalid_request_error", code: "invalid_api_key" }), 1],
  ];
  for (const [name, upstream, expected] of cases) {
    const attempts = adapterWith(upstream);
    const r = await post(PLANT_A, valid);
    assert.equal(r.status, 503, name);
    assert.deepEqual(r.body, { error: "Diagnosis is temporarily unavailable", code: "diagnosis_unavailable" }, name);
    assert.equal(attempts.length, expected, name);
  }
  const flaky = adapterWith(async (n) => (n === 1 ? upstreamError(503, { type: "server_error", code: "server_is_overloaded" }) : upstreamOk()));
  const r = await post(PLANT_A, valid);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, RESULT);
  assert.equal(flaky.length, 2);
  assert.equal(count(A), 1);
});

test("adapter behind the route: a never-answering provider is aborted at the deadline, no attempt after it", async () => {
  deadlineMs = 150;
  let abortFired = false;
  const attempts = adapterWith(async (_n, init) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => { abortFired = true; reject(new DOMException("aborted", "AbortError")); }, { once: true });
  }));
  const started = Date.now();
  const r = await post(PLANT_A, valid);
  const elapsed = Date.now() - started;
  assert.equal(r.status, 503);
  assert.ok(elapsed < 1500, `took ${elapsed} ms`);
  assert.equal(abortFired, true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(attempts.length, 1);

  // Retries that would start after the deadline never start.
  const retrying = adapterWith(async () => upstreamError(500, { type: "server_error", code: null }, "100"));
  const deadlineAt = Date.now() + deadlineMs;
  assert.equal((await post(PLANT_A, valid)).status, 503);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(retrying.length >= 1 && retrying.length <= 2, `attempts ${retrying.length}`);
  for (const at of retrying) assert.ok(at <= deadlineAt + 20, "attempt after the deadline");
});

test("adapter behind the route: a connection error gives 503", async () => {
  const attempts = adapterWith(async () => { throw new TypeError("fetch failed"); });
  const r = await post(PLANT_A, valid);
  assert.equal(r.status, 503);
  assert.equal(attempts.length, 3);
});
