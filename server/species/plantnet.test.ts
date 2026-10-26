import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { identifyWithPlantNet, mapPlantNetResults, PLANTNET_IDENTIFY_URL } from "./plantnet";
import type { IdentifyImage } from "./identifyInput";

const KEY = "changeme-plantnet-key";
const IMG: IdentifyImage = { mime: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), organ: "auto" };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function raw(name: string, score: number, extra: Record<string, unknown> = {}) {
  return { score, species: { scientificNameWithoutAuthor: name, scientificName: `${name} L.`, commonNames: ["x"] }, gbif: { id: "123" }, images: [], ...extra };
}

test("sends one multipart POST with nb-results=3, lang and paired organs", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fakeFetch = (async (url: URL, init: RequestInit) => {
    calls.push({ url: new URL(String(url)), init });
    return jsonResponse(200, { results: [] });
  }) as unknown as typeof fetch;
  const images: IdentifyImage[] = [{ ...IMG, organ: "leaf" }, { ...IMG, mime: "image/png", organ: "auto" }];
  const out = await identifyWithPlantNet(images, "ru", { apiKey: KEY, fetch: fakeFetch });
  assert.deepEqual(out, { kind: "ok", results: [] });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(`${url.origin}${url.pathname}`, PLANTNET_IDENTIFY_URL);
  assert.equal(init.method, "POST");
  assert.equal(url.searchParams.get("nb-results"), "3");
  assert.equal(url.searchParams.get("lang"), "ru");
  assert.equal(url.searchParams.get("api-key"), KEY);
  const form = init.body as FormData;
  assert.ok(form instanceof FormData);
  assert.deepEqual(form.getAll("organs"), ["leaf", "auto"]);
  const files = form.getAll("images") as Blob[];
  assert.deepEqual(files.map((f) => f.type), ["image/jpeg", "image/png"]);
});

test("maps 7 provider results to 3 candidates in provider order", () => {
  const payload = {
    bestMatch: "A a",
    remainingIdentificationRequests: 499,
    results: [
      raw("Monstera deliciosa", 0.91),
      { score: 0.05, species: { scientificNameWithoutAuthor: "Epipremnum aureum", commonNames: [] } },
      raw("Philodendron hederaceum", 0.02, { gbif: { id: 987 } }),
      raw("D", 0.01), raw("E", 0.01), raw("F", 0.01), raw("G", 0.01),
    ],
  };
  assert.deepEqual(mapPlantNetResults(payload), [
    { scientificName: "Monstera deliciosa", commonNames: ["x"], score: 0.91, gbifId: "123" },
    { scientificName: "Epipremnum aureum", commonNames: [], score: 0.05, gbifId: null },
    { scientificName: "Philodendron hederaceum", commonNames: ["x"], score: 0.02, gbifId: "987" },
  ]);
});

test("malformed success bodies are rejected", () => {
  assert.equal(mapPlantNetResults({}), null);
  assert.equal(mapPlantNetResults({ results: "no" }), null);
  assert.equal(mapPlantNetResults({ results: [{ score: "high" }] }), null);
  assert.deepEqual(mapPlantNetResults({ results: [] }), []);
});

test("a hanging upstream is aborted by the 15 s timeout", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let seen: AbortSignal | undefined;
    const hanging = ((_url: URL, init: RequestInit) => {
      seen = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const pending = identifyWithPlantNet([IMG], "en", { apiKey: KEY, fetch: hanging });
    await Promise.resolve();
    mock.timers.tick(14_999);
    assert.equal(seen?.aborted, false);
    mock.timers.tick(1);
    assert.deepEqual(await pending, { kind: "unavailable", reason: "timeout" });
    assert.equal(seen?.aborted, true);
  } finally {
    mock.timers.reset();
  }
});
