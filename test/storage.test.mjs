import { test } from "node:test";
import assert from "node:assert/strict";

import { deleteStorage, read, write } from "../build/storage.mjs";

/** An in-memory store that can fail, like `host.storage` can. */
function mockStore({ fail = false } = {}) {
  const map = new Map();
  return {
    map,
    async get(key) {
      if (fail) throw new Error("read failed");
      return map.get(key);
    },
    async set(key, value) {
      if (fail) throw new Error("write failed");
      map.set(key, value);
    },
    async delete(key) {
      if (fail) throw new Error("delete failed");
      map.delete(key);
    },
  };
}

const sanitize = (raw) => (typeof raw === "object" && raw !== null ? raw : { fallback: true });

test("write strips non-JSON values before storing", async () => {
  const store = mockStore();
  await write("key", { nested: { value: 1 }, fn: () => 1 }, store);
  const stored = store.map.get("key");
  assert.deepEqual(stored, { nested: { value: 1 } });
  assert.equal("fn" in stored, false);
});

test("read passes the stored value through the sanitizer", async () => {
  const store = mockStore();
  store.map.set("key", { hello: "world" });
  assert.deepEqual(await read("key", sanitize, store), { hello: "world" });
  store.map.set("key", 42);
  assert.deepEqual(await read("key", sanitize, store), { fallback: true });
});

test("read answers the sanitized fallback when the store fails", async () => {
  const store = mockStore({ fail: true });
  assert.deepEqual(await read("key", sanitize, store), { fallback: true });
});

test("write and delete swallow failures instead of throwing", async () => {
  const store = mockStore({ fail: true });
  await write("key", { a: 1 }, store);
  await deleteStorage("key", store);
});
