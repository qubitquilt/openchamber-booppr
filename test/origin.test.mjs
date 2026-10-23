import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeOrigin } from "../build/origin.mjs";

/**
 * The one bare-origin rule both the sign-in field (`parseServerUrl`) and the
 * service (`service/main.ts`) run. Pinning it here pins the pair: if the rule
 * changes, both sides change together and this suite names what changed.
 */

test("accepts a bare https origin", () => {
  assert.equal(normalizeOrigin("https://api.booppr.com"), "https://api.booppr.com");
  assert.equal(normalizeOrigin("  https://api.booppr.com  "), "https://api.booppr.com");
  assert.equal(normalizeOrigin("https://api.booppr.com/"), "https://api.booppr.com");
});

test("accepts http for the loopback hosts only", () => {
  assert.equal(normalizeOrigin("http://localhost:8080"), "http://localhost:8080");
  assert.equal(normalizeOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(normalizeOrigin("http://[::1]:8080"), "http://[::1]:8080");
  assert.equal(normalizeOrigin("http://api.booppr.com"), "");
});

test("refuses a path, query, hash or credentials", () => {
  assert.equal(normalizeOrigin("https://api.booppr.com/api"), "");
  assert.equal(normalizeOrigin("https://api.booppr.com/?x=1"), "");
  assert.equal(normalizeOrigin("https://api.booppr.com/#frag"), "");
  assert.equal(normalizeOrigin("https://user:pass@api.booppr.com"), "");
});

test("refuses other schemes, non-strings and junk", () => {
  assert.equal(normalizeOrigin("ftp://api.booppr.com"), "");
  assert.equal(normalizeOrigin("api.booppr.com"), "");
  assert.equal(normalizeOrigin(""), "");
  assert.equal(normalizeOrigin("   "), "");
  assert.equal(normalizeOrigin(undefined), "");
  assert.equal(normalizeOrigin(42), "");
});
