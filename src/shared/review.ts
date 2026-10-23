import { host } from "./host";
import { BoopError, type BoopClient } from "./client";
import { prKey } from "./format";
import { reportFailure } from "./attachments";
import { invalidateBootstrapCache } from "./tenants";

/**
 * The on-demand review flow, its own module rather than a resident of the chip
 * builders: the wording (queued / accepted / duplicate), the 409-duplicate and
 * rate-limit paths, and the shared bootstrap invalidation live once here, and
 * the panel and the page both call it. Resolves `true` when the receiver
 * accepted (or reports a deliberate re-run) and `false` when it refused; the
 * caller reloads its data and drops its PR cache on `true`.
 */
export async function requestReview(
  client: Pick<BoopClient, "triggerReview">,
  tenantId: string,
  owner: string,
  repo: string,
  number: number,
): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const response = await client.triggerReview(tenantId, owner, repo, number);
    if (response.status === "duplicate") {
      await host.toast({
        kind: "info",
        message: `Boop already reviewed the latest head of ${prKey(owner, repo, number)}.`,
        dismiss: true,
      });
    } else if (response.run_id) {
      await host.toast({ kind: "success", message: `Review accepted: ${response.run_id}.` });
    } else {
      await host.toast({
        kind: "success",
        message: `Review of ${prKey(owner, repo, number)} queued.`,
      });
    }
    await invalidateBootstrapCache();
    return true;
  } catch (error) {
    if (error instanceof BoopError && error.code === "RATE_LIMITED") {
      await host.toast({
        kind: "error",
        message: "The tenant's review rate limit is spent for now. Try again later.",
        dismiss: true,
      });
      return false;
    }
    await reportFailure("Request review", error);
    return false;
  }
}
