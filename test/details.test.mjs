import { test } from "node:test";
import assert from "node:assert/strict";

import { createDetailStore } from "../build/details.mjs";

/** A fetcher that records its calls and answers from a routing table. */
function stubFetchers() {
  const calls = [];
  const fetchers = {
    prDetail: async (tenantId, owner, repo, number) => {
      calls.push(`pr ${tenantId} ${owner}/${repo}#${number}`);
      return { pr: { owner, repo, pr_number: number }, runs: [], findings: [] };
    },
    runFindings: async (tenantId, runId) => {
      calls.push(`findings ${tenantId} ${runId}`);
      if (runId === "boom") throw new Error("receiver down");
      return [
        {
          pk: 1,
          id: "f",
          run_id: runId,
          lens: "l",
          severity: "low",
          headline: "h",
          rationale: "",
          posted: false,
          recorded_at: "",
        },
      ];
    },
    runTelemetry: async (tenantId, runId) => {
      calls.push(`telemetry ${tenantId} ${runId}`);
      if (runId === "boom") throw new Error("no telemetry");
      return {
        run_id: runId,
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        cache_read_tokens: 0,
        cost_usd: 0,
        step_count: 1,
        lenses: [],
      };
    },
  };
  return { fetchers, calls };
}

function makeStore(fetchers, errors = []) {
  const renders = [];
  const store = createDetailStore(fetchers, (action, error) =>
    errors.push(`${action}: ${error?.message ?? error}`),
  );
  store.onRender(() => renders.push(1));
  return { store, renders, errors };
}

test("a fetch runs once per tenant and resource until dropped", async () => {
  const { fetchers, calls } = stubFetchers();
  const { store, renders } = makeStore(fetchers);
  store.ensurePRDetail("t1", "o", "r", 9);
  store.ensurePRDetail("t1", "o", "r", 9);
  await new Promise((done) => setTimeout(done, 0));

  assert.deepEqual(calls, ["pr t1 o/r#9"]);
  assert.equal(store.prDetail("t1", "o/r#9")?.pr.pr_number, 9);
  assert.equal(renders.length, 1);

  store.dropPRDetail("t1", "o/r#9");
  store.ensurePRDetail("t1", "o", "r", 9);
  await new Promise((done) => setTimeout(done, 0));
  assert.deepEqual(calls, ["pr t1 o/r#9", "pr t1 o/r#9"]);
});

test("entries are keyed by tenant first, so memberships never share", async () => {
  const { fetchers, calls } = stubFetchers();
  const { store } = makeStore(fetchers);
  store.ensurePRDetail("t1", "o", "r", 9);
  store.ensurePRDetail("t2", "o", "r", 9);
  await new Promise((done) => setTimeout(done, 0));

  assert.deepEqual(calls, ["pr t1 o/r#9", "pr t2 o/r#9"]);
  assert.notEqual(store.prDetail("t1", "o/r#9"), store.prDetail("t2", "o/r#9"));
  assert.equal(store.prDetail("t2", "o/r#9")?.pr.pr_number, 9);
});

test("findings cache the error text inline; telemetry caches null", async () => {
  const { fetchers } = stubFetchers();
  const errors = [];
  const { store } = makeStore(fetchers, errors);
  store.ensureRunData("t1", "boom");
  await new Promise((done) => setTimeout(done, 0));

  const findings = store.findings("t1", "boom");
  assert.equal(findings?.loading, false);
  assert.match(findings?.error ?? "", /receiver down/);
  assert.equal(store.telemetry("t1", "boom"), null);

  // A failed fetch stays cached: no retry loop, no second error report.
  const before = errors.length;
  store.ensureRunData("t1", "boom");
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(errors.length, before);
});

test("a drop mid-flight discards the late answer", async () => {
  // The documented kill: a fetch started, dropped before it settles, and its
  // answer arriving anyway must not land in the cache.
  const calls = [];
  let releaseFirst;
  const { store, renders } = makeStore({
    prDetail: async (tenantId, owner, repo, number) => {
      calls.push(`pr ${tenantId} ${owner}/${repo}#${number}`);
      if (calls.length === 1) {
        return new Promise((done) => {
          releaseFirst = () =>
            done({ pr: { owner, repo, pr_number: number }, runs: [], findings: [] });
        });
      }
      return { pr: { owner, repo, pr_number: number }, runs: [], findings: [] };
    },
    runFindings: async () => [],
    runTelemetry: async (runId) => ({
      run_id: runId,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: 0,
      step_count: 0,
      lenses: [],
    }),
  });

  store.ensurePRDetail("t1", "o", "r", 9);
  store.dropPRDetail("t1", "o/r#9");
  releaseFirst();
  await new Promise((done) => setTimeout(done, 0));

  assert.equal(store.prDetail("t1", "o/r#9"), undefined);
  assert.equal(renders.length, 1, "only the drop repaints; the late answer is silent");

  // A fresh ensure after the kill refetches and lands normally.
  store.ensurePRDetail("t1", "o", "r", 9);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(store.prDetail("t1", "o/r#9")?.pr.pr_number, 9);
  assert.deepEqual(calls, ["pr t1 o/r#9", "pr t1 o/r#9"]);
});

test("clear() kills in-flight fetches the way a drop does", async () => {
  const calls = [];
  let releaseFirst;
  const { store } = makeStore({
    prDetail: async (tenantId, owner, repo, number) => {
      calls.push(`pr ${tenantId} ${owner}/${repo}#${number}`);
      if (calls.length === 1) {
        return new Promise((done) => {
          releaseFirst = () =>
            done({ pr: { owner, repo, pr_number: number }, runs: [], findings: [] });
        });
      }
      return { pr: { owner, repo, pr_number: number }, runs: [], findings: [] };
    },
    runFindings: async () => [],
    runTelemetry: async (runId) => ({
      run_id: runId,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: 0,
      step_count: 0,
      lenses: [],
    }),
  });

  store.ensurePRDetail("t1", "o", "r", 9);
  store.clear();
  releaseFirst();
  await new Promise((done) => setTimeout(done, 0));

  assert.equal(store.prDetail("t1", "o/r#9"), undefined);

  store.ensurePRDetail("t1", "o", "r", 9);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(store.prDetail("t1", "o/r#9")?.pr.pr_number, 9);
  assert.deepEqual(calls, ["pr t1 o/r#9", "pr t1 o/r#9"]);
});

test("clear() empties every tenant's caches", async () => {
  const { fetchers, calls } = stubFetchers();
  const { store } = makeStore(fetchers);
  store.ensurePRDetail("t1", "o", "r", 1);
  store.ensureRunData("t1", "run-1");
  await new Promise((done) => setTimeout(done, 0));

  store.clear();
  assert.equal(store.prDetail("t1", "o/r#1"), undefined);
  assert.equal(store.findings("t1", "run-1"), null);

  store.ensurePRDetail("t1", "o", "r", 1);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(calls.filter((entry) => entry === "pr t1 o/r#1").length, 2);
});
