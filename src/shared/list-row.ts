import { el } from "./dom";
import { personChip, repoKey } from "./chips";
import { RUN_LABEL, type RunStatus } from "./constants";
import { prKey, prTitle, relativeTimeOf, runCostLine } from "./format";
import type { TenantPR, TenantRun } from "./types";

/**
 * A list row in the shape of the OpenChamber reference rows: a state glyph,
 * a two-line-clamped semibold title, and one muted meta line holding the
 * reference, the author, the age and the cost. The rail panel, the full-screen
 * page and the attach picker all render through these two builders, so the
 * surfaces stay identical.
 */

type Glyph = "blank" | "progress" | "done" | "error" | "skipped";

const GLYPH_COLOR: Record<Glyph, string> = {
  blank: "var(--oc-muted, var(--b-muted))",
  progress: "var(--oc-info, var(--b-info-text))",
  done: "var(--oc-success, var(--b-success-text))",
  error: "var(--oc-error-text, var(--b-error-text))",
  skipped: "var(--oc-muted, var(--b-muted))",
};

/** Tiny inline SVGs; the sandbox cannot load an icon font or sprite. */
function glyphNode(kind: Glyph): SVGSVGElement {
  const color = GLYPH_COLOR[kind];
  const paths: Record<Glyph, string> = {
    blank: `<circle cx="8" cy="8" r="6.5" fill="none" stroke="${color}" stroke-width="1.5"/>`,
    progress: `<circle cx="8" cy="8" r="6.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="${color}"/>`,
    done: `<circle cx="8" cy="8" r="6.5" fill="${color}"/><path d="M5 8.2 L7.2 10.4 L11 6.2" stroke="var(--b-bg)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    error: `<circle cx="8" cy="8" r="6.5" fill="${color}"/><path d="M5.8 5.8 L10.2 10.2 M10.2 5.8 L5.8 10.2" stroke="var(--b-bg)" stroke-width="1.5" stroke-linecap="round"/>`,
    skipped: `<circle cx="8" cy="8" r="6.5" fill="none" stroke="${color}" stroke-width="1.5"/><path d="M5.5 8 L10.5 8" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`,
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths[kind];
  svg.classList.add("row-glyph");
  return svg;
}

/** The glyph of a run's lifecycle state. */
export function runGlyph(status: RunStatus): Glyph {
  return status === "succeeded"
    ? "done"
    : status === "failed"
      ? "error"
      : status === "running"
        ? "progress"
        : status === "canceled"
          ? "skipped"
          : "blank";
}

/** The glyph of a tracked PR's review status. */
export function reviewGlyph(status: TenantPR["review_status"]): Glyph {
  return status === "reviewed"
    ? "done"
    : status === "failed"
      ? "error"
      : status === "in_flight"
        ? "progress"
        : status === "skipped"
          ? "skipped"
          : "blank";
}

export interface PRRowOptions {
  pr: TenantPR;
  /** How many findings are open on the PR, for the meta line. */
  openFindings?: number;
  selected: boolean;
  /** A click activates (opens the preview); the host list handles keyboard. */
  onActivate: () => void;
}

export function renderPRRow(options: PRRowOptions): HTMLElement {
  const { pr, selected, onActivate } = options;
  const age = relativeTimeOf(pr.last_seen_at);
  const key = prKey(pr.owner, pr.repo, pr.pr_number);

  const row = el("div", {
    className: selected ? "row-item row-item-selected" : "row-item",
    dataset: { pr: key },
    onClick: onActivate,
  });

  const content = el("div", { className: "row-body" });
  content.append(el("div", { className: "row-title" }, prTitle(pr)));

  const meta = el("div", { className: "row-meta" });
  meta.append(el("span", { className: "task-key" }, key));
  if (pr.author_login) meta.append(personChip(pr.author_login));
  if (pr.state !== "open") meta.append(el("span", {}, pr.state));
  if (age) meta.append(el("span", {}, age));
  if ((options.openFindings ?? 0) > 0) {
    const count = options.openFindings as number;
    meta.append(el("span", { className: count >= 5 ? "overdue" : "" }, `${count} open`));
  }
  content.append(meta);

  row.append(glyphNode(reviewGlyph(pr.review_status)), content);
  row.title = `${key} · ${pr.review_status}`;
  return row;
}

export interface RunRowOptions {
  run: TenantRun;
  selected: boolean;
  onActivate: () => void;
}

export function renderRunRow(options: RunRowOptions): HTMLElement {
  const { run, selected, onActivate } = options;
  const age = relativeTimeOf(run.started_at);
  const key = prKey(run.owner, run.repo, run.pr_number);

  const row = el("div", {
    className: selected ? "row-item row-item-selected" : "row-item",
    dataset: { runId: run.id },
    onClick: onActivate,
  });

  const content = el("div", { className: "row-body" });
  content.append(
    el("div", { className: "row-title" }, `${key} review #${run.review_number ?? "?"}`),
  );

  const meta = el("div", { className: "row-meta" });
  meta.append(el("span", { className: "task-key" }, run.id));
  meta.append(el("span", {}, RUN_LABEL[run.status]));
  if (age) meta.append(el("span", {}, age));
  const spent = runCostLine(run);
  if (spent) meta.append(el("span", { className: "tabular" }, spent));
  content.append(meta);

  row.append(glyphNode(runGlyph(run.status)), content);
  row.title = `${key} · ${RUN_LABEL[run.status]}${run.model ? ` · ${run.model}` : ""}`;
  return row;
}

/** A compact card used by grouped lists; the split lists use `renderPRRow`. */
export function renderPRCard(options: PRRowOptions): HTMLElement {
  const { pr } = options;
  const card = el("div", { className: "row-item", tabIndex: 0 });
  card.append(
    el(
      "div",
      { className: "row-body" },
      el("div", { className: "row-title" }, prTitle(pr)),
      el(
        "div",
        { className: "row-meta" },
        repoKey(pr.owner, pr.repo),
        el("span", { className: "task-key" }, prKey(pr.owner, pr.repo, pr.pr_number)),
        el("span", {}, relativeTimeOf(pr.last_seen_at) ?? ""),
      ),
    ),
  );
  const activate = options.onActivate;
  card.addEventListener("click", activate);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
  return card;
}
