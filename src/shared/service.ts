import { host } from "./host";
import { BoopError } from "./client";

/**
 * The panel's side of the local Boop service.
 *
 * Every network call the extension makes goes through this module: the
 * sandboxed iframe cannot hold a credential, and the receiver's tenant surface
 * authenticates with a session *cookie*, so a host-spawned service holds the
 * JWT and attaches it. `serviceTransport` is the drop-in `RequestFn` for
 * `createBoopClient`; the rest drive the loopback sign-in and the account
 * state.
 *
 * `host.serviceRequest` refuses with `NO_SERVICE` until the user allows the
 * local service in Settings → Extensions, and with `SERVICE_FAILED` when the
 * process cannot start; both surface here as thrown errors the banner shows.
 */

/** One line describing any thrown value, for a banner or a toast. */
export function describeServiceError(error: unknown): string {
  if (error instanceof BoopError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Read a `{message}` or `{error}` field out of a parsed body, or a fallback. */
function readErrorField(json: unknown, fallback: string): string {
  const value = (typeof json === "object" && json !== null ? json : {}) as {
    message?: unknown;
    error?: unknown;
  };
  if (typeof value.message === "string" && value.message) return value.message;
  if (typeof value.error === "string" && value.error) return value.error;
  return fallback;
}

async function serviceCall(
  path: string,
  method: "GET" | "POST" = "POST",
  body?: unknown,
): Promise<{ status: number; body: string }> {
  const result = await host.serviceRequest({
    method,
    path,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: result.status, body: result.body };
}

async function serviceJson<T>(
  path: string,
  method: "GET" | "POST" = "POST",
  body?: unknown,
): Promise<T> {
  const result = await serviceCall(path, method, body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new BoopError(
      result.status,
      "SERVICE_BAD_RESPONSE",
      `Boop service answered ${result.status} with a body that is not JSON.`,
    );
  }
  if (result.status >= 400) {
    throw new BoopError(
      result.status,
      readErrorField(parsed, "SERVICE_ERROR"),
      readErrorField(parsed, `Boop service answered ${result.status}.`),
    );
  }
  return parsed as T;
}

/**
 * The `RequestFn` `createBoopClient` takes. Wraps each call in a `POST
 * /forward` the service unwraps, so a GET still travels as a POST to the
 * loopback and the service performs the real method against the receiver.
 */
export async function serviceTransport(input: {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; body: string }> {
  const result = await host.serviceRequest({
    method: "POST",
    path: "/forward",
    body: JSON.stringify(input),
  });
  let envelope: unknown;
  try {
    envelope = JSON.parse(result.body);
  } catch {
    throw new BoopError(
      result.status,
      "SERVICE_BAD_RESPONSE",
      "Boop service answered with a body that is not JSON.",
    );
  }
  const shaped = (typeof envelope === "object" && envelope !== null ? envelope : {}) as {
    status?: unknown;
    body?: unknown;
  };
  if (typeof shaped.status !== "number") {
    throw new BoopError(
      result.status >= 400 ? result.status : 502,
      "SERVICE_ERROR",
      readErrorField(envelope, "Boop service returned an unexpected answer."),
    );
  }
  return { status: shaped.status, body: typeof shaped.body === "string" ? shaped.body : "" };
}

/* ------------------------------------------------------------------ account */

export interface BoopAccount {
  connected: boolean;
  account: string;
  slug: string;
  role: string;
  expiresAt: string;
  origin: string;
}

export const boopAccount = () => serviceJson<BoopAccount>("/account", "GET");

/* ---------------------------------------------------------------- sign-in */

export interface LoginStart {
  loginUrl: string;
  expiresAt: number;
}

export type LoginPoll =
  | { status: "pending" }
  | { status: "connected"; account: string; slug: string; role: string; expiresAt: string }
  | { status: "error"; message: string };

export const startSignIn = (origin: string, slug: string) =>
  serviceJson<LoginStart>("/auth/start", "POST", { origin, slug });
export const pollSignIn = () => serviceJson<LoginPoll>("/auth/poll", "POST");
export const signOutOfBoop = () => serviceJson<{ ok: true }>("/auth/signout", "POST");
