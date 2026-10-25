import { LEGACY_API_ORIGIN } from "./constants";
import { normalizeOrigin } from "./origin";
import { read, write, type StorageStore } from "./storage";

/**
 * The stored **Receiver URL**: the origin the sign-in view persists as
 * `serverUrl` in the preferences record and re-fills the field with on the
 * next open. This module owns the migration on the stored value. It takes the
 * record key and the store as arguments — the same seam `storage.ts` uses —
 * so it stays pure and unit-testable; `preferences.ts` passes the record key
 * and `host.storage`.
 */

/**
 * The stored receiver URL: the value under `recordKey`, with a one-time
 * migration as the side effect. A pre-fix client could have saved the old
 * default there — the dedicated API host — and a login started there can
 * never complete: the receiver's OAuth state cookie is host-only and GitHub's
 * callback is fixed on the tenant origin, so the receiver answers "invalid
 * state" with no hint why. That stale value is cleared so the bundled tenant
 * origin takes over, and every other stored field is kept as-is; the full
 * sanitizer runs again on the next load. The answer is "" once the legacy
 * value is cleared — and also when the record is unreadable, so a storage
 * blip can never answer the API host.
 */
export async function storedReceiverUrl(recordKey: string, store: StorageStore): Promise<string> {
  const prefs = await read(recordKey, sanitizeStoredRecord, store);
  if (normalizeOrigin(prefs.serverUrl) !== LEGACY_API_ORIGIN) return prefs.serverUrl;
  await write(recordKey, { ...prefs, serverUrl: "" }, store);
  return "";
}

/**
 * A narrow sanitizer: the migration only rewrites `serverUrl` and must not
 * reformat the rest of the record, so it passes every other field through
 * untouched instead of applying the full preferences shape.
 */
function sanitizeStoredRecord(raw: unknown): { serverUrl: string } & Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return { serverUrl: "" };
  const value = raw as { serverUrl?: unknown };
  return {
    ...(value as Record<string, unknown>),
    serverUrl: typeof value.serverUrl === "string" ? value.serverUrl : "",
  };
}
