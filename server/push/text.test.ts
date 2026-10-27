import { test } from "node:test";
import assert from "node:assert/strict";
import { notifTitle, plantCountText } from "./text";

const RU: Array<[number, string]> = [
  [1, "1 растение ждёт"],
  [2, "2 растения ждут"],
  [4, "4 растения ждут"],
  [5, "5 растений ждут"],
  [11, "11 растений ждут"],
  [12, "12 растений ждут"],
  [14, "14 растений ждут"],
  [21, "21 растение ждёт"],
  [22, "22 растения ждут"],
  [25, "25 растений ждут"],
  [101, "101 растение ждёт"],
  [111, "111 растений ждут"],
];

for (const [n, head] of RU) {
  test(`plantCountText ru ${n}: noun and verb agree`, () => {
    assert.equal(plantCountText(n, "ru"), `${head} вашего внимания 🌿`);
  });
}

test("plantCountText defaults to ru", () => {
  assert.equal(plantCountText(1), "1 растение ждёт вашего внимания 🌿");
});

test("plantCountText en 1: plant needs", () => {
  assert.equal(plantCountText(1, "en"), "1 plant needs your attention 🌿");
});

test("plantCountText en 2: plants need", () => {
  assert.equal(plantCountText(2, "en"), "2 plants need your attention 🌿");
});

test("notifTitle stays unchanged", () => {
  assert.equal(notifTitle("ru"), "Ваши цветочки ждут заботы 💚");
  assert.equal(notifTitle("en"), "Your plants need care 💚");
  assert.equal(notifTitle(), "Ваши цветочки ждут заботы 💚");
});
