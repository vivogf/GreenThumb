import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAssetLinks,
  createAssetLinksHandler,
  parseFingerprints,
  DEBUG_PACKAGE,
  RELEASE_PACKAGE,
} from "./assetlinks";

// Built at runtime so no fingerprint-shaped literal lives in the source tree.
const fp = (byte: string) => Array(32).fill(byte).join(":");
const RELATIONS = [
  "delegate_permission/common.handle_all_urls",
  "delegate_permission/common.get_login_creds",
];

test("no configured fingerprints gives an empty list", () => {
  assert.deepEqual(buildAssetLinks({}), []);
  assert.deepEqual(buildAssetLinks({ ASSETLINKS_FINGERPRINTS_DEBUG: "  " }), []);
});

test("debug only: exactly one statement for the debug package", () => {
  const statements = buildAssetLinks({ ASSETLINKS_FINGERPRINTS_DEBUG: fp("3C") });
  assert.deepEqual(statements, [{
    relation: RELATIONS,
    target: { namespace: "android_app", package_name: DEBUG_PACKAGE, sha256_cert_fingerprints: [fp("3C")] },
  }]);
});

test("release statement appears only when release fingerprints are configured", () => {
  const statements = buildAssetLinks({
    ASSETLINKS_FINGERPRINTS_DEBUG: fp("3C"),
    ASSETLINKS_FINGERPRINTS_RELEASE: `${fp("AA")}, ${fp("BB")}`,
  });
  assert.equal(statements.length, 2);
  assert.equal(statements[1].target.package_name, RELEASE_PACKAGE);
  assert.deepEqual(statements[1].target.sha256_cert_fingerprints, [fp("AA"), fp("BB")]);
  assert.deepEqual(statements[1].relation, RELATIONS);
});

test("parseFingerprints uppercases, dedupes and drops malformed values", () => {
  assert.deepEqual(parseFingerprints(`${fp("ab")},${fp("AB")} ${fp("CD")}`), [fp("AB"), fp("CD")]);
  assert.deepEqual(parseFingerprints("not-a-fingerprint"), []);
  // SHA-1 length (20 bytes) is rejected
  assert.deepEqual(parseFingerprints(Array(20).fill("AA").join(":")), []);
  assert.deepEqual(parseFingerprints(fp("ZZ")), []);
});

test("handler sends application/json with the built statements", () => {
  const headers: Record<string, string> = {};
  let body = "";
  const res: any = {
    set(name: string, value: string) { headers[name.toLowerCase()] = value; return res; },
    type(value: string) { headers["content-type"] = value; return res; },
    send(value: string) { body = value; return res; },
  };
  createAssetLinksHandler(() => ({ ASSETLINKS_FINGERPRINTS_DEBUG: fp("3C") }))({} as any, res);
  assert.equal(headers["content-type"], "application/json");
  const parsed = JSON.parse(body);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].target.package_name, DEBUG_PACKAGE);
});
