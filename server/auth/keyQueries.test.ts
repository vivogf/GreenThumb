import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  commitPendingKeyQuery,
  currentOrPendingHashQuery,
  insertUserQuery,
  pinKeyHashQuery,
  setPendingKeyQuery,
  userWithCurrentFlagQuery,
} from "./keyQueries";

// drizzle.mock() builds the real SQL with no connection, so these check the statements the store sends.
const db = drizzle.mock();
const H = "a".repeat(64);

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

test("K2: create inserts the name and the hash only; the plaintext column is never named", () => {
  const q = insertUserQuery(db, "Fern", H).toSQL();
  assert.match(q.sql, /^insert into "users" \(.*\) values \(.*\) returning /);
  const cols = q.sql.match(/^insert into "users" \(([^)]*)\)/)?.[1] ?? "";
  assert.doesNotMatch(cols, /"recovery_key"/);
  assert.match(cols, /"recovery_key_hash"/);
  assert.ok(q.params.includes(H) && q.params.includes("Fern"), JSON.stringify(q.params));
  assertNoKeyColumnOut(q.sql);
});

test("K2b: the pin after create sets the hash without naming recovery_key (the 008 trigger stays quiet)", () => {
  const q = pinKeyHashQuery(db, 7, H).toSQL();
  assert.match(q.sql, /^update "users" set "recovery_key_hash" = \$1 where "users"\."id" = \$2$/);
  assert.deepEqual(q.params, [H, 7]);
});

test("K3: regenerate writes only the pending hash and returns public columns", () => {
  const q = setPendingKeyQuery(db, 7, H).toSQL();
  assert.match(q.sql, /^update "users" set "pending_recovery_key_hash" = \$1 where "users"\."id" = \$2 returning /);
  assert.deepEqual(q.params, [H, 7]);
  assertNoKeyColumnOut(q.sql);
});

test("K4: commit is one UPDATE of the hashes conditional on the pending hash; no plaintext key", () => {
  const q = commitPendingKeyQuery(db, 7, H).toSQL();
  assert.match(
    q.sql,
    /^update "users" set "recovery_key_hash" = \$1, "pending_recovery_key_hash" = \$2 where \("users"\."id" = \$3 and "users"\."pending_recovery_key_hash" = \$4\) returning /,
  );
  assert.deepEqual(q.params, [H, null, 7, H]);
  assertNoKeyColumnOut(q.sql);
});

test("K5: the already_current check reads a boolean, never the hash", () => {
  const q = userWithCurrentFlagQuery(db, 7, H).toSQL();
  assert.match(q.sql, /where "users"\."id" = \$\d+$/);
  assertNoKeyColumnOut(q.sql);
});
