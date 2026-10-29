import { test } from "node:test";
import assert from "node:assert/strict";
import { VAPID_SUBJECT, configureVapid } from "./vapid";

test("the VAPID subject is the support mailbox", () => {
  assert.equal(VAPID_SUBJECT, "mailto:greenthumbapp@proton.me");
});

test("configureVapid passes the subject and keys only when both keys are set", () => {
  const calls: string[][] = [];
  const set = (...args: string[]) => { calls.push(args); };
  assert.equal(configureVapid({}, set), false);
  assert.equal(configureVapid({ VAPID_PUBLIC_KEY: "changeme-public" }, set), false);
  assert.equal(calls.length, 0);
  assert.equal(configureVapid({ VAPID_PUBLIC_KEY: "changeme-public", VAPID_PRIVATE_KEY: "changeme-private" }, set), true);
  assert.deepEqual(calls, [["mailto:greenthumbapp@proton.me", "changeme-public", "changeme-private"]]);
});
