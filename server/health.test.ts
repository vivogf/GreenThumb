import { test } from "node:test";
import assert from "node:assert/strict";
import { getHealth, readRevision } from "./health";

const okRevision = async () => "abc1234";

test("health is 200 with exactly ok, db, revision when the DB answers", async () => {
  const result = await getHealth({ pingDb: async () => {}, readRevision: okRevision });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, db: true, revision: "abc1234" });
  assert.deepEqual(Object.keys(result.body).sort(), ["db", "ok", "revision"]);
});

test("health is 503 with db false when the DB ping throws", async () => {
  const result = await getHealth({
    pingDb: async () => { throw new Error("connect ECONNREFUSED postgres://secret@host"); },
    readRevision: okRevision,
  });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: true, db: false, revision: "abc1234" });
  assert.doesNotMatch(JSON.stringify(result.body), /secret|ECONNREFUSED/);
});

test("health is 503 when the DB ping hangs past the timeout", async () => {
  const result = await getHealth({
    pingDb: () => new Promise(() => {}),
    readRevision: okRevision,
    timeoutMs: 20,
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.db, false);
});

test("readRevision returns the trimmed SHA from the file", async () => {
  const rev = await readRevision("/x/REVISION", async () => "e04960f1a2b3\n");
  assert.equal(rev, "e04960f1a2b3");
});

test("readRevision falls back to dev when the file is missing", async () => {
  const rev = await readRevision("/x/REVISION", async () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  assert.equal(rev, "dev");
});

test("readRevision falls back to dev when the file is not a hex SHA", async () => {
  assert.equal(await readRevision("/x/REVISION", async () => "DATABASE_URL=postgres://x"), "dev");
  assert.equal(await readRevision("/x/REVISION", async () => "abc"), "dev");
});
