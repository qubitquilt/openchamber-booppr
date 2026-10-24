import { LEGACY_API_ORIGIN } from "./constants";
import { normalizeOrigin } from "./origin";
import { read, write, type StorageStore } from "./storage";

/**
 * The stored **Receiver URL**: the origin the sign-in view persists as
 * `serverUrl` in the preferences record and re-fills the field with on the
 * next open. This module owns the record key and the migrations on the stored
 * value, so they run with an injected store and stay unit-testable; the
 * sign-in view passes `host.storage`.
 */

/** The one storage key the preferences record lives under. */
export const PREFERENCES_KEY = "preferences";

/**
 * One-time migration for clients upgraded across the tenant-origin fix. A
 * pre-fix client could have saved the old default here — the dedicated API
 * host — and a login started there can never complete: the receiver's OAuth
 * state cookie is host-only and GitHub's callback is fixed on the tenant
 * origin, so the receiver answers "invalid state" with no hint why. Clear the
 * stale value so the bundled tenant origin takes over, and keep every other
 * stored field as-is; the full sanitizer runs again on the next load.
 * Answers whether it migrated, so the sign-in view can re-fill its field.
 */
export async function clearLegacyServerUrl(store: StorageStore): Promise<boolean> {
  const prefs = await read(PREFERENCES_KEY, storedRecord, store);
  if (normalizeOrigin(prefs.serverUrl) !== LEGACY_API_ORIGIN) return false;
  await write(PREFERENCES_KEY, { ...prefs, serverUrl: "" }, store);
  return true;
}

/**
 * A narrow sanitizer: the migration only rewrites `serverUrl` and must not
 * reformat the rest of the record, so it passes every other field through
 * untouched instead of applying the full preferences shape.
 */
function storedRecord(raw: unknown): { serverUrl: string } & Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return { serverUrl: "" };
  const value = raw as { serverUrl?: unknown };
  return {
    ...(value as Record<string, unknown>),
    serverUrl: typeof value.serverUrl === "string" ? value.serverUrl : "",
  };
}
