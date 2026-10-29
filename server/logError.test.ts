import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { errorLabel, logError } from "./logError";

const SECRET = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// Shaped like postgres-js PostgresError: the enumerable fields may carry row values.
class PostgresError extends Error {
  code = "23505";
  detail = `Key (recovery_key)=(${SECRET}) already exists.`;
  where = `SQL statement "UPDATE users SET recovery_key = '${SECRET}'"`;
  hint = `try ${SECRET}`;
  constraint_name = "users_recovery_key_unique";
  constructor() {
    super(`duplicate key value violates unique constraint for ${SECRET}`);
    this.name = "PostgresError";
  }
}

test("errorLabel keeps only the error name and code", () => {
  assert.equal(errorLabel(new PostgresError()), "PostgresError 23505");
  assert.equal(errorLabel(Object.assign(new Error("x"), { statusCode: 410, name: "WebPushError" })), "WebPushError 410");
  assert.equal(errorLabel(new TypeError(SECRET)), "TypeError");
  assert.equal(errorLabel({ errorInfo: { code: "messaging/invalid-argument" } }), "messaging/invalid-argument");
  assert.equal(errorLabel("plain string " + SECRET), "string");
  assert.equal(errorLabel(null), "null");
  assert.equal(errorLabel(undefined), "undefined");
});

test("errorLabel drops a code or name that is not a short identifier", () => {
  const weird = Object.assign(new Error("m"), { code: `bad ${SECRET}` });
  weird.name = `Name ${SECRET}`;
  assert.equal(errorLabel(weird), "Error");
});

test("logError writes the fixed context and the label, never message, detail, where or hint", () => {
  const lines: unknown[][] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { lines.push(args); };
  try {
    logError("Create anonymous user error", new PostgresError());
  } finally {
    console.error = orig;
  }
  assert.deepEqual(lines, [["Create anonymous user error: PostgresError 23505"]]);
  assert.ok(!JSON.stringify(lines).includes(SECRET));
});

function serverSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...serverSources(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

test("no server console call passes a whole error object or interpolates it", () => {
  const offenders: string[] = [];
  for (const file of serverSources(join(import.meta.dirname))) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (!/console\.(log|warn|error|info|debug)\(/.test(line)) return;
      if (/,\s*(err|error|e)(\?\.message\s*\|\|\s*err)?\s*\)\s*;?\s*$/.test(line) || /\$\{(err|error|e)\}/.test(line) || /(err|error|e)\??\.message/.test(line)) {
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});
