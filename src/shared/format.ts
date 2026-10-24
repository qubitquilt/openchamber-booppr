import { SEVERITY_RANK, CHIP_FINDINGS_MAX, githubPrUrl } from "./constants";
import type { TenantFinding, TenantPR, TenantPRDetailResponse, TenantRun } from "./types";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** The `owner/repo#123` form people type and paste. */
export function prKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

/** Parse a PR reference out of free text: `owner/repo#123` or a GitHub PR URL. */
export function parsePRRef(raw: string): { owner: string; repo: string; number: number } | null {
  const text = raw.trim();
  if (!text) return null;
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(text);
  if (short?.[1] && short[2] && short[3]) {
    return { owner: short[1], repo: short[2], number: Number(short[3]) };
  }
  const url =
    /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(
      text,
    );
  if (url?.[1] && url[2] && url[3]) {
    return { owner: url[1], repo: url[2], number: Number(url[3]) };
  }
  return null;
}

/** Find the first PR reference in a longer text, for message actions. */
export function firstPRRefIn(text: string): { owner: string; repo: string; number: number } | null {
  const short = /([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)/.exec(text);
  if (short?.[1]) {
    const parsed = parsePRRef(short[1]);
    if (parsed) return parsed;
  }
  const url = /https?:\/\/github\.com\/[^\s"')]+/i.exec(text);
  if (url?.[0]) {
    const parsed = parsePRRef(url[0]);
    if (parsed) return parsed;
  }
  return null;
}

/** The row title for a PR: the GitHub title, else the reference. */
export function prTitle(pr: Pick<TenantPR, "owner" | "repo" | "pr_number" | "title">): string {
  const title = pr.title?.trim();
  return title || prKey(pr.owner, pr.repo, pr.pr_number);
}

/** The web URL a chip opens: always the PR on GitHub. */
export function prWebUrl(owner: string, repo: string, number: number): string {
  return githubPrUrl(owner, repo, number);
}

/** Severity with its first letter up, for pills and rows. */
export function severityLabel(severity: string | null | undefined): string {
  const value = (severity ?? "").trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Unknown";
}

/** Sort key: the highest-severity findings first. Unknown severities sort low. */
export function severityRank(severity: string | null | undefined): number {
  return SEVERITY_RANK[(severity ?? "").toLowerCase()] ?? -1;
}

/**
 * "just now / 5m / 3h / 2d / 5w", the way the OpenChamber reference rows show
 * an item's age. Returns `null` when there is nothing worth showing.
 */
export function relativeTimeOf(
  iso: string | number | null | undefined,
  now: number = Date.now(),
): string | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const at = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}d`;
  return `${Math.floor(elapsed / (7 * DAY_MS))}w`;
}

/** "$1.23", "$0.04", or "" for zero-ish values nobody budgets by. */
export function costLabel(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

/** "12.3k" for token counts, or "" when there is nothing to count. */
export function tokenLabel(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count) || count <= 0) return "";
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** "3m 12s" for a wall-clock duration, or "" for an unknown one. */
export function durationLabel(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Strip Markdown down to the first line, for list rows and chip titles. */
export function firstLine(markdown: string | null | undefined, limit = 160): string {
  if (!markdown) return "";
  const line = markdown
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return "";
  const text = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[*_>]+/, "")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** One line of what a run spent, for detail rows and run subtitles. */
export function runCostLine(run: { cost_usd?: number; total_tokens?: number }): string {
  const parts: string[] = [];
  const cost = costLabel(run.cost_usd);
  if (cost) parts.push(cost);
  const tokens = tokenLabel(run.total_tokens);
  if (tokens) parts.push(`${tokens} tokens`);
  return parts.join(" · ");
}

/** A `path:line` location, or just the path when there is no line. */
export function locationOf(finding: { path?: string; line?: number }): string {
  if (!finding.path) return "";
  return finding.line && finding.line > 0 ? `${finding.path}:${finding.line}` : finding.path;
}

/**
 * The text handed to the model when a PR chip is attached to a session. It
 * carries the review state and the open findings, so the agent can start from
 * what Boop already found instead of re-deriving it.
 */
export function prContext(
  detail: Pick<TenantPRDetailResponse, "pr" | "findings" | "telemetry_rollup">,
  meta: { webUrl?: string } = {},
): string {
  const pr = detail.pr;
  const parts = [`Boop reviews ${prKey(pr.owner, pr.repo, pr.pr_number)}: ${prTitle(pr)}`];
  parts.push(`PR state: ${pr.state}; review status: ${pr.review_status}`);
  if (pr.author_login) parts.push(`Author: ${pr.author_login}`);
  if (pr.head_sha) parts.push(`Head: ${pr.head_sha.slice(0, 12)}`);
  if (pr.additions !== undefined || pr.deletions !== undefined) {
    parts.push(`Diff: +${pr.additions ?? 0} -${pr.deletions ?? 0}`);
  }
  if (meta.webUrl) parts.push(meta.webUrl);

  const open = detail.findings
    .filter((finding) => finding.state === "open")
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  if (open.length > 0) {
    parts.push("", `Open findings from Boop (${open.length}):`);
    for (const finding of open.slice(0, CHIP_FINDINGS_MAX)) {
      const where = locationOf(finding);
      parts.push(
        `- [${severityLabel(finding.severity)}] ${where ? `${where} — ` : ""}${firstLine(finding.headline, 200)}`,
      );
    }
    if (open.length > CHIP_FINDINGS_MAX) {
      parts.push(`- …and ${open.length - CHIP_FINDINGS_MAX} more`);
    }
  } else {
    parts.push("", "Boop has no open findings on this PR.");
  }
  return parts.join("\n");
}

/** The text for a run chip: what the run reviewed and what it found. */
export function runContext(run: TenantRun, findings: TenantFinding[] = []): string {
  const parts = [
    `Boop run ${run.id}: ${prKey(run.owner, run.repo, run.pr_number)} (review #${run.review_number ?? "?"}, ${run.status})`,
  ];
  if (run.model) parts.push(`Model: ${run.model}`);
  if (run.cost_usd) parts.push(`Cost: ${costLabel(run.cost_usd)}`);
  parts.push(`Started: ${run.started_at}`);
  if (run.error) parts.push(`Error: ${firstLine(run.error, 300)}`);

  if (findings.length > 0) {
    parts.push("", `Findings (${findings.length}):`);
    for (const finding of findings.slice(0, CHIP_FINDINGS_MAX)) {
      const where = locationOf(finding);
      parts.push(
        `- [${severityLabel(finding.severity)}] ${where ? `${where} — ` : ""}${firstLine(finding.headline, 200)}`,
      );
    }
    if (findings.length > CHIP_FINDINGS_MAX)
      parts.push(`- …and ${findings.length - CHIP_FINDINGS_MAX} more`);
  }
  return parts.join("\n");
}

/** A git-safe branch name for a session started from a PR. */
export function branchForPR(owner: string, repo: string, number: number, title?: string): string {
  const slug = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `boop/${repo || owner}-pr-${number}${slug ? `-${slug}` : ""}`;
}

export type SessionPhase = "started" | "completed" | "failed";

/** The toast shown when a linked session changes phase. */
export function sessionToast(phase: SessionPhase, pr: string, title: string): string {
  const detail = title.trim() || pr;
  if (phase === "completed") return `Session completed for ${pr}: ${detail}`;
  if (phase === "failed") return `Session failed for ${pr}: ${detail}`;
  return `Session started for ${pr}: ${detail}`;
}
