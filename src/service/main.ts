/**
 * The OpenChamber Boop service.
 *
 * The sandboxed panel cannot hold a credential for `host.request` — the host
 * attaches whatever the integration stored, and no guest call can store one —
 * and the Boop receiver authenticates its tenant surface with a session
 * *cookie* (`boop_session`), not a bearer header, so no integration card shape
 * fits. The part of the `boop` CLI that signs in lives here instead, in the
 * one component that can: a host-spawned local process. It runs the receiver's
 * loopback OAuth flow (the same dance `boop auth login` performs), keeps the
 * session JWT, refreshes it on use, and forwards the panel's API calls with
 * the cookie attached. The panel reaches it only through `host.serviceRequest`.
 *
 * The receiver to talk to comes from the panel per sign-in (the sign-in view's
 * server URL field), defaulting to `API_ORIGIN`. It is stored with the token,
 * so every later call goes to the receiver the session was minted against.
 *
 * Contract (`GUEST_SERVICES.md`): bind `OPENCHAMBER_SERVICE_PORT` on 127.0.0.1,
 * require `Authorization: Bearer ${OPENCHAMBER_SERVICE_TOKEN}` on every request,
 * and answer `GET /health` with 200 once ready.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { API_ORIGIN, OAUTH_CLIENT_ID } from "../shared/constants";
import { normalizeOrigin } from "../shared/origin";

const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT ?? "");
const SERVICE_TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";

/** The bundled receiver when the panel names none. */
const DEFAULT_ORIGIN = API_ORIGIN;

/** A human completing GitHub OAuth, possibly with 2FA, inside five minutes. */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 2_000_000;

/** Where the session lives. `HOME`/`XDG_CONFIG_HOME` are passed to the service. */
const configHome =
  process.env.XDG_CONFIG_HOME?.trim() || join(process.env.HOME?.trim() || homedir(), ".config");
const AUTH_FILE = join(configHome, "openchamber-booppr", "auth.json");

/** A tenant slug: the lowercase identifiers tenants are keyed by. */
export function normalizeSlug(value: unknown): string {
  if (typeof value !== "string") return "";
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) ? slug : "";
}

/* ------------------------------------------------------------------ storage */

interface StoredAuth {
  origin: string;
  slug: string;
  jwt: string;
  role: string;
  /** The GitHub user id from the verified claims, for the account menu. */
  account: string;
  expiresAt: string;
  savedAt: number;
}

async function readAuth(): Promise<StoredAuth | null> {
  try {
    const raw = JSON.parse(await readFile(AUTH_FILE, "utf8")) as Partial<StoredAuth>;
    if (typeof raw.jwt === "string" && raw.jwt && typeof raw.slug === "string" && raw.slug) {
      return {
        origin: normalizeOrigin(raw.origin) || DEFAULT_ORIGIN,
        slug: raw.slug,
        jwt: raw.jwt,
        role: typeof raw.role === "string" ? raw.role : "",
        account: typeof raw.account === "string" ? raw.account : "",
        expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
        savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
      };
    }
  } catch {
    // Missing or unreadable is signed out, not an error.
  }
  return null;
}

async function writeAuth(auth: StoredAuth | null): Promise<void> {
  if (!auth) {
    await rm(AUTH_FILE, { force: true });
    return;
  }
  await mkdir(dirname(AUTH_FILE), { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(auth), { mode: 0o600 });
}

/* ------------------------------------------------------------- loopback flow */

interface PendingLogin {
  origin: string;
  slug: string;
  state: string;
  close: () => void;
  expiresAt: number;
}

interface LoginStart {
  loginUrl: string;
  expiresAt: number;
}

type LoginPoll =
  | { status: "pending" }
  | { status: "connected"; account: string; slug: string; role: string; expiresAt: string }
  | { status: "error"; message: string };

let pending: PendingLogin | null = null;
let loginError: string | null = null;

/** One JSON call to a receiver origin. Returns the raw text too, so a non-JSON answer survives. */
async function receiverJson<T>(
  origin: string,
  path: string,
  init: { method: string; body?: unknown; jwt?: string },
): Promise<{ status: number; payload: T | null; text: string }> {
  const response = await fetch(`${origin}${path}`, {
    method: init.method,
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.jwt ? { Cookie: `boop_session=${init.jwt}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload: T | null = null;
  try {
    payload = JSON.parse(text) as T;
  } catch {
    payload = null;
  }
  return { status: response.status, payload, text };
}

interface CliCallbackResponse {
  session_jwt?: string;
  tenant_id?: string;
  role?: string;
  expires_at?: string;
}

/**
 * Serve exactly one redirect before shutting down, like the CLI's listener.
 * The one-time code is exchanged in the background; the promise resolves as
 * soon as the port is known so `startLogin` can answer with the login URL.
 */
function startLoopbackListener(
  state: string,
  onCode: (code: string) => void,
): Promise<{ port: number; close: () => void }> {
  return new Promise((resolvePromise) => {
    let finished = false;
    const close = () => {
      finished = true;
      server.close();
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.statusCode = 404;
        response.end();
        return;
      }
      const code = url.searchParams.get("code") ?? "";
      if (url.searchParams.get("state") !== state || !code) {
        // A probe or a mangled redirect; keep waiting for the real one.
        response.statusCode = 400;
        response.end("state mismatch");
        return;
      }
      if (finished) {
        response.statusCode = 400;
        response.end("already used");
        return;
      }
      finished = true;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<html><body><h2>authorized</h2><p>Return to OpenChamber to continue.</p></body></html>",
      );
      // The response is out; stop listening and trade the code in the background.
      server.close();
      onCode(code);
    });
    server.on("error", () => {
      loginError = "Could not start the local sign-in listener.";
      resolvePromise({ port: 0, close: () => undefined });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ port, close });
    });
  });
}

/** Trade the one-time code for a session and store it. Mirrors `boop auth login`. */
async function exchangeCode(
  origin: string,
  slug: string,
  code: string,
  state: string,
): Promise<void> {
  try {
    const { status, payload } = await receiverJson<CliCallbackResponse>(
      origin,
      `/auth/tenant/${encodeURIComponent(slug)}/cli-callback`,
      { method: "POST", body: { code, state } },
    );
    const jwt = payload?.session_jwt;
    if (status >= 400 || typeof jwt !== "string" || !jwt) {
      loginError =
        status === 403
          ? "The tenant's CLI allow-list no longer contains the boop-cli client id. Ask the tenant admin to allow it."
          : `The receiver refused the sign-in (${status}).`;
      pending = null;
      return;
    }
    const account = await fetchAccountId(origin, jwt);
    const auth: StoredAuth = {
      origin,
      slug: typeof payload?.tenant_id === "string" && payload.tenant_id ? payload.tenant_id : slug,
      jwt,
      role: typeof payload?.role === "string" ? payload.role : "",
      account,
      expiresAt: typeof payload?.expires_at === "string" ? payload.expires_at : "",
      savedAt: Date.now(),
    };
    await writeAuth(auth);
    loginError = null;
    pending = null;
  } catch (error) {
    loginError = error instanceof Error ? error.message : "The sign-in exchange failed.";
    pending = null;
  }
}

/** The verified claims' GitHub user id (`sub`), the friendliest label at hand. */
async function fetchAccountId(origin: string, jwt: string): Promise<string> {
  try {
    const { payload } = await receiverJson<{ sub?: string }>(origin, "/api/me", {
      method: "GET",
      jwt,
    });
    return typeof payload?.sub === "string" ? payload.sub : "";
  } catch {
    return "";
  }
}

async function startLogin(origin: string, slug: string): Promise<LoginStart> {
  // One login at a time: a second start replaces the first, like the CLI's
  // separate processes would.
  if (pending) {
    pending.close();
    pending = null;
  }
  loginError = null;
  const state = randomBytes(16).toString("hex");
  const { port, close } = await startLoopbackListener(
    state,
    (code) => void exchangeCode(origin, slug, code, state),
  );
  if (port === 0) {
    throw new Error(loginError ?? "Could not start the local sign-in listener.");
  }
  pending = { origin, slug, state, close, expiresAt: Date.now() + LOGIN_TIMEOUT_MS };
  const query = new URLSearchParams({
    cli: "1",
    client_id: OAUTH_CLIENT_ID,
    state,
    port: String(port),
  });
  return {
    loginUrl: `${origin}/auth/tenant/${encodeURIComponent(slug)}/login?${query.toString()}`,
    expiresAt: pending.expiresAt,
  };
}

async function pollLogin(): Promise<LoginPoll> {
  if (loginError) {
    const message = loginError;
    loginError = null;
    return { status: "error", message };
  }
  if (!pending) {
    const auth = await readAuth();
    if (!auth) return { status: "error", message: "No sign-in is in progress." };
    return {
      status: "connected",
      account: auth.account,
      slug: auth.slug,
      role: auth.role,
      expiresAt: auth.expiresAt,
    };
  }
  if (Date.now() > pending.expiresAt) {
    pending.close();
    pending = null;
    return { status: "error", message: "The sign-in window timed out. Start again." };
  }
  return { status: "pending" };
}

/* ------------------------------------------------------------------ forward */

interface ForwardInput {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: string;
}

const FORWARD_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function forwardError(
  status: number,
  message: string,
  code: string,
): { status: number; body: string } {
  return { status, body: JSON.stringify({ message, code }) };
}

/**
 * Re-issue the session JWT through the refresh endpoint (BOOP-46). The path
 * slug must match the session's tenant claim, which it does by construction:
 * the stored slug is the slug the session was minted for.
 */
async function refreshSession(auth: StoredAuth): Promise<string | null> {
  try {
    const { status, payload } = await receiverJson<CliCallbackResponse>(
      auth.origin,
      `/auth/tenant/${encodeURIComponent(auth.slug)}/refresh`,
      { method: "POST", jwt: auth.jwt },
    );
    const jwt = payload?.session_jwt;
    if (status >= 400 || typeof jwt !== "string" || !jwt) return null;
    const fresh: StoredAuth = { ...auth, jwt, savedAt: Date.now() };
    await writeAuth(fresh);
    return jwt;
  } catch {
    return null;
  }
}

async function receiverCall(
  auth: StoredAuth,
  input: ForwardInput,
  jwt: string,
): Promise<{ status: number; body: string }> {
  let url: URL;
  try {
    url = new URL(`${auth.origin}${input.path}`);
  } catch {
    return forwardError(400, "Bad path.", "BAD_PATH");
  }
  // A path like `//evil.com` would escape the origin; refuse anything off it.
  if (url.origin !== auth.origin) {
    return forwardError(400, "Bad path.", "BAD_PATH");
  }
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (typeof value === "string") url.searchParams.set(key, value);
    }
  }
  const sendBody = input.method !== "GET" && input.body !== undefined;
  try {
    const response = await fetch(url, {
      method: input.method,
      headers: {
        Accept: "application/json",
        Cookie: `boop_session=${jwt}`,
        ...(sendBody ? { "Content-Type": "application/json" } : {}),
      },
      body: sendBody ? input.body : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return { status: response.status, body: await response.text() };
  } catch {
    return forwardError(502, "Could not reach the Boop receiver.", "UPSTREAM_FAILED");
  }
}

async function forward(input: ForwardInput): Promise<{ status: number; body: string }> {
  const auth = await readAuth();
  if (!auth) {
    return forwardError(401, "Not connected. Sign in to Boop.", "DISCONNECTED");
  }
  if (typeof input?.path !== "string" || !FORWARD_METHODS.has(input.method)) {
    return forwardError(400, "Bad request.", "BAD_REQUEST");
  }
  let result = await receiverCall(auth, input, auth.jwt);
  // Refresh-on-use (BOOP-46): a 401 re-issues the JWT once and replays, the
  // same contract the CLI's doSession implements for a cookie-less client.
  if (result.status === 401) {
    const fresh = await refreshSession(auth);
    if (fresh) result = await receiverCall(auth, input, fresh);
  }
  return result;
}

/* ------------------------------------------------------------------- server */

function send(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error("Request body too large."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.headers.authorization !== `Bearer ${SERVICE_TOKEN}`) {
    send(response, 401, { error: "unauthorized" });
    return;
  }
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const route = `${request.method} ${pathname}`;

  try {
    if (route === "GET /health") {
      send(response, 200, { ok: true });
      return;
    }
    if (route === "GET /account") {
      const auth = await readAuth();
      send(response, 200, {
        connected: Boolean(auth),
        account: auth?.account ?? "",
        slug: auth?.slug ?? "",
        role: auth?.role ?? "",
        expiresAt: auth?.expiresAt ?? "",
        origin: auth?.origin ?? DEFAULT_ORIGIN,
      });
      return;
    }
    if (route === "POST /auth/signout") {
      const auth = await readAuth();
      if (auth) {
        // Best-effort server-side revocation; the local clear is the guarantee.
        await receiverJson(auth.origin, "/auth/logout", { method: "POST", jwt: auth.jwt }).catch(
          () => undefined,
        );
      }
      pending?.close();
      pending = null;
      loginError = null;
      await writeAuth(null);
      send(response, 200, { ok: true });
      return;
    }
    if (route === "POST /auth/start") {
      const body = JSON.parse((await readBody(request)) || "{}") as {
        origin?: unknown;
        slug?: unknown;
      };
      const rawOrigin = typeof body.origin === "string" ? body.origin.trim() : "";
      const origin = rawOrigin ? normalizeOrigin(rawOrigin) : DEFAULT_ORIGIN;
      if (!origin) {
        send(response, 400, {
          error: "bad-origin",
          message:
            "The server URL must be an https origin, like https://app.booppr.com (http is allowed for localhost only).",
        });
        return;
      }
      const slug = normalizeSlug(body.slug);
      if (!slug) {
        send(response, 400, {
          error: "bad-slug",
          message: "Enter the tenant slug to sign in to, like qubitquilt.",
        });
        return;
      }
      send(response, 200, await startLogin(origin, slug));
      return;
    }
    if (route === "POST /auth/poll") {
      send(response, 200, await pollLogin());
      return;
    }
    if (route === "POST /forward") {
      const input = JSON.parse(await readBody(request)) as ForwardInput;
      send(response, 200, await forward(input));
      return;
    }
    send(response, 404, { error: "not-found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Service error.";
    send(response, 500, { error: "service-error", message });
  }
}

createServer((request, response) => {
  void handle(request, response);
}).listen(PORT, "127.0.0.1");
