import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { jsonBodyParser } from "../http";
import { createLoginRecoveryHandler, normalizeRecoveryKey, type LoginRecoveryStore } from "./loginRecovery";
import { hashRecoveryKey } from "./recoveryKey";

const VALID_KEY = "3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f";
const PENDING_KEY = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const USER = { id: 77, name: "Fern" };

let calls: string[];
let logs: string[];
const original = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };

let commitResult: "committed" | "not_pending";

const store: LoginRecoveryStore = {
  async getUserByCurrentOrPendingKeyHash(hash) {
    calls.push(`hash:${hash}`);
    if (hash === hashRecoveryKey(VALID_KEY)) return { user: USER as any, pending: false };
    if (hash === hashRecoveryKey(PENDING_KEY)) return { user: USER as any, pending: true };
    return null;
  },
  async commitPendingRecoveryKey(userId, hash, keepSid) {
    calls.push(`commit:${userId}:${hash}:${keepSid}`);
    return commitResult === "committed" ? { status: "committed", user: USER as any } : { status: "not_pending" };
  },
};

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(jsonBodyParser);
  app.use((req, _res, next) => { (req as any).session = {}; (req as any).sessionID = "sid-of-this-request"; next(); });
  app.post("/api/auth/login-recovery", createLoginRecoveryHandler({ store, log: (line) => logs.push(line) }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  calls = [];
  commitResult = "committed";
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" ")); };
  console.log = capture; console.warn = capture; console.error = capture; console.info = capture; console.debug = capture;
});

afterEach(() => {
  Object.assign(console, original);
});

async function login(recoveryKey: unknown) {
  const res = await fetch(`${base}/api/auth/login-recovery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recoveryKey }),
  });
  return { status: res.status, body: await res.json() };
}

function assertLogsClean(secret: string) {
  const all = logs.join("\n");
  // No 4+ character slice of the submitted key may reach the log.
  for (let i = 0; i + 4 <= secret.length; i++) {
    const part = secret.slice(i, i + 4);
    assert.ok(!all.includes(part), `log contains "${part}" from the key: ${all}`);
  }
}

test("a malformed recovery key gets 400 without a storage lookup and is not logged", async () => {
  const typo = "typo-SECRETKEY-zz91";
  const { status, body } = await login(typo);
  assert.equal(status, 400);
  assert.deepEqual(body, { error: "Invalid recovery key" });
  assert.deepEqual(calls, [], "storage must not be called for a malformed key");
  assert.ok(logs.length > 0, "the rejection is logged with a code");
  assertLogsClean(typo);
});

test("a UUID with no account gets 401 and only a code in the log", async () => {
  const unknown = "aaaabbbb-cccc-4ddd-8eee-ffff00001111";
  const { status, body } = await login(unknown);
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "Invalid recovery key" });
  assert.deepEqual(calls, [`hash:${hashRecoveryKey(unknown)}`], "one lookup by hash, no plaintext fallback");
  assertLogsClean(unknown);
});

test("a valid key signs in; surrounding spaces and upper case are accepted", async () => {
  const { status, body } = await login(`  ${VALID_KEY.toUpperCase()} `);
  assert.equal(status, 200);
  assert.deepEqual(body, { user: USER });
  assert.deepEqual(calls, [`hash:${hashRecoveryKey(VALID_KEY)}`]);
});

test("a pending-key hit commits it with this request's sid as keepSid and signs in", async () => {
  const { status, body } = await login(PENDING_KEY.toUpperCase());
  assert.equal(status, 200);
  assert.deepEqual(body, { user: USER });
  assert.deepEqual(calls, [
    `hash:${hashRecoveryKey(PENDING_KEY)}`,
    `commit:${USER.id}:${hashRecoveryKey(PENDING_KEY)}:sid-of-this-request`,
  ]);
  assertLogsClean(PENDING_KEY);
});

test("a pending-key hit whose commit finds it no longer pending is 401", async () => {
  commitResult = "not_pending";
  const { status, body } = await login(PENDING_KEY);
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "Invalid recovery key" });
  assert.equal(calls.length, 2, "lookup and commit only");
  assertLogsClean(PENDING_KEY);
});

test("a missing key keeps the old 400 response", async () => {
  const { status, body } = await login(undefined);
  assert.equal(status, 400);
  assert.deepEqual(body, { error: "Recovery key is required" });
  assert.deepEqual(calls, []);
});

test("a storage failure answers 503 with a generic body, never 400/401, and logs only the error code", async () => {
  const failing: LoginRecoveryStore = {
    ...store,
    async getUserByCurrentOrPendingKeyHash() {
      const err: any = new Error('password authentication failed for user "gt_secret_role"');
      err.code = "28P01";
      err.detail = "Key (recovery_key)=(3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f)";
      throw err;
    },
  };
  const app = express();
  app.use(jsonBodyParser);
  app.use((req, _res, next) => { (req as any).session = {}; next(); });
  app.post("/x", createLoginRecoveryHandler({ store: failing, log: (line) => logs.push(line) }));
  const s = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => s.once("listening", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: VALID_KEY }),
    });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Service unavailable" });
  } finally {
    await new Promise((resolve) => s.close(resolve));
  }
  const all = logs.join("\n");
  assert.match(all, /28P01/);
  assert.doesNotMatch(all, /gt_secret_role|password authentication/);
  assertLogsClean(VALID_KEY);
});

test("normalizeRecoveryKey accepts only the spellings Postgres uuid input accepts", () => {
  const canonical = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const accepted = [
    canonical,
    canonical.toUpperCase(),
    `{${canonical}}`,
    `{${canonical.toUpperCase()}}`,
    canonical.replace(/-/g, ""),
    "a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11",
    "a0eebc999c0b4ef8bb6d6bb9-bd380a11",
    `  ${canonical}\n`,
    ` {${canonical}} `,
  ];
  for (const raw of accepted) {
    assert.equal(normalizeRecoveryKey(raw), canonical, `should accept ${JSON.stringify(raw)}`);
  }
  const rejected = [
    `--${canonical}--`,
    `-${canonical}`,
    `${canonical}-`,
    "a0eebc99--9c0b-4ef8-bb6d-6bb9bd380a11",
    "-".repeat(50) + canonical.replace(/-/g, ""),
    canonical.replace(/-/g, "") + "-".repeat(50),
    "a0e-ebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    `{{${canonical}}}`,
    `{${canonical}`,
    `${canonical}}`,
    `{-${canonical}}`,
    `{ ${canonical} }`,
    canonical.slice(0, 35),
    canonical + "0",
    "g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "",
  ];
  for (const raw of rejected) {
    assert.equal(normalizeRecoveryKey(raw), null, `should reject ${JSON.stringify(raw)}`);
  }
});
