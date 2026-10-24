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
 * - a failed PR fetch reports through `onPRDetailError` (the surface's
 *   banner) — the only fetch whose failure has no inline home; a failed
 *   findings fetch caches the error text inline, and a failed telemetry fetch
 *   caches `null` so a broken telemetry row never retries in a loop;
 * - a re-review makes a PR's cached aggregate stale, and the surfaces drop it
 *   explicitly with `dropPRDetail` when the receiver accepted;
 * - a fetch in flight is marked live, two synchronous ensures fetch once, and
 *   `dropPRDetail` and `clear()` both kill the marker, so a late answer never
 *   lands after the entry it belonged to is gone.
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
  onPRDetailError: (action: string, error: unknown) => void,
): {
  onRender(listener: () => void): void;
  prDetail(tenantId: string, prRef: string): TenantPRDetailResponse | undefined;
  dropPRDetail(tenantId: string, prRef: string): void;
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
   * entry dies with `dropPRDetail` and `clear()`, and the late answer is
   * discarded. */
  const prInFlight = new Map<string, { live: boolean }>();
  const findingsInFlight = new Map<string, { live: boolean }>();
  const telemetryInFlight = new Map<string, { live: boolean }>();

  const key = (tenantId: string, resource: string): string => `${tenantId}|${resource}`;

  return {
    onRender(listener: () => void): void {
      onChange = listener;
    },

    prDetail(tenantId: string, prRef: string): TenantPRDetailResponse | undefined {
      return prDetails.get(key(tenantId, prRef));
    },

    dropPRDetail(tenantId: string, prRef: string): void {
      const cacheKey = key(tenantId, prRef);
      const call = prInFlight.get(cacheKey);
      if (call) call.live = false;
      prInFlight.delete(cacheKey);
      prDetails.delete(cacheKey);
      onChange();
    },

    ensurePRDetail(tenantId: string, owner: string, repo: string, number: number): void {
      const cacheKey = key(tenantId, `${owner}/${repo}#${number}`);
      if (prDetails.has(cacheKey) || prInFlight.has(cacheKey)) return;
      const call = { live: true };
      prInFlight.set(cacheKey, call);
      void fetchers
        .prDetail(tenantId, owner, repo, number)
        .then((detail) => {
          prInFlight.delete(cacheKey);
          if (!call.live) return;
          prDetails.set(cacheKey, detail);
          onChange();
        })
        .catch((error: unknown) => {
          prInFlight.delete(cacheKey);
          if (!call.live) return;
          onPRDetailError("Open pull request", error);
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
      if (!findings.has(cacheKey) && !findingsInFlight.has(cacheKey)) {
        const call = { live: true };
        findingsInFlight.set(cacheKey, call);
        findings.set(cacheKey, { loading: true, error: null });
        void fetchers
          .runFindings(tenantId, runId)
          .then((items) => {
            findingsInFlight.delete(cacheKey);
            if (!call.live) return;
            findings.set(cacheKey, { loading: false, error: null, items });
            onChange();
          })
          .catch((error: unknown) => {
            findingsInFlight.delete(cacheKey);
            if (!call.live) return;
            findings.set(cacheKey, {
              loading: false,
              error: describeAndLog("Load findings", error),
            });
            onChange();
          });
      }
      if (!telemetry.has(cacheKey) && !telemetryInFlight.has(cacheKey)) {
        const call = { live: true };
        telemetryInFlight.set(cacheKey, call);
        telemetry.set(cacheKey, null);
        void fetchers
          .runTelemetry(tenantId, runId)
          .then((row) => {
            telemetryInFlight.delete(cacheKey);
            if (!call.live) return;
            telemetry.set(cacheKey, row);
            onChange();
          })
          .catch(() => {
            telemetryInFlight.delete(cacheKey);
            // A failed fetch caches null — no retry loop — and a killed one
            // leaves nothing behind for `clear()` to have promised.
          });
      }
    },

    clear(): void {
      for (const call of prInFlight.values()) call.live = false;
      for (const call of findingsInFlight.values()) call.live = false;
      for (const call of telemetryInFlight.values()) call.live = false;
      prInFlight.clear();
      findingsInFlight.clear();
      telemetryInFlight.clear();
      prDetails.clear();
      findings.clear();
      telemetry.clear();
      onChange();
    },
  };
}
