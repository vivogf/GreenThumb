import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeasonModeBody } from "./seasonMode";

test("accepts the four modes", () => {
  for (const mode of ["auto", "north", "south", "off"]) {
    assert.deepEqual(parseSeasonModeBody({ season_mode: mode }), { ok: true, mode });
  }
});

test("rejects other values with an error string", () => {
  const bad: unknown[] = [
    { season_mode: "winter" },
    { season_mode: "NORTH" },
    { season_mode: "" },
    { season_mode: null },
    { season_mode: 5 },
    { season_mode: ["north"] },
    {},
    null,
    undefined,
    "north",
  ];
  for (const body of bad) {
    const r = parseSeasonModeBody(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    if (!r.ok) assert.match(r.error, /season_mode must be one of auto, north, south, off/);
  }
});
