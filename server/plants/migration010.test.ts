import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Migration 010: per-user idempotency key for POST /api/plants (offline queue replay).
const DIR = join(import.meta.dirname, "..", "migrations");

function sql(): string {
  const file = readdirSync(DIR).find((f) => f.startsWith("010_") && f.endsWith(".sql"));
  assert.ok(file, "migration 010 exists");
  return readFileSync(join(DIR, file), "utf8").replace(/--.*$/gm, "");
}

test("010 adds a nullable plants.client_request_id idempotently", () => {
  const s = sql();
  assert.match(s, /ALTER TABLE plants ADD COLUMN IF NOT EXISTS client_request_id text;/i);
  assert.doesNotMatch(s, /client_request_id text NOT NULL/i);
});

test("010 makes (user_id, client_request_id) unique only where a key is set", () => {
  assert.match(
    sql(),
    /CREATE UNIQUE INDEX IF NOT EXISTS plants_user_client_request_id_key\s+ON plants \(user_id, client_request_id\)\s+WHERE client_request_id IS NOT NULL;/i,
  );
});

test("010 does not rewrite or drop anything", () => {
  const s = sql();
  for (const word of [/\bDROP\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /CONCURRENTLY/i]) assert.doesNotMatch(s, word);
});
