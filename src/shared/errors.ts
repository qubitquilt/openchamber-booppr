import { BoopError, isSessionExpired } from "./client";

/** One line describing any thrown value, for a banner or a toast. */
export function describe(error: unknown): string {
  if (error instanceof BoopError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Describe an error and log the full value to the console. */
export function describeAndLog(action: string, error: unknown): string {
  console.error(`${action} failed:`, error);
  return describe(error);
}

/**
 * The outcome a surface's load should render: the sign-in view for a dead
 * session, a retry banner with one line for everything else. The union keeps
 * the impossible state out of the type — an expired outcome carries no
 * message, so no surface can render an empty banner. Shared by the panel, the
 * page and the picker so the routing decision lives once.
 */
export type LoadOutcome = { expired: true } | { expired: false; message: string };

export function classifyLoadError(error: unknown): LoadOutcome {
  if (isSessionExpired(error)) return { expired: true };
  return {
    expired: false,
    message: `Could not reach Boop. ${describeAndLog("Reach Boop", error)}`,
  };
}
