import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Stage 2 of the key hashing: migration 009 drops the plaintext users.recovery_key.
const DIR = join(import.meta.dirname, "..", "migrations");

function migration(prefix: string): string {
  const file = readdirSync(DIR).find((f) => f.startsWith(`${prefix}_`) && f.endsWith(".sql"));
  assert.ok(file, `migration ${prefix} exists`);
  return readFileSync(join(DIR, file), "utf8");
}

/** The SQL without -- comments, so a comment cannot satisfy a check. */
function code(body: string): string {
  return body.replace(/--.*$/gm, "");
}

const sql = () => code(migration("009"));
const at = (s: string, needle: string | RegExp) => {
  const i = typeof needle === "string" ? s.indexOf(needle) : s.search(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  return i;
};

test("M1: 009 starts with SET LOCAL lock_timeout", () => {
  assert.match(sql().trim(), /^SET LOCAL lock_timeout = '5s';/);
});

test("M2: 009 refuses to run without the 008 hash column or with any NULL hash, before it changes anything", () => {
  const s = sql();
  const guard = at(s, "DO $$");
  assert.match(s, /attname = 'recovery_key_hash'/);
  assert.match(s, /recovery_key_hash IS NULL/);
  assert.match(s, /RAISE EXCEPTION '009: /);
  for (const change of [/ALTER TABLE/, /DROP TRIGGER/, /DROP FUNCTION/, /CREATE UNIQUE INDEX/]) {
    assert.ok(guard < at(s, change), `the guard runs before ${change}`);
  }
});

test("M3: 009 keeps recovery_key_hash NOT NULL and unique", () => {
  const s = sql();
  assert.match(s, /ALTER TABLE users ALTER COLUMN recovery_key_hash SET NOT NULL;/);
  assert.match(s, /CREATE UNIQUE INDEX IF NOT EXISTS users_recovery_key_hash_key ON users \(recovery_key_hash\);/);
});

test("M4: 009 drops the 008 sync trigger and its function, then the plaintext column", () => {
  const s = sql();
  const trigger = at(s, "DROP TRIGGER IF EXISTS users_recovery_key_hash_sync ON users;");
  const fn = at(s, "DROP FUNCTION IF EXISTS users_recovery_key_hash_sync();");
  const column = at(s, "ALTER TABLE users DROP COLUMN IF EXISTS recovery_key;");
  assert.ok(trigger < fn && fn < column, "trigger, function, column in this order");
  // 008 created exactly this trigger and function.
  const m8 = code(migration("008"));
  assert.match(m8, /CREATE TRIGGER users_recovery_key_hash_sync\b/);
  assert.match(m8, /FUNCTION users_recovery_key_hash_sync\(\)/);
});

test("M5: 009 is safe to re-run and never cascades or vacuums", () => {
  const s = sql();
  assert.doesNotMatch(s, /CASCADE/i, "a dependent object must stop the drop, not vanish with it");
  assert.doesNotMatch(s, /VACUUM/i, "VACUUM cannot run inside the migration transaction");
  assert.doesNotMatch(s, /DROP (TRIGGER|FUNCTION|COLUMN) (?!IF EXISTS)/);
  assert.doesNotMatch(s, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  assert.doesNotMatch(s, /'[0-9a-f-]{36}'|'[0-9a-f]{64}'/, "no key or hash literal");
});
