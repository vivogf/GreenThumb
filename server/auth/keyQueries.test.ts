import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  commitPendingKeyQuery,
  currentOrPendingHashQuery,
  repairKeyHashQuery,
  setPendingKeyQuery,
  userWithCurrentFlagQuery,
} from "./keyQueries";

// drizzle.mock() builds the real SQL with no connection, so these check the statements the store sends.
const db = drizzle.mock();
const H = "a".repeat(64);
const KEY = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

/** The select list / returning list: everything between SELECT and FROM, or after RETURNING. */
function outputColumns(sql: string): string {
  return sql.match(/^select (.*?) from /)?.[1] ?? sql.match(/ returning (.*)$/)?.[1] ?? "";
}

function assertNoKeyColumnOut(sql: string) {
  // A key column may appear only inside the boolean comparison with a bound parameter, never as an output column.
  const out = outputColumns(sql).replace(/\((?:"users"\.)?"recovery_key_hash" = \$\d+\)/g, "<flag>");
  assert.doesNotMatch(out, /recovery_key/, `a key column is selected: ${sql}`);
}

test("K1: login lookup is ONE query matching the current OR the pending hash, current match first", () => {
  const q = currentOrPendingHashQuery(db, H).toSQL();
  assert.match(q.sql, /where \("users"\."recovery_key_hash" = \$\d+ or "users"\."pending_recovery_key_hash" = \$\d+\)/);
  assert.match(q.sql, /order by \("users"\."recovery_key_hash" = \$\d+\) desc limit \$\d+$/);
  assert.ok(q.params.every((p) => p === H || p === 1), JSON.stringify(q.params));
  assertNoKeyColumnOut(q.sql);
});

test("K2: the hash repair is conditional on the plaintext key still being the one that was checked (P3)", () => {
  const q = repairKeyHashQuery(db, 7, H, KEY).toSQL();
  assert.match(q.sql, /^update "users" set "recovery_key_hash" = \$1 where \("users"\."id" = \$2 and "users"\."recovery_key" = \$3\)$/);
  assert.deepEqual(q.params, [H, 7, KEY]);
});

test("K3: regenerate writes only the pending hash and returns public columns", () => {
  const q = setPendingKeyQuery(db, 7, H).toSQL();
  assert.match(q.sql, /^update "users" set "pending_recovery_key_hash" = \$1 where "users"\."id" = \$2 returning /);
  assert.deepEqual(q.params, [H, 7]);
  assertNoKeyColumnOut(q.sql);
});

test("K4: commit is one UPDATE conditional on the pending hash; stage 1 writes the plaintext key too", () => {
  const q = commitPendingKeyQuery(db, 7, { key: KEY, hash: H }).toSQL();
  assert.match(
    q.sql,
    /^update "users" set "recovery_key" = \$1, "recovery_key_hash" = \$2, "pending_recovery_key_hash" = \$3 where \("users"\."id" = \$4 and "users"\."pending_recovery_key_hash" = \$5\) returning /,
  );
  assert.deepEqual(q.params, [KEY, H, null, 7, H]);
  assertNoKeyColumnOut(q.sql);
});

test("K5: the already_current check reads a boolean, never the hash", () => {
  const q = userWithCurrentFlagQuery(db, 7, H).toSQL();
  assert.match(q.sql, /where "users"\."id" = \$\d+$/);
  assertNoKeyColumnOut(q.sql);
});
