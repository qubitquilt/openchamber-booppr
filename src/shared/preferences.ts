import { host } from "./host";
import { read, write } from "./storage";
import type { RunStatus, ReviewStatus } from "./constants";
import { RUN_STATUSES, REVIEW_STATUSES } from "./constants";
import { sanitizeRepoFilter } from "./repo-filter";
import { clearLegacyServerUrl } from "./server-url";
import { sanitizeSessionLinks, pruneSessionLinks, type SessionLink } from "./session-links";

/** Selection persisted between surfaces, kept in the extension's own storage. */
export interface Preferences {
  /** The tenant slug the surfaces work in. Empty until the first sign-in. */
  tenantId: string;
  /** The receiver the session was signed in against; empty means bundled. */
  serverUrl: string;
  /** Repo shown in the panel and the page, `owner/name`; empty for every repo. */
  repoFilter: string;
  runStatusFilter: RunStatus | "any";
  reviewStatusFilter: ReviewStatus | "any";
  /** Only runs the signed-in user triggered. */
  mineOnly: boolean;
  /** Which tab the full-screen page shows. */
  view: "prs" | "runs";
  /** Run shown in the panel's detail sheet. */
  openRunId: string | null;
  /** PR shown in the page's detail pane, as `owner/repo#number`. */
  openPR: string | null;
  /** The tenant the open detail was pinned to, when opened from a chip. */
  openTenantId: string | null;
  /** Whether "Start session" creates a worktree, like Linear's toggle. */
  createInWorktree: boolean;
  /** Re-run a Boop review automatically when a linked session completes. */
  autoRereview: boolean;
}

const PREFERENCES_KEY = "preferences";

const DEFAULTS: Preferences = {
  tenantId: "",
  serverUrl: "",
  repoFilter: "",
  runStatusFilter: "any",
  reviewStatusFilter: "any",
  mineOnly: false,
  view: "prs",
  openRunId: null,
  openPR: null,
  openTenantId: null,
  createInWorktree: false,
  autoRereview: false,
};

function sanitize(raw: unknown): Preferences {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULTS };
  const value = raw as Partial<Preferences>;
  const runStatus = value.runStatusFilter;
  const knownRun =
    runStatus === "any" || (!!runStatus && (RUN_STATUSES as readonly string[]).includes(runStatus));
  const reviewStatus = value.reviewStatusFilter;
  const knownReview =
    reviewStatus === "any" ||
    (!!reviewStatus && (REVIEW_STATUSES as readonly string[]).includes(reviewStatus));
  return {
    tenantId: typeof value.tenantId === "string" ? value.tenantId : "",
    serverUrl: typeof value.serverUrl === "string" ? value.serverUrl : "",
    // The filter grammar lives in repo-filter.ts; junk never reaches a fetch.
    repoFilter: sanitizeRepoFilter(value.repoFilter),
    runStatusFilter: knownRun ? (runStatus as RunStatus | "any") : "any",
    reviewStatusFilter: knownReview ? (reviewStatus as ReviewStatus | "any") : "any",
    mineOnly: value.mineOnly === true,
    view: value.view === "runs" ? "runs" : "prs",
    openRunId: typeof value.openRunId === "string" ? value.openRunId : null,
    openPR: typeof value.openPR === "string" ? value.openPR : null,
    openTenantId:
      typeof value.openTenantId === "string" && value.openTenantId ? value.openTenantId : null,
    createInWorktree: value.createInWorktree === true,
    autoRereview: value.autoRereview === true,
  };
}

export async function loadPreferences(): Promise<Preferences> {
  return read(PREFERENCES_KEY, (raw) => sanitize(raw), host.storage);
}

export async function savePreferences(next: Partial<Preferences>): Promise<Preferences> {
  const merged = sanitize({ ...(await loadPreferences()), ...next });
  await write(PREFERENCES_KEY, merged, host.storage);
  return merged;
}

/**
 * The receiver URL the sign-in view's field should show: the stored value,
 * with the legacy API-host default cleared and "" answered when the record is
 * unreadable. Runs the one-time migration in `server-url.ts`, so an upgraded
 * client cannot restart the invalid-state bug from a stale field.
 */
export async function migrateServerUrl(): Promise<string> {
  return clearLegacyServerUrl(PREFERENCES_KEY, host.storage);
}

/**
 * Sessions started from a PR or run chip, so a later lifecycle event can
 * surface the outcome on that PR's detail. Kept small: the newest 50 links,
 * oldest dropped, one storage key.
 */
const SESSION_LINKS_KEY = "session-links";

export type { SessionLink } from "./session-links";

export async function loadSessionLinks(): Promise<Record<string, SessionLink>> {
  return read(SESSION_LINKS_KEY, sanitizeSessionLinks, host.storage);
}

export async function rememberSession(
  sessionId: string,
  link: { pr: string; title: string },
): Promise<void> {
  const links = await loadSessionLinks();
  links[sessionId] = { ...link, at: Date.now(), posted: [] };
  // Prune the whole record and store that, so the oldest actually fall off.
  const kept = pruneSessionLinks(links);
  await write(SESSION_LINKS_KEY, kept, host.storage);
}

export async function markSessionOutcome(
  sessionId: string,
  phase: string,
  at: number = Date.now(),
): Promise<void> {
  const links = await loadSessionLinks();
  const link = links[sessionId];
  if (!link) return;
  if (!link.posted.includes(phase)) link.posted.push(phase);
  link.outcomeAt = at;
  await write(SESSION_LINKS_KEY, links, host.storage);
}
