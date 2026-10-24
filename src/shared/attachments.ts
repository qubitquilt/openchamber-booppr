import { PROVIDER_ID, githubPrUrl } from "./constants";
import { BoopError } from "./client";
import { host } from "./host";
import { rememberSession } from "./preferences";
import {
  branchForPR,
  locationOf,
  prContext,
  prKey,
  prTitle,
  prWebUrl,
  runContext,
  severityLabel,
} from "./format";
import type {
  TenantFinding,
  TenantPR,
  TenantPRDetailPR,
  TenantPRFinding,
  TenantRun,
} from "./types";

/**
 * The JSON stored with a chip. It comes back as `ready.item.data` when the user
 * clicks the chip, so the panel can reopen the PR or run without another
 * lookup. Every value is a plain string, which is what keeps the object
 * assignable to the host's `JsonValue`; absent fields are stored as "".
 */
export interface PRChipData {
  [key: string]: string;
  tenantId: string;
  owner: string;
  repo: string;
  prNumber: string;
  runId: string;
}

export interface PRChipTarget {
  pr: TenantPR | TenantPRDetailPR;
  tenantId: string;
  /** Open findings, for the model context. */
  findings?: TenantPRFinding[];
}

export interface RunChipTarget {
  run: TenantRun;
  tenantId: string;
  findings?: TenantFinding[];
}

/** The chip title for a PR: `owner/repo#123 Title`, capped by the host. */
export function prChipTitle(pr: TenantPR): string {
  return `${prKey(pr.owner, pr.repo, pr.pr_number)} ${prTitle(pr)}`.slice(0, 200);
}

/** The chip title for a run: the PR it reviewed plus the outcome. */
export function runChipTitle(run: TenantRun): string {
  return `${prKey(run.owner, run.repo, run.pr_number)} review #${run.review_number ?? "?"} (${run.status})`.slice(
    0,
    200,
  );
}

export function prChipData(
  pr: { owner: string; repo: string; pr_number: number },
  tenantId: string,
  runId = "",
): PRChipData {
  return {
    tenantId,
    owner: pr.owner,
    repo: pr.repo,
    prNumber: String(pr.pr_number),
    runId,
  };
}

/** The composer chip for a PR. `title` is capped at 200 characters by the host. */
export function chipForPR(target: PRChipTarget) {
  const pr = target.pr;
  const webUrl = prWebUrl(pr.owner, pr.repo, pr.pr_number);
  const text = prContext(
    {
      pr,
      findings: target.findings ?? [],
      telemetry_rollup: {
        run_count: 0,
        success_count: 0,
        cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        wall_clock_ms: 0,
      },
    },
    { webUrl },
  );
  return {
    providerId: PROVIDER_ID,
    id: prKey(pr.owner, pr.repo, pr.pr_number),
    title: prChipTitle(pr),
    url: webUrl,
    kind: "pull" as const,
    ...(pr.author_login ? { author: pr.author_login.slice(0, 80) } : {}),
    text,
    data: prChipData(pr, target.tenantId),
  };
}

/** The composer chip for one run of a PR. */
export function chipForRun(target: RunChipTarget) {
  const run = target.run;
  return {
    providerId: PROVIDER_ID,
    id: run.id.slice(0, 128),
    title: runChipTitle(run),
    url: githubPrUrl(run.owner, run.repo, run.pr_number),
    kind: "pull" as const,
    text: runContext(run, target.findings ?? []),
    data: prChipData(run, target.tenantId, run.id),
  };
}

export async function attachPRChip(target: PRChipTarget): Promise<void> {
  await host.attach(chipForPR(target));
}

export async function attachRunChip(target: RunChipTarget): Promise<void> {
  await host.attach(chipForRun(target));
}

/**
 * Attach, then open a fresh session with the PR as first message.
 *
 * With `worktree: true` the session opens in a new worktree whose branch is
 * named from the PR. `branch` reports the branch the host created, not the one
 * we asked for: it may adjust the name, and the success toasts must not claim
 * otherwise. `sessionId` is `null` when the worktree was created but the
 * session was not; the worktree is kept, so the caller should not blind-retry.
 */
export async function startSessionWithPR(
  target: PRChipTarget,
  options: { worktree?: boolean } = {},
): Promise<{ sessionId: string | null; sent: string; failure?: string; branch?: string }> {
  const pr = target.pr;
  const requestedBranch = options.worktree
    ? branchForPR(pr.owner, pr.repo, pr.pr_number, pr.title)
    : undefined;
  const result = await host.startSession({
    ...chipForPR(target),
    navigation: "preserve",
    ...(requestedBranch ? { worktree: { kind: "new" as const, name: requestedBranch } } : {}),
    text: `Work on the Boop findings for ${prKey(pr.owner, pr.repo, pr.pr_number)}. Start by reading the attached findings and restating the plan before changing anything.`,
  });

  if (result.sessionId === null) {
    return {
      sessionId: null,
      sent: result.sent,
      failure: result.failure,
      branch: result.worktree?.branch,
    };
  }
  return {
    sessionId: result.sessionId,
    sent: result.sent,
    branch: result.worktree?.branch ?? requestedBranch,
  };
}

/** Attach the PR and confirm it, the way every detail surface does. */
export async function attachPR(target: PRChipTarget): Promise<void> {
  await attachPRChip(target);
  await host.toast({
    kind: "success",
    message: `${prKey(target.pr.owner, target.pr.repo, target.pr.pr_number)} attached to the chat.`,
  });
}

/**
 * Start a session for the PR, remember it for the lifecycle watcher, and
 * report the outcome. The panel, the picker and the page all call this, so a
 * new session reads the same everywhere and the worktree wording stays in one
 * place.
 */
export async function startSessionForPR(
  target: PRChipTarget,
  options: { worktree?: boolean } = {},
): Promise<boolean> {
  const result = await startSessionWithPR(target, options);
  const key = prKey(target.pr.owner, target.pr.repo, target.pr.pr_number);

  if (result.sessionId === null) {
    const kept = result.branch ? ` The worktree ${result.branch} was kept.` : "";
    const reason = result.failure ? ` (${result.failure})` : "";
    await host.toast({
      kind: "error",
      message: `No session was created${reason}.${kept} Check the session list before retrying.`,
      dismiss: true,
    });
    return false;
  }

  await rememberSession(result.sessionId, {
    pr: key,
    title: prChipTitle(target.pr),
  });
  await host.toast({
    kind: "success",
    message:
      options.worktree && result.branch
        ? `Session started on ${result.branch} for ${key}.`
        : `Session started for ${key}.`,
  });
  return true;
}

/** Put the PR in the chat box without sending it. */
export async function composePRChip(target: PRChipTarget): Promise<void> {
  await host.compose({
    mode: "append",
    text: `\n${prContext(
      {
        pr: target.pr,
        findings: target.findings ?? [],
        telemetry_rollup: {
          run_count: 0,
          success_count: 0,
          cost_usd: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          wall_clock_ms: 0,
        },
      },
      { webUrl: prWebUrl(target.pr.owner, target.pr.repo, target.pr.pr_number) },
    )}\n`,
  });
}

export async function openOnGitHub(target: PRChipTarget | RunChipTarget): Promise<void> {
  const owner = "pr" in target ? target.pr.owner : target.run.owner;
  const repo = "pr" in target ? target.pr.repo : target.run.repo;
  const number = "pr" in target ? target.pr.pr_number : target.run.pr_number;
  await host.openUrl(githubPrUrl(owner, repo, number));
}

/** One line of what a finding is, for chips and lists. */
export function findingLine(finding: {
  severity: string;
  path?: string;
  line?: number;
  headline: string;
}): string {
  const where = locationOf(finding);
  return `[${severityLabel(finding.severity)}] ${where ? `${where} — ` : ""}${finding.headline}`;
}

/**
 * Everything the panel offers on one PR, gathered into a toast on failure.
 *
 * The toast carries the action and the error code (or "Unknown error"); the
 * full message is logged to the console for the developer. A `BoopError`
 * message is the server's response text, which can carry internal paths or
 * query strings we do not want shown to the user, and a future server bug
 * could include someone else's data in it. The user gets the action and a
 * short code; the developer gets the rest in their console.
 */
export async function reportFailure(action: string, error: unknown): Promise<void> {
  console.error(`${action} failed:`, error);
  const code = error instanceof BoopError ? error.code : null;
  const message = code ? `${action} failed (${code}).` : `${action} failed.`;
  await host.toast({ kind: "error", message: message.slice(0, 400), dismiss: true });
}
