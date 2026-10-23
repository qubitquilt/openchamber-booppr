import { test } from "node:test";
import assert from "node:assert/strict";

import { BoopError, createBoopClient, isSessionExpired } from "../build/client.mjs";
import { classifyLoadError } from "../build/errors.mjs";

/** Record every request and answer from a routing table. */
function stub(routes) {
  const calls = [];
  const request = async (input) => {
    calls.push(input);
    const key = `${input.method} ${input.path}`;
    const route = routes[key];
    if (!route)
      return { status: 404, body: JSON.stringify({ message: "no route", code: "NOT_FOUND" }) };
    if (typeof route === "function") return route(input);
    return { status: 200, body: JSON.stringify(route) };
  };
  return { request, calls };
}

const tenant = "qubitquilt";
const runsPath = `/api/tenants/${tenant}/runs`;
const prsPath = `/api/tenants/${tenant}/prs`;

test("query values are stringified and empty ones are dropped", async () => {
  const { request, calls } = stub({ [`GET ${runsPath}`]: { runs: [] } });
  const client = createBoopClient(request);
  await client.listRuns(tenant, { repo: "boop", mine: true, limit: 25 });

  assert.equal(calls.length, 1);
  const sent = calls[0];
  assert.equal(sent.method, "GET");
  assert.equal(sent.path, runsPath);
  assert.deepEqual(sent.query, { repo: "boop", mine: "true", limit: "25" });
});

test("cursor and status filters ride the query", async () => {
  const { request, calls } = stub({ [`GET ${runsPath}`]: { runs: [] } });
  const client = createBoopClient(request);
  await client.listRuns(tenant, { status: "failed", cursor: "next-page" });

  assert.deepEqual(calls[0].query, { status: "failed", cursor: "next-page", limit: "50" });
});

test("a non-2xx becomes a BoopError with the receiver's message", async () => {
  const { request } = stub({
    [`GET ${runsPath}`]: () => ({ status: 403, body: "forbidden" }),
  });
  const client = createBoopClient(request);
  await assert.rejects(client.listRuns(tenant), (error) => {
    assert.ok(error instanceof BoopError);
    assert.equal(error.status, 403);
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.message, "forbidden");
    return true;
  });
});

test("structured error bodies name their field", async () => {
  const { request } = stub({
    [`GET ${runsPath}`]: () => ({
      status: 400,
      body: JSON.stringify({ field: "limit", message: "bad limit" }),
    }),
  });
  const client = createBoopClient(request);
  await assert.rejects(client.listRuns(tenant), (error) => {
    assert.ok(error instanceof BoopError);
    assert.equal(error.code, "HTTP_400");
    // The field the receiver named leads the message, the BOOP-76 shape.
    assert.equal(error.message, "limit: bad limit");
    return true;
  });
});

test("the service envelope's error code is carried through", async () => {
  const { request } = stub({
    [`GET ${runsPath}`]: () => ({
      status: 401,
      body: JSON.stringify({ message: "Not connected. Sign in to Boop.", code: "DISCONNECTED" }),
    }),
  });
  const client = createBoopClient(request);
  await assert.rejects(client.listRuns(tenant), (error) => {
    assert.ok(error instanceof BoopError);
    // The service's own marker wins over the status-derived label, so a
    // signed-out forward reads DISCONNECTED, not SESSION_EXPIRED.
    assert.equal(error.code, "DISCONNECTED");
    assert.equal(error.status, 401);
    return true;
  });
});

test("a 429 backs off and retries before failing", async () => {
  let attempts = 0;
  const { request } = stub({
    [`GET ${runsPath}`]: () => {
      attempts += 1;
      return attempts < 2
        ? { status: 429, body: "slow down" }
        : { status: 200, body: '{"runs":[]}' };
    },
  });
  const client = createBoopClient(request);
  const response = await client.listRuns(tenant);
  assert.deepEqual(response, { runs: [] });
  assert.equal(attempts, 2);
});

test("triggerReview posts to the PR review route", async () => {
  const { request, calls } = stub({
    [`POST ${prsPath}/boop/boop/191/review`]: { run_id: "run-1", status: "queued" },
  });
  const client = createBoopClient(request);
  const response = await client.triggerReview(tenant, "boop", "boop", 191);

  assert.deepEqual(response, { run_id: "run-1", status: "queued" });
  assert.equal(calls[0].method, "POST");
});

test("feedback posts a JSON body", async () => {
  const feedbackPath = `/api/tenants/${tenant}/runs/run-1/feedback`;
  const { request, calls } = stub({
    [`POST ${feedbackPath}`]: { id: "fb-1", run_id: "run-1", rating: 2, category: "noisy" },
  });
  const client = createBoopClient(request);
  const response = await client.postFeedback(tenant, "run-1", {
    rating: 2,
    category: "noisy",
    comment: "style nit spam",
  });

  assert.equal(response.id, "fb-1");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(JSON.parse(calls[0].body), {
    rating: 2,
    category: "noisy",
    comment: "style nit spam",
  });
});

test("PR detail paths escape their segments", async () => {
  const { request, calls } = stub({
    "GET /api/tenants/t/prs/own%2Fer/repo/12": { pr: {}, runs: [] },
  });
  const client = createBoopClient(request);
  await client.getPRDetail("t", "own/er", "repo", 12);
  assert.equal(calls[0].path, "/api/tenants/t/prs/own%2Fer/repo/12");
});

test("meTenants unwraps the response", async () => {
  const { request } = stub({
    "GET /api/me/tenants": { tenants: [{ id: "acme", role: "member" }] },
  });
  const client = createBoopClient(request);
  assert.deepEqual(await client.meTenants(), [{ id: "acme", role: "member" }]);
});

test("isSessionExpired routes 401s to sign-in and leaves the rest alone", () => {
  // A dead session after refresh-on-use ran, and the service's signed-out
  // envelope, are both 401s only a fresh sign-in helps.
  assert.equal(isSessionExpired(new BoopError(401, "SESSION_EXPIRED", "expired")), true);
  assert.equal(isSessionExpired(new BoopError(401, "DISCONNECTED", "Not connected.")), true);
  assert.equal(isSessionExpired(new BoopError(403, "FORBIDDEN", "forbidden")), false);
  assert.equal(isSessionExpired(new BoopError(500, "HTTP_500", "boom")), false);
  assert.equal(isSessionExpired(new Error("plain")), false);
  assert.equal(isSessionExpired(undefined), false);
});

test("classifyLoadError splits the sign-in route from the retry banner", () => {
  const expired = classifyLoadError(new BoopError(401, "SESSION_EXPIRED", "expired"));
  assert.deepEqual(expired, { expired: true, message: null });

  const refused = classifyLoadError(new BoopError(403, "FORBIDDEN", "forbidden"));
  assert.equal(refused.expired, false);
  assert.match(refused.message ?? "", /^Could not reach Boop\. FORBIDDEN: forbidden$/);
});
