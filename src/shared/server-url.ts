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
 * One-time migration for clients upgraded across the tenant-origin fix. A
 * pre-fix client could have saved the old default under `key` — the dedicated
 * API host — and a login started there can never complete: the receiver's
 * OAuth state cookie is host-only and GitHub's callback is fixed on the
 * tenant origin, so the receiver answers "invalid state" with no hint why.
 * Clear the stale value so the bundled tenant origin takes over, and keep
 * every other stored field as-is; the full sanitizer runs again on the next
 * load. Answers the URL the field should show: the stored one, or "" once the
 * legacy value is cleared — also when the record is unreadable, so a storage
 * blip can never leave the API host pre-filled.
 */
export async function clearLegacyServerUrl(key: string, store: StorageStore): Promise<string> {
  const prefs = await read(key, sanitizeStoredRecord, store);
  if (normalizeOrigin(prefs.serverUrl) !== LEGACY_API_ORIGIN) return prefs.serverUrl;
  await write(key, { ...prefs, serverUrl: "" }, store);
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
