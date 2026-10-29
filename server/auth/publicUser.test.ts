import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { PUBLIC_USER_FIELDS, publicUserColumns, toPublicUser } from "./publicUser";
import { deleteOtherSessionsSql } from "./sessions";

const EXPECTED = ["id", "name", "notification_time", "timezone", "last_notified_date", "season_mode", "created_at"];

test("T4: the allow-list holds exactly the public columns, never a key column", () => {
  assert.deepEqual([...PUBLIC_USER_FIELDS], EXPECTED);
  assert.deepEqual(Object.keys(publicUserColumns), EXPECTED);
  for (const [field, column] of Object.entries(publicUserColumns)) {
    assert.equal((column as any).name, field, `${field} maps to its own column`);
  }
});

test("T4: toPublicUser picks the allow-listed fields and drops any other column", () => {
  const created = new Date("2026-10-28T10:00:00Z");
  const row = {
    id: 5, name: "Fern", notification_time: "09:00", timezone: null, last_notified_date: "2026-10-27",
    season_mode: "auto" as const, created_at: created,
    recovery_key: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    recovery_key_hash: "db8055e0e0307d5a016bec4dc338d69875eb0fb7e614a8b125b08fb082095d98",
    some_future_column: "secret",
  };
  assert.deepEqual(toPublicUser(row), {
    id: 5, name: "Fern", notification_time: "09:00", timezone: null, last_notified_date: "2026-10-27",
    season_mode: "auto", created_at: created,
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("T4: every query on users selects and returns only allow-listed or explicitly named non-key columns", () => {
  const offenders: string[] = [];
  for (const file of sources(join(import.meta.dirname, ".."))) {
    const src = readFileSync(file, "utf8");
    // One drizzle chain = from `db`/`tx` up to the end of the statement.
    for (const chain of src.match(/\b(db|tx)\s*\.[\s\S]*?;/g) ?? []) {
      if (!/\((users)\)/.test(chain)) continue;
      const flat = chain.replace(/\s+/g, " ");
      if (/\.select\(\s*\)/.test(flat)) offenders.push(`${file}: select() on users: ${flat}`);
      if (/\.returning\(\s*\)/.test(flat)) offenders.push(`${file}: bare returning() on users: ${flat}`);
      const select = flat.match(/\.select\(([^)]*)\)/)?.[1] ?? "";
      const returning = flat.match(/\.returning\(([^)]*)\)/)?.[1] ?? "";
      for (const picked of [select, returning]) {
        if (/recovery_key/.test(picked)) offenders.push(`${file}: key column selected: ${flat}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("T6: the session cleanup deletes the user's sessions except the current sid", () => {
  const query = new PgDialect().sqlToQuery(deleteOtherSessionsSql(42, "current-sid"));
  assert.equal(query.sql, `DELETE FROM "session" WHERE sess->>'userId' = $1 AND sid <> $2`);
  assert.deepEqual(query.params, ["42", "current-sid"]);
});
