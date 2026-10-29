import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpenAIRequest } from "./openai";

const PHOTO = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64");

test("a plant-less request uses neutral instructions; own-plant and legacy requests keep the houseplant role", () => {
  const unknown = buildOpenAIRequest("m", { photoDataUrl: PHOTO, language: "ru", context: "c", subject: "unknown" });
  assert.doesNotMatch(unknown.instructions, /houseplant/i);
  assert.equal(unknown.store, false);
  const own = buildOpenAIRequest("m", { photoDataUrl: PHOTO, language: "ru", context: "c", subject: "own" });
  const legacy = buildOpenAIRequest("m", { photoDataUrl: PHOTO, language: "ru", context: "c" });
  assert.match(own.instructions, /houseplant/);
  assert.equal(legacy.instructions, own.instructions);
});
