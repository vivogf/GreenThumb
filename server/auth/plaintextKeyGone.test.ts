import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Migration 009 drops users.recovery_key. No code may read or write it; the word survives only as the field
// of the one-time answer that shows a newly created key (server sends it, the web client reads it once).
const ROOT = join(import.meta.dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Comments out, so a comment that explains the history cannot fail or satisfy the check. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function hits(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of sources(join(ROOT, dir))) {
    const n = (code(readFileSync(file, "utf8")).match(/\brecovery_key\b/g) ?? []).length;
    if (n > 0) out[relative(ROOT, file)] = n;
  }
  return out;
}

test("S1: shared/schema.ts has no plaintext key column; the hash is NOT NULL and unique", () => {
  const schema = code(readFileSync(join(ROOT, "shared", "schema.ts"), "utf8"));
  assert.doesNotMatch(schema, /\brecovery_key\b/);
  assert.match(schema, /recovery_key_hash: text\("recovery_key_hash"\)\.notNull\(\)\.unique\(\)/);
  assert.deepEqual(hits("shared"), {});
});

test("S2: server code names recovery_key only in the create answer of userRoutes.ts", () => {
  assert.deepEqual(hits("server"), { "server/auth/userRoutes.ts": 1 });
  const routes = code(readFileSync(join(ROOT, "server", "auth", "userRoutes.ts"), "utf8"));
  assert.match(routes, /json\(\{ user: \{ \.\.\.toPublicUser\(user\), recovery_key: key \} \}\)/);
});

test("S3: the web client reads recovery_key only from the create answer, in AuthContext", () => {
  assert.deepEqual(Object.keys(hits("client/src")), ["client/src/contexts/AuthContext.tsx"]);
});
