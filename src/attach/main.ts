import { isGuestMessageItem, isGuestSessionItem, type HostReadyContext } from "@openchamber/sdk";
import {
  applyHostReady,
  mountBanner,
  mountButton,
  mountEmpty,
  mountMenu,
  mountSearchField,
  mountSpinner,
  mountTabs,
} from "@openchamber/sdk/ui";

import { createBoopClient } from "../shared/client";
import { describeAndLog } from "../shared/errors";
import {
  RUN_LABEL,
  REVIEW_LABEL,
  RUN_STATUSES,
  type RunStatus,
  type ReviewStatus,
} from "../shared/constants";
import { clear, el } from "../shared/dom";
import { host } from "../shared/host";
import { mountSignIn } from "../shared/signin";
import { boopAccount, serviceTransport } from "../shared/service";
import {
  attachPRChip,
  attachRunChip,
  startSessionForPR,
  type PRChipTarget,
  type RunChipTarget,
} from "../shared/attachments";
import {
  prDetailScaffold,
  runDetailScaffold,
  type FindingState,
  type TenantPRDetailLike,
} from "../shared/detail";
import { firstPRRefIn, prKey, prTitle, relativeTimeOf } from "../shared/format";
import { installStyles } from "../shared/styles";
import type { TenantPR, TenantPRDetailResponse, TenantRun } from "../shared/types";
import { NotConnectedError, bootstrap, type TenantContext } from "../shared/tenants";

/**
 * The picker behind the composer's + menu, shaped like OpenChamber's reference
 * picker: a search header, the tenant's pull requests and runs on the left and
 * a preview of the highlighted one on the right, with Attach in the footer.
 *
 * Two entry paths share this page. The + menu arrives with no item; the
 * `review-with-boop` message action arrives with the message, and when the
 * text names a pull request the dialog opens focused on it, ready to request
 * a review or start a session on the findings.
 */

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Boop attach dialog is missing its #root element.");

const client = createBoopClient(serviceTransport);
/** Below this the dialog shows the list or the preview, never both. */
const NARROW_WIDTH = 560;

interface State {
  ready: HostReadyContext | null;
  connected: boolean;
  context: TenantContext | null;
  prs: TenantPR[];
  runs: TenantRun[];
  /** The PR a message action named, fetched and focused. */
  focused: TenantPRDetailResponse | null;
  focusedKey: string;
  focusedError: string | null;
  /** The PR aggregate behind the picker's preview pane, fetched once per key. */
  previewKey: string;
  previewDetail: TenantPRDetailResponse | null;
  previewError: string | null;
  /** Search hits over the loaded feeds, or null while the picker shows both. */
  results: { prs: TenantPR[]; runs: TenantRun[] } | null;
  search: string;
  repoFilter: string;
  statusFilter: string;
  tab: "prs" | "runs";
  loading: boolean;
  error: string | null;
  highlightedId: string | null;
  /** Findings per run, fetched when a preview opens. */
  runFindings: Record<string, FindingState>;
  worktree: boolean;
  wide: boolean;
  /** Narrow layout: whether the preview replaced the list. */
  previewOpen: boolean;
}

const state: State = {
  ready: null,
  connected: false,
  context: null,
  prs: [],
  runs: [],
  focused: null,
  focusedKey: "",
  focusedError: null,
  previewKey: "",
  previewDetail: null,
  previewError: null,
  results: null,
  search: "",
  repoFilter: "",
  statusFilter: "any",
  tab: "prs",
  loading: true,
  error: null,
  highlightedId: null,
  runFindings: {},
  worktree: false,
  wide: true,
  previewOpen: false,
};

let renderToken = 0;
/** `onReady` repeats on theme and session changes; only the first one seeds. */
let booted = false;
/** The feeds are loaded on the first connect and after a reconnect. */
let loaded = false;

/** The sign-in view, mounted once and kept across renders so its polling lives. */
let signInRoot: HTMLElement | null = null;
let disposeSignIn: (() => void) | null = null;
/** False until the service has told us whether a session exists. */
let accountsResolved = false;
let accountsChecking = false;

function showSignIn(): void {
  if (!signInRoot) {
    signInRoot = el("div", { className: "signin-fill" });
    disposeSignIn = mountSignIn(signInRoot, () => void onSignedIn());
  }
  root?.append(signInRoot);
}

function clearSignIn(): void {
  disposeSignIn?.();
  disposeSignIn = null;
  signInRoot = null;
}

async function onSignedIn(): Promise<void> {
  clearSignIn();
  state.connected = true;
  loaded = true;
  await load();
}

function repoOfPR(pr: TenantPR): string {
  return `${pr.owner}/${pr.repo}`;
}

function repoOfRun(run: TenantRun): string {
  return `${run.owner}/${run.repo}`;
}

function visiblePRs(): TenantPR[] {
  const source = state.results?.prs ?? state.prs;
  const needle = state.search.trim().toLowerCase();
  return source.filter(
    (pr) =>
      (!state.repoFilter || repoOfPR(pr) === state.repoFilter) &&
      (!needle ||
        prTitle(pr).toLowerCase().includes(needle) ||
        prKey(pr.owner, pr.repo, pr.pr_number).toLowerCase().includes(needle)),
  );
}

function visibleRuns(): TenantRun[] {
  const source = state.results?.runs ?? state.runs;
  const needle = state.search.trim().toLowerCase();
  return source.filter(
    (run) =>
      (!state.repoFilter || repoOfRun(run) === state.repoFilter) &&
      (state.statusFilter === "any" || run.status === state.statusFilter) &&
      (!needle ||
        `${run.owner}/${run.repo}#${run.pr_number}`.toLowerCase().includes(needle) ||
        run.id.toLowerCase().includes(needle)),
  );
}

/* ------------------------------------------------------------------- data */

async function load(): Promise<void> {
  const token = ++renderToken;
  state.loading = true;
  render();

  try {
    const context = await bootstrap(client);
    if (token !== renderToken) return;
    state.context = context;
    state.loading = false;
    state.error = null;
    render();

    const [prResult, runResult] = await Promise.allSettled([
      client.listPRs(context.tenantId, { limit: 100 }),
      client.listRuns(context.tenantId, { limit: 50 }),
    ]);
    if (prResult.status === "fulfilled") state.prs = prResult.value.prs;
    else state.error = describeAndLog("List PRs", prResult.reason);
    if (runResult.status === "fulfilled") state.runs = runResult.value.runs;
    if (token !== renderToken) return;
    render();
  } catch (error) {
    if (token !== renderToken) return;
    state.loading = false;
    state.error =
      error instanceof NotConnectedError
        ? error.message
        : `Could not reach Boop. ${describeAndLog("Reach Boop", error)}`;
    render();
  }
}

/** Fetch the PR a message action named, then focus the preview on it. */
async function focusPR(key: string): Promise<void> {
  const tenantId = state.context?.tenantId;
  if (!tenantId) return;
  state.focusedKey = key;
  state.focused = null;
  state.focusedError = null;
  render();
  const match = /^([^/]+)\/([^/]+)#(\d+)$/.exec(key);
  if (!match) return;
  try {
    const detail = await client.getPRDetail(
      tenantId,
      match[1] ?? "",
      match[2] ?? "",
      Number(match[3]),
    );
    if (state.focusedKey !== key) return;
    state.focused = detail;
    render();
  } catch (error) {
    if (state.focusedKey !== key) return;
    state.focusedError = describeAndLog("Open pull request", error);
    render();
  }
}

/** Findings for a run preview, fetched once. */
function syncRunFindings(runId: string): void {
  const tenantId = state.context?.tenantId;
  if (!tenantId || state.runFindings[runId]) return;
  state.runFindings[runId] = { loading: true, error: null };
  void client
    .getRunFindings(tenantId, runId)
    .then((items) => {
      state.runFindings[runId] = { loading: false, error: null, items };
      renderBody();
    })
    .catch((error: unknown) => {
      state.runFindings[runId] = { loading: false, error: describeAndLog("Load findings", error) };
      renderBody();
    });
}

async function attachPR(target: PRChipTarget): Promise<void> {
  try {
    await attachPRChip(target);
    await host.close();
  } catch (error) {
    await host.toast({
      kind: "error",
      message: `Attach failed: ${describeAndLog("Attach", error)}`,
      dismiss: true,
    });
  }
}

async function attachRun(target: RunChipTarget): Promise<void> {
  try {
    await attachRunChip(target);
    await host.close();
  } catch (error) {
    await host.toast({
      kind: "error",
      message: `Attach failed: ${describeAndLog("Attach", error)}`,
      dismiss: true,
    });
  }
}

async function attachAndStart(target: PRChipTarget): Promise<void> {
  const started = await startSessionForPR(target, { worktree: state.worktree });
  if (started) await host.close();
}

/* ----------------------------------------------------------------- render */

let headRoot: HTMLElement | null = null;
let bodyRoot: HTMLElement | null = null;
let footRoot: HTMLElement | null = null;

function render(): void {
  if (!root) return;
  clear(root);
  headRoot = null;
  bodyRoot = null;
  footRoot = null;

  if (!state.ready) {
    mountSpinner(root, { label: "Connecting to Boop" });
    return;
  }
  if (!state.connected) {
    if (!accountsResolved) {
      mountSpinner(root, { label: "Loading Boop" });
      return;
    }
    showSignIn();
    return;
  }

  if (state.focusedKey || state.focusedError) {
    renderFocused();
    return;
  }
  renderPicker();
}

/** The focused view a message action opened: one PR, its findings, its actions. */
function renderFocused(): void {
  const head = el("div", { className: "attach-head" });
  root?.append(head);
  head.append(el("h2", { className: "detail-title" }, "Review with Boop"));

  const body = el("div", { className: "dialog-body" });
  root?.append(body);

  if (state.focusedError) {
    const holder = el("div");
    body.append(holder);
    mountBanner(holder, {
      tone: "error",
      title: "Boop",
      body: state.focusedError,
      action: {
        label: "Browse all PRs",
        onClick: () => {
          state.focusedKey = "";
          state.focusedError = null;
          render();
        },
      },
    });
    return;
  }
  if (!state.focused) {
    const holder = el("div", { style: "flex:1; display:flex; align-items:center;" });
    body.append(holder);
    mountSpinner(holder, { label: "Loading pull request" });
    return;
  }

  const detail = state.focused;
  const tenantId = state.context?.tenantId ?? "";
  const target: PRChipTarget = { pr: detail.pr, tenantId, findings: detail.findings };
  body.append(
    prDetailScaffold({
      detail,
      sessions: [],
      worktree: state.worktree,
      onWorktreeChange: (worktree) => {
        state.worktree = worktree;
      },
      onStartSession: () => void attachAndStart(target),
      onAttach: () => void attachPR(target),
      onCompose: undefined,
      githubUrl: `https://github.com/${detail.pr.owner}/${detail.pr.repo}/pull/${detail.pr.pr_number}`,
      onTriggerReview: async () => {
        try {
          await client.triggerReview(
            tenantId,
            detail.pr.owner,
            detail.pr.repo,
            detail.pr.pr_number,
          );
          await host.toast({ kind: "success", message: "Review requested." });
          await host.close();
        } catch (error) {
          await host.toast({
            kind: "error",
            message: `Review request failed: ${describeAndLog("Request review", error)}`,
            dismiss: true,
          });
        }
      },
      onBack: () => {
        state.focusedKey = "";
        state.focused = null;
        state.focusedError = null;
        render();
      },
    }),
  );
}

function renderPicker(): void {
  headRoot = el("div", { className: "attach-head" });
  root?.append(headRoot);
  renderHead();

  bodyRoot = el("div", { className: "attach-body" });
  root?.append(bodyRoot);

  footRoot = el("div", { className: "attach-foot" });
  root?.append(footRoot);

  renderBody();
  renderFoot();
}

function renderHead(): void {
  if (!headRoot) return;
  clear(headRoot);

  const tabsHolder = el("div");
  headRoot.append(tabsHolder);
  mountTabs(tabsHolder, {
    items: [
      { id: "prs", label: `Pull requests${state.prs.length ? ` (${state.prs.length})` : ""}` },
      { id: "runs", label: `Runs${state.runs.length ? ` (${state.runs.length})` : ""}` },
    ],
    activeId: state.tab,
    onChange: (id) => {
      state.tab = id === "runs" ? "runs" : "prs";
      resetHighlight();
      renderBody();
      renderFoot();
    },
  });

  const row = el("div", { className: "attach-head-row" });

  const searchHolder = el("div", { className: "attach-search" });
  row.append(searchHolder);
  mountSearchField(searchHolder, {
    value: state.search,
    label: "Search",
    placeholder: "Search, or paste owner/repo#123",
    onChange: (value) => {
      state.search = value;
      // The loaded feeds are small; filter in place instead of searching.
      state.results = null;
      resetHighlight();
      renderBody();
      renderFoot();
    },
  });

  const repos = [...new Set([...state.prs.map(repoOfPR), ...state.runs.map(repoOfRun)])].sort();
  if (repos.length > 1) {
    const holder = el("div", { className: state.repoFilter ? "filter filter-active" : "filter" });
    row.append(holder);
    mountMenu(holder, {
      label: state.repoFilter || "Repo",
      size: "sm",
      variant: "ghost",
      items: [
        { id: "", label: "Any repo" },
        { separator: true as const },
        ...repos.map((repo) => ({ id: repo, label: repo })),
      ],
      onSelect: (id) => {
        state.repoFilter = id;
        resetHighlight();
        renderBody();
        renderFoot();
      },
    });
  }

  if (state.tab === "runs") {
    const holder = el("div", {
      className: state.statusFilter !== "any" ? "filter filter-active" : "filter",
    });
    row.append(holder);
    mountMenu(holder, {
      label: state.statusFilter === "any" ? "Status" : RUN_LABEL[state.statusFilter as RunStatus],
      size: "sm",
      variant: "ghost",
      items: [
        { id: "any", label: "Any status" },
        { separator: true as const },
        ...RUN_STATUSES.map((status) => ({ id: status, label: RUN_LABEL[status] })),
      ],
      onSelect: (id) => {
        state.statusFilter = id;
        resetHighlight();
        renderBody();
        renderFoot();
      },
    });
  }

  headRoot.append(row);
}

/** The list and the preview, side by side on a wide dialog. */
function renderBody(): void {
  if (!bodyRoot) return;
  clear(bodyRoot);

  const rows = state.tab === "prs" ? visiblePRs() : visibleRuns();
  if (!state.highlightedId || !rows.some((row) => rowId(row) === state.highlightedId)) {
    state.highlightedId = rows[0] ? rowId(rows[0]) : null;
  }

  bodyRoot.classList.toggle("narrow", !state.wide);
  if (!state.wide && state.previewOpen && state.highlightedId) {
    bodyRoot.append(renderPreview());
    return;
  }

  const split = el("div", { className: "attach-split" });
  split.append(renderList(rows));
  if (state.wide) split.append(renderPreview());
  bodyRoot.append(split);
}

function rowId(row: TenantPR | TenantRun): string {
  return "review_status" in row ? prKey(row.owner, row.repo, row.pr_number) : row.id;
}

function renderList(rows: Array<TenantPR | TenantRun>): HTMLElement {
  const list = el("div", { className: "attach-list scroll" });

  if (state.error) {
    const holder = el("div");
    list.append(holder);
    mountBanner(holder, {
      tone: "error",
      title: "Boop",
      body: state.error,
      action: { label: "Retry", onClick: () => void load() },
    });
  }

  if (state.loading && rows.length === 0) {
    mountSpinner(list, { label: "Loading" });
    return list;
  }
  if (rows.length === 0) {
    mountEmpty(list, {
      title: state.search.trim() ? "Nothing matches" : "Nothing here yet",
      body: state.search.trim()
        ? "Search runs over this tenant's tracked pull requests and recent runs."
        : "Once Boop reviews a pull request, it shows up here.",
    });
    return list;
  }

  for (const row of rows) {
    const item = el("div", {
      className: state.highlightedId === rowId(row) ? "row-item row-item-selected" : "row-item",
    });
    const body = el("div", { className: "row-body" });
    const isPR = "review_status" in row;
    body.append(
      el(
        "div",
        { className: "row-title" },
        isPR
          ? prTitle(row as TenantPR)
          : `${prKey(row.owner, row.repo, row.pr_number)} review #${(row as TenantRun).review_number ?? "?"}`,
      ),
      el(
        "div",
        { className: "row-meta" },
        el("span", { className: "task-key" }, rowId(row)),
        el(
          "span",
          {},
          isPR
            ? REVIEW_LABEL[(row as TenantPR).review_status as ReviewStatus]
            : RUN_LABEL[(row as TenantRun).status as RunStatus],
        ),
        el(
          "span",
          {},
          relativeTimeOf(isPR ? (row as TenantPR).last_seen_at : (row as TenantRun).started_at) ??
            "",
        ),
      ),
    );
    item.append(body);
    item.addEventListener("click", () => {
      state.highlightedId = rowId(row);
      if (isPR) syncFindingsForPR(row as TenantPR);
      else syncRunFindings(row.id);
      if (!state.wide) {
        state.previewOpen = true;
        renderBody();
        return;
      }
      renderBody();
    });
    item.addEventListener("dblclick", () => void attachHighlighted());
    list.append(item);
  }
  return list;
}

/** Drop the highlight and the aggregate behind its preview. */
function resetHighlight(): void {
  state.highlightedId = null;
  state.previewKey = "";
  state.previewDetail = null;
  state.previewError = null;
}

/** Open findings for a PR preview, fetched from the detail aggregate once. */
function syncFindingsForPR(pr: TenantPR): void {
  const tenantId = state.context?.tenantId;
  const key = prKey(pr.owner, pr.repo, pr.pr_number);
  if (!tenantId || state.previewKey === key) return;
  state.previewKey = key;
  state.previewDetail = null;
  state.previewError = null;
  void client
    .getPRDetail(tenantId, pr.owner, pr.repo, pr.pr_number)
    .then((detail) => {
      if (state.previewKey === key) {
        state.previewDetail = detail;
        state.previewError = null;
        renderBody();
      }
    })
    .catch((error: unknown) => {
      if (state.previewKey === key) {
        state.previewDetail = null;
        state.previewError = describeAndLog("Open pull request", error);
        renderBody();
      }
    });
}

/** The currently highlighted row, as its detail or its bare row. */
function highlightedDetail(): { pr?: TenantPRDetailLike; run?: TenantRun } | null {
  const id = state.highlightedId;
  if (!id) return null;
  if (state.tab === "runs") {
    const run = visibleRuns().find((entry) => entry.id === id);
    return run ? { run } : null;
  }
  const pr =
    visiblePRs().find((entry) => prKey(entry.owner, entry.repo, entry.pr_number) === id) ?? null;
  if (!pr) return null;
  if (state.previewKey === id && state.previewDetail) return { pr: state.previewDetail };
  // The bare row previews fine; the aggregate lands when its fetch settles.
  return {
    pr: {
      pr,
      findings: [],
    },
  };
}

function renderPreview(): HTMLElement {
  const preview = el("div", { className: "attach-preview" });
  const current = highlightedDetail();

  if (!current) {
    const holder = el("div", { style: "flex:1; display:flex; align-items:center;" });
    preview.append(holder);
    mountEmpty(holder, {
      title: "Select an item",
      body: "Pick a pull request or a run on the left to preview it here before attaching.",
    });
    return preview;
  }

  if (!state.wide) {
    const back = el("div");
    preview.append(back);
    mountButton(back, {
      label: "Back",
      variant: "ghost",
      size: "sm",
      onClick: () => {
        state.previewOpen = false;
        renderBody();
      },
    });
  }

  if (current.run) {
    const run = current.run;
    syncRunFindings(run.id);
    const tenantId = state.context?.tenantId ?? "";
    preview.append(
      runDetailScaffold({
        run,
        findings: state.runFindings[run.id] ?? null,
        telemetry: null,
        worktree: state.worktree,
        onWorktreeChange: (worktree) => {
          state.worktree = worktree;
        },
        onStartSession: async () => {
          const target: PRChipTarget = {
            pr: {
              owner: run.owner,
              repo: run.repo,
              pr_number: run.pr_number,
              state: "open",
              review_status: run.status === "succeeded" ? "reviewed" : "in_flight",
              last_seen_at: run.started_at,
            },
            tenantId,
          };
          await attachAndStart(target);
        },
        onAttach: () => void attachRun({ run, tenantId }),
        githubUrl: `https://github.com/${run.owner}/${run.repo}/pull/${run.pr_number}`,
        onBack: () => {
          state.previewOpen = false;
          renderBody();
        },
        showChatActions: true,
      }),
    );
    return preview;
  }

  const detail = current.pr as TenantPRDetailLike;
  const tenantId = state.context?.tenantId ?? "";
  const target: PRChipTarget = {
    pr: detail.pr as TenantPRDetailResponse["pr"],
    tenantId,
    findings: detail.findings as TenantPRDetailResponse["findings"],
  };
  preview.append(
    prDetailScaffold({
      detail,
      sessions: [],
      worktree: state.worktree,
      onWorktreeChange: (worktree) => {
        state.worktree = worktree;
      },
      onStartSession: () => void attachAndStart(target),
      onAttach: () => void attachPR(target),
      githubUrl: `https://github.com/${detail.pr.owner}/${detail.pr.repo}/pull/${detail.pr.pr_number}`,
      onTriggerReview: async () => {
        try {
          await client.triggerReview(
            tenantId,
            detail.pr.owner,
            detail.pr.repo,
            detail.pr.pr_number,
          );
          await host.toast({ kind: "success", message: "Review requested." });
          await host.close();
        } catch (error) {
          await host.toast({
            kind: "error",
            message: `Review request failed: ${describeAndLog("Request review", error)}`,
            dismiss: true,
          });
        }
      },
      onBack: () => {
        state.previewOpen = false;
        renderBody();
      },
      showChatActions: true,
    }),
  );
  if (!state.previewDetail && state.tab === "prs") {
    const listed = visiblePRs().find(
      (entry) => prKey(entry.owner, entry.repo, entry.pr_number) === state.highlightedId,
    );
    if (listed) syncFindingsForPR(listed);
  }
  return preview;
}

async function attachHighlighted(): Promise<void> {
  const current = highlightedDetail();
  const tenantId = state.context?.tenantId ?? "";
  if (!current) return;
  if (current.run) {
    await attachRun({ run: current.run, tenantId });
    return;
  }
  if (current.pr) {
    await attachPR({
      pr: current.pr.pr as TenantPRDetailResponse["pr"],
      tenantId,
      findings: current.pr.findings as TenantPRDetailResponse["findings"],
    });
  }
}

function renderFoot(): void {
  if (!footRoot) return;
  clear(footRoot);

  const hasSelection = Boolean(state.highlightedId);
  footRoot.append(
    el(
      "span",
      { className: "attach-hint" },
      hasSelection
        ? "Enter attaches the highlighted item."
        : "Select a pull request or run to attach.",
    ),
  );

  mountButton(footRoot, {
    label: "Cancel",
    variant: "outline",
    size: "sm",
    onClick: () => void host.close(),
  });
  const attachHolder = el("div");
  footRoot.append(attachHolder);
  mountButton(attachHolder, {
    label: "Attach",
    size: "sm",
    disabled: !hasSelection,
    onClick: () => void attachHighlighted(),
  });
}

/** Enter attaches the highlighted item, the way the reference picker does. */
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || state.focusedKey) return;
  const tag = document.activeElement?.tagName.toLowerCase() ?? "";
  if (tag === "textarea" || tag === "button") return;
  if (!state.highlightedId) return;
  event.preventDefault();
  void attachHighlighted();
});

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  installStyles();
  document.body.dataset.theme = ctx.theme.mode;
  document.body.dataset.surface = ctx.surface;
  state.ready = ctx;

  // Seed the focus from the opening item only once; a later `onReady` is a
  // theme or session update and must not reset the user's view.
  if (!booted) {
    booted = true;
    if (isGuestMessageItem(ctx.item) || isGuestSessionItem(ctx.item)) {
      const text = ctx.item.kind === "message" ? ctx.item.text : ctx.item.sessionTitle;
      const ref = firstPRRefIn(text);
      if (ref) {
        state.focusedKey = prKey(ref.owner, ref.repo, ref.number);
      } else {
        void host
          .toast({
            kind: "info",
            message: "No pull request reference in that text. Pick one below.",
          })
          .catch(() => undefined);
      }
    }
    observeWidth();
  }

  render();
  // The connection is the local service's session, not a host integration, so
  // it is read once here and again after a sign-in.
  if (!accountsResolved && !accountsChecking) {
    accountsChecking = true;
    void refreshConnection();
  }
});

async function refreshConnection(): Promise<void> {
  state.connected = Boolean((await boopAccount().catch(() => null))?.connected);
  accountsChecking = false;
  accountsResolved = true;
  render();
  if (state.connected && !loaded) {
    loaded = true;
    await load();
    if (state.focusedKey) void focusPR(state.focusedKey);
  }
}

/** The dialog can be resized; below the breakpoint the panes stack. */
function observeWidth(): void {
  if (!root || !globalThis.ResizeObserver) return;
  const observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    const wide = width === 0 || width >= NARROW_WIDTH;
    if (wide === state.wide) return;
    state.wide = wide;
    if (wide) state.previewOpen = false;
    render();
  });
  observer.observe(root);
}

host.onItem((item) => {
  if (!item || !("providerId" in item)) return;
  const data = item.data as
    { owner?: string; repo?: string; prNumber?: string; runId?: string } | undefined;
  const label = data?.runId
    ? `Run ${data.runId}`
    : data?.owner && data.repo && data.prNumber
      ? prKey(data.owner, data.repo, Number(data.prNumber))
      : "That item";
  void host.toast({ kind: "info", message: `${label} is already attached to this chat.` });
});
