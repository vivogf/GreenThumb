import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANT_NOT_FOUND, isPlantId, requireOwnedPlant } from "./ownership";

const A_PLANT = { id: "8d3c7f0e-1b2a-4c5d-9e8f-0a1b2c3d4e5f", user_id: "10", name: "A-plant" };

function lookup(id: string, userId: number) {
  return Promise.resolve(id === A_PLANT.id && String(userId) === A_PLANT.user_id ? A_PLANT : null);
}

test("isPlantId accepts UUIDs and rejects everything else", () => {
  assert.equal(isPlantId(A_PLANT.id), true);
  assert.equal(isPlantId(A_PLANT.id.toUpperCase()), true);
  for (const bad of ["not-a-uuid", "12345", "' OR 1=1--", "", `${A_PLANT.id}x`]) {
    assert.equal(isPlantId(bad), false, bad);
  }
});

test("the owner gets the plant", async () => {
  assert.deepEqual(await requireOwnedPlant(lookup, A_PLANT.id, 10), A_PLANT);
});

test("a plant of another user is treated as not found", async () => {
  assert.equal(await requireOwnedPlant(lookup, A_PLANT.id, 11), null);
});

test("a missing id and an invalid id are not found without a lookup", async () => {
  let calls = 0;
  const counting = (id: string, userId: number) => { calls++; return lookup(id, userId); };
  assert.equal(await requireOwnedPlant(counting, "7d3c7f0e-1b2a-4c5d-9e8f-0a1b2c3d4e5f", 10), null);
  assert.equal(await requireOwnedPlant(counting, "not-a-uuid", 10), null);
  assert.equal(calls, 1);
});

test("the not-found body is the documented one", () => {
  assert.deepEqual(PLANT_NOT_FOUND, { error: "Plant not found" });
});
