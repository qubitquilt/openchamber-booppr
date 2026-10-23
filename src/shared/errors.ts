import { BoopError } from "./client";

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
