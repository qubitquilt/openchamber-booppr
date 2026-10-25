import { TENANT_ORIGIN } from "./constants";
import { host } from "./host";
import { loadPreferences, savePreferences } from "./preferences";
import { deleteStorage, read, write } from "./storage";
import { normalizeOrigin } from "./origin";
import type { SessionTenantClaim } from "./types";

/**
 * The account, the memberships and the active tenant every surface starts
 * from. The tenant comes from stored preferences, then the seed slug, then
 * the first membership the session can see.
 */

export interface TenantContext {
  /** The GitHub user id from the verified claims, for the account menu. */
  account: string;
  /** The live memberships (`GET /api/me/tenants`). */
  tenants: SessionTenantClaim[];
  /** The tenant the surfaces work in. */
  tenantId: string;
  role: string;
}

export class NoTenantError extends Error {
  constructor() {
    super("This account has no Boop tenant membership yet.");
    this.name = "NoTenantError";
  }
}

/**
 * Resolve the account, the memberships and the active tenant. The membership
 * list is the receiver's live lookup, not the JWT's mint-time snapshot, so a
 * newly invited tenant shows up without a re-login.
 */
export async function bootstrap(
  client: {
    meTenants(): Promise<SessionTenantClaim[]>;
    me(): Promise<{ sub: string }>;
  },
  seedSlug?: string,
  options: { force?: boolean } = {},
): Promise<TenantContext> {
  if (!options.force) {
    const cached = await readCache();
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.context;
  }

  const [tenants, me] = await Promise.all([
    client.meTenants(),
    client.me().catch(() => ({ sub: "" })),
  ]);
  if (tenants.length === 0) throw new NoTenantError();

  const stored = await loadPreferences();
  const active =
    stored.tenantId && tenants.some((entry) => entry.id === stored.tenantId)
      ? stored.tenantId
      : ((seedSlug && tenants.find((entry) => entry.id === seedSlug)?.id) ??
        (tenants[0] as SessionTenantClaim).id);
  const role = tenants.find((entry) => entry.id === active)?.role ?? "";

  if (active !== stored.tenantId) {
    await savePreferences({ tenantId: active });
  }

  const context: TenantContext = { account: me.sub, tenants, tenantId: active, role };
  await writeCache(context);
  return context;
}

/**
 * The account, membership and role change rarely, and the panel, the picker
 * and the page each run this on open. Caching for a minute keeps a burst of
 * surface opens from tripping the ingress rate limit. Pass `force: true` after
 * a sign-in or a switch to read past it.
 */
const CACHE_KEY = "bootstrap-cache";
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  context: TenantContext;
}

async function readCache(): Promise<CacheEntry | null> {
  return read(
    CACHE_KEY,
    (raw) => {
      if (!raw || typeof raw !== "object") return null;
      const entry = raw as Partial<CacheEntry>;
      if (typeof entry.at !== "number" || !entry.context || typeof entry.context !== "object")
        return null;
      const contextRaw = entry.context as Partial<TenantContext>;
      if (!Array.isArray(contextRaw.tenants) || typeof contextRaw.tenantId !== "string")
        return null;
      return {
        at: entry.at,
        context: {
          account: contextRaw.account ?? "",
          tenants: (contextRaw.tenants ?? []) as SessionTenantClaim[],
          tenantId: contextRaw.tenantId,
          role: contextRaw.role ?? "",
        },
      } as CacheEntry;
    },
    host.storage,
  );
}

async function writeCache(context: TenantContext): Promise<void> {
  await write(CACHE_KEY, { at: Date.now(), context }, host.storage);
}

export async function invalidateBootstrapCache(): Promise<void> {
  await deleteStorage(CACHE_KEY, host.storage);
}

/**
 * Validate a typed server URL to a bare origin, or report the problem. Empty
 * means the bundled origin, which is what the field defaults to. The rule is
 * the shared one in `origin.ts`, so the field can never accept a URL the
 * service then rejects: https everywhere except the loopback hosts.
 */
export function parseServerUrl(value: string | undefined): {
  origin: string;
  error: string | null;
} {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { origin: TENANT_ORIGIN, error: null };
  const origin = normalizeOrigin(trimmed);
  if (origin) return { origin, error: null };
  return {
    origin: TENANT_ORIGIN,
    error: `Enter an https origin, like ${TENANT_ORIGIN} (http is allowed for localhost).`,
  };
}

/** Shared badge: how many reviews are in flight for the tenant. */
export async function refreshBadge(inFlightCount: number): Promise<void> {
  try {
    await host.setBadge(inFlightCount > 999 ? 999 : inFlightCount);
  } catch {
    // A badge is decoration. Never let it break a surface.
  }
}
