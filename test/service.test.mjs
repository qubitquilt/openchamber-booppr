import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The service's loopback contract (`GUEST_SERVICES.md`): bind the given port,
 * require the bearer on every request, answer `/health` with 200, and wrap
 * forwarded calls and service errors in the shape `src/shared/service.ts`
 * expects. The login-URL route is exercised against an origin nothing listens
 * on: the loopback listener starts locally and answers before any receiver is
 * contacted. No real receiver call is made, so the run needs no account.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE = resolve(root, "service/main.js");
const TOKEN = "contract-test-token";

let child;
let port;
let configHome;

function freePort() {
  return new Promise((res, rej) => {
    const server = createServer();
    server.on("error", rej);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => res(address.port));
    });
  });
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const url = (path) => `http://127.0.0.1:${port}${path}`;

async function waitForHealth() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url("/health"), { headers: auth });
      if (response.status === 200) return true;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

before(async () => {
  assert.ok(existsSync(SERVICE), "service/main.js is not built. Run npm run build.");
  configHome = await mkdtemp(join(tmpdir(), "oc-boop-service-"));
  port = await freePort();
  child = spawn(process.execPath, [SERVICE], {
    env: {
      ...process.env,
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: TOKEN,
      XDG_CONFIG_HOME: configHome,
    },
    stdio: "ignore",
  });
  assert.ok(await waitForHealth(), "the service never answered /health");
});

after(async () => {
  child?.kill("SIGTERM");
  if (configHome) await rm(configHome, { recursive: true, force: true });
});

test("answers /health only with the bearer", async () => {
  const authed = await fetch(url("/health"), { headers: auth });
  assert.equal(authed.status, 200);
  assert.deepEqual(await authed.json(), { ok: true });

  const anon = await fetch(url("/health"));
  assert.equal(anon.status, 401);
});

test("reports a signed-out account without a session", async () => {
  const response = await fetch(url("/account"), { headers: auth });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.connected, false);
  assert.equal(body.account, "");
  assert.match(body.origin, /^https:\/\//);
});

test("refuses a sign-in origin that is not a bare origin", async () => {
  const response = await fetch(url("/auth/start"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ origin: "https://api.booppr.com/path", slug: "acme" }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "bad-origin");
});

test("refuses a sign-in without a tenant slug", async () => {
  const response = await fetch(url("/auth/start"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ origin: "https://api.booppr.com", slug: "" }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "bad-slug");
});

test("defaults the sign-in to the tenant origin, not the API host", async () => {
  // The receiver's OAuth state cookie is host-only and its callback is
  // https://app.booppr.com/auth/callback. A login started on the API host
  // comes back to that callback without the cookie, which the receiver
  // renders as "invalid state" — so the default must be the tenant origin.
  const response = await fetch(url("/auth/start"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "acme" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(new URL(body.loginUrl).origin, "https://app.booppr.com");
});

test("starts a loopback login with the CLI's client id", async () => {
  const response = await fetch(url("/auth/start"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ origin: "https://api.booppr.com", slug: "acme" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.loginUrl, /^https:\/\/api\.booppr\.com\/auth\/tenant\/acme\/login\?/);
  const query = new URL(body.loginUrl).searchParams;
  assert.equal(query.get("cli"), "1");
  assert.equal(query.get("client_id"), "boop-cli");
  assert.ok(query.get("state"));
  assert.ok(Number(query.get("port")) > 0);
});

test("wraps a signed-out forward as a DISCONNECTED envelope", async () => {
  const response = await fetch(url("/forward"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "GET", path: "/api/me" }),
  });
  assert.equal(response.status, 200);
  const envelope = await response.json();
  assert.equal(envelope.status, 401);
  assert.deepEqual(JSON.parse(envelope.body), {
    message: "Not connected. Sign in to Boop.",
    code: "DISCONNECTED",
  });
});

test("forwards to the stored origin with the session cookie attached", async () => {
  // A throwaway local receiver pins both halves of the forward: the call must
  // land on the origin the session was minted against (not the bundled
  // default), and it must carry the session cookie and the JSON accept header.
  // Without the listener the test would pass even if the service ignored the
  // stored origin or dropped the cookie, because nothing would see either.
  const { writeFile, mkdir } = await import("node:fs/promises");
  const seen = { path: "", cookie: "", accept: "", contentType: "" };
  const upstream = createHttpServer((request, response) => {
    seen.path = request.url ?? "";
    seen.cookie = String(request.headers.cookie ?? "");
    seen.accept = String(request.headers.accept ?? "");
    seen.contentType = String(request.headers["content-type"] ?? "");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ sub: "12345" }));
  });
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
  const upstreamAddress = upstream.address();
  const upstreamPort =
    typeof upstreamAddress === "object" && upstreamAddress ? upstreamAddress.port : 0;
  try {
    const authDir = join(configHome, "openchamber-booppr");
    await mkdir(authDir, { recursive: true });
    await writeFile(
      join(authDir, "auth.json"),
      JSON.stringify({
        origin: `http://127.0.0.1:${upstreamPort}`,
        slug: "acme",
        jwt: "session-jwt",
        role: "member",
        account: "",
        expiresAt: "",
        savedAt: 1,
      }),
    );
    const response = await fetch(url("/forward"), {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ method: "GET", path: "/api/me" }),
    });
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.equal(envelope.status, 200);
    assert.deepEqual(JSON.parse(envelope.body), { sub: "12345" });

    assert.equal(seen.path, "/api/me");
    assert.equal(seen.cookie, "boop_session=session-jwt");
    assert.match(seen.accept, /application\/json/);
  } finally {
    await new Promise((done) => upstream.close(done));
  }
});

test("forwards a POST with its method, body and content type", async () => {
  // The write path `triggerReview` rides. A service that hardcoded GET or
  // dropped the body would keep a GET-only suite green, so this pins the
  // method, the body bytes and the content type the service attaches.
  const { writeFile, mkdir } = await import("node:fs/promises");
  const seen = { method: "", path: "", cookie: "", contentType: "", body: "" };
  const upstream = createHttpServer((request, response) => {
    seen.method = request.method ?? "";
    seen.path = request.url ?? "";
    seen.cookie = String(request.headers.cookie ?? "");
    seen.contentType = String(request.headers["content-type"] ?? "");
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      seen.body = Buffer.concat(chunks).toString("utf8");
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ run_id: "run-9", status: "queued" }));
    });
  });
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
  const upstreamAddress = upstream.address();
  const upstreamPort =
    typeof upstreamAddress === "object" && upstreamAddress ? upstreamAddress.port : 0;
  try {
    const authDir = join(configHome, "openchamber-booppr");
    await mkdir(authDir, { recursive: true });
    await writeFile(
      join(authDir, "auth.json"),
      JSON.stringify({
        origin: `http://127.0.0.1:${upstreamPort}`,
        slug: "acme",
        jwt: "session-jwt",
        role: "member",
        account: "",
        expiresAt: "",
        savedAt: 1,
      }),
    );
    const response = await fetch(url("/forward"), {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "POST",
        path: "/api/tenants/acme/prs/own/repo/9/review",
        body: "{}",
      }),
    });
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.equal(envelope.status, 202);
    assert.deepEqual(JSON.parse(envelope.body), { run_id: "run-9", status: "queued" });

    assert.equal(seen.method, "POST");
    assert.equal(seen.path, "/api/tenants/acme/prs/own/repo/9/review");
    assert.equal(seen.cookie, "boop_session=session-jwt");
    assert.equal(seen.contentType, "application/json");
    assert.equal(seen.body, "{}");
  } finally {
    await new Promise((done) => upstream.close(done));
  }
});

test("refuses a forward path that is not a path", async () => {
  const response = await fetch(url("/forward"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "GET", path: "https://evil.example/api/me" }),
  });
  assert.equal(response.status, 200);
  const envelope = await response.json();
  assert.equal(envelope.status, 400);
  assert.equal(JSON.parse(envelope.body).code, "BAD_PATH");
});

test("refuses an unknown forward method", async () => {
  const response = await fetch(url("/forward"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "CONNECT", path: "/api/me" }),
  });
  assert.equal(response.status, 200);
  const envelope = await response.json();
  assert.equal(envelope.status, 400);
  assert.equal(JSON.parse(envelope.body).code, "BAD_REQUEST");
});

test("refuses an unknown route", async () => {
  const response = await fetch(url("/nope"), { headers: auth });
  assert.equal(response.status, 404);
});
