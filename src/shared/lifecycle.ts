import { host } from "./host";
import { loadPreferences, loadSessionLinks, markSessionOutcome } from "./preferences";
import { parsePRRef, sessionToast } from "./format";
import type { BoopClient } from "./client";

/**
 * PR-linked session outcomes.
 *
 * A session started from a PR chip is remembered with that PR; while any Boop
 * surface is open, its lifecycle events record the outcome on the link, tell
 * the user, and — when the user opted in — trigger a fresh Boop review of the
 * new head. Nothing is ever posted to GitHub from here: the receiver owns that
 * surface.
 *
 * The watcher lives in whichever surface is open, so a session that outlives
 * every Boop surface records no further outcomes.
 */

let watching = false;

/**
 * Register once per surface. `onReady` can repeat, so a second call is a
 * no-op rather than a second handler that acts twice.
 */
export function watchSessionLifecycle(client: BoopClient): void {
  if (watching) return;
  watching = true;
  host.onSessionLifecycle(async (event) => {
    const phase =
      event.phase === "started"
        ? "started"
        : event.phase === "completed"
          ? "completed"
          : event.phase === "failure"
            ? "failed"
            : null;
    if (!phase) return;

    const links = await loadSessionLinks();
    const link = links[event.sessionId];
    if (!link || link.posted.includes(phase)) return;

    await markSessionOutcome(event.sessionId, phase);
    if (phase === "started") return;

    await host
      .toast({
        kind: phase === "completed" ? "success" : "error",
        message: sessionToast(phase, link.pr, link.title),
      })
      .catch(() => undefined);

    if (phase !== "completed" || !link.pr) return;
    const preferences = await loadPreferences();
    if (!preferences.autoRereview || !preferences.tenantId) return;
    const pr = parsePRRef(link.pr);
    if (!pr) return;
    try {
      await client.triggerReview(preferences.tenantId, pr.owner, pr.repo, pr.number);
      await host
        .toast({
          kind: "info",
          message: `A fresh Boop review of ${link.pr} is on its way.`,
        })
        .catch(() => undefined);
    } catch (error) {
      // The review trigger is best effort: a rate limit or a duplicate head
      // must never read as a session failure.
      console.error("Auto re-review failed:", error);
    }
  });
}
