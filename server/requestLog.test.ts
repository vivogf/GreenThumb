import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { createRequestLogger } from "./requestLog";

test("request log line has method, path, status and duration only — no body, no query string", async () => {
  const lines: string[] = [];
  const app = express();
  app.use(createRequestLogger((line) => lines.push(line)));
  app.get("/api/auth/me", (_req, res) => {
    res.json({ user: { id: 987654, name: "Secret Fern Lover", recovery_key: "11111111-2222-4333-8444-555555555555" } });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/me?token=query-secret-abc`);
    assert.equal(res.status, 200);
    await res.json();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.match(line, /^GET \/api\/auth\/me 200 in \d+ms$/);
  for (const secret of ["987654", "Secr", "Fern", "11111111", "query-secret", "token"]) {
    assert.ok(!line.includes(secret), `log line must not contain ${secret}: ${line}`);
  }
});
