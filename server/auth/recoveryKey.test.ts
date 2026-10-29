import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateRecoveryKey, hashRecoveryKey, RECOVERY_KEY_HASH } from "./recoveryKey";
import { normalizeRecoveryKey } from "./loginRecovery";

const GOLDEN = "00000000-0000-4000-8000-000000000000";
const GOLDEN_HASH = "db8055e0e0307d5a016bec4dc338d69875eb0fb7e614a8b125b08fb082095d98";

test("T1: golden key hashes to the fixed SHA-256 hex", () => {
  assert.equal(hashRecoveryKey(GOLDEN), GOLDEN_HASH);
});

test("T1: every accepted spelling of a key normalizes to one hash", () => {
  const canonical = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const expected = hashRecoveryKey(canonical);
  for (const raw of [canonical.toUpperCase(), `{${canonical}}`, canonical.replace(/-/g, ""), "a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11", `  ${canonical} `]) {
    const key = normalizeRecoveryKey(raw);
    assert.ok(key, raw);
    assert.equal(hashRecoveryKey(key), expected, raw);
  }
  assert.notEqual(hashRecoveryKey(canonical.toUpperCase()), expected, "the hash input must be the canonical form");
});

test("generateRecoveryKey returns a canonical v4 UUID and its hash", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const { key, hash } = generateRecoveryKey();
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(normalizeRecoveryKey(key), key);
    assert.match(hash, RECOVERY_KEY_HASH);
    assert.equal(hash, hashRecoveryKey(key));
    seen.add(key);
  }
  assert.equal(seen.size, 20);
});

test("T2: the golden constant in migration 008 equals hashRecoveryKey(golden)", () => {
  const dir = join(import.meta.dirname, "..", "migrations");
  const file = readdirSync(dir).find((f) => /^008_.*\.sql$/.test(f));
  assert.ok(file, "migration 008 exists");
  const body = readFileSync(join(dir, file), "utf8");
  assert.ok(body.includes(`'${GOLDEN}'`), "the migration checks the golden key");
  const constants = body.match(/'[0-9a-f]{64}'/g) ?? [];
  assert.deepEqual(constants, [`'${hashRecoveryKey(GOLDEN)}'`], "exactly one 64-hex constant, equal to the app's hash");
  // The same expression as hashRecoveryKey: UTF-8 bytes of the text, never a ::bytea cast.
  assert.match(body, /encode\(sha256\(convert_to\('00000000-0000-4000-8000-000000000000', 'UTF8'\)\), 'hex'\)/);
  assert.match(body, /encode\(sha256\(convert_to\(recovery_key::text, 'UTF8'\)\), 'hex'\)/);
  assert.doesNotMatch(body, /::bytea/);
  assert.doesNotMatch(body, /DROP COLUMN/i, "stage 1 keeps the plaintext column");
  assert.match(body, /BEFORE INSERT OR UPDATE OF recovery_key ON users/);
});

function migration008(): string {
  const dir = join(import.meta.dirname, "..", "migrations");
  const file = readdirSync(dir).find((f) => /^008_.*\.sql$/.test(f));
  assert.ok(file, "migration 008 exists");
  return readFileSync(join(dir, file), "utf8");
}

/** The SQL without -- comments, so a comment cannot satisfy a check. */
function code(body: string): string {
  return body.replace(/--.*$/gm, "");
}

test("T2b: 008 starts with SET LOCAL lock_timeout, then refuses to run unless recovery_key is uuid", () => {
  const sql = code(migration008()).trim();
  assert.match(sql, /^SET LOCAL lock_timeout = '5s';/, "lock_timeout is the first statement");
  const guard = sql.indexOf("format_type(");
  assert.ok(guard > 0, "type guard present");
  assert.ok(guard < sql.indexOf("sha256("), "the type guard runs before anything else");
  assert.match(sql, /FROM pg_attribute/);
  assert.match(sql, /attname = 'recovery_key'/);
  assert.match(sql, /IS DISTINCT FROM 'uuid' THEN\s+RAISE EXCEPTION/);
});

test("T2c: 008 adds the pending hash column with the hex CHECK, a partial unique index, and the trigger clears it", () => {
  const sql = code(migration008());
  assert.match(sql, /ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_recovery_key_hash text;/);
  assert.doesNotMatch(sql, /pending_recovery_key_hash text NOT NULL/i, "pending is nullable");
  assert.match(sql, /CHECK \(pending_recovery_key_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON users \(pending_recovery_key_hash\)\s+WHERE pending_recovery_key_hash IS NOT NULL;/);
  // The trigger body: hash follows the key, pending is dropped (an old-build key write kills a pending rotation).
  const fn = sql.match(/FUNCTION users_recovery_key_hash_sync\(\)[\s\S]*?END \$\$;/)?.[0] ?? "";
  assert.match(fn, /NEW\.recovery_key_hash := encode\(sha256\(convert_to\(NEW\.recovery_key::text, 'UTF8'\)\), 'hex'\);/);
  assert.match(fn, /NEW\.pending_recovery_key_hash := NULL;/);
  assert.ok(sql.indexOf("ADD COLUMN IF NOT EXISTS pending_recovery_key_hash") < sql.indexOf("CREATE OR REPLACE FUNCTION"));
  // Re-runnable: no bare ADD COLUMN / CREATE INDEX / ADD CONSTRAINT outside a guard.
  assert.doesNotMatch(sql, /ADD COLUMN (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
});
