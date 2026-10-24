import { test } from "node:test";
import assert from "node:assert/strict";

import { clearLegacyServerUrl, PREFERENCES_KEY } from "../build/server-url.mjs";
import { write } from "../build/storage.mjs";

/**
 * The receiver-URL migration (Boop review of 835521e, F1): a client upgraded
 * across the tenant-origin fix can hold the old API-host default in its
 * stored `serverUrl`. The migration must clear exactly that value and keep
 * the rest of the record, or the invalid-state sign-in bug returns unnoticed.
 */

/** An in-memory store, like `host.storage`. */
function mockStore() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

const LEGACY = "https://api.booppr.com";

test("clears a stored serverUrl holding the pre-fix API-host default and keeps the tenant", async () => {
  const store = mockStore();
  await write(PREFERENCES_KEY, { serverUrl: LEGACY, tenantId: "acme" }, store);

  assert.equal(await clearLegacyServerUrl(store), true);

  const saved = store.map.get(PREFERENCES_KEY);
  assert.equal(saved.serverUrl, "");
  assert.equal(saved.tenantId, "acme");
});

test("clears the legacy URL when a pre-fix client saved it with a path", async () => {
  // The bare-origin rule collapses `https://api.booppr.com/` to its origin,
  // so the slash form a user once typed must migrate too.
  const store = mockStore();
  await write(PREFERENCES_KEY, { serverUrl: `${LEGACY}/`, tenantId: "acme" }, store);

  assert.equal(await clearLegacyServerUrl(store), true);
  assert.equal(store.map.get(PREFERENCES_KEY).serverUrl, "");
});

test("leaves every other stored serverUrl alone", async () => {
  for (const serverUrl of [
    "",
    "https://app.booppr.com",
    "http://localhost:8080",
    "https://receiver.example",
  ]) {
    const store = mockStore();
    await write(PREFERENCES_KEY, { serverUrl, tenantId: "acme" }, store);

    assert.equal(await clearLegacyServerUrl(store), false);
    assert.deepEqual(store.map.get(PREFERENCES_KEY), { serverUrl, tenantId: "acme" });
  }
});

test("answers false on an empty store without writing", async () => {
  const store = mockStore();

  assert.equal(await clearLegacyServerUrl(store), false);
  assert.equal(store.map.has(PREFERENCES_KEY), false);
});

test("answers false on a junk record without writing", async () => {
  const store = mockStore();
  store.map.set(PREFERENCES_KEY, "junk");

  assert.equal(await clearLegacyServerUrl(store), false);
  assert.equal(store.map.get(PREFERENCES_KEY), "junk");
});
