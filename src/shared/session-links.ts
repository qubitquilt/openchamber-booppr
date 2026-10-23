/**
 * The pure half of the PR-to-session links: reading a possibly stale stored
 * blob and dropping the oldest entries. Kept free of `host` so `npm test` can
 * exercise it without an iframe.
 */

/**
 * A session started from a PR or a run. The lifecycle watcher records the
 * outcome on the link; the PR detail shows the recent ones with it.
 */
export interface SessionLink {
  /** `owner/repo#number`, or the empty string for a run-only link. */
  pr: string;
  /** Chip title captured at start, since lifecycle events carry no title. */
  title: string;
  /** When the session started, used to drop the oldest links. */
  at: number;
  /** Phases already handled, so two open surfaces do not act twice. */
  posted: string[];
  /** When the last observed phase landed, for "finished 5m ago". */
  outcomeAt?: number;
}

/** How many PR-linked sessions to keep. */
export const SESSION_LINKS_MAX = 50;

/** Read whatever is in storage into well-formed links, ignoring junk entries. */
export function sanitizeSessionLinks(raw: unknown): Record<string, SessionLink> {
  if (!raw || typeof raw !== "object") return {};
  const links: Record<string, SessionLink> = {};
  for (const [id, value] of Object.entries(raw as Record<string, SessionLink>)) {
    if (!value || typeof value !== "object" || typeof value.pr !== "string") continue;
    links[id] = {
      pr: value.pr,
      title: typeof value.title === "string" ? value.title : "",
      at: typeof value.at === "number" ? value.at : 0,
      posted: Array.isArray(value.posted)
        ? value.posted.filter((phase) => typeof phase === "string")
        : [],
      outcomeAt: typeof value.outcomeAt === "number" ? value.outcomeAt : undefined,
    };
  }
  return links;
}

/** Keep the newest `max` links, by start time. */
export function pruneSessionLinks(
  links: Record<string, SessionLink>,
  max: number = SESSION_LINKS_MAX,
): Record<string, SessionLink> {
  const newest = Object.entries(links)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, Math.max(0, max));
  return Object.fromEntries(newest);
}

/** The links for one PR, newest first. */
export function linksForPR(
  links: Record<string, SessionLink>,
  pr: string,
): Array<[sessionId: string, link: SessionLink]> {
  return Object.entries(links)
    .filter(([, link]) => link.pr === pr)
    .sort((a, b) => b[1].at - a[1].at);
}
