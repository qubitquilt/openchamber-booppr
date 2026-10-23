import type { TenantFinding, TenantPRDetailResponse, TenantRunTelemetryResponse } from "./types";
import { describeAndLog } from "./errors";

/**
 * The per-tenant detail caches the panel and the page share.
 *
 * Both surfaces mirror the same fetch-and-cache pair for a PR's aggregate and
 * a run's findings and telemetry; two hand-rolled copies drifted on when a
 * cache dies (the panel served stale findings after a re-review the page
 * would have dropped). One store owns the policy now:
 *
 * - every entry is keyed by tenant first, so a chip pinned under another
 *   membership never reads another tenant's cached data;
 * - a fetch runs once per key until the entry is dropped or `clear()` runs;
 * - a failed PR fetch reports through `onFetchError` (the surface's banner),
 *   a failed findings fetch caches the error text inline, and a failed
 *   telemetry fetch caches `null` so a broken telemetry row never retries in
 *   a loop;
 * - a re-review makes a PR's cached aggregate stale, and the surfaces drop it
 *   explicitly with `dropPRDetail` when the receiver accepted.
 *
 * Pure and host-free, so `npm test` exercises the policy directly.
 */

export interface FindingState {
  loading: boolean;
  error: string | null;
  items?: TenantFinding[];
}

export interface DetailFetchers {
  prDetail(
    tenantId: string,
    owner: string,
    repo: string,
    number: number,
  ): Promise<TenantPRDetailResponse>;
  runFindings(tenantId: string, runId: string): Promise<TenantFinding[]>;
  runTelemetry(tenantId: string, runId: string): Promise<TenantRunTelemetryResponse>;
}

export function createDetailStore(
  fetchers: DetailFetchers,
  onFetchError: (action: string, error: unknown) => void,
): {
  onRender(listener: () => void): void;
  prDetail(tenantId: string, resource: string): TenantPRDetailResponse | undefined;
  dropPRDetail(tenantId: string, resource: string): void;
  ensurePRDetail(tenantId: string, owner: string, repo: string, number: number): void;
  findings(tenantId: string, runId: string): FindingState | null;
  telemetry(tenantId: string, runId: string): TenantRunTelemetryResponse | null;
  ensureRunData(tenantId: string, runId: string): void;
  clear(): void;
} {
  let onChange: () => void = () => undefined;
  const prDetails = new Map<string, TenantPRDetailResponse>();
  const findings = new Map<string, FindingState>();
  const telemetry = new Map<string, TenantRunTelemetryResponse | null>();
  /** A fetch in flight, so two synchronous ensures fetch once. The marker's
   * entry dies with `dropPRDetail`, and the late answer is discarded. */
  const inFlight = new Map<string, { live: boolean }>();

  const key = (tenantId: string, resource: string): string => `${tenantId}|${resource}`;

  return {
    onRender(listener: () => void): void {
      onChange = listener;
    },

    prDetail(tenantId: string, resource: string): TenantPRDetailResponse | undefined {
      return prDetails.get(key(tenantId, resource));
    },

    dropPRDetail(tenantId: string, resource: string): void {
      const cacheKey = key(tenantId, resource);
      const call = inFlight.get(cacheKey);
      if (call) call.live = false;
      inFlight.delete(cacheKey);
      prDetails.delete(cacheKey);
      onChange();
    },

    ensurePRDetail(tenantId: string, owner: string, repo: string, number: number): void {
      const cacheKey = key(tenantId, `${owner}/${repo}#${number}`);
      if (prDetails.has(cacheKey) || inFlight.has(cacheKey)) return;
      const call = { live: true };
      inFlight.set(cacheKey, call);
      void fetchers
        .prDetail(tenantId, owner, repo, number)
        .then((detail) => {
          inFlight.delete(cacheKey);
          if (!call.live) return;
          prDetails.set(cacheKey, detail);
          onChange();
        })
        .catch((error: unknown) => {
          inFlight.delete(cacheKey);
          if (!call.live) return;
          onFetchError("Open pull request", error);
        });
    },

    findings(tenantId: string, runId: string): FindingState | null {
      return findings.get(key(tenantId, runId)) ?? null;
    },

    telemetry(tenantId: string, runId: string): TenantRunTelemetryResponse | null {
      return telemetry.get(key(tenantId, runId)) ?? null;
    },

    ensureRunData(tenantId: string, runId: string): void {
      const cacheKey = key(tenantId, runId);
      if (!findings.has(cacheKey)) {
        findings.set(cacheKey, { loading: true, error: null });
        void fetchers
          .runFindings(tenantId, runId)
          .then((items) => {
            findings.set(cacheKey, { loading: false, error: null, items });
            onChange();
          })
          .catch((error: unknown) => {
            findings.set(cacheKey, {
              loading: false,
              error: describeAndLog("Load findings", error),
            });
            onChange();
          });
      }
      if (!telemetry.has(cacheKey)) {
        telemetry.set(cacheKey, null);
        void fetchers
          .runTelemetry(tenantId, runId)
          .then((row) => {
            telemetry.set(cacheKey, row);
            onChange();
          })
          .catch(() => {
            telemetry.set(cacheKey, null);
          });
      }
    },

    clear(): void {
      prDetails.clear();
      findings.clear();
      telemetry.clear();
      onChange();
    },
  };
}
