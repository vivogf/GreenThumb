import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_EVENT_LIMIT, buildDiagnosisContext, buildStandaloneContext, diagnosisInstructions, recentCareEvents } from "./prompt";

const plant = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Kitchen fern",
  species_name: "Nephrolepis exaltata",
  water_frequency_days: 10,
  last_watered_date: "2025-12-10",
};
const user = {
  id: 4242, timezone: "Europe/Berlin", season_mode: "north", recovery_key: "changeme-recovery-key-0000",
  recovery_key_hash: "db8055e0e0307d5a016bec4dc338d69875eb0fb7e614a8b125b08fb082095d98",
};

test("uses the species name when present and the plant name otherwise", () => {
  const withSpecies = buildDiagnosisContext({ plant, user, events: [], note: null });
  assert.match(withSpecies, /Nephrolepis exaltata/);
  const noSpecies = buildDiagnosisContext({ plant: { ...plant, species_name: null }, user, events: [], note: null });
  assert.match(noSpecies, /Kitchen fern/);
  assert.doesNotMatch(noSpecies, /Nephrolepis/);
});

test("contains the base and the effective seasonal interval (north, December, 10 → 15)", () => {
  const ctx = buildDiagnosisContext({ plant, user, events: [], note: null });
  assert.match(ctx, /Base watering interval: every 10 days/);
  assert.match(ctx, /Effective watering interval now[^\n]*: every 15 days/);
  const summer = buildDiagnosisContext({ plant: { ...plant, last_watered_date: "2026-06-10" }, user, events: [], note: null });
  assert.match(summer, /Effective watering interval now[^\n]*: every 10 days/);
  const off = buildDiagnosisContext({ plant, user: { ...user, season_mode: "off" }, events: [], note: null });
  assert.match(off, /Effective watering interval now[^\n]*: every 10 days/);
});

test("contains the note when present and no note line when absent", () => {
  const withNote = buildDiagnosisContext({ plant, user, events: [], note: "Leaves turn yellow from the bottom" });
  assert.match(withNote, /Leaves turn yellow from the bottom/);
  const without = buildDiagnosisContext({ plant, user, events: [], note: null });
  assert.doesNotMatch(without, /note|description of the problem/i);
});

test("never contains the user id, the recovery key or photo bytes", () => {
  const ctx = buildDiagnosisContext({ plant, user, events: [], note: "x" });
  assert.doesNotMatch(ctx, /4242/);
  assert.doesNotMatch(ctx, /changeme-recovery-key/);
  assert.doesNotMatch(ctx, /db8055e0/);
  assert.doesNotMatch(ctx, /base64|data:image/);
  assert.doesNotMatch(ctx, new RegExp(plant.id));
});

test("lists the latest 10 care events of this plant only, newest first, types and dates only", () => {
  const events = [];
  for (let day = 1; day <= 12; day++) {
    events.push({ plant_id: plant.id, type: day % 2 ? "water" : "fertilize", occurred_on: `2026-10-${String(day).padStart(2, "0")}`, created_at: `2026-10-${String(day).padStart(2, "0")}T08:00:00.000000Z`, note: null });
  }
  events.push({ plant_id: plant.id, type: "note", occurred_on: "2026-10-12", created_at: "2026-10-12T09:00:00.000000Z", note: "secret journal body" });
  events.push({ plant_id: "22222222-2222-4222-8222-222222222222", type: "repot", occurred_on: "2026-10-20", created_at: "2026-10-20T08:00:00.000000Z", note: null });
  const picked = recentCareEvents(events.slice().reverse().concat([]), plant.id);
  assert.equal(picked.length, CONTEXT_EVENT_LIMIT);
  assert.deepEqual(picked[0], { type: "note", occurred_on: "2026-10-12" });
  assert.deepEqual(picked[1], { type: "fertilize", occurred_on: "2026-10-12" });
  assert.deepEqual(picked[9], { type: "fertilize", occurred_on: "2026-10-04" });
  const ctx = buildDiagnosisContext({ plant, user, events, note: null });
  assert.match(ctx, /- 2026-10-12: note\n- 2026-10-12: fertilize\n- 2026-10-11: water/);
  assert.match(ctx, /- 2026-10-04: fertilize/);
  assert.doesNotMatch(ctx, /2026-10-03|2026-10-02|2026-10-01/);
  assert.doesNotMatch(ctx, /repot|2026-10-20/);
  assert.doesNotMatch(ctx, /secret journal body/);
});

test("says when no care events are recorded", () => {
  assert.match(buildDiagnosisContext({ plant, user, events: [], note: null }), /Recent care events: none recorded/);
});

test("instructions ask for the request language and forbid numeric likelihood", () => {
  const en = diagnosisInstructions("en");
  const ru = diagnosisInstructions("ru");
  assert.match(en, /in English/);
  assert.match(ru, /in Russian/);
  for (const text of [en, ru]) {
    assert.match(text, /percentage/i);
    assert.match(text, /low, medium, high/);
  }
});

test("instructions let the model answer with an empty causes list when there is nothing to diagnose", () => {
  for (const subject of ["own", "unknown"] as const) {
    const text = diagnosisInstructions("en", subject);
    assert.match(text, /empty causes list/i);
    assert.match(text, /does not show a plant/i);
    assert.match(text, /daylight/i);
    assert.match(text, /do not guess/i);
  }
});

test("standalone context holds only the quoted note and states that no plant data is known", () => {
  const ctx = buildStandaloneContext({ note: "Пятна на листьях" });
  assert.match(ctx, /"Пятна на листьях"/);
  assert.match(ctx, /no information about this plant/i);
  for (const forbidden of [/species/i, /interval/i, /water/i, /care event/i, /houseplant/i, /owner/i]) assert.doesNotMatch(ctx, forbidden);
  const empty = buildStandaloneContext({ note: null });
  assert.doesNotMatch(empty, /description of the problem/i);
});

test("instructions for an unknown plant do not assume a houseplant; own-plant instructions stay as before", () => {
  for (const language of ["en", "ru"] as const) {
    const unknown = diagnosisInstructions(language, "unknown");
    assert.doesNotMatch(unknown, /houseplant/i);
    assert.match(unknown, /outdoors|someone else/i);
    assert.match(unknown, /percentage/i);
    assert.match(unknown, /low, medium, high/);
    assert.equal(diagnosisInstructions(language), diagnosisInstructions(language, "own"));
    assert.match(diagnosisInstructions(language), /houseplant/);
  }
});
