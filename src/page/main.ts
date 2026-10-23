import type { HostReadyContext } from "@openchamber/sdk";
import {
  applyHostReady,
  mountBanner,
  mountButton,
  mountEmpty,
  mountMenu,
  mountSearchField,
  mountSelect,
  mountSpinner,
  mountTabs,
} from "@openchamber/sdk/ui";

import { createBoopClient } from "../shared/client";
import { classifyLoadError, describeAndLog } from "../shared/errors";
import { createDetailStore } from "../shared/details";
import {
  RUN_STATUSES,
  REVIEW_STATUSES,
  RUN_LABEL,
  REVIEW_LABEL,
  type RunStatus,
  type ReviewStatus,
} from "../shared/constants";
import { clear, el } from "../shared/dom";
import { host } from "../shared/host";
import { disconnect } from "../shared/auth";
import { mountSignIn } from "../shared/signin";
import { boopAccount, serviceTransport } from "../shared/service";
import {
  attachPRChip,
  attachRunChip,
  composePRChip,
  reportFailure,
  startSessionForPR,
  type PRChipTarget,
} from "../shared/attachments";
import { requestReview } from "../shared/review";
import { prDetailScaffold, runDetailScaffold } from "../shared/detail";
import { parsePRRef, prKey, prTitle } from "../shared/format";
import {
  loadPreferences,
  loadSessionLinks,
  savePreferences,
  type Preferences,
} from "../shared/preferences";
import { installStyles } from "../shared/styles";
import { watchSessionLifecycle } from "../shared/lifecycle";
import { renderPRRow, renderRunRow } from "../shared/list-row";
import { repoMatchesFilter } from "../shared/repo-filter";
import { resolveRepoFromDirectory } from "../shared/repo";
import { boopWordmark } from "../shared/logo";
import type { SessionLink } from "../shared/session-links";
import type { TenantPR, TenantRun } from "../shared/types";
import { bootstrap, invalidateBootstrapCache, type TenantContext } from "../shared/tenants";

/**
 * The full-screen dashboard from the Extension pages menu. A master-detail
 * split over the tenant's tracked pull requests and review runs, sharing the
 * rail panel's details and actions.
 */

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Boop page is missing its #root element.");

const client = createBoopClient(serviceTransport);

/** The per-tenant detail caches, shared with the panel through one policy. */
const store = createDetailStore(
  {
    prDetail: (tenantId, owner, repo, number) => client.getPRDetail(tenantId, owner, repo, number),
    runFindings: (tenantId, runId) => client.getRunFindings(tenantId, runId),
    runTelemetry: (tenantId, runId) => client.getRunTelemetry(tenantId, runId),
  },
  (action, error) => {
    state.error = describeAndLog(action, error);
    render();
  },
);

interface PageState {
  ready: HostReadyContext | null;
  connected: boolean;
  context: TenantContext | null;
  prs: TenantPR[];
  prsCursor: string | null;
  runs: TenantRun[];
  runsCursor: string | null;
  extraRun: TenantRun | null;
  sessionLinks: Record<string, SessionLink>;
  detectedRepo: string;
  preferences: Preferences;
  search: string;
  listWidth: number | null;
  loading: boolean;
  error: string | null;
}

const state: PageState = {
  ready: null,
  connected: false,
  context: null,
  prs: [],
  prsCursor: null,
  runs: [],
  runsCursor: null,
  extraRun: null,
  sessionLinks: {},
  detectedRepo: "",
  preferences: {
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
  },
  search: "",
  listWidth: null,
  loading: true,
  error: null,
};

let renderToken = 0;
/** `onReady` repeats on theme and session changes; only the first one loads. */
let booted = false;

function repoOfPR(pr: TenantPR): string {
  return `${pr.owner}/${pr.repo}`;
}

function repoOfRun(run: TenantRun): string {
  return `${run.owner}/${run.repo}`;
}

function repoOptions(): Array<{ id: string; label: string }> {
  const repos = new Set<string>();
  for (const pr of state.prs) repos.add(repoOfPR(pr));
  for (const run of state.runs) repos.add(repoOfRun(run));
  return [...repos].sort().map((repo) => ({ id: repo, label: repo }));
}

function prMatches(pr: TenantPR): boolean {
  if (!repoMatchesFilter(repoOfPR(pr), state.preferences.repoFilter)) return false;
  if (
    state.preferences.reviewStatusFilter !== "any" &&
    pr.review_status !== state.preferences.reviewStatusFilter
  ) {
    return false;
  }
  const needle = state.search.trim().toLowerCase();
  if (!needle) return true;
  return (
    prTitle(pr).toLowerCase().includes(needle) ||
    prKey(pr.owner, pr.repo, pr.pr_number).toLowerCase().includes(needle)
  );
}

function runMatches(run: TenantRun): boolean {
  if (!repoMatchesFilter(repoOfRun(run), state.preferences.repoFilter)) return false;
  if (
    state.preferences.runStatusFilter !== "any" &&
    run.status !== state.preferences.runStatusFilter
  ) {
    return false;
  }
  const needle = state.search.trim().toLowerCase();
  if (!needle) return true;
  return (
    `${run.owner}/${run.repo}#${run.pr_number}`.toLowerCase().includes(needle) ||
    run.id.toLowerCase().includes(needle)
  );
}

function accountLabel(): string {
  if (state.context?.tenantId) {
    return `${state.context.tenantId}${state.context.role ? ` · ${state.context.role}` : ""}`;
  }
  return "Boop";
}

/* -------------------------------------------------------------------- data */

async function load(): Promise<void> {
  const token = ++renderToken;
  state.loading = true;
  render();
  try {
    const context = await bootstrap(client, state.preferences.tenantId || undefined);
    if (token !== renderToken) return;

    state.context = context;
    state.preferences = await loadPreferences();
    // The persisted detail pin belongs to the pointer, not to this surface:
    // wiping it here would break the panel's restart-restore contract. The
    // page works in the active tenant, and its own openers clear the pin
    // explicitly when the user navigates.

    if (!state.detectedRepo && state.ready?.directory) {
      state.detectedRepo = await resolveRepoFromDirectory(state.ready.directory, (path) =>
        host.readFile(path).then((file) => file.content),
      ).catch(() => "");
      if (state.detectedRepo && !state.preferences.repoFilter && token === renderToken) {
        state.preferences = await savePreferences({ repoFilter: state.detectedRepo });
      }
    }

    state.loading = false;
    state.error = null;
    render();

    const [prResult, runResult] = await Promise.allSettled([
      client.listPRs(context.tenantId, { limit: 100 }),
      client.listRuns(context.tenantId, {
        ...(state.preferences.runStatusFilter !== "any"
          ? { status: state.preferences.runStatusFilter }
          : {}),
        ...(state.preferences.mineOnly ? { mine: true } : {}),
        limit: 50,
      }),
    ]);
    if (prResult.status === "fulfilled") {
      state.prs = prResult.value.prs;
      state.prsCursor = prResult.value.next_cursor ?? null;
    } else {
      state.error = describeAndLog("List PRs", prResult.reason);
    }
    if (runResult.status === "fulfilled") {
      state.runs = runResult.value.runs;
      state.runsCursor = runResult.value.next_cursor ?? null;
    }
    if (token !== renderToken) return;
    state.sessionLinks = await loadSessionLinks();
    render();
  } catch (error) {
    if (token !== renderToken) return;
    state.loading = false;
    const outcome = classifyLoadError(error);
    if (outcome.expired) {
      // The session is dead; back to sign-in instead of a Retry banner.
      state.connected = false;
      state.context = null;
      accountsResolved = true;
      render();
      return;
    }
    state.error = outcome.message;
    render();
  }
}

/* ------------------------------------------------------------------ render */

let resultsRoot: HTMLElement | null = null;

let signInRoot: HTMLElement | null = null;
let disposeSignIn: (() => void) | null = null;
let accountsResolved = false;

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

function render(): void {
  if (!root) return;
  clear(root);
  resultsRoot = null;

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

  root.append(renderBar());

  if (state.error) {
    const holder = el("div");
    root.append(holder);
    mountBanner(holder, {
      tone: "error",
      title: "Boop",
      body: state.error,
      action: { label: "Retry", onClick: () => void load() },
    });
  }

  resultsRoot = el("div", { style: "flex:1; min-height:0; display:flex; flex-direction:column;" });
  root.append(resultsRoot);
  renderResults();
}

/** Rebuild only the body; the toolbar, and the search focus, stay put. */
function renderResults(): void {
  if (!resultsRoot) return;
  clear(resultsRoot);

  if (state.loading && state.prs.length === 0 && state.runs.length === 0) {
    mountSpinner(resultsRoot, { label: "Loading" });
    return;
  }

  const split = el("div", { className: "split" });
  split.append(state.preferences.view === "runs" ? renderRunList() : renderPRList());
  split.append(renderSeparator());
  split.append(renderPreview());
  if (state.listWidth !== null) {
    const list = split.querySelector<HTMLElement>(".split-list");
    if (list) list.style.width = `${state.listWidth}px`;
  }
  resultsRoot.append(split);
}

function renderSeparator(): HTMLElement {
  const sep = el("div", { className: "split-sep" });
  sep.addEventListener("pointerdown", startListResize);
  return sep;
}

/** The resizable divider between list and preview, like the host's own splits. */
function startListResize(event: PointerEvent): void {
  event.preventDefault();
  const target = event.target as HTMLElement;
  const previous =
    target.previousElementSibling instanceof HTMLElement ? target.previousElementSibling : null;
  const startWidth = previous?.offsetWidth ?? 320;
  const startX = event.clientX;
  const onMove = (move: PointerEvent) => {
    const width = Math.min(
      Math.max(300, startWidth + (move.clientX - startX)),
      Math.floor(window.innerWidth * 0.6),
    );
    state.listWidth = width;
    // Restyle in place; a full render per pointer move would stutter.
    if (resultsRoot) {
      const list = resultsRoot.querySelector<HTMLElement>(".split-list");
      if (list) list.style.width = `${width}px`;
    }
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function renderPRList(): HTMLElement {
  const list = el("div", { className: "split-list scroll" });
  const prs = state.prs.filter(prMatches);

  if (prs.length === 0) {
    const holder = el("div");
    list.append(holder);
    mountEmpty(holder, {
      title: state.prs.length === 0 ? "No tracked pull requests" : "Nothing matches",
      body:
        state.prs.length === 0
          ? "Once a repo is onboarded and a PR opens, Boop tracks it here."
          : "Clear the search box or the filters.",
    });
    return list;
  }

  for (const pr of prs) {
    list.append(
      renderPRRow({
        pr,
        selected: state.preferences.openPR === prKey(pr.owner, pr.repo, pr.pr_number),
        onActivate: () => {
          void openPRDetail(prKey(pr.owner, pr.repo, pr.pr_number));
        },
      }),
    );
  }
  if (state.prsCursor) list.append(renderMore("prs"));
  return list;
}

function renderRunList(): HTMLElement {
  const list = el("div", { className: "split-list scroll" });
  const runs = state.runs.filter(runMatches);

  if (runs.length === 0) {
    const holder = el("div");
    list.append(holder);
    mountEmpty(holder, {
      title: state.runs.length === 0 ? "No runs yet" : "Nothing matches",
      body:
        state.runs.length === 0
          ? "Boop reviews land here once a pull request triggers one."
          : "Clear the search box or the filters.",
    });
    return list;
  }

  for (const run of runs) {
    list.append(
      renderRunRow({
        run,
        selected: state.preferences.openRunId === run.id,
        onActivate: () => {
          void openRunDetail(run.id);
        },
      }),
    );
  }
  if (state.runsCursor) list.append(renderMore("runs"));
  return list;
}

function renderMore(kind: "prs" | "runs"): HTMLElement {
  const holder = el("div", { className: "block" });
  mountButton(holder, {
    label: "Show more",
    variant: "outline",
    size: "sm",
    onClick: () => void loadMore(kind),
  });
  return holder;
}

async function loadMore(kind: "prs" | "runs"): Promise<void> {
  const tenantId = state.context?.tenantId;
  const cursor = kind === "prs" ? state.prsCursor : state.runsCursor;
  if (!tenantId || !cursor) return;
  try {
    if (kind === "prs") {
      const response = await client.listPRs(tenantId, { limit: 100, cursor });
      state.prs = [...state.prs, ...response.prs];
      state.prsCursor = response.next_cursor ?? null;
    } else {
      const response = await client.listRuns(tenantId, { limit: 50, cursor });
      state.runs = [...state.runs, ...response.runs];
      state.runsCursor = response.next_cursor ?? null;
    }
    renderResults();
  } catch (error) {
    state.error = describeAndLog("Load more", error);
    render();
  }
}

/** The toolbar row: tabs, tenant, repo, search, filters, refresh, account. */
function renderBar(): HTMLElement {
  const bar = el("div", { className: "oc-toolbar" });

  const tabsHolder = el("div", { style: "flex-shrink:0;" });
  bar.append(tabsHolder);
  mountTabs(tabsHolder, {
    items: [
      { id: "prs", label: "Pull requests" },
      { id: "runs", label: "Runs" },
    ],
    activeId: state.preferences.view,
    onChange: (id) => {
      const view = id === "runs" ? "runs" : "prs";
      void savePreferences({ view, openRunId: null, openPR: null }).then((preferences) => {
        state.preferences = preferences;
        render();
      });
    },
  });

  const tenants = state.context?.tenants ?? [];
  if (tenants.length > 1) {
    const holder = el("div", { style: "min-width:130px;" });
    bar.append(holder);
    mountSelect(holder, {
      label: "Tenant",
      value: state.context?.tenantId ?? "",
      options: tenants.map((entry) => ({ id: entry.id, label: entry.id, hint: entry.role })),
      onChange: (id) => void switchTenant(id),
    });
  }

  const repos = repoOptions();
  if (repos.length > 0) {
    const holder = el("div", { style: "min-width:150px;" });
    bar.append(holder);
    mountSelect(holder, {
      label: "Repo",
      searchable: repos.length > 8,
      value: state.preferences.repoFilter,
      placeholder: "Every repo",
      options: [{ id: "", label: "Every repo" }, ...repos],
      onChange: (id) => {
        void savePreferences({ repoFilter: id }).then(() => {
          void load();
        });
      },
    });
  }

  const searchHolder = el("div", { style: "flex:1; min-width:180px;" });
  bar.append(searchHolder);
  mountSearchField(searchHolder, {
    value: state.search,
    label: "Filter",
    placeholder: "Filter by title, reference or run id",
    onChange: (value) => {
      state.search = value;
      // Repaint the results only: rebuilding the toolbar would drop focus from
      // the search input after the first keystroke.
      renderResults();
    },
  });

  if (state.preferences.view === "runs") {
    bar.append(
      statusMenu(
        state.preferences.runStatusFilter === "any"
          ? "Any status"
          : RUN_LABEL[state.preferences.runStatusFilter as RunStatus],
        state.preferences.runStatusFilter !== "any",
        [
          { id: "any", label: "Any status" },
          { separator: true },
          ...RUN_STATUSES.map((status) => ({ id: status, label: RUN_LABEL[status] })),
        ],
        (id) => {
          void savePreferences({ runStatusFilter: id as RunStatus | "any" }).then((preferences) => {
            state.preferences = preferences;
            void load();
          });
        },
      ),
      statusMenu(
        state.preferences.mineOnly ? "Triggered by me" : "Anyone",
        state.preferences.mineOnly,
        [
          { id: "any", label: "Anyone" },
          { id: "me", label: "Triggered by me" },
        ],
        (id) => {
          void savePreferences({ mineOnly: id === "me" }).then((preferences) => {
            state.preferences = preferences;
            void load();
          });
        },
      ),
    );
  } else {
    bar.append(
      statusMenu(
        state.preferences.reviewStatusFilter === "any"
          ? "Any review state"
          : REVIEW_LABEL[state.preferences.reviewStatusFilter as ReviewStatus],
        state.preferences.reviewStatusFilter !== "any",
        [
          { id: "any", label: "Any review state" },
          { separator: true },
          ...REVIEW_STATUSES.map((status) => ({ id: status, label: REVIEW_LABEL[status] })),
        ],
        (id) => {
          void savePreferences({ reviewStatusFilter: id as ReviewStatus | "any" }).then(
            (preferences) => {
              state.preferences = preferences;
              void load();
            },
          );
        },
      ),
    );
  }

  const refreshHolder = el("div", { style: "margin-left:auto;" });
  bar.append(refreshHolder);
  mountButton(refreshHolder, {
    label: "Refresh",
    variant: "ghost",
    size: "sm",
    loading: state.loading,
    onClick: () => void load(),
  });

  const accountHolder = el("div");
  bar.append(accountHolder);
  mountMenu(accountHolder, {
    label: accountLabel(),
    size: "sm",
    variant: "ghost",
    items: [
      {
        id: "auto-rereview",
        label: `Auto re-review: ${state.preferences.autoRereview ? "on" : "off"}`,
      },
      { id: "disconnect", label: "Disconnect", destructive: true },
    ],
    onSelect: (id) => {
      if (id === "disconnect") void onDisconnect();
      if (id === "auto-rereview") {
        void savePreferences({ autoRereview: !state.preferences.autoRereview }).then(
          (preferences) => {
            state.preferences = preferences;
            render();
          },
        );
      }
    },
  });

  bar.append(boopWordmark("Boop"));
  return bar;
}

function statusMenu(
  label: string,
  active: boolean,
  items: Array<{ id: string; label: string } | { separator: true }>,
  onSelect: (id: string) => void,
): HTMLElement {
  const holder = el("div", { className: active ? "filter filter-active" : "filter" });
  mountMenu(holder, {
    label,
    size: "sm",
    items,
    onSelect,
  });
  return holder;
}

/* ----------------------------------------------------------------- detail */

async function openPRDetail(key: string): Promise<void> {
  state.preferences = await savePreferences({ openPR: key, openRunId: null, openTenantId: null });
  render();
  ensurePRDetail(key);
}

async function openRunDetail(runId: string): Promise<void> {
  state.preferences = await savePreferences({ openRunId: runId, openPR: null, openTenantId: null });
  render();
  ensureRunData(runId);
}

async function closeDetail(): Promise<void> {
  state.preferences = await savePreferences({ openRunId: null, openPR: null, openTenantId: null });
  render();
}

function ensurePRDetail(key: string): void {
  const tenantId = state.context?.tenantId;
  if (!tenantId) return;
  const pr = parsePRRef(key);
  if (!pr) return;
  store.ensurePRDetail(tenantId, pr.owner, pr.repo, pr.number);
}

function ensureRunData(runId: string): void {
  const tenantId = state.context?.tenantId;
  if (!tenantId) return;
  store.ensureRunData(tenantId, runId);
}

function prSessions(key: string): Array<[string, SessionLink]> {
  return Object.entries(state.sessionLinks)
    .filter(([, link]) => link.pr === key)
    .sort((a, b) => b[1].at - a[1].at);
}

function renderPreview(): HTMLElement {
  const preview = el("div", { className: "split-preview" });
  const tenantId = state.context?.tenantId;

  if (!tenantId) return preview;

  if (state.preferences.view === "runs") {
    const runId = state.preferences.openRunId;
    const run =
      state.runs.find((entry) => entry.id === runId) ??
      (state.extraRun?.id === runId ? state.extraRun : null);
    if (!run) {
      const holder = el("div", { style: "flex:1; display:flex; align-items:center;" });
      preview.append(holder);
      mountEmpty(holder, {
        title: "Select a run",
        body: "Pick a run on the left to see its findings, telemetry and feedback here.",
      });
      return preview;
    }
    ensureRunData(run.id);
    preview.append(
      runDetailScaffold({
        run,
        findings: store.findings(tenantId, run.id),
        telemetry: store.telemetry(tenantId, run.id),
        feedback: {
          onSubmit: (input) => client.postFeedback(tenantId, run.id, input).then(() => undefined),
        },
        worktree: state.preferences.createInWorktree,
        onWorktreeChange: (worktree) => {
          state.preferences = { ...state.preferences, createInWorktree: worktree };
          void savePreferences({ createInWorktree: worktree });
        },
        onStartSession: () => void startSessionFromRun(run),
        onAttach: () =>
          void attachRunChip({ run, tenantId }).catch((e) => reportFailure("Attach", e)),
        githubUrl: `https://github.com/${run.owner}/${run.repo}/pull/${run.pr_number}`,
        onTriggerReview: () =>
          void requestReview(client, tenantId, run.owner, run.repo, run.pr_number).then(
            (accepted) => {
              if (!accepted) return;
              // A fresh review makes the run's PR aggregate stale, the same
              // rule the panel's runs branch follows.
              store.dropPRDetail(tenantId, prKey(run.owner, run.repo, run.pr_number));
              void load();
            },
          ),
        onBack: () => void closeDetail(),
      }),
    );
    return preview;
  }

  const key = state.preferences.openPR;
  const detail = key && tenantId ? store.prDetail(tenantId, key) : undefined;
  if (!key || !detail) {
    if (key) ensurePRDetail(key);
    const holder = el("div", { style: "flex:1; display:flex; align-items:center;" });
    preview.append(holder);
    mountEmpty(holder, {
      title: "Select a pull request",
      body: "Pick one on the left to see its findings, runs and sessions here.",
    });
    return preview;
  }

  const prRef = parsePRRef(key);
  const target: PRChipTarget = { pr: detail.pr, tenantId, findings: detail.findings };
  preview.append(
    prDetailScaffold({
      detail,
      sessions: prSessions(key),
      worktree: state.preferences.createInWorktree,
      onWorktreeChange: (worktree) => {
        state.preferences = { ...state.preferences, createInWorktree: worktree };
        void savePreferences({ createInWorktree: worktree });
      },
      onStartSession: () =>
        void startSessionForPR(target, { worktree: state.preferences.createInWorktree }),
      onAttach: () => void attachPRChip(target).catch((e) => reportFailure("Attach", e)),
      onCompose: () => void composePRChip(target).catch((e) => reportFailure("Send to chat", e)),
      githubUrl: `https://github.com/${detail.pr.owner}/${detail.pr.repo}/pull/${detail.pr.pr_number}`,
      onTriggerReview: () => {
        if (prRef)
          void requestReview(client, tenantId, prRef.owner, prRef.repo, prRef.number).then(
            (accepted) => {
              if (!accepted) return;
              // A fresh review makes the cached aggregate stale.
              store.dropPRDetail(tenantId, key);
              void load();
            },
          );
      },
      onBack: () => void closeDetail(),
    }),
  );
  return preview;
}

/** A session started from a run works on the run's PR. */
async function startSessionFromRun(run: TenantRun): Promise<void> {
  const tenantId = state.context?.tenantId;
  if (!tenantId) return;
  const key = prKey(run.owner, run.repo, run.pr_number);
  const detail = store.prDetail(tenantId, key);
  const target: PRChipTarget = detail
    ? { pr: detail.pr, tenantId, findings: detail.findings }
    : {
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
  await startSessionForPR(target, { worktree: state.preferences.createInWorktree });
}

async function switchTenant(tenantId: string): Promise<void> {
  if (tenantId === state.context?.tenantId) return;
  state.preferences = await savePreferences({
    tenantId,
    openRunId: null,
    openPR: null,
    openTenantId: null,
  });
  state.prs = [];
  state.runs = [];
  state.extraRun = null;
  store.clear();
  await invalidateBootstrapCache();
  await load();
}

/* ------------------------------------------------------------------- host */

store.onRender(() => render());

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  installStyles();
  document.body.dataset.theme = ctx.theme.mode;
  document.body.dataset.surface = ctx.surface;
  state.ready = ctx;
  render();
  // The connection is the local service's session, not a host integration, so
  // it is read here once and again after a sign-in. Later `onReady` calls are
  // theme or session updates that must not refetch everything.
  if (!booted) {
    booted = true;
    void refreshConnection();
  }
});

async function refreshConnection(): Promise<void> {
  state.connected = Boolean((await boopAccount().catch(() => null))?.connected);
  accountsResolved = true;
  render();
  if (state.connected) void load();
}

async function onSignedIn(): Promise<void> {
  clearSignIn();
  state.connected = true;
  await load();
}

async function onDisconnect(): Promise<void> {
  await disconnect();
  clearSignIn();
  state.connected = false;
  state.context = null;
  state.prs = [];
  state.runs = [];
  store.clear();
  render();
}

// Session outcomes for PRs this extension started sessions on.
watchSessionLifecycle(client);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (state.preferences.openPR || state.preferences.openRunId)) {
    void closeDetail();
  }
});
