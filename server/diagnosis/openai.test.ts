import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DEFAULT_DIAGNOSIS_MODEL,
  OPENAI_MAX_RETRIES,
  OPENAI_TIMEOUT_MS,
  createOpenAIDiagnosisProvider,
} from "./openai";
import { createDiagnosisProvider } from "./provider";
import { DiagnosisNotApplicableError, DiagnosisUnavailableError } from "./types";

const SENTINEL = "changeme-openai-sentinel-91c2";
const PHOTO = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]).toString("base64");
const RESULT = {
  causes: [{ title: "Overwatering", likelihood: "high", explanation: "Soil stays wet.", advice: "Let the top 3 cm dry." }],
  summary: "Most likely overwatering.",
};

type Call = { url: string; init: RequestInit; body: any };
let calls: Call[];
let reply: (n: number, init: RequestInit) => Promise<Response>;
const original = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
let logs: string[];

const fakeFetch = (async (url: string | URL, init: RequestInit = {}) => {
  calls.push({ url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : null });
  return reply(calls.length, init);
}) as unknown as typeof fetch;

function okResponse(text: string = JSON.stringify(RESULT), extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    id: "resp_test", object: "response", status: "completed", model: DEFAULT_DIAGNOSIS_MODEL,
    output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
    ...extra,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function errorResponse(status: number, error: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: { message: `upstream says no ${SENTINEL}`, param: null, ...error } }), {
    status,
    headers: { "content-type": "application/json", "retry-after-ms": "5" },
  });
}

const input = { photoDataUrl: PHOTO, language: "en" as const, context: "Plant: Fern" };
const run = (provider = createOpenAIDiagnosisProvider({ apiKey: SENTINEL, fetch: fakeFetch })) =>
  provider.diagnose(input, { signal: new AbortController().signal });

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof DiagnosisUnavailableError, `expected DiagnosisUnavailableError, got ${String(err)}`);
    assert.ok(!String(err.message).includes(SENTINEL));
    return err.reason;
  }
  assert.fail("expected a failure");
}

beforeEach(() => {
  calls = [];
  reply = async () => okResponse();
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  Object.assign(console, { log: capture, warn: capture, error: capture, info: capture, debug: capture });
});

afterEach(() => {
  Object.assign(console, original);
  for (const line of logs) {
    assert.ok(!line.includes(SENTINEL), "key leaked to logs");
    assert.ok(!line.includes(PHOTO.slice(30)), "photo leaked to logs");
  }
});

test("sends the approved Responses API request shape", async () => {
  const out = await run();
  assert.deepEqual(out, RESULT);
  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.match(url, /\/responses$/);
  assert.equal(init.method, "POST");
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.store, false);
  assert.deepEqual(body.reasoning, { effort: "low" });
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  const causeSchema = body.text.format.schema.properties.causes.items;
  assert.deepEqual(causeSchema.properties.likelihood.enum, ["low", "medium", "high"]);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.equal(causeSchema.additionalProperties, false);
  assert.match(body.instructions, /in English/);
  assert.match(body.instructions, /percentage/i);
  const parts = body.input[0].content;
  assert.deepEqual(parts[0], { type: "input_text", text: "Plant: Fern" });
  assert.equal(parts[1].type, "input_image");
  assert.equal(parts[1].image_url, PHOTO);
  const sanitized = { ...body, input: [{ ...body.input[0], content: [parts[0], { type: "input_image", length: PHOTO.length, sha256: createHash("sha256").update(PHOTO).digest("hex").slice(0, 12) }] }] };
  assert.ok(!JSON.stringify(sanitized).includes(SENTINEL));
});

test("uses DIAGNOSIS_MODEL when set and the Russian instruction for ru", async () => {
  const provider = createOpenAIDiagnosisProvider({ apiKey: SENTINEL, model: "gpt-test-model", fetch: fakeFetch });
  await provider.diagnose({ ...input, language: "ru" }, { signal: new AbortController().signal });
  assert.equal(calls[0].body.model, "gpt-test-model");
  assert.match(calls[0].body.instructions, /in Russian/);
});

test("constructs the client with maxRetries 2 and a 30 s timeout", () => {
  const provider = createOpenAIDiagnosisProvider({ apiKey: SENTINEL, fetch: fakeFetch });
  assert.equal(OPENAI_MAX_RETRIES, 2);
  assert.equal(OPENAI_TIMEOUT_MS, 30_000);
  assert.equal(provider.client.maxRetries, 2);
  assert.equal(provider.client.timeout, 30_000);
});

test("billing errors are not retried", async () => {
  for (const error of [
    { type: "insufficient_quota", code: "insufficient_quota" },
    { type: "billing_error", code: "credit_balance_exhausted" },
    { type: "requests", code: "project_spend_limit_exceeded" },
  ]) {
    calls = [];
    reply = async () => errorResponse(429, error);
    assert.equal(await failure(run()), "billing", error.code);
    assert.equal(calls.length, 1, error.code);
  }
});

test("rate limits, 500 and 503 overloaded are retried twice, then fail", async () => {
  for (const [status, error, reason] of [
    [429, { type: "requests", code: "rate_limit_exceeded" }, "rate_limit"],
    [500, { type: "server_error", code: null }, "upstream_unavailable"],
    [503, { type: "server_error", code: "server_is_overloaded" }, "upstream_unavailable"],
  ] as const) {
    calls = [];
    reply = async () => errorResponse(status, error);
    assert.equal(await failure(run()), reason, String(status));
    assert.equal(calls.length, 3, String(status));
  }
});

test("one 503 followed by success returns the result", async () => {
  reply = async (n) => (n === 1 ? errorResponse(503, { type: "server_error", code: "server_is_overloaded" }) : okResponse());
  assert.deepEqual(await run(), RESULT);
  assert.equal(calls.length, 2);
});

test("auth errors and connection errors map to failures", async () => {
  reply = async () => errorResponse(401, { type: "invalid_request_error", code: "invalid_api_key" });
  assert.equal(await failure(run()), "request_or_auth");
  assert.equal(calls.length, 1);
  calls = [];
  reply = async () => { throw new TypeError("fetch failed"); };
  assert.equal(await failure(run()), "network");
});

test("refusal is a verdict about the photo, incomplete and non-JSON outputs are failures", async () => {
  reply = async () => new Response(JSON.stringify({
    id: "r", object: "response", status: "completed",
    output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "I can't help with that." }] }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(run(), (error: unknown) => {
    assert.ok(error instanceof DiagnosisNotApplicableError, `expected not-applicable, got ${String(error)}`);
    assert.equal(error.reason, "refusal");
    return true;
  });
  reply = async () => okResponse(JSON.stringify(RESULT).slice(0, 20), { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
  assert.equal(await failure(run()), "incomplete");
  reply = async () => okResponse("not json at all");
  assert.equal(await failure(run()), "invalid_output");
});

test("an aborted signal stops further attempts", async () => {
  const controller = new AbortController();
  reply = async (_n, init) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const provider = createOpenAIDiagnosisProvider({ apiKey: SENTINEL, fetch: fakeFetch });
  const pending = provider.diagnose(input, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  assert.equal(await failure(pending), "aborted");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls.length, 1);
});

test("createDiagnosisProvider: openai with a key is enabled; unset, empty, unknown or keyless is disabled", () => {
  assert.equal(createDiagnosisProvider({ DIAGNOSIS_PROVIDER: "openai", OPENAI_API_KEY: SENTINEL })?.name, "openai");
  assert.equal(createDiagnosisProvider({ DIAGNOSIS_PROVIDER: "openai", OPENAI_API_KEY: SENTINEL, DIAGNOSIS_MODEL: "" })?.model, DEFAULT_DIAGNOSIS_MODEL);
  assert.equal(createDiagnosisProvider({ DIAGNOSIS_PROVIDER: "openai", OPENAI_API_KEY: SENTINEL, DIAGNOSIS_MODEL: "gpt-x" })?.model, "gpt-x");
  assert.equal(createDiagnosisProvider({}), null);
  assert.equal(createDiagnosisProvider({ DIAGNOSIS_PROVIDER: "", OPENAI_API_KEY: SENTINEL }), null);
  assert.equal(createDiagnosisProvider({ DIAGNOSIS_PROVIDER: "gemini", OPENAI_API_KEY: SENTINEL }), null);
  assert.equal(createDiagnosisProvider({ DIAGNOSIS_PROVIDER: "disabled", OPENAI_API_KEY: SENTINEL }), null);
  assert.equal(createDiagnosisProvider({ DIAGNOSIS_PROVIDER: "openai" }), null);
});
