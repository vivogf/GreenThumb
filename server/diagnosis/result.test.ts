import { test } from "node:test";
import assert from "node:assert/strict";
import { readDiagnosisOutput } from "./result";

/** The result the route would show, or null — the same shape a 200 carries. */
const shown = (raw: unknown) => {
  const reading = readDiagnosisOutput(raw);
  return reading.kind === "ok" ? reading.result : null;
};

const cause = (n: number, likelihood: unknown = "medium") => ({
  title: `Cause ${n}`,
  likelihood,
  explanation: `Explanation ${n}`,
  advice: `Advice ${n}`,
});

test("passes a valid 1-cause and 3-cause result through", () => {
  const one = { causes: [cause(1, "high")], summary: "Overwatering is likely." };
  assert.deepEqual(shown(one), one);
  const three = { causes: [cause(1, "high"), cause(2), cause(3, "low")], summary: "S" };
  assert.deepEqual(shown(three), three);
});

test("keeps the first 3 of 4 causes in provider order", () => {
  const out = shown({ causes: [cause(1), cause(2), cause(3), cause(4)], summary: "S" });
  assert.deepEqual(out?.causes.map((c) => c.title), ["Cause 1", "Cause 2", "Cause 3"]);
});

test("rejects 0 causes, unknown likelihood, missing advice, blank text and non-objects", () => {
  const { advice: _a, ...noAdvice } = cause(1);
  const bad: Array<[string, unknown]> = [
    ["0 causes", { causes: [], summary: "S" }],
    ["very high", { causes: [cause(1, "very high")], summary: "S" }],
    ["numeric likelihood", { causes: [cause(1, 0.8)], summary: "S" }],
    ["missing advice", { causes: [noAdvice], summary: "S" }],
    ["blank summary", { causes: [cause(1)], summary: "  " }],
    ["blank title", { causes: [{ ...cause(1), title: "" }], summary: "S" }],
    ["missing summary", { causes: [cause(1)] }],
    ["string", "not json"],
    ["null", null],
  ];
  for (const [name, raw] of bad) assert.equal(shown(raw), null, name);
});

test("strips extra numeric fields so no number reaches the client", () => {
  const out = shown({ causes: [{ ...cause(1), confidence: 0.8 }], summary: "S", score: 3 });
  assert.ok(out);
  assert.deepEqual(Object.keys(out), ["causes", "summary"]);
  assert.deepEqual(Object.keys(out.causes[0]), ["title", "likelihood", "explanation", "advice"]);
  const numbers = JSON.stringify(out).match(/:\s*-?\d/g);
  assert.equal(numbers, null);
});

test("keeps a percentage inside advice text unchanged", () => {
  const raw = { causes: [{ ...cause(1), advice: "Reduce watering by 20% for a month." }], summary: "S" };
  assert.equal(shown(raw)?.causes[0].advice, "Reduce watering by 20% for a month.");
});

test("rejects text that states a probability or confidence as a number", () => {
  for (const text of ["70% likely", "This is 70 % likely.", "вероятность 60%", "confidence 0.8", "Probability: 45%", "шанс около 30 %"]) {
    const raw = { causes: [{ ...cause(1), explanation: text }], summary: "S" };
    assert.equal(shown(raw), null, text);
  }
  assert.equal(shown({ causes: [cause(1)], summary: "Root rot is 80% probable." }), null);
});

// A photo without a plant (or without any visible disease) is not a service failure: the model says so with an
// empty causes list, and the route answers «not a plant», which is not retryable and costs no daily check.
test("an empty causes list with a summary reads as no_plant, not as invalid output", () => {
  assert.deepEqual(readDiagnosisOutput({ causes: [], summary: "No plant is visible in the photo." }), { kind: "no_plant" });
  assert.deepEqual(readDiagnosisOutput({ causes: [], summary: "На фото нет растения." }), { kind: "no_plant" });
});

test("no_plant needs a readable summary: a blank or missing one is invalid output, not a verdict", () => {
  for (const raw of [{ causes: [], summary: "   " }, { causes: [] }, { summary: "No plant." }, null, "not json"]) {
    assert.deepEqual(readDiagnosisOutput(raw), { kind: "invalid" }, JSON.stringify(raw));
  }
});

test("a valid result reads as ok with the same payload shown() returns", () => {
  const raw = { causes: [cause(1, "high")], summary: "Overwatering is likely." };
  assert.deepEqual(readDiagnosisOutput(raw), { kind: "ok", result: raw });
});

test("broken causes and numeric likelihoods stay invalid, never no_plant", () => {
  const { advice: _a, ...noAdvice } = cause(1);
  for (const raw of [
    { causes: [noAdvice], summary: "S" },
    { causes: [cause(1, "very high")], summary: "S" },
    { causes: [{ ...cause(1), explanation: "70% likely" }], summary: "S" },
  ]) {
    assert.deepEqual(readDiagnosisOutput(raw), { kind: "invalid" }, JSON.stringify(raw));
  }
});
