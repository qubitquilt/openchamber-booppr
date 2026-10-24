import { test } from "node:test";
import assert from "node:assert/strict";

import { storedReceiverUrl } from "../build/server-url.mjs";

/**
 * The receiver-URL migration (Boop reviews of 835521e and 060731c): a client
 * upgraded across the tenant-origin fix can hold the old API-host default in
 * its stored `serverUrl`. The migration must clear exactly that value, keep
 * the rest of the record byte-for-byte — the full preferences sanitizer must
 * fail these tests — and answer "" when the record is unreadable, so a
 * storage blip can never surface the stored API host.
 */

/** An in-memory store that can fail, like `host.storage`. */
function mockStore({ failRead = false } = {}) {
  const map = new Map();
  return {
    map,
    async get(key) {
      if (failRead) throw new Error("read failed");
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

const KEY = "preferences";
const LEGACY = "https://api.booppr.com";

test("clears a stored serverUrl holding the pre-fix API-host default and keeps the rest", async () => {
  const store = mockStore();
  await store.set(KEY, {
    serverUrl: LEGACY,
    tenantId: "acme",
    // Fields the preferences schema does not know: the migration must pass
    // them through untouched, so the full sanitizer cannot pass this test.
    futureFlag: true,
    nested: { a: 1 },
  });

  assert.equal(await storedReceiverUrl(KEY, store), "");

  assert.deepEqual(store.map.get(KEY), {
    serverUrl: "",
    tenantId: "acme",
    futureFlag: true,
    nested: { a: 1 },
  });
});

test("clears the legacy URL when a pre-fix client saved it with a path", async () => {
  // The bare-origin rule collapses `https://api.booppr.com/` to its origin,
  // so the slash form a user once typed must migrate too.
  const store = mockStore();
  await store.set(KEY, { serverUrl: `${LEGACY}/`, tenantId: "acme" });

  assert.equal(await storedReceiverUrl(KEY, store), "");
  assert.equal(store.map.get(KEY).serverUrl, "");
});

test("answers every other stored serverUrl unchanged and writes nothing", async () => {
  for (const serverUrl of [
    "",
    "https://app.booppr.com",
    "http://localhost:8080",
    "https://receiver.example",
  ]) {
    const store = mockStore();
    await store.set(KEY, { serverUrl, tenantId: "acme" });

    assert.equal(await storedReceiverUrl(KEY, store), serverUrl);
    assert.deepEqual(store.map.get(KEY), { serverUrl, tenantId: "acme" });
  }
});

test('answers "" on an empty store without writing', async () => {
  const store = mockStore();

  assert.equal(await storedReceiverUrl(KEY, store), "");
  assert.equal(store.map.has(KEY), false);
});

test('answers "" on a junk record without writing', async () => {
  const store = mockStore();
  store.map.set(KEY, "junk");

  assert.equal(await storedReceiverUrl(KEY, store), "");
  assert.equal(store.map.get(KEY), "junk");
});

test('answers "" on a failed read instead of the stored value', async () => {
  // Boop re-review #3 (F1): a failed read must answer "" rather than the
  // stored API host; re-filling the field with that answer is signin.ts's job.
  const store = mockStore({ failRead: true });

  assert.equal(await storedReceiverUrl(KEY, store), "");
  assert.equal(store.map.has(KEY), false);
});
