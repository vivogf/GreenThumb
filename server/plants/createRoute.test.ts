import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { Plant } from "@shared/schema";
import {
  IDEMPOTENCY_KEY_HEADER,
  createPlantCreateHandler,
  isUniqueViolation,
  parseIdempotencyKey,
  type PlantCreateStore,
} from "./createRoute";

const A = 1;
const B = 2;
let rows: Plant[];
let uploads: string[];
let removed: string[];
let raceOnInsert: boolean;
let winnerDeletedAfterRace: boolean;

function row(plant: Parameters<PlantCreateStore["addPlant"]>[0]): Plant {
  return {
    id: `p${rows.length + 1}`,
    user_id: plant.user_id,
    name: plant.name,
    location: plant.location,
    photo_url: plant.photo_url,
    water_frequency_days: plant.water_frequency_days,
    last_watered_date: plant.last_watered_date,
    fertilize_frequency_days: plant.fertilize_frequency_days ?? null,
    last_fertilized_date: plant.last_fertilized_date ?? null,
    repot_frequency_months: plant.repot_frequency_months ?? null,
    last_repotted_date: plant.last_repotted_date ?? null,
    prune_frequency_months: plant.prune_frequency_months ?? null,
    last_pruned_date: plant.last_pruned_date ?? null,
    notes: plant.notes ?? "",
    species_id: plant.species_id ?? null,
    species_name: plant.species_name ?? null,
    client_request_id: plant.client_request_id ?? null,
    created_at: new Date("2026-11-08T10:00:00Z"),
  };
}

const store: PlantCreateStore = {
  async addPlant(plant) {
    if (raceOnInsert) {
      // A concurrent request with the same key committed first.
      raceOnInsert = false;
      rows.push(row({ ...plant, name: "first" }));
      // The committed plant is deleted before this request reads it back.
      if (winnerDeletedAfterRace) rows.pop();
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    }
    const key = plant.client_request_id ?? null;
    if (key !== null && rows.some((r) => r.user_id === plant.user_id && r.client_request_id === key)) {
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    }
    const created = row(plant);
    rows.push(created);
    return created;
  },
  async getPlantByClientRequestId(userId, key) {
    return rows.find((r) => r.user_id === String(userId) && r.client_request_id === key) ?? null;
  },
};

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.header("x-test-user");
    (req as any).session = user ? { userId: Number(user) } : {};
    next();
  });
  app.post(
    "/api/plants",
    createPlantCreateHandler({
      store,
      userTimezone: async () => "UTC",
      preparePhoto: async (incoming) => {
        if (incoming && incoming.startsWith("data:")) {
          const key = `k${uploads.length + 1}.jpg`;
          uploads.push(key);
          return { ok: true, photoUrl: `https://photos.test/${key}`, uploadedKey: key, obsoleteKey: null };
        }
        return { ok: true, photoUrl: "", uploadedKey: null, obsoleteKey: null };
      },
      removePhotos: async (keys) => {
        for (const k of keys) if (k) removed.push(k);
      },
      onError: (res, _label, error) => {
        res.status(500).json({ error: String(error) });
      },
    }),
  );
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

beforeEach(() => {
  rows = [];
  uploads = [];
  removed = [];
  raceOnInsert = false;
  winnerDeletedAfterRace = false;
});

const body = (extra: Record<string, unknown> = {}) => ({
  name: "Fern",
  location: "Kitchen",
  photo_url: "",
  water_frequency_days: 7,
  last_watered_date: "2026-11-08",
  ...extra,
});

async function post(user: number, payload: unknown, key?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-test-user": String(user) };
  if (key !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = key;
  const res = await fetch(`${base}/api/plants`, { method: "POST", headers, body: JSON.stringify(payload) });
  return { status: res.status, json: await res.json() };
}

// Placeholder request id in the UUID shape the app sends.
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";

test("without Idempotency-Key every POST creates a plant (old clients)", async () => {
  const first = await post(A, body());
  const second = await post(A, body());
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.json.id, second.json.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].client_request_id, null);
});

test("a repeated Idempotency-Key returns the plant created first, without a second row or upload", async () => {
  const first = await post(A, body({ photo_url: "data:image/jpeg;base64,AAAA" }), REQUEST_ID);
  const replay = await post(A, body({ photo_url: "data:image/jpeg;base64,AAAA" }), REQUEST_ID);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.id, first.json.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].client_request_id, REQUEST_ID);
  assert.deepEqual(uploads, ["k1.jpg"]);
  assert.deepEqual(removed, []);
});

test("the replay answer does not depend on the replayed body", async () => {
  const first = await post(A, body(), REQUEST_ID);
  const replay = await post(A, { name: "" }, REQUEST_ID);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.id, first.json.id);
  assert.equal(rows.length, 1);
});

test("the same key from another user creates that user's own plant", async () => {
  const a = await post(A, body(), REQUEST_ID);
  const b = await post(B, body(), REQUEST_ID);
  assert.notEqual(a.json.id, b.json.id);
  assert.equal(b.json.user_id, String(B));
  assert.equal(rows.length, 2);
});

test("a malformed Idempotency-Key is 400 and creates nothing", async () => {
  for (const bad of ["", "x".repeat(129), "has space", "semi;colon"]) {
    const res = await post(A, body(), bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(typeof res.json.error, "string");
  }
  assert.equal(rows.length, 0);
});

test("a concurrent duplicate insert returns the committed plant and removes its own upload", async () => {
  raceOnInsert = true;
  const res = await post(A, body({ photo_url: "data:image/jpeg;base64,AAAA" }), REQUEST_ID);
  assert.equal(res.status, 200);
  assert.equal(res.json.name, "first");
  assert.equal(rows.length, 1);
  assert.deepEqual(removed, ["k1.jpg"]);
});

test("a duplicate insert whose committed plant is already deleted is 409, not 500, and leaves no plant", async () => {
  raceOnInsert = true;
  winnerDeletedAfterRace = true;
  const res = await post(A, body({ photo_url: "data:image/jpeg;base64,AAAA" }), REQUEST_ID);
  assert.equal(res.status, 409);
  assert.equal(typeof res.json.error, "string");
  assert.equal(rows.length, 0);
  assert.deepEqual(removed, ["k1.jpg"]);
});

test("invalid body with a fresh key is still 400", async () => {
  const res = await post(A, { name: "" }, REQUEST_ID);
  assert.equal(res.status, 400);
  assert.equal(rows.length, 0);
});

test("parseIdempotencyKey: absent is null, UUID passes, junk fails", () => {
  assert.deepEqual(parseIdempotencyKey(undefined), { ok: true, key: null });
  assert.deepEqual(parseIdempotencyKey(REQUEST_ID), { ok: true, key: REQUEST_ID });
  assert.equal(parseIdempotencyKey("a b").ok, false);
  assert.equal(parseIdempotencyKey(["a", "b"]).ok, false);
});

test("isUniqueViolation finds code 23505 on the error or its cause chain", () => {
  assert.equal(isUniqueViolation(Object.assign(new Error("x"), { code: "23505" })), true);
  assert.equal(isUniqueViolation(new Error("wrapped", { cause: Object.assign(new Error("x"), { code: "23505" }) })), true);
  assert.equal(isUniqueViolation(Object.assign(new Error("x"), { code: "23503" })), false);
  assert.equal(isUniqueViolation("23505"), false);
});
