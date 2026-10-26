import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Readable } from "node:stream";
import express from "express";
import { createPhotoHandler, photoPathNotFound } from "./route";
import type { PhotoStore } from "./store";

const UUID = "3f0c8a52-7b1e-4c2d-9a6f-1e2d3c4b5a69";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const objects = new Map<string, Buffer>([[`p/${UUID}.jpg`, JPEG], [`p/${UUID}.png`, Buffer.from("png-bytes")]]);
const requestedKeys: string[] = [];

const store: PhotoStore = {
  async put() {},
  async deleteMany() {},
  async delete() {},
  async list() { return []; },
  async getStream(key) {
    requestedKeys.push(key);
    const bytes = objects.get(key);
    return bytes ? { body: Readable.from([bytes]), contentLength: bytes.length, etag: '"abc"' } : null;
  },
};

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.get("/photos/:file", createPhotoHandler(() => store));
  app.all(["/photos", "/photos/*"], photoPathNotFound);
  app.use("*", (_req, res) => { res.status(200).send("<html>spa</html>"); });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("serves the exact bytes with immutable caching and no cookie", async () => {
  const res = await fetch(`${base}/photos/${UUID}.jpg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), JPEG);
});

test("content type follows the extension", async () => {
  const res = await fetch(`${base}/photos/${UUID}.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  await res.arrayBuffer();
});

test("invalid names, unknown objects and other /photos paths are 404, never the SPA", async () => {
  const before = requestedKeys.length;
  const paths = [
    "/photos", "/photos/", "/photos/abc.jpg", `/photos/${UUID}.gif`, `/photos/${UUID}`,
    `/photos/${UUID.toUpperCase()}.jpg`, "/photos/..%2F..%2Fetc%2Fpasswd", `/photos/a/${UUID}.jpg`,
  ];
  for (const path of paths) {
    const res = await fetch(base + path);
    const body = await res.text();
    assert.equal(res.status, 404, path);
    assert.ok(!body.includes("spa"), path);
  }
  assert.equal(requestedKeys.length, before, "malformed names never reach the store");

  const missing = await fetch(`${base}/photos/0b6f2a52-7b1e-4c2d-9a6f-1e2d3c4b5a69.jpg`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  await missing.text();
});
