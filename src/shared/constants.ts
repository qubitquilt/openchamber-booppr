/**
 * Values every surface and the service share.
 *
 * `TENANT_ORIGIN` is the one source of truth for the Boop receiver. The service
 * (`src/service/main.ts`) is the only place that reaches it, for the sign-in
 * and every forwarded call, so retargeting the extension means changing this
 * one line and rebuilding.
 *
 * It is the receiver's **tenant origin**, not its dedicated API host. The
 * sign-in is a browser redirect whose OAuth state cookie (and CLI hand-off
 * cookie) is host-only, while GitHub always comes back to the receiver's
 * static `/auth/callback`. Starting the login on another host — notably
 * `https://api.booppr.com`, which fronts only `/api/` — leaves the callback
 * with no cookie and the receiver answers "invalid state". The tenant origin
 * proxies both `/api/*` and `/auth/*` to the receiver, so it serves the
 * session calls too.
 */
export const TENANT_ORIGIN = "https://app.booppr.com";

/**
 * The pre-fix default, kept only so the sign-in view can recognize a
 * `serverUrl` a pre-fix client persisted. A login started here can never
 * complete — the OAuth state cookie is host-only and GitHub's callback is
 * fixed on the tenant origin — so the receiver answers "invalid state". It is
 * not a receiver; only the one-time migration in `src/shared/signin.ts` reads
 * it.
 */
export const LEGACY_API_ORIGIN = "https://api.booppr.com";

/**
 * The web console origin, used to build "open in the tenant console" links.
 * The receiver's public API lives on its own host; the console is deployed
 * beside it. Empty disables the link rather than guessing a host.
 */
export const CONSOLE_ORIGIN = "";

/**
 * The GitHub URL every PR chip opens. Boop reviews GitHub pull requests, so
 * the chip's link is always the PR itself, on the forge the receiver serves.
 */
export const githubPrUrl = (owner: string, repo: string, number: number): string =>
  `https://github.com/${owner}/${repo}/pull/${number}`;

/** Chip provider id. Matches `panel.id`, so OpenChamber groups our chips. */
export const PROVIDER_ID = "boop-reviews";

/**
 * The CLI's public OAuth client id (BOOP-46). The receiver checks it against
 * the tenant's `allowed_cli_client_ids` allow-list before GitHub is involved,
 * so the extension reuses the same well-known id the `boop` CLI presents and
 * needs no client id pasted anywhere.
 */
export const OAUTH_CLIENT_ID = "boop-cli";

/** How many runs one page of `GET /api/tenants/{id}/runs` asks for. */
export const RUNS_PER_PAGE = 50;

/** How many tracked PRs one page of `GET /api/tenants/{id}/prs` asks for. */
export const PRS_PER_PAGE = 100;

export const RUN_STATUSES = ["pending", "running", "succeeded", "failed", "canceled"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** The tracked-PR review status (`TrackedPRReviewStatus` in the receiver API). */
export const REVIEW_STATUSES = ["none", "in_flight", "reviewed", "skipped", "failed"] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Tone of the status pills, mapped through the host's semantic colors. */
export const RUN_TONE: Record<RunStatus, "neutral" | "info" | "success" | "warning" | "error"> = {
  pending: "neutral",
  running: "info",
  succeeded: "success",
  failed: "error",
  canceled: "warning",
};

export const REVIEW_TONE: Record<
  ReviewStatus,
  "neutral" | "info" | "success" | "warning" | "error"
> = {
  none: "neutral",
  in_flight: "info",
  reviewed: "success",
  skipped: "neutral",
  failed: "error",
};

/** Human label for a run status. */
export const RUN_LABEL: Record<RunStatus, string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  canceled: "Canceled",
};

/** Human label for a tracked PR's review status. */
export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  none: "Not reviewed",
  in_flight: "In flight",
  reviewed: "Reviewed",
  skipped: "Skipped",
  failed: "Failed",
};

/** Finding severities the receiver emits, most severe last for sorting. */
export const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  minor: 2,
  medium: 3,
  major: 4,
  high: 5,
  critical: 6,
  blocker: 7,
};

/** Feedback categories the receiver accepts on `POST …/feedback`. */
export const FEEDBACK_CATEGORIES = ["wrong", "noisy", "missed", "outdated", "other"] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_LABEL: Record<FeedbackCategory, string> = {
  wrong: "Wrong",
  noisy: "Noisy",
  missed: "Missed a bug",
  outdated: "Outdated",
  other: "Other",
};

/** How many findings a chip carries into the model context. */
export const CHIP_FINDINGS_MAX = 10;
