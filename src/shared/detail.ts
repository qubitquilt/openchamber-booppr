import { mountButton, mountCheckbox, mountSelect, mountTextField } from "@openchamber/sdk/ui";

import { reportFailure } from "./attachments";
import { avatarNode, findingPill, lensChip, runPill, severityChip } from "./chips";
import { collapsibleMarkdown, el, renderMarkdown } from "./dom";
import { host } from "./host";
import { FEEDBACK_CATEGORIES, FEEDBACK_LABEL, type FeedbackCategory } from "./constants";
import {
  costLabel,
  durationLabel,
  locationOf,
  prKey,
  prTitle,
  prWebUrl,
  relativeTimeOf,
  tokenLabel,
} from "./format";
import type {
  FeedbackRequest,
  TenantRun,
  TenantRunStage,
  TenantRunTelemetryResponse,
} from "./types";
import type { SessionLink } from "./session-links";

/**
 * The rail sheet and the full-screen page draw the same details, in the shape
 * of the Linear issue view: a header bar, a title block, a metadata grid, the
 * body sections and a footer that starts sessions. Keeping them in one module
 * is what stops the surfaces drifting.
 *
 * `FindingState` is the store's type in `details.ts` — the store and the
 * renderer share one declaration, so a field added to one cannot drift from
 * the other. Re-exported for the surfaces, which import it from here.
 */
import type { FindingState } from "./details";
export type { FindingState };

/** Attach a button with the shared loading and error handling. */
function actionButton(
  root: HTMLElement,
  label: string,
  run: () => void | Promise<unknown>,
  options: { variant?: "default" | "secondary" | "outline" | "ghost"; block?: boolean } = {},
): void {
  const handle = mountButton(root, {
    label,
    variant: options.variant ?? "secondary",
    size: "sm",
    onClick: () => {
      handle.update({ loading: true });
      void Promise.resolve(run())
        .catch((error: unknown) => reportFailure(label, error))
        .finally(() => handle.update({ loading: false }));
    },
  });
  if (options.block) root.classList.add("block");
}

/** The header bar: Back to the list, then Open on GitHub. */
export function detailHeader(onBack: () => void, githubUrl: string): HTMLElement {
  const bar = el("div", { className: "detail-header" });
  const back = el("div");
  bar.append(back);
  mountButton(back, { label: "Back", variant: "ghost", size: "sm", onClick: onBack });
  const open = el("div", { style: "margin-left:auto;" });
  bar.append(open);
  mountButton(open, {
    label: "Open on GitHub",
    variant: "ghost",
    size: "sm",
    onClick: () => void host.openUrl(githubUrl),
  });
  return bar;
}

/** The reference and title that head a detail. */
export function detailTitle(id: string, title: string): HTMLElement {
  return el(
    "div",
    { className: "detail-heading" },
    el("div", { className: "detail-id" }, id),
    el("h2", { className: "detail-title" }, title),
  );
}

/** A metadata grid from `[label, value]` rows; empty values drop out. */
export function detailMeta(rows: Array<[string, string]>): HTMLElement {
  const grid = el("dl", { className: "meta-grid" });
  for (const [key, value] of rows) {
    if (!value) continue;
    grid.append(el("dt", {}, key), el("dd", {}, value));
  }
  return grid;
}

/** One finding row: severity chip, lens, location, headline, then the why. */
export function findingRow(finding: {
  lens: string;
  severity: string;
  path?: string;
  line?: number;
  headline: string;
  rationale: string;
}): HTMLElement {
  const row = el("div", { className: "finding-row" });
  const head = el("div", { className: "finding-head" });
  head.append(severityChip(finding.severity));
  if (finding.lens) head.append(lensChip(finding.lens));
  const where = locationOf(finding);
  if (where) head.append(el("span", { className: "finding-location" }, where));
  row.append(head);
  row.append(el("div", { className: "finding-title" }, finding.headline));
  if (finding.rationale.trim()) {
    row.append(el("div", { className: "finding-body" }, renderMarkdown(finding.rationale)));
  }
  return row;
}

/** The findings list, or the loading/error line that stands in for it. */
export function findingsSection(
  state: FindingState | null,
  empty = "No findings recorded.",
): HTMLElement {
  const section = el("div", { className: "detail-section" });
  section.append(el("h3", { className: "detail-section-title" }, "Findings"));
  if (!state) return section;
  if (state.error) {
    section.append(el("p", { className: "muted" }, `Findings unavailable: ${state.error}`));
    return section;
  }
  if (state.loading) {
    section.append(el("p", { className: "muted" }, "Loading findings…"));
    return section;
  }
  const items = state.items ?? [];
  if (items.length === 0) {
    section.append(el("p", { className: "muted" }, empty));
    return section;
  }
  const list = el("div", { className: "findings" });
  for (const finding of items) list.append(findingRow(finding));
  section.append(list);
  return section;
}

/** The run's stage waterfall: name, outcome, attempts and duration. */
export function stagesSection(stages: TenantRunStage[] | undefined): HTMLElement | null {
  if (!stages || stages.length === 0) return null;
  const section = el("div", { className: "detail-section" });
  section.append(el("h3", { className: "detail-section-title" }, "Stages"));
  const list = el("div", { className: "stage-list" });
  for (const stage of stages) {
    const row = el("div", { className: "stage-row" });
    row.append(
      el(
        "span",
        { className: "stage-name" },
        stage.scope ? `${stage.scope} · ${stage.stage}` : stage.stage,
      ),
      el("span", { className: `stage-status ${stage.status}` }, stage.status),
      el(
        "span",
        { className: "stage-duration" },
        `${stage.attempts > 0 ? `${stage.attempts}× · ` : ""}${durationLabel(stage.duration_ms)}`,
      ),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

/** The run's token and cost telemetry, as a small grid plus per-lens rows. */
export function telemetrySection(telemetry: TenantRunTelemetryResponse | null): HTMLElement | null {
  if (!telemetry) return null;
  const section = el("div", { className: "detail-section" });
  section.append(el("h3", { className: "detail-section-title" }, "Telemetry"));
  section.append(
    detailMeta([
      ["Model", telemetry.model ?? ""],
      ["Tokens", tokenLabel(telemetry.total_tokens)],
      ["Cost", costLabel(telemetry.cost_usd)],
      ["Duration", durationLabel(telemetry.duration_ms)],
      ["Steps", telemetry.step_count ? String(telemetry.step_count) : ""],
      ...(telemetry.is_byok ? ([["Key", "tenant's own"]] as Array<[string, string]>) : []),
    ]),
  );
  const lenses = telemetry.lenses ?? [];
  if (lenses.length > 0) {
    const list = el("div", { className: "stage-list" });
    for (const lens of lenses) {
      const row = el("div", { className: "stage-row" });
      row.append(
        el("span", { className: "stage-name" }, lens.lens),
        el("span", { className: "stage-status" }, lens.model),
        el(
          "span",
          { className: "stage-duration tabular" },
          `${tokenLabel(lens.total_tokens)} · ${costLabel(lens.cost_usd)}`,
        ),
      );
      list.append(row);
    }
    section.append(list);
  }
  return section;
}

/** The recent sessions OpenChamber started for this PR, with outcomes. */
export function sessionLinksSection(sessions: Array<[string, SessionLink]>): HTMLElement | null {
  if (sessions.length === 0) return null;
  const section = el("div", { className: "detail-section" });
  section.append(el("h3", { className: "detail-section-title" }, "Sessions"));
  const list = el("div", { className: "session-links" });
  for (const [id, link] of sessions.slice(0, 8)) {
    const row = el("div", { className: "session-link" });
    row.append(avatarNode(link.title));
    row.append(el("span", { className: "session-link-title" }, link.title || id.slice(0, 12)));
    const phase = link.posted.includes("completed")
      ? "completed"
      : link.posted.includes("failed")
        ? "failed"
        : "started";
    row.append(
      el(
        "span",
        {
          className: `outcome${phase === "completed" ? " success" : phase === "failed" ? " error" : ""}`,
        },
        `${phase} · ${relativeTimeOf(link.outcomeAt ?? link.at) ?? ""}`,
      ),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

/* -------------------------------------------------------------- the footer */

export interface FooterOptions {
  /** Worktree choice, owned by the surface so it survives a re-render. */
  worktree: boolean;
  onWorktreeChange: (worktree: boolean) => void;
  onStartSession: () => void;
  onAttach: () => void;
  onCompose?: () => void;
  githubUrl: string;
  /** Hide the secondary attach actions, for a read-only surface. */
  showChatActions?: boolean;
}

/** The footer: the worktree toggle, a full-width Start session, then chat. */
export function detailFooter(options: FooterOptions): HTMLElement {
  const footer = el("div", { className: "detail-footer" });
  const toggle = el("div");
  footer.append(toggle);
  mountCheckbox(toggle, {
    label: "Create in a new worktree",
    checked: options.worktree,
    onChange: options.onWorktreeChange,
  });

  const start = el("div", { className: "detail-start block" });
  footer.append(start);
  actionButton(start, "Start session", async () => options.onStartSession(), {
    variant: "default",
    block: true,
  });

  if (options.showChatActions !== false) {
    const secondary = el("div", { className: "toolbar detail-secondary" });
    footer.append(secondary);
    actionButton(secondary, "Attach", async () => options.onAttach());
    const compose = options.onCompose;
    if (compose) actionButton(secondary, "Send to chat", async () => compose());
    actionButton(secondary, "GitHub", () => host.openUrl(options.githubUrl).then(() => undefined));
  }
  return footer;
}

/* ------------------------------------------------------------- run detail */

export interface RunDetailOptions extends FooterOptions {
  run: TenantRun;
  findings: FindingState | null;
  telemetry: TenantRunTelemetryResponse | null;
  feedback?: {
    /** Submitting posts and then clears the form; errors surface as toasts. */
    onSubmit: (input: FeedbackRequest) => Promise<void>;
  };
  onTriggerReview?: () => void;
  onBack: () => void;
}

/** A full run detail: header bar, scrolling body and footer. */
export function runDetailScaffold(options: RunDetailOptions): HTMLElement {
  const run = options.run;
  const githubUrl = prWebUrl(run.owner, run.repo, run.pr_number);
  const shell = el("div", { className: "detail" });
  shell.append(detailHeader(options.onBack, githubUrl));

  const body = el("div", { className: "detail-body" });
  body.append(
    detailTitle(
      run.id,
      `${prKey(run.owner, run.repo, run.pr_number)} · review #${run.review_number ?? "?"}`,
    ),
  );

  const statusRow = el("div", { className: "detail-row" });
  statusRow.append(runPill(run.status));
  if (options.onTriggerReview) {
    const holder = el("div");
    statusRow.append(holder);
    mountButton(holder, {
      label: "Re-review",
      variant: "outline",
      size: "sm",
      onClick: () => void options.onTriggerReview?.(),
    });
  }
  body.append(statusRow);

  body.append(
    detailMeta([
      ["Started", relativeTimeOf(run.started_at) ?? run.started_at],
      ["Duration", durationLabel(run.duration_ms)],
      ["Model", run.model ?? ""],
      ["Tokens", tokenLabel(run.total_tokens)],
      ["Cost", costLabel(run.cost_usd)],
      ["Steps", run.step_count ? String(run.step_count) : ""],
    ]),
  );

  if (run.error?.trim()) {
    const banner = el("div", { className: "detail-section" });
    banner.append(el("h3", { className: "detail-section-title" }, "Error"));
    banner.append(el("div", { className: "finding-body" }, run.error));
    body.append(banner);
  }

  const stages = stagesSection(run.stages);
  if (stages) body.append(stages);
  const telemetry = telemetrySection(options.telemetry);
  if (telemetry) body.append(telemetry);
  body.append(findingsSection(options.findings));
  if (options.feedback) body.append(feedbackSection(options.feedback.onSubmit));
  shell.append(body);

  shell.append(
    detailFooter({
      worktree: options.worktree,
      onWorktreeChange: options.onWorktreeChange,
      onStartSession: options.onStartSession,
      onAttach: options.onAttach,
      onCompose: options.onCompose,
      githubUrl,
      showChatActions: options.showChatActions,
    }),
  );
  return shell;
}

/* -------------------------------------------------------------- PR detail */

export interface PRDetailOptions extends FooterOptions {
  detail: TenantPRDetailLike;
  sessions: Array<[string, SessionLink]>;
  onTriggerReview: () => void;
  onBack: () => void;
}

/**
 * The PR aggregate the detail reads. `TenantPRDetailResponse` satisfies it;
 * the narrower type keeps the module honest about what it touches.
 */
export interface TenantPRDetailLike {
  pr: {
    owner: string;
    repo: string;
    pr_number: number;
    title?: string;
    state: string;
    review_status: string;
    author_login?: string;
    head_sha?: string;
    additions?: number;
    deletions?: number;
    changed_files?: number;
    body?: string;
    draft?: boolean;
    github_fresh?: boolean;
  };
  findings: Array<{
    lens: string;
    severity: string;
    path?: string;
    line?: number;
    headline: string;
    rationale: string;
    state: string;
  }>;
  findings_truncated?: boolean;
  findings_total?: number;
  telemetry_rollup?: {
    run_count: number;
    success_count: number;
    cost_usd: number;
    total_tokens: number;
    wall_clock_ms: number;
  };
}

/** A full PR detail: header bar, scrolling body and footer. */
export function prDetailScaffold(options: PRDetailOptions): HTMLElement {
  const pr = options.detail.pr;
  const githubUrl = prWebUrl(pr.owner, pr.repo, pr.pr_number);
  const shell = el("div", { className: "detail" });
  shell.append(detailHeader(options.onBack, githubUrl));

  const body = el("div", { className: "detail-body" });
  body.append(detailTitle(prKey(pr.owner, pr.repo, pr.pr_number), prTitle(pr)));

  const statusRow = el("div", { className: "detail-row" });
  statusRow.append(el("span", { className: "state-pill" }, pr.state));
  statusRow.append(el("span", { className: "state-pill" }, pr.review_status));
  const reviewHolder = el("div");
  statusRow.append(reviewHolder);
  mountButton(reviewHolder, {
    label: "Request review",
    variant: "outline",
    size: "sm",
    onClick: () => void options.onTriggerReview(),
  });
  body.append(statusRow);

  body.append(
    detailMeta([
      ["Author", pr.author_login ?? ""],
      ["Head", pr.head_sha ? pr.head_sha.slice(0, 12) : ""],
      ["Diff", pr.additions !== undefined ? `+${pr.additions} -${pr.deletions ?? 0}` : ""],
      ["Files", pr.changed_files !== undefined ? String(pr.changed_files) : ""],
      ["Draft", pr.draft ? "yes" : ""],
    ]),
  );
  if (pr.github_fresh === false) {
    body.append(el("p", { className: "muted" }, "GitHub facts came from the cached row."));
  }

  if (pr.body?.trim()) {
    const section = el("div", { className: "detail-section" });
    section.append(el("h3", { className: "detail-section-title" }, "Description"));
    section.append(collapsibleMarkdown(pr.body, 1200));
    body.append(section);
  }

  const rollup = options.detail.telemetry_rollup;
  if (rollup && rollup.run_count > 0) {
    body.append(
      detailMeta([
        ["Runs", `${rollup.success_count}/${rollup.run_count} succeeded`],
        ["Spent", costLabel(rollup.cost_usd)],
        ["Tokens", tokenLabel(rollup.total_tokens)],
        ["Wall clock", durationLabel(rollup.wall_clock_ms)],
      ]),
    );
  }

  const open = options.detail.findings.filter((finding) => finding.state === "open");
  const resolved = options.detail.findings.filter((finding) => finding.state !== "open");
  const openSection = el("div", { className: "detail-section" });
  openSection.append(
    el("h3", { className: "detail-section-title" }, `Open findings (${open.length})`),
  );
  if (open.length === 0) {
    openSection.append(el("p", { className: "muted" }, "Nothing open. Boop is happy."));
  } else {
    const list = el("div", { className: "findings" });
    for (const finding of open) list.append(findingRow(finding));
    openSection.append(list);
  }
  body.append(openSection);

  if (resolved.length > 0) {
    const resolvedSection = el("div", { className: "detail-section" });
    resolvedSection.append(
      el("h3", { className: "detail-section-title" }, `Resolved (${resolved.length})`),
    );
    const list = el("div", { className: "findings" });
    for (const finding of resolved) {
      const row = findingRow(finding);
      row.querySelector(".finding-head")?.append(findingPill(finding.state));
      list.append(row);
    }
    resolvedSection.append(list);
    body.append(resolvedSection);
  }
  if (options.detail.findings_truncated) {
    body.append(
      el(
        "p",
        { className: "muted" },
        `Showing the newest findings of ${options.detail.findings_total ?? "many"}.`,
      ),
    );
  }

  const sessions = sessionLinksSection(options.sessions);
  if (sessions) body.append(sessions);
  shell.append(body);

  shell.append(
    detailFooter({
      worktree: options.worktree,
      onWorktreeChange: options.onWorktreeChange,
      onStartSession: options.onStartSession,
      onAttach: options.onAttach,
      onCompose: options.onCompose,
      githubUrl,
      showChatActions: options.showChatActions,
    }),
  );
  return shell;
}

/* --------------------------------------------------------------- feedback */

/** The feedback form: rating, category, comment, submit. */
export function feedbackSection(onSubmit: (input: FeedbackRequest) => Promise<void>): HTMLElement {
  let rating = 5;
  let category: FeedbackCategory = "other";
  let comment = "";

  const section = el("div", { className: "detail-section" });
  section.append(el("h3", { className: "detail-section-title" }, "Feedback"));
  section.append(el("p", { className: "muted" }, "Tell the tenant how this review landed."));

  const ratingHolder = el("div");
  section.append(ratingHolder);
  mountSelect(ratingHolder, {
    label: "Rating",
    value: "5",
    options: [5, 4, 3, 2, 1].map((value) => ({
      id: String(value),
      label: `${"★".repeat(value)}${"☆".repeat(5 - value)}`,
    })),
    onChange: (id) => {
      rating = Number(id) || 5;
    },
  });

  const categoryHolder = el("div");
  section.append(categoryHolder);
  mountSelect(categoryHolder, {
    label: "Category",
    value: category,
    options: FEEDBACK_CATEGORIES.map((value) => ({ id: value, label: FEEDBACK_LABEL[value] })),
    onChange: (id) => {
      category = id as FeedbackCategory;
    },
  });

  const commentHolder = el("div");
  section.append(commentHolder);
  mountTextField(commentHolder, {
    label: "Comment",
    value: "",
    multiline: true,
    rows: 3,
    placeholder: "Optional context for the team.",
    onChange: (value) => {
      comment = value;
    },
  });

  const submitHolder = el("div", { className: "block" });
  section.append(submitHolder);
  const button = mountButton(submitHolder, {
    label: "Send feedback",
    size: "sm",
    onClick: () => {
      button.update({ loading: true });
      void onSubmit({ rating, category, ...(comment.trim() ? { comment: comment.trim() } : {}) })
        .then(() => host.toast({ kind: "success", message: "Feedback sent. Boop wags his tail." }))
        .catch((error: unknown) => reportFailure("Send feedback", error))
        .finally(() => button.update({ loading: false }));
    },
  });
  return section;
}
