import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import { jsonBodyParser } from "../http";
import { hashRecoveryKey } from "./recoveryKey";
import { registerUserRoutes } from "./userRoutes";

// A users row as the database holds it in stage 1: both key columns plus a column no response may carry.
type Row = {
  id: number;
  name: string | null;
  notification_time: string | null;
  timezone: string | null;
  last_notified_date: string | null;
  season_mode: "auto" | "north" | "south" | "off";
  recovery_key: string;
  recovery_key_hash: string;
  pending_recovery_key_hash: string | null;
  created_at: Date;
  internal_extra: string;
};

const sessions = new session.MemoryStore();
let rows: Row[];
let nextId: number;
let calls: string[];
let logs: string[];
let failNext: string | null;
// Pauses inside the fake store, so a test can interleave two requests at a chosen point.
let hooks: { afterLookup?: () => Promise<void>; beforeCommit?: () => Promise<void>; beforeRepair?: () => Promise<void> };
const original = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };

function storeError(): Error {
  return Object.assign(new Error('connection to "db.internal" failed'), { code: "ECONNREFUSED" });
}

function check(method: string) {
  calls.push(method);
  if (failNext === method) {
    failNext = null;
    throw storeError();
  }
}

function sessionsOf(userId: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    sessions.all!((err, all) => {
      if (err) return reject(err);
      resolve(Object.entries(all ?? {}).filter(([, s]) => (s as any).userId === userId).map(([sid]) => sid));
    });
  });
}

/** What the migration 008 trigger does on every write of recovery_key: hash follows the key, pending is cleared. */
function writeKey(row: Row, key: string) {
  row.recovery_key = key;
  row.recovery_key_hash = hashRecoveryKey(key);
  row.pending_recovery_key_hash = null;
}

async function deleteOtherSessions(userId: number, keepSid: string) {
  for (const sid of await sessionsOf(userId)) {
    if (sid !== keepSid) await new Promise((r) => sessions.destroy(sid, r));
  }
}

// Fake store with the real store's contract. It returns whole rows on purpose, so the routes must pick the
// public fields themselves. The old call shapes (no key pair, no sid) also work, like the database DEFAULT.
// Each row check-and-write runs without an await in between: the same atomicity as one conditional UPDATE.
const store = {
  async createAnonymousUser(name?: string, pair?: { key: string; hash: string }) {
    check("createAnonymousUser");
    const key = pair?.key ?? randomUUID();
    const row: Row = {
      id: nextId++, name: name || null, notification_time: "09:00", timezone: null, last_notified_date: null,
      season_mode: "auto", recovery_key: key, recovery_key_hash: pair?.hash ?? hashRecoveryKey(key),
      pending_recovery_key_hash: null, created_at: new Date("2026-10-28T10:00:00Z"), internal_extra: "never-in-a-response",
    };
    rows.push(row);
    return { ...row };
  },
  async getUserById(id: number) {
    check("getUserById");
    const row = rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  },
  async getUserByCurrentOrPendingKeyHash(hash: string) {
    check("getUserByCurrentOrPendingKeyHash");
    const row = rows.find((r) => r.recovery_key_hash === hash) ?? rows.find((r) => r.pending_recovery_key_hash === hash);
    const hit = row ? { user: { ...row }, pending: row.recovery_key_hash !== hash } : null;
    await hooks.afterLookup?.();
    return hit;
  },
  async getUserByRecoveryKey(key: string) {
    check("getUserByRecoveryKey");
    const row = rows.find((r) => r.recovery_key === key);
    return row ? { ...row } : null;
  },
  // UPDATE users SET recovery_key_hash = $hash WHERE id = $id AND recovery_key = $canonicalKey
  async setRecoveryKeyHash(userId: number, hash: string, canonicalKey: string) {
    check("setRecoveryKeyHash");
    await hooks.beforeRepair?.();
    const row = rows.find((r) => r.id === userId && r.recovery_key === canonicalKey);
    if (row) row.recovery_key_hash = hash;
  },
  async setPendingRecoveryKey(userId: number, hash: string) {
    check("setPendingRecoveryKey");
    const row = rows.find((r) => r.id === userId);
    if (!row) return null;
    row.pending_recovery_key_hash = hash;
    return { ...row };
  },
  // One transaction: UPDATE ... WHERE id = $u AND pending = $h, then (1 row) DELETE the other sessions.
  async commitPendingRecoveryKey(userId: number, pair: { key: string; hash: string }, keepSid: string) {
    check("commitPendingRecoveryKey");
    await hooks.beforeCommit?.();
    const row = rows.find((r) => r.id === userId);
    if (!row) return { status: "not_found" as const };
    if (row.pending_recovery_key_hash === pair.hash) {
      writeKey(row, pair.key);
      const user = { ...row };
      await deleteOtherSessions(userId, keepSid);
      return { status: "committed" as const, user };
    }
    if (row.recovery_key_hash === pair.hash) return { status: "already_current" as const, user: { ...row } };
    return { status: "not_pending" as const };
  },
  async updateUserTimezone(userId: number, timezone: string) {
    check("updateUserTimezone");
    const row = rows.find((r) => r.id === userId);
    if (row) row.timezone = timezone;
    return row ? { ...row } : null;
  },
  async updateUserNotificationTime(userId: number, notificationTime: string) {
    check("updateUserNotificationTime");
    const row = rows.find((r) => r.id === userId);
    if (row) row.notification_time = notificationTime;
    return row ? { ...row } : null;
  },
  async updateUserSeasonMode(userId: number, seasonMode: Row["season_mode"]) {
    check("updateUserSeasonMode");
    const row = rows.find((r) => r.id === userId);
    if (row) row.season_mode = seasonMode;
    return row ? { ...row } : null;
  },
};

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Authentication required" });
  next();
}

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(jsonBodyParser);
  app.use(session({ secret: "test", resave: false, saveUninitialized: false, store: sessions }));
  registerUserRoutes(app, { store: store as any, requireAuth, log: (line: string) => logs.push(line) } as any);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  rows = [];
  nextId = 1;
  calls = [];
  logs = [];
  failNext = null;
  hooks = {};
  const capture = (...args: unknown[]) => { logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  console.log = capture; console.warn = capture; console.error = capture; console.info = capture; console.debug = capture;
});

afterEach(() => {
  Object.assign(console, original);
});

type Reply = { status: number; body: any; cookie: string | null; cacheControl: string | null };

async function call(method: string, path: string, body?: unknown, cookie?: string | null, signal?: AbortSignal): Promise<Reply> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${path}`, { method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    body: await res.json(),
    cookie: setCookie ? setCookie.split(";")[0] : null,
    cacheControl: res.headers.get("cache-control"),
  };
}

async function createUser(name = "Fern") {
  const r = await call("POST", "/api/auth/create-anonymous", { name });
  assert.equal(r.status, 200);
  return { cookie: r.cookie!, key: r.body.user?.recovery_key as string, reply: r };
}

function strings(value: unknown, path = "$"): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [[`${path}.${k}#key`, k] as [string, string], ...strings(v, `${path}.${k}`)]);
  }
  return [];
}

/** No 64-hex string anywhere; recovery keys only at $.user.recovery_key and only where allowed. */
function assertNoSecrets(label: string, body: unknown, keys: string[], allowedKeyAt: string | null) {
  for (const [path, s] of strings(body)) {
    assert.doesNotMatch(s, /[0-9a-f]{64}/i, `${label}: 64-hex string at ${path}`);
    assert.notEqual(s, "recovery_key_hash", `${label}: hash field at ${path}`);
    assert.notEqual(s, "internal_extra", `${label}: non-public column at ${path}`);
    for (const key of keys) {
      if (s.includes(key) || s.includes(key.replace(/-/g, ""))) {
        assert.equal(path, allowedKeyAt, `${label}: recovery key at ${path}`);
      }
    }
  }
}

const PUBLIC_FIELDS = ["created_at", "id", "last_notified_date", "name", "notification_time", "season_mode", "timezone"];

test("T3/T4/T7: create answers the public user plus the new key once, with no-store", async () => {
  const { reply, key } = await createUser();
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(reply.cacheControl, "no-store");
  assert.deepEqual(Object.keys(reply.body).sort(), ["user"]);
  assert.deepEqual(Object.keys(reply.body.user).sort(), [...PUBLIC_FIELDS, "recovery_key"].sort());
  assertNoSecrets("create", reply.body, [key], "$.user.recovery_key");
  // The key was generated by the route (Node) and both columns were written with it.
  assert.equal(rows[0].recovery_key, key);
  assert.equal(rows[0].recovery_key_hash, hashRecoveryKey(key));
});

test("T3/T4: /me, login, timezone, notification time and season mode carry neither key nor hash", async () => {
  const { cookie, key } = await createUser();
  const replies: Array<[string, Reply]> = [
    ["me", await call("GET", "/api/auth/me", undefined, cookie)],
    ["login", await call("POST", "/api/auth/login-recovery", { recoveryKey: key })],
    ["timezone", await call("PATCH", "/api/auth/update-timezone", { timezone: "Europe/Berlin" }, cookie)],
    ["notification-time", await call("PATCH", "/api/auth/update-notification-time", { notification_time: "08:30" }, cookie)],
    ["season-mode", await call("PATCH", "/api/auth/update-season-mode", { season_mode: "north" }, cookie)],
  ];
  for (const [label, r] of replies) {
    assert.equal(r.status, 200, label);
    assert.deepEqual(Object.keys(r.body.user).sort(), PUBLIC_FIELDS, `${label}: only the public fields`);
    assertNoSecrets(label, r.body, [key], null);
  }
});

async function regenerate(cookie: string) {
  const r = await call("POST", "/api/auth/regenerate-recovery-key", undefined, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { reply: r, key: r.body.pending_recovery_key as string };
}

const confirm = (recoveryKey: unknown, cookie: string | null) =>
  call("POST", "/api/auth/confirm-recovery-key", { recoveryKey }, cookie);
const login = (recoveryKey: string) => call("POST", "/api/auth/login-recovery", { recoveryKey });
const me = (cookie: string | null) => call("GET", "/api/auth/me", undefined, cookie);

test("R1: regenerate answers pending_recovery_key outside user, no-store; the current key and every session stay", async () => {
  const { cookie, key: oldKey } = await createUser();
  const other = (await login(oldKey)).cookie!;
  const { reply: r, key: newKey } = await regenerate(cookie);
  assert.equal(r.cacheControl, "no-store");
  assert.deepEqual(Object.keys(r.body).sort(), ["pending_recovery_key", "user"]);
  assert.deepEqual(Object.keys(r.body.user).sort(), PUBLIC_FIELDS, "the new key is not in user");
  assert.match(newKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(newKey, oldKey);
  assertNoSecrets("regenerate", r.body, [oldKey, newKey], "$.pending_recovery_key");
  assert.equal(rows[0].recovery_key, oldKey, "the current key is unchanged");
  assert.equal(rows[0].recovery_key_hash, hashRecoveryKey(oldKey));
  assert.equal(rows[0].pending_recovery_key_hash, hashRecoveryKey(newKey), "only the pending hash is written");

  assert.equal((await me(other)).status, 200, "another session of the user is alive");
  assert.equal((await me(cookie)).status, 200);
  assert.equal((await login(oldKey)).status, 200, "the current key still signs in");
});

test("R2: login with the current key keeps the pending key", async () => {
  const { cookie, key: oldKey } = await createUser();
  const { key: newKey } = await regenerate(cookie);
  const r = await login(oldKey);
  assert.equal(r.status, 200);
  assertNoSecrets("login K1", r.body, [oldKey, newKey], null);
  assert.equal(rows[0].pending_recovery_key_hash, hashRecoveryKey(newKey));
  assert.equal(rows[0].recovery_key, oldKey);
});

test("R3: login with the pending key commits it: other sessions revoked, then the old key is 401", async () => {
  const { cookie: web, key: oldKey } = await createUser();
  const stranger = (await createUser("Other")).cookie;
  const { key: newKey } = await regenerate(web);
  calls = [];
  const r = await login(newKey);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, 1);
  assertNoSecrets("login K2", r.body, [oldKey, newKey], null);
  assert.deepEqual(calls, ["getUserByCurrentOrPendingKeyHash", "commitPendingRecoveryKey"], "one lookup, then the commit");
  assert.equal(rows[0].recovery_key, newKey);
  assert.equal(rows[0].recovery_key_hash, hashRecoveryKey(newKey));
  assert.equal(rows[0].pending_recovery_key_hash, null);

  assert.equal((await me(r.cookie)).status, 200, "the signing-in session is kept");
  assert.equal((await me(web)).status, 401, "the other session of the user is revoked");
  assert.equal((await me(stranger)).status, 200, "another user's session is untouched");
  assert.equal((await login(oldKey)).status, 401, "the old key is dead");
  assert.equal((await login(newKey)).status, 200);
});

test("R4: confirm commits: status committed, other sessions revoked, old key 401, new key 200", async () => {
  const { cookie, key: oldKey } = await createUser();
  const other = (await login(oldKey)).cookie!;
  const stranger = (await createUser("Other")).cookie;
  const { key: newKey } = await regenerate(cookie);
  const r = await confirm(newKey, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "committed");
  assert.deepEqual(Object.keys(r.body).sort(), ["status", "user"]);
  assert.deepEqual(Object.keys(r.body.user).sort(), PUBLIC_FIELDS);
  assertNoSecrets("confirm", r.body, [oldKey, newKey], null);

  assert.equal((await me(other)).status, 401, "the other session is revoked");
  assert.equal((await me(cookie)).status, 200, "the confirming session is kept");
  assert.equal((await me(stranger)).status, 200, "another user's session is untouched");
  assert.equal((await login(oldKey)).status, 401);
  assert.equal((await login(newKey)).status, 200);
});

test("R5: a replayed confirm is already_current and deletes no session", async () => {
  const { cookie } = await createUser();
  const { key: newKey } = await regenerate(cookie);
  assert.equal((await confirm(newKey, cookie)).body.status, "committed");
  const later = (await login(newKey)).cookie!;
  const r = await confirm(newKey.toUpperCase(), cookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "already_current");
  assertNoSecrets("confirm replay", r.body, [newKey], null);
  assert.equal((await me(later)).status, 200, "the replay revoked no session");
});

test("R6: confirm of a key that is not pending is 409 not_pending, changes nothing, never 401", async () => {
  const { cookie, key: oldKey } = await createUser();
  const other = (await login(oldKey)).cookie!;
  // No pending at all, then a pending that is not this key.
  let r = await confirm(randomUUID(), cookie);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { code: "not_pending" });
  const { key: newKey } = await regenerate(cookie);
  r = await confirm(randomUUID(), cookie);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { code: "not_pending" });
  assert.equal(rows[0].recovery_key, oldKey);
  assert.equal(rows[0].pending_recovery_key_hash, hashRecoveryKey(newKey), "the pending key survives a wrong confirm");
  assert.equal((await me(other)).status, 200);
  assert.equal((await me(cookie)).status, 200);
  // The current key is already current: 200 with no side effect, the pending key stays.
  r = await confirm(oldKey, cookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "already_current");
  assert.equal(rows[0].pending_recovery_key_hash, hashRecoveryKey(newKey));
  assert.equal((await me(other)).status, 200);
});

test("R7: confirm answers 400 for a malformed key, 401 only without a session, 503 on a store failure", async () => {
  const { cookie } = await createUser();
  const { key: newKey } = await regenerate(cookie);
  for (const bad of ["not-a-key", "", 42, null]) {
    const r = await confirm(bad, cookie);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await confirm(newKey, null)).status, 401, "no session");
  failNext = "commitPendingRecoveryKey";
  const failed = await confirm(newKey, cookie);
  assert.equal(failed.status, 503);
  assert.deepEqual(failed.body, { error: "Service unavailable" });
  assert.equal(failed.cacheControl, "no-store");
  assert.equal(rows[0].pending_recovery_key_hash, hashRecoveryKey(newKey));
});

test("R8: a second regenerate overwrites pending: the first new key gets 409 on confirm and 401 at login", async () => {
  const { cookie, key: oldKey } = await createUser();
  const { key: k2 } = await regenerate(cookie);
  const { key: k3 } = await regenerate(cookie);
  assert.equal(rows[0].pending_recovery_key_hash, hashRecoveryKey(k3));
  const r = await confirm(k2, cookie);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { code: "not_pending" });
  assert.equal((await login(k2)).status, 401);
  assert.equal((await login(oldKey)).status, 200, "the current key is untouched");
  assert.equal((await confirm(k3, cookie)).body.status, "committed");
});

test("R9: a key write by the old build (trigger) drops the pending key", async () => {
  const { cookie } = await createUser();
  const { key: k2 } = await regenerate(cookie);
  writeKey(rows[0], randomUUID());
  assert.equal((await confirm(k2, cookie)).status, 409);
  assert.equal((await login(k2)).status, 401);
});

test("R10: confirm and login with the new key in either order never give 401", async () => {
  // a) login found the pending hit, confirm commits before the login's commit runs.
  {
    rows = []; nextId = 1;
    const { cookie } = await createUser();
    const { key } = await regenerate(cookie);
    let release!: () => void;
    let reached!: () => void;
    const atLookup = new Promise<void>((r) => { reached = r; });
    hooks.afterLookup = () => { hooks.afterLookup = undefined; reached(); return new Promise((r) => { release = r; }); };
    const loginP = login(key);
    await atLookup;
    const c = await confirm(key, cookie);
    release();
    const l = await loginP;
    assert.equal(c.status, 200);
    assert.equal(c.body.status, "committed");
    assert.equal(l.status, 200, "login after a concurrent commit is not 401");
    assert.equal(rows[0].recovery_key, key);
  }
  // b) confirm passed its session check, the login commits first (and revokes the confirming session).
  {
    rows = []; nextId = 1;
    const { cookie } = await createUser();
    const { key } = await regenerate(cookie);
    let release!: () => void;
    let reached!: () => void;
    const atCommit = new Promise<void>((r) => { reached = r; });
    hooks.beforeCommit = () => { hooks.beforeCommit = undefined; reached(); return new Promise((r) => { release = r; }); };
    const confirmP = confirm(key, cookie);
    await atCommit;
    const l = await login(key);
    release();
    const c = await confirmP;
    assert.equal(l.status, 200);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.status, "already_current");
  }
  // c) both at once, several times.
  for (let i = 0; i < 10; i++) {
    rows = []; nextId = 1;
    const { cookie } = await createUser();
    const { key } = await regenerate(cookie);
    const [c, l] = await Promise.all([confirm(key, cookie), login(key)]);
    assert.notEqual(l.status, 401, `login, round ${i}`);
    assert.equal(l.status, 200, `login, round ${i}`);
    assert.equal(c.status, 200, `confirm, round ${i}`);
    assert.equal(rows[0].recovery_key, key);
  }
});

test("R11: a hash repair after the plaintext fallback cannot bring back a key rotated meanwhile", async () => {
  const { cookie, key: oldKey } = await createUser();
  rows[0].recovery_key_hash = "0".repeat(64);
  const { key: newKey } = await regenerate(cookie);
  // Between the fallback hit on the old key and its repair, the new key is committed.
  hooks.beforeRepair = async () => { hooks.beforeRepair = undefined; writeKey(rows[0], newKey); };
  const r = await login(oldKey);
  assert.equal(r.status, 200, "the old key was right when it was checked");
  assert.equal(rows[0].recovery_key_hash, hashRecoveryKey(newKey), "the repair did not resurrect the old key");
  assert.equal((await login(oldKey)).status, 401);
  assert.equal((await login(newKey)).status, 200);
});

test("R12: /me answers 503 on a store failure, never 401", async () => {
  const { cookie } = await createUser();
  failNext = "getUserById";
  const r = await call("GET", "/api/auth/me", undefined, cookie, AbortSignal.timeout(2000));
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { error: "Service unavailable" });
  assert.doesNotMatch(logs.join("\n"), /db\.internal/);
});

test("T5: login by hash hit is 200 and does not touch the plaintext column", async () => {
  const { key } = await createUser();
  calls = [];
  const r = await call("POST", "/api/auth/login-recovery", { recoveryKey: key.toUpperCase() });
  assert.equal(r.status, 200);
  assert.deepEqual(calls, ["getUserByCurrentOrPendingKeyHash"]);
});

test("T5: hash miss + plaintext hit is 200, repairs the hash and logs hash_miss with the user id only", async () => {
  const { key } = await createUser();
  rows[0].recovery_key_hash = "0".repeat(64);
  logs = [];
  const r = await call("POST", "/api/auth/login-recovery", { recoveryKey: key });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, rows[0].id);
  assert.equal(rows[0].recovery_key_hash, hashRecoveryKey(key), "the hash is repaired");
  assert.ok(logs.includes(`login-recovery: hash_miss user=${rows[0].id}`), logs.join("\n"));
  assertLogsClean([key]);
});

test("T5: a failed hash repair still signs the user in", async () => {
  const { key } = await createUser();
  rows[0].recovery_key_hash = "0".repeat(64);
  failNext = "setRecoveryKeyHash";
  const r = await call("POST", "/api/auth/login-recovery", { recoveryKey: key });
  assert.equal(r.status, 200);
});

test("T5: both lookups miss → 401", async () => {
  await createUser();
  const r = await call("POST", "/api/auth/login-recovery", { recoveryKey: randomUUID() });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: "Invalid recovery key" });
});

test("T5: a store failure in either lookup is 503, never 401", async () => {
  const { key } = await createUser();
  for (const method of ["getUserByCurrentOrPendingKeyHash", "getUserByRecoveryKey", "commitPendingRecoveryKey"]) {
    rows[0].recovery_key_hash = "0".repeat(64);
    // The commit runs only for a pending hit.
    rows[0].pending_recovery_key_hash = method === "commitPendingRecoveryKey" ? hashRecoveryKey(key) : null;
    failNext = method;
    const r = await call("POST", "/api/auth/login-recovery", { recoveryKey: key });
    assert.equal(r.status, 503, method);
    assert.deepEqual(r.body, { error: "Service unavailable" });
  }
});

function assertLogsClean(keys: string[]) {
  const all = logs.join("\n");
  for (const key of keys) {
    for (const secret of [key, key.replace(/-/g, ""), hashRecoveryKey(key), hashRecoveryKey(key).slice(0, 16)]) {
      assert.ok(!all.includes(secret), `log contains a key or hash: ${all}`);
    }
  }
}

test("T8: logs during create, login, regenerate, confirm and their failures contain neither key nor hash", async () => {
  const { cookie, key } = await createUser();
  await call("POST", "/api/auth/login-recovery", { recoveryKey: key });
  rows[0].recovery_key_hash = "0".repeat(64);
  await call("POST", "/api/auth/login-recovery", { recoveryKey: key });
  const r = await call("POST", "/api/auth/regenerate-recovery-key", undefined, cookie);
  const newKey = r.body.pending_recovery_key;
  await call("POST", "/api/auth/login-recovery", { recoveryKey: key });
  await confirm(randomUUID(), cookie);
  await confirm(newKey, cookie);
  await confirm(newKey, cookie);
  await call("POST", "/api/auth/login-recovery", { recoveryKey: key });
  failNext = "commitPendingRecoveryKey";
  await confirm(newKey, cookie);
  failNext = "setPendingRecoveryKey";
  const failed = await call("POST", "/api/auth/regenerate-recovery-key", undefined, cookie);
  assert.equal(failed.status, 500);
  failNext = "createAnonymousUser";
  assert.equal((await call("POST", "/api/auth/create-anonymous", { name: "x" })).status, 500);
  assert.ok(logs.length > 0);
  assertLogsClean([key, newKey]);
  assert.doesNotMatch(logs.join("\n"), /db\.internal/, "error messages are not logged");
});

test("T7: a failed create or regenerate is a generic 500 with no-store and no error text", async () => {
  failNext = "createAnonymousUser";
  const r = await call("POST", "/api/auth/create-anonymous", { name: "x" });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "Internal server error" });
  assert.equal(r.cacheControl, "no-store");
});
