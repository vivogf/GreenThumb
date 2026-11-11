import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { jsonBodyParser } from "../http";
import { createIdentifyHandler } from "./identifyRoute";
import { MemoryUsageStore } from "./usage";
import { MAX_IDENTIFY_PHOTO_BYTES } from "./identifyInput";

const SENTINEL = "changeme-plantnet-sentinel-7f3a";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
const jpegUrl = (b: Buffer = JPEG) => `data:image/jpeg;base64,${b.toString("base64")}`;
const sizedJpeg = (n: number) => { const b = Buffer.alloc(n, 1); JPEG.copy(b, 0, 0, 3); return b; };

const MONSTERA = {
  results: [
    { score: 0.88, species: { scientificNameWithoutAuthor: "Monstera deliciosa", commonNames: ["Swiss cheese plant"] }, gbif: { id: "2868241" } },
    { score: 0.03, species: { scientificNameWithoutAuthor: "Monstera adansonii", commonNames: [] } },
  ],
  remainingIdentificationRequests: 498,
};

type Upstream = (url: URL, init: RequestInit) => Promise<Response>;
let upstream: Upstream;
let fetchCalls: URL[];
let store: MemoryUsageStore;
let env: NodeJS.ProcessEnv;
let clock: Date;
let logs: string[];
const original = { log: console.log, warn: console.warn, error: console.error };

const fakeFetch = (async (url: URL | string, init: RequestInit) => {
  const u = new URL(String(url));
  fetchCalls.push(u);
  return upstream(u, init);
}) as unknown as typeof fetch;

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
  app.post("/api/species/identify", createIdentifyHandler({
    get store() { return store; },
    apiKey: () => SENTINEL,
    fetch: fakeFetch,
    timeoutMs: 50,
    now: () => clock,
    env: () => env,
  }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  fetchCalls = [];
  store = new MemoryUsageStore();
  env = {};
  clock = new Date("2026-10-27T12:00:00Z");
  upstream = async () => new Response(JSON.stringify(MONSTERA), { status: 200 });
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
});

afterEach(() => {
  console.log = original.log;
  console.warn = original.warn;
  console.error = original.error;
  for (const line of logs) {
    assert.ok(!line.includes(SENTINEL) && !line.includes("api-key="), "key leaked to logs");
  }
});

async function post(body: unknown, user: number | null = 1) {
  const res = await fetch(`${base}/api/species/identify`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(user === null ? {} : { "x-test-user": String(user) }) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  assert.ok(!text.includes(SENTINEL) && !text.includes("api-key"), "key leaked to response");
  return { status: res.status, body: JSON.parse(text) };
}

test("401 without a session and no upstream call", async () => {
  const r = await post({ photos: [jpegUrl()] }, null);
  assert.equal(r.status, 401);
  assert.equal("results" in r.body, false);
  assert.equal(fetchCalls.length, 0);
});

test("invalid inputs are 400 with zero upstream calls", async () => {
  const cases: Record<string, unknown> = {
    "missing photos": {},
    "empty array": { photos: [] },
    "4 photos": { photos: [jpegUrl(), jpegUrl(), jpegUrl(), jpegUrl()] },
    "not a data:image/ string": { photos: ["https://example.com/a.jpg"] },
    "broken base64": { photos: ["data:image/jpeg;base64,@@@@"] },
    "webp data url": { photos: [`data:image/webp;base64,${WEBP.toString("base64")}`] },
    "webp bytes as jpeg": { photos: [jpegUrl(WEBP)] },
    "gif bytes": { photos: [`data:image/jpeg;base64,${GIF.toString("base64")}`] },
    "gif data url": { photos: [`data:image/gif;base64,${GIF.toString("base64")}`] },
    "no image signature": { photos: ["data:image/jpeg;base64,AAAA"] },
    "2,621,441 bytes decoded": { photos: [jpegUrl(sizedJpeg(MAX_IDENTIFY_PHOTO_BYTES + 1))] },
    "unknown organ": { photos: [jpegUrl()], organs: ["stem"] },
    "unsupported lang": { photos: [jpegUrl()], lang: "de" },
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = await post(body);
    assert.equal(r.status, 400, name);
    assert.equal(typeof r.body.error, "string", name);
    assert.ok(!JSON.stringify(r.body).includes("base64,"), `${name}: photo echoed`);
  }
  assert.equal(fetchCalls.length, 0);
  assert.equal(store.rows.size, 0, "invalid input consumes no quota");
});

test("positive controls: one PNG and three max-size JPEGs reach the upstream", async () => {
  const png = await post({ photos: [`data:image/png;base64,${PNG.toString("base64")}`] });
  assert.equal(png.status, 200);
  const big = jpegUrl(sizedJpeg(MAX_IDENTIFY_PHOTO_BYTES));
  const three = await post({ photos: [big, big, big] });
  assert.equal(three.status, 200);
  assert.equal(fetchCalls.length, 2);
});

test("success maps results and returns remainingToday", async () => {
  const r = await post({ photos: [jpegUrl()] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    results: [
      { scientificName: "Monstera deliciosa", commonNames: ["Swiss cheese plant"], score: 0.88, gbifId: "2868241" },
      { scientificName: "Monstera adansonii", commonNames: [], score: 0.03, gbifId: null },
    ],
    remainingToday: 19,
  });
  assert.equal(store.count("2026-10-27", "1", "identify"), 1);
});

test("lang is forwarded: ru → ru, en → en, missing → en", async () => {
  const pairs: Array<[unknown, string]> = [["ru", "ru"], ["en", "en"], [undefined, "en"]];
  for (const [lang, expected] of pairs) {
    fetchCalls = [];
    const r = await post({ photos: [jpegUrl()], ...(lang === undefined ? {} : { lang }) });
    assert.equal(r.status, 200);
    assert.equal(fetchCalls[0].searchParams.get("lang"), expected);
    assert.equal(fetchCalls[0].searchParams.get("nb-results"), "3");
  }
});

test("upstream 404 (no match) → 200 with empty results, and the attempt is not counted", async () => {
  upstream = async () => new Response(JSON.stringify({ statusCode: 404, error: "Not Found", message: "Species not found" }), { status: 404 });
  const r = await post({ photos: [jpegUrl()] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { results: [], remainingToday: 20 });
  assert.equal(store.count("2026-10-27", "1", "identify"), 0);
});

test("per-user limit: third request is 429 without upstream; others and next day still served", async () => {
  env = { PLANTNET_USER_DAILY_LIMIT: "2" };
  assert.equal((await post({ photos: [jpegUrl()] }, 10)).status, 200);
  assert.equal((await post({ photos: [jpegUrl()] }, 10)).status, 200);
  assert.equal(fetchCalls.length, 2);
  const third = await post({ photos: [jpegUrl()] }, 10);
  assert.equal(third.status, 429);
  assert.equal(third.body.code, "quota_exceeded");
  assert.equal(fetchCalls.length, 2);
  assert.equal((await post({ photos: [jpegUrl()] }, 11)).status, 200);
  clock = new Date("2026-10-28T00:00:01Z");
  assert.equal((await post({ photos: [jpegUrl()] }, 10)).status, 200);
  assert.equal(fetchCalls.length, 4);
});

test("per-user limit defaults to 20", async () => {
  for (let i = 0; i < 20; i++) assert.equal((await post({ photos: [jpegUrl()] }, 5)).status, 200);
  assert.equal((await post({ photos: [jpegUrl()] }, 5)).status, 429);
  assert.equal(fetchCalls.length, 20);
});

test("global limit holds under 5 concurrent requests and resets the next UTC day", async () => {
  env = { PLANTNET_DAILY_LIMIT: "3" };
  const results = await Promise.all([1, 2, 3, 4, 5].map((u) => post({ photos: [jpegUrl()] }, u)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 429, 429]);
  assert.equal(fetchCalls.length, 3);
  const next = await post({ photos: [jpegUrl()] }, 6);
  assert.equal(next.status, 429);
  assert.equal(next.body.code, "quota_exceeded");
  assert.equal(fetchCalls.length, 3);
  clock = new Date("2026-10-28T08:00:00Z");
  assert.equal((await post({ photos: [jpegUrl()] }, 6)).status, 200);
});

test("global limit defaults to 450 (counts from __deleted__ included)", async () => {
  store.rows.set("2026-10-27|__deleted__|identify", 449);
  assert.equal((await post({ photos: [jpegUrl()] }, 1)).status, 200);
  const r = await post({ photos: [jpegUrl()] }, 2);
  assert.equal(r.status, 429);
});

test("provider 429 maps to 429 quota_exceeded below local caps and costs the user nothing", async () => {
  upstream = async () => new Response("Too Many Requests", { status: 429, headers: { "retry-after": "Tue, 28 Oct 2026 00:00:00 GMT" } });
  const r = await post({ photos: [jpegUrl()] });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, "quota_exceeded");
  // Pl@ntNet's own quota is not this user's recognition: the reservation goes back.
  assert.equal(store.count(clock.toISOString().slice(0, 10), "1", "identify"), 0);
});

test("upstream failures settle as 503 identify_unavailable", async () => {
  const failures: Record<string, Upstream> = {
    "500": async () => new Response("boom", { status: 500 }),
    "401": async () => new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 }),
    "413": async () => new Response("too large", { status: 413 }),
    "network error": async (url) => { throw new TypeError(`fetch failed for ${url.href}`); },
    "non-JSON body": async () => new Response("<html>oops</html>", { status: 200 }),
    "malformed JSON": async () => new Response(JSON.stringify({ results: [{ nope: true }] }), { status: 200 }),
    "never resolves": () => new Promise<Response>(() => {}),
  };
  for (const [name, fn] of Object.entries(failures)) {
    upstream = fn;
    const r = await post({ photos: [jpegUrl()] });
    assert.equal(r.status, 503, name);
    assert.equal(r.body.code, "identify_unavailable", name);
    assert.equal(typeof r.body.error, "string", name);
    assert.ok(r.body.error.length < 80, name);
  }
  // Not one of the failures was a recognition: none of them spends the user's daily check.
  assert.equal(store.rows.size, 0);
});

test("missing API key → 503 without upstream call or quota use", async () => {
  const app = express();
  app.use(jsonBodyParser);
  app.use((req, _res, next) => { (req as any).session = { userId: 1 }; next(); });
  app.post("/x", createIdentifyHandler({ store, apiKey: () => undefined, fetch: fakeFetch }));
  const s = await new Promise<Server>((resolve) => { const v = app.listen(0, "127.0.0.1", () => resolve(v)); });
  try {
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/x`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photos: [jpegUrl()] }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "identify_unavailable");
  } finally {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  assert.equal(fetchCalls.length, 0);
  assert.equal(store.rows.size, 0);
});
