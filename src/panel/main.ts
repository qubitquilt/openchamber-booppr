import type { HostReadyContext } from "@openchamber/sdk";
import {
  applyHostReady,
  mountBanner,
  mountButton,
  mountEmpty,
  mountList,
  mountMenu,
  mountSearchField,
  mountSelect,
  mountSpinner,
} from "@openchamber/sdk/ui";

import { createBoopClient } from "../shared/client";
import { classifyLoadError, describeAndLog } from "../shared/errors";
import { createDetailStore } from "../shared/details";
import {
  PROVIDER_ID,
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
  type PRChipData,
  type PRChipTarget,
} from "../shared/attachments";
import { requestReview } from "../shared/review";
import { prDetailScaffold, runDetailScaffold } from "../shared/detail";
import { parsePRRef, prKey, prTitle, relativeTimeOf, costLabel } from "../shared/format";
import {
  loadPreferences,
  loadSessionLinks,
  savePreferences,
  type Preferences,
} from "../shared/preferences";
import { installStyles } from "../shared/styles";
import { watchSessionLifecycle } from "../shared/lifecycle";
import { repoMatchesFilter, repoNameOf } from "../shared/repo-filter";
import { resolveRepoFromDirectory } from "../shared/repo";
import type { SessionLink } from "../shared/session-links";
import type { TenantPR, TenantRun } from "../shared/types";
import {
  bootstrap,
  invalidateBootstrapCache,
  refreshBadge,
  type TenantContext,
} from "../shared/tenants";

/**
 * The rail panel, shaped like OpenChamber's own issue panels: one tab of the
 * tenant's tracked pull requests and one of its review runs, with a search
 * box, a row of filters, and in-place details that carry the findings, the
 * telemetry and the actions.
 */

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Boop panel is missing its #root element.");

const client = createBoopClient(serviceTransport);

/** The per-tenant detail caches, shared with the page through one policy. */
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

interface PanelState {
  ready: HostReadyContext | null;
  connected: boolean;
  context: TenantContext | null;
  prs: TenantPR[];
  prsCursor: string | null;
  runs: TenantRun[];
  runsCursor: string | null;
  /** A run fetched for a chip click that is not on the loaded page. */
  extraRun: TenantRun | null;
  /** Session links, loaded once per render cycle for the PR details. */
  sessionLinks: Record<string, SessionLink>;
  /** The repo the open project is, resolved from .git/config. */
  detectedRepo: string;
  preferences: Preferences;
  search: string;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const state: PanelState = {
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
  loading: true,
  loadingMore: false,
  error: null,
};

/** A newer render always wins, so a slow answer never overwrites a newer one. */
let renderToken = 0;
/** `onReady` repeats on theme and session changes; only the first one loads. */
let booted = false;

/* ---------------------------------------------------------------- filtering */

function repoOfPR(pr: TenantPR): string {
  return `${pr.owner}/${pr.repo}`;
}

function repoOfRun(run: TenantRun): string {
  return `${run.owner}/${run.repo}`;
}

/** The row view of the repo filter, from the one grammar in repo-filter.ts. */
function repoMatches(ownerRepo: string): boolean {
  return repoMatchesFilter(ownerRepo, state.preferences.repoFilter);
}

function prMatches(pr: TenantPR): boolean {
  if (!repoMatches(repoOfPR(pr))) return false;
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
  if (!repoMatches(repoOfRun(run))) return false;
  if (
    state.preferences.runStatusFilter !== "any" &&
    run.status !== state.preferences.runStatusFilter
  ) {
    return false;
  }
  // `mine` is a server-side filter, applied by reloadRuns.
  const needle = state.search.trim().toLowerCase();
  if (!needle) return true;
  return (
    `${run.owner}/${run.repo}#${run.pr_number}`.toLowerCase().includes(needle) ||
    run.id.toLowerCase().includes(needle)
  );
}

function anyFilterActive(): boolean {
  return (
    state.search.trim().length > 0 ||
    state.preferences.repoFilter !== "" ||
    state.preferences.runStatusFilter !== "any" ||
    state.preferences.reviewStatusFilter !== "any" ||
    state.preferences.mineOnly
  );
}

/** The menu label for the signed-in account: tenant and role, then the id. */
function accountLabel(): string {
  if (state.context?.tenantId) {
    return `${state.context.tenantId}${state.context.role ? ` · ${state.context.role}` : ""}`;
  }
  return "Boop";
}

/* -------------------------------------------------------------------- data */

function repoOptions(): Array<{ id: string; label: string }> {
  const repos = new Set<string>();
  for (const pr of state.prs) repos.add(repoOfPR(pr));
  for (const run of state.runs) repos.add(repoOfRun(run));
  return [...repos].sort().map((repo) => ({ id: repo, label: repo }));
}

async function load(): Promise<void> {
  const token = ++renderToken;
  state.loading = true;
  render();
  try {
    const context = await bootstrap(client, state.preferences.tenantId || undefined);
    if (token !== renderToken) return;

    state.context = context;
    state.preferences = await loadPreferences();

    // The open project's repo, resolved once per load; an empty result keeps
    // whatever filter the user already chose.
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

    const [prResult, runResult] = await Promise.allSettled([reloadPRs(), reloadRuns()]);
    if (prResult.status === "rejected") state.error = describeAndLog("List PRs", prResult.reason);
    if (runResult.status === "rejected")
      state.error = describeAndLog("List runs", runResult.reason);
    if (token !== renderToken) return;

    state.preferences = await loadPreferences();
    state.sessionLinks = await loadSessionLinks();
    await refreshBadge(
      state.runs.filter((run) => run.status === "running" || run.status === "pending").length,
    );
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

async function reloadPRs(cursor?: string): Promise<void> {
  const tenantId = state.context?.tenantId;
  if (!tenantId) {
    state.prs = [];
    state.prsCursor = null;
    return;
  }
  // The server filters when the filter carries a repo name; the row view
  // (repoMatches, via repoMatchesFilter) governs what renders. An empty or
  // junk filter reaches the server as no filter at all.
  const repoName = repoNameOf(state.preferences.repoFilter);
  const response = await client.listPRs(tenantId, {
    ...(repoName ? { repo: repoName } : {}),
    limit: 100,
    ...(cursor ? { cursor } : {}),
  });
  state.prs = cursor ? [...state.prs, ...response.prs] : response.prs;
  state.prsCursor = response.next_cursor ?? null;
}

async function reloadRuns(cursor?: string): Promise<void> {
  const tenantId = state.context?.tenantId;
  if (!tenantId) {
    state.runs = [];
    state.runsCursor = null;
    return;
  }
  const repoName = repoNameOf(state.preferences.repoFilter);
  const response = await client.listRuns(tenantId, {
    ...(repoName ? { repo: repoName } : {}),
    ...(state.preferences.runStatusFilter !== "any"
      ? { status: state.preferences.runStatusFilter }
      : {}),
    ...(state.preferences.mineOnly ? { mine: true } : {}),
    limit: 50,
    ...(cursor ? { cursor } : {}),
  });
  state.runs = cursor ? [...state.runs, ...response.runs] : response.runs;
  state.runsCursor = response.next_cursor ?? null;
}

/* ------------------------------------------------------------------ render */

/**
 * The results region, kept between renders so typing in the search box can
 * refresh the list without rebuilding the toolbar and dropping focus.
 */
let resultsRoot: HTMLElement | null = null;

/**
 * The sign-in view is mounted once and kept across renders, so its polling
 * survives a theme repaint instead of being torn down and restarted. It is
 * disposed when the user connects or disconnects.
 */
let signInRoot: HTMLElement | null = null;
let disposeSignIn: (() => void) | null = null;
/** False until the service has told us whether a session exists, to avoid a flash of sign-in. */
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

  if (!state.connected) {
    if (!accountsResolved) {
      const holder = el("div", { style: "flex:1; display:flex; align-items:center;" });
      root.append(holder);
      mountSpinner(holder, { label: "Loading Boop" });
      return;
    }
    showSignIn();
    return;
  }

  if (!state.context && state.loading) {
    const holder = el("div", { style: "flex:1; display:flex; align-items:center;" });
    root.append(holder);
    mountSpinner(holder, { label: "Loading Boop" });
    return;
  }

  const detail = renderOpenDetail();
  if (detail) {
    root.append(detail);
    return;
  }

  root.append(renderToolbar());

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

  resultsRoot = el("div", { className: "scroll" });
  root.append(resultsRoot);
  renderList();
}

interface ListEntry {
  id: string;
  title: string;
  leading: string;
  subtitle: string;
}

function renderList(): void {
  if (!resultsRoot) return;
  clear(resultsRoot);

  if (state.preferences.view === "runs") {
    const runs = state.runs.filter(runMatches);
    if (state.loading && runs.length === 0) {
      mountSpinner(resultsRoot, { label: "Loading runs" });
      return;
    }
    if (state.runs.length === 0) {
      mountEmpty(resultsRoot, {
        title: "No runs yet",
        body: "Boop reviews land here once a pull request triggers one.",
      });
      return;
    }
    if (runs.length === 0) {
      mountEmpty(resultsRoot, {
        title: "Nothing matches the filters",
        body: "Clear the search box or the filters.",
      });
      return;
    }
    const entries: ListEntry[] = runs.map((run) => ({
      id: run.id,
      title: `${prKey(run.owner, run.repo, run.pr_number)} review #${run.review_number ?? "?"}`,
      leading: RUN_LABEL[run.status],
      subtitle: [run.id, relativeTimeOf(run.started_at), costLabel(run.cost_usd)]
        .filter(Boolean)
        .join(" · "),
    }));
    mountRunList(entries, state.preferences.openRunId);
    if (state.runsCursor) resultsRoot.append(renderMoreButton("runs"));
    return;
  }

  const prs = state.prs.filter(prMatches);
  if (state.loading && prs.length === 0) {
    mountSpinner(resultsRoot, { label: "Loading pull requests" });
    return;
  }
  if (state.prs.length === 0) {
    mountEmpty(resultsRoot, {
      title: "No tracked pull requests",
      body: "Once a repo is onboarded and a PR opens, Boop tracks it here.",
    });
    return;
  }
  if (prs.length === 0) {
    mountEmpty(resultsRoot, {
      title: "Nothing matches the filters",
      body: "Clear the search box or the filters.",
    });
    return;
  }
  const entries: ListEntry[] = prs.map((pr) => ({
    id: prKey(pr.owner, pr.repo, pr.pr_number),
    title: prTitle(pr),
    leading: prKey(pr.owner, pr.repo, pr.pr_number),
    subtitle: [REVIEW_LABEL[pr.review_status], pr.author_login, relativeTimeOf(pr.last_seen_at)]
      .filter(Boolean)
      .join(" · "),
  }));
  mountPRList(entries, state.preferences.openPR);
  if (state.prsCursor) resultsRoot.append(renderMoreButton("prs"));
}

function renderMoreButton(kind: "prs" | "runs"): HTMLElement {
  const holder = el("div", { className: "block" });
  mountButton(holder, {
    label: "Show more",
    variant: "outline",
    size: "sm",
    loading: state.loadingMore,
    onClick: () => void loadMore(kind),
  });
  return holder;
}

async function loadMore(kind: "prs" | "runs"): Promise<void> {
  const cursor = kind === "prs" ? state.prsCursor : state.runsCursor;
  if (!cursor || state.loadingMore) return;
  state.loadingMore = true;
  renderList();
  try {
    if (kind === "prs") await reloadPRs(cursor);
    else await reloadRuns(cursor);
  } catch (error) {
    state.error = describeAndLog("Load more", error);
  } finally {
    state.loadingMore = false;
    render();
  }
}

function mountPRList(items: ListEntry[], selectedId: string | null): void {
  if (!resultsRoot) return;
  const holder = el("div");
  resultsRoot.append(holder);
  mountList(holder, {
    items,
    selectedId,
    ariaLabel: "Tracked pull requests",
    onSelect: (id) => void openPRDetail(id),
  });
}

function mountRunList(items: ListEntry[], selectedId: string | null): void {
  if (!resultsRoot) return;
  const holder = el("div");
  resultsRoot.append(holder);
  mountList(holder, {
    items,
    selectedId,
    ariaLabel: "Review runs",
    onSelect: (id) => void openRunDetail(id),
  });
}

function renderToolbar(): HTMLElement {
  const wrap = el("div", { className: "panel-head" });

  const tabsHolder = el("div");
  wrap.append(tabsHolder);
  mountTabsMini(tabsHolder);

  const searchHolder = el("div");
  wrap.append(searchHolder);
  mountSearchField(searchHolder, {
    value: state.search,
    label: "Filter",
    placeholder:
      state.preferences.view === "runs"
        ? "Filter by repo, PR or run id"
        : "Filter by title or reference",
    onChange: (value) => {
      state.search = value;
      renderList();
    },
  });

  const bar = el("div", { className: "toolbar filters" });

  const repos = repoOptions();
  filterMenu(bar, {
    label: state.preferences.repoFilter || "Repo",
    active: state.preferences.repoFilter !== "",
    items: [{ id: "", label: "Any repo" }, { separator: true as const }, ...repos],
    onSelect: (id) => {
      void savePreferences({ repoFilter: id }).then((preferences) => {
        state.preferences = preferences;
        void load();
      });
    },
  });

  filterMenu(bar, {
    label:
      state.preferences.view === "runs"
        ? state.preferences.runStatusFilter === "any"
          ? "Status"
          : RUN_LABEL[state.preferences.runStatusFilter as RunStatus]
        : state.preferences.reviewStatusFilter === "any"
          ? "Review"
          : REVIEW_LABEL[state.preferences.reviewStatusFilter as ReviewStatus],
    active:
      state.preferences.view === "runs"
        ? state.preferences.runStatusFilter !== "any"
        : state.preferences.reviewStatusFilter !== "any",
    items:
      state.preferences.view === "runs"
        ? [
            { id: "any", label: "Any status" },
            { separator: true as const },
            ...RUN_STATUSES.map((status) => ({ id: status, label: RUN_LABEL[status] })),
          ]
        : [
            { id: "any", label: "Any review state" },
            { separator: true as const },
            ...REVIEW_STATUSES.map((status) => ({ id: status, label: REVIEW_LABEL[status] })),
          ],
    onSelect: (id) => {
      void savePreferences(
        state.preferences.view === "runs"
          ? { runStatusFilter: id as RunStatus | "any" }
          : { reviewStatusFilter: id as ReviewStatus | "any" },
      ).then((preferences) => {
        state.preferences = preferences;
        void load();
      });
    },
  });

  if (state.preferences.view === "runs") {
    filterMenu(bar, {
      label: state.preferences.mineOnly ? "Triggered by me" : "Anyone",
      active: state.preferences.mineOnly,
      items: [
        { id: "any", label: "Anyone" },
        { id: "me", label: "Triggered by me" },
      ],
      onSelect: (id) => {
        void savePreferences({ mineOnly: id === "me" }).then((preferences) => {
          state.preferences = preferences;
          void load();
        });
      },
    });
  }

  if (anyFilterActive()) {
    const holder = el("div", { className: "filter-clear" });
    bar.append(holder);
    mountButton(holder, {
      label: "Clear",
      variant: "ghost",
      size: "sm",
      onClick: () => {
        state.search = "";
        void savePreferences({
          repoFilter: "",
          runStatusFilter: "any",
          reviewStatusFilter: "any",
          mineOnly: false,
        }).then((preferences) => {
          state.preferences = preferences;
          void load();
        });
      },
    });
  }

  const refreshHolder = el("div", { className: "filter-refresh" });
  bar.append(refreshHolder);
  mountButton(refreshHolder, {
    label: "Refresh",
    variant: "ghost",
    size: "sm",
    loading: state.loading,
    onClick: () => void load(),
  });

  const accountHolder = el("div", { className: "filter-account" });
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

  wrap.append(bar);

  const scopes = el("div", { className: "toolbar scope" });
  const tenants = state.context?.tenants ?? [];
  if (tenants.length > 1) {
    const holder = el("div", { style: "flex:1; min-width:120px;" });
    scopes.append(holder);
    mountSelect(holder, {
      value: state.context?.tenantId ?? "",
      options: tenants.map((entry) => ({
        id: entry.id,
        label: entry.id,
        hint: entry.role,
      })),
      onChange: (id) => void switchTenant(id),
    });
  }
  if (state.detectedRepo && state.detectedRepo !== state.preferences.repoFilter) {
    const holder = el("div");
    scopes.append(holder);
    mountButton(holder, {
      label: `This repo: ${state.detectedRepo}`,
      variant: "ghost",
      size: "sm",
      onClick: () => {
        void savePreferences({ repoFilter: state.detectedRepo }).then((preferences) => {
          state.preferences = preferences;
          void load();
        });
      },
    });
  }
  if (scopes.childElementCount > 0) wrap.append(scopes);

  return wrap;
}

/** Two text tabs without pulling the full tab kit into a narrow rail. */
function mountTabsMini(holder: HTMLElement): void {
  const bar = el("div", { className: "toolbar" });
  for (const view of ["prs", "runs"] as const) {
    const active = state.preferences.view === view;
    const tab = el("div", { style: active ? "" : "opacity:0.7;" });
    bar.append(tab);
    mountButton(tab, {
      label: view === "prs" ? "Pull requests" : "Runs",
      variant: active ? "secondary" : "ghost",
      size: "sm",
      onClick: () => {
        if (state.preferences.view === view) return;
        void savePreferences({ view, openRunId: null, openPR: null }).then((preferences) => {
          state.preferences = preferences;
          render();
        });
      },
    });
  }
  holder.append(bar);
}

function filterMenu(
  bar: HTMLElement,
  props: {
    label: string;
    items: Array<{ id: string; label: string } | { separator: true }>;
    active: boolean;
    onSelect: (id: string) => void;
  },
): void {
  const holder = el("div", { className: props.active ? "filter filter-active" : "filter" });
  bar.append(holder);
  mountMenu(holder, {
    label: props.label,
    size: "sm",
    variant: "ghost",
    items: props.items,
    onSelect: props.onSelect,
  });
}

/* ----------------------------------------------------------------- detail */

function findRun(runId: string | null): TenantRun | null {
  if (!runId) return null;
  return (
    state.runs.find((run) => run.id === runId) ??
    (state.extraRun?.id === runId ? state.extraRun : null)
  );
}

async function openRunDetail(runId: string, tenantIdOverride?: string): Promise<void> {
  // The pin persists beside the pointer, so a chip detail restored after a
  // restart still refetches under the tenant it was attached under.
  state.preferences = await savePreferences({
    openRunId: runId,
    openPR: null,
    openTenantId: tenantIdOverride ?? null,
  });
  render();
  ensureRunData(runId);
}

async function openPRDetail(key: string, tenantIdOverride?: string): Promise<void> {
  state.preferences = await savePreferences({
    openPR: key,
    openRunId: null,
    openTenantId: tenantIdOverride ?? null,
  });
  render();
  ensurePRDetail(key);
}

/**
 * The tenant the open detail acts in: the tenant its pointer was pinned to
 * (a chip can attach under another membership), else the panel's own. A
 * session authorizes the user and the receiver's RBAC checks live membership,
 * so a pin the session can no longer see falls through to the panel's tenant
 * and fails loudly there instead of silently switching.
 */
function detailTenantId(): string {
  const pinned = state.preferences.openTenantId;
  if (pinned && state.context?.tenants.some((tenant) => tenant.id === pinned)) return pinned;
  return state.context?.tenantId || "";
}

async function closeDetail(): Promise<void> {
  state.preferences = await savePreferences({ openRunId: null, openPR: null });
  render();
}

/** Fetch a run's findings and telemetry once; a re-render picks them up. */
function ensureRunData(runId: string): void {
  const tenantId = detailTenantId();
  if (!tenantId) return;
  store.ensureRunData(tenantId, runId);
}

/** Fetch the PR aggregate once; a re-render picks it up. */
function ensurePRDetail(key: string): void {
  const tenantId = detailTenantId();
  if (!tenantId) return;
  const pr = parsePRRef(key);
  if (!pr) return;
  store.ensurePRDetail(tenantId, pr.owner, pr.repo, pr.number);
}

/** The open detail sheet, or null when the list should show. */
function renderOpenDetail(): HTMLElement | null {
  const tenantId = detailTenantId();
  if (!tenantId) return null;

  if (state.preferences.openRunId) {
    const run = findRun(state.preferences.openRunId);
    if (!run) return null;
    ensureRunData(run.id);
    const prRef = parsePRRef(prKey(run.owner, run.repo, run.pr_number));
    return runDetailScaffold({
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
      onTriggerReview: prRef
        ? () =>
            void requestReview(client, tenantId, prRef.owner, prRef.repo, prRef.number).then(
              (accepted) => {
                if (!accepted) return;
                // A fresh review makes the cached aggregate stale.
                store.dropPRDetail(tenantId, prKey(prRef.owner, prRef.repo, prRef.number));
                void load();
              },
            )
        : undefined,
      onBack: () => void closeDetail(),
    });
  }

  if (state.preferences.openPR) {
    const key = state.preferences.openPR;
    const detail = store.prDetail(tenantId, key);
    if (!detail) {
      ensurePRDetail(key);
      const holder = el("div", { style: "flex:1; display:flex; align-items:center;" });
      mountSpinner(holder, { label: "Loading pull request" });
      return holder;
    }
    const prRef = parsePRRef(key);
    const target: PRChipTarget = { pr: detail.pr, tenantId, findings: detail.findings };
    return prDetailScaffold({
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
      githubUrl: `https://github.com/${prRef?.owner ?? detail.pr.owner}/${prRef?.repo ?? detail.pr.repo}/pull/${prRef?.number ?? detail.pr.pr_number}`,
      onTriggerReview: () => {
        if (prRef)
          void requestReview(client, tenantId, prRef.owner, prRef.repo, prRef.number).then(
            (accepted) => {
              if (!accepted) return;
              // A fresh review makes the cached aggregate stale.
              store.dropPRDetail(tenantId, prKey(prRef.owner, prRef.repo, prRef.number));
              void load();
            },
          );
      },
      onBack: () => void closeDetail(),
    });
  }
  return null;
}

/** The recorded sessions for one PR, newest first. */
function prSessions(key: string): Array<[string, SessionLink]> {
  const links = state.sessionLinks;
  return Object.entries(links)
    .filter(([, link]) => link.pr === key)
    .sort((a, b) => b[1].at - a[1].at);
}

/** A session started from a run works on the run's PR. */
async function startSessionFromRun(run: TenantRun): Promise<void> {
  const tenantId = detailTenantId();
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

/* ---------------------------------------------------------------- actions */

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

store.onRender(() => render());

/** Mount the panel once, then refresh when the theme moves. */
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
  state.extraRun = null;
  store.clear();
  render();
}

// Session outcomes for PRs this extension started sessions on.
watchSessionLifecycle(client);

/** Chip clicks land here; a chip click restores the PR or run it came from. */
host.onItem((item) => {
  if (!item || !("providerId" in item) || item.providerId !== PROVIDER_ID) return;
  // The chip's own payload, typed by the module that wrote it. A chip is
  // attached under one tenant; honor it rather than the tenant the panel
  // happens to show now, or the lookup 404s into the error banner.
  const data = item.data as Partial<PRChipData> | undefined;
  if (!data) return;
  const chipTenant = typeof data.tenantId === "string" ? data.tenantId : "";
  if (!chipTenant) {
    // Our chips always carry the tenant; an item without one is foreign or
    // corrupted, and opening it under the panel's current membership could
    // act on the wrong tenant.
    void host.toast({
      kind: "error",
      message: "That chip carries no tenant, so it cannot be opened here.",
      dismiss: true,
    });
    return;
  }
  if (typeof data.runId === "string" && data.runId) {
    void openRunChip(data.runId, chipTenant);
    return;
  }
  if (
    typeof data.owner === "string" &&
    typeof data.repo === "string" &&
    typeof data.prNumber === "string" &&
    data.prNumber
  ) {
    void openPRDetail(`${data.owner}/${data.repo}#${data.prNumber}`, chipTenant);
  }
});

/**
 * A chip click can name a run outside the loaded page; fetch it first, the way
 * a detail opened from a stale page would. The fetch uses the chip's tenant,
 * which openRunDetail then persists beside the pointer.
 */
async function openRunChip(runId: string, chipTenant: string): Promise<void> {
  const tenantId = chipTenant || state.context?.tenantId || "";
  if (!findRun(runId) && tenantId) {
    try {
      state.extraRun = await client.getRun(tenantId, runId);
    } catch (error) {
      await reportFailure("Open run", error);
      return;
    }
  }
  await openRunDetail(runId, chipTenant || undefined);
}
