import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { checkPushApiKey, createPushCheckGate } from "./checkGate";

const KEY = "changeme-push-key";
const SESSION_SECRET_VALUE = "changeme-session";

function fakeDeps() {
  const calls = { storage: 0, push: 0 };
  const storage = {
    getAllPlantsForCron: async () => { calls.storage++; return []; },
    getAllUsers: async () => { calls.storage++; return []; },
  };
  const push = { send: async () => { calls.push++; } };
  return { calls, storage, push };
}

async function run(opts: {
  configured: string | undefined;
  headers?: Record<string, string>;
  sessionUserId?: number;
}) {
  const deps = fakeDeps();
  const gate = createPushCheckGate(() => opts.configured);
  const handler = async () => {
    await deps.storage.getAllPlantsForCron();
    await deps.storage.getAllUsers();
    await deps.push.send();
  };
  const req = {
    headers: opts.headers ?? {},
    session: opts.sessionUserId ? { userId: opts.sessionUserId } : {},
  } as unknown as Request;
  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) { status = code; return this; },
    json(b: unknown) { body = b; return this; },
  } as unknown as Response;
  let nextCalled = false;
  await new Promise<void>((resolve) => {
    gate(req, res, () => { nextCalled = true; handler().then(resolve); });
    if (!nextCalled) resolve();
  });
  return { status, body, nextCalled, calls: deps.calls };
}

for (const configured of [undefined, ""]) {
  const label = configured === undefined ? "unset" : "empty";
  for (const [name, headers] of [
    ["no header", {}],
    ["empty X-API-Key", { "x-api-key": "" }],
    ["X-API-Key 'undefined'", { "x-api-key": "undefined" }],
  ] as const) {
    test(`key ${label}, ${name}: 503 and no storage or push calls`, async () => {
      const r = await run({ configured, headers: { ...headers } });
      assert.equal(r.status, 503);
      assert.equal(r.nextCalled, false);
      assert.deepEqual(r.calls, { storage: 0, push: 0 });
      assert.equal(typeof (r.body as { error: unknown }).error, "string");
    });
  }

  test(`key ${label}, valid session but no key: 503 and no calls`, async () => {
    const r = await run({ configured, sessionUserId: 42 });
    assert.equal(r.status, 503);
    assert.deepEqual(r.calls, { storage: 0, push: 0 });
  });
}

test("key set, correct X-API-Key: handler runs", async () => {
  const r = await run({ configured: KEY, headers: { "x-api-key": KEY } });
  assert.equal(r.status, 200);
  assert.equal(r.nextCalled, true);
  assert.deepEqual(r.calls, { storage: 2, push: 1 });
});

test("key set, X-API-Key equal to SESSION_SECRET: 401 and no calls", async () => {
  const r = await run({ configured: KEY, headers: { "x-api-key": SESSION_SECRET_VALUE } });
  assert.equal(r.status, 401);
  assert.deepEqual(r.calls, { storage: 0, push: 0 });
});

test("key set, valid session and no key: 401 and no calls", async () => {
  const r = await run({ configured: KEY, sessionUserId: 42 });
  assert.equal(r.status, 401);
  assert.deepEqual(r.calls, { storage: 0, push: 0 });
});

test("key set, wrong key, missing header, key prefix: 401", () => {
  assert.deepEqual(checkPushApiKey(KEY, "wrong-key"), { ok: false, status: 401, body: { error: "Invalid API key" } });
  assert.equal(checkPushApiKey(KEY, undefined).ok, false);
  assert.equal(checkPushApiKey(KEY, KEY.slice(0, -1)).ok, false);
  assert.equal(checkPushApiKey(KEY, [KEY, KEY]).ok, false);
});

test("error body never echoes the configured key", () => {
  const r = checkPushApiKey(KEY, "nope");
  assert.doesNotMatch(JSON.stringify(r), new RegExp(KEY));
});
