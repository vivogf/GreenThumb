import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { JSON_BODY_LIMIT_BYTES, jsonBodyParser, jsonErrorHandler } from "./http";

function fakeRequest(body: string | null, contentLength: number) {
  const req: any = new PassThrough();
  req.headers = {
    "content-type": "application/json",
    "content-length": String(contentLength),
  };
  req.method = "POST";
  req.url = "/api/plants";
  if (body !== null) req.end(body);
  return req;
}

function runParser(req: any): Promise<unknown> {
  return new Promise((resolve) => {
    jsonBodyParser(req, {} as any, (err?: unknown) => resolve(err));
  });
}

function fakeResponse() {
  const res: any = { statusCode: 200, body: undefined, headersSent: false };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; res.headersSent = true; return res; };
  return res;
}

test("JSON body limit is 12 MiB", () => {
  assert.equal(JSON_BODY_LIMIT_BYTES, 12 * 1024 * 1024);
});

test("a 13,107,200-byte JSON body is rejected as too large", async () => {
  const err: any = await runParser(fakeRequest(null, 13_107_200));
  assert.ok(err, "parser must fail");
  assert.equal(err.status, 413);
  assert.equal(err.type, "entity.too.large");

  const res = fakeResponse();
  jsonErrorHandler(err, {} as any, res, () => {});
  assert.equal(res.statusCode, 413);
  assert.equal(typeof res.body.error, "string");
  assert.deepEqual(Object.keys(res.body), ["error"]);
});

test("a JSON body under the limit is parsed", async () => {
  const body = JSON.stringify({ name: "fern" });
  const req = fakeRequest(body, Buffer.byteLength(body));
  const err = await runParser(req);
  assert.equal(err, undefined);
  assert.deepEqual(req.body, { name: "fern" });
});

test("malformed JSON gets 400 {error}", async () => {
  const body = "{not json";
  const err: any = await runParser(fakeRequest(body, Buffer.byteLength(body)));
  const res = fakeResponse();
  jsonErrorHandler(err, {} as any, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(typeof res.body.error, "string");
});

test("unexpected errors get 500 with a generic message", () => {
  const res = fakeResponse();
  const origError = console.error;
  console.error = () => {};
  try {
    jsonErrorHandler(new Error("db password leaked here"), {} as any, res, () => {});
  } finally {
    console.error = origError;
  }
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Internal Server Error" });
});

test("errors after headers were sent go to the next handler", () => {
  const res = fakeResponse();
  res.headersSent = true;
  let forwarded: unknown;
  const err = new Error("late");
  jsonErrorHandler(err, {} as any, res, (e?: unknown) => { forwarded = e; });
  assert.equal(forwarded, err);
});
