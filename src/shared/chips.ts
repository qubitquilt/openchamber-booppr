import { el } from "./dom";
import { RUN_LABEL, RUN_TONE, REVIEW_LABEL, REVIEW_TONE } from "./constants";
import type { RunStatus, ReviewStatus } from "./constants";
import { severityLabel } from "./format";

/**
 * The small inline chips the list rows, the previews and the detail sheets all
 * share. They are built here once so a label reads the same on every surface.
 */

const TONE_CLASS: Record<string, string> = {
  neutral: "",
  info: " tone-info",
  success: " tone-success",
  warning: " tone-warning",
  error: " tone-error",
};

/** A status pill for a run's lifecycle state. */
export function runPill(status: RunStatus): HTMLElement {
  return el(
    "span",
    { className: `state-pill${TONE_CLASS[RUN_TONE[status]] ?? ""}` },
    RUN_LABEL[status],
  );
}

/** A status pill for a tracked PR's review status. */
export function reviewPill(status: ReviewStatus): HTMLElement {
  return el(
    "span",
    { className: `state-pill${TONE_CLASS[REVIEW_TONE[status]] ?? ""}` },
    REVIEW_LABEL[status],
  );
}

/** A finding-state pill: open, resolved or not-verifiable. */
export function findingPill(state: string): HTMLElement {
  const tone = state === "open" ? " tone-error" : state === "resolved" ? " tone-success" : "";
  const label = state === "open" ? "Open" : state === "resolved" ? "Resolved" : "Not verifiable";
  return el("span", { className: `state-pill${tone}` }, label);
}

const SEVERITY_CLASS: Record<string, string> = {
  blocker: " tone-error",
  critical: " tone-error",
  high: " tone-error",
  major: " tone-warning",
  medium: " tone-warning",
  minor: " tone-info",
  low: " tone-info",
  info: "",
};

/** A severity chip on a finding row. */
export function severityChip(severity: string | null | undefined): HTMLElement {
  const key = (severity ?? "").toLowerCase();
  return el(
    "span",
    { className: `severity-chip${SEVERITY_CLASS[key] ?? ""}` },
    severityLabel(severity),
  );
}

/** A lens chip: which expert raised the finding. */
export function lensChip(lens: string): HTMLElement {
  return el("span", { className: "lens-chip" }, lens);
}

/** An avatar initial plus the person's name. */
export function personChip(name: string | null | undefined): HTMLElement {
  const initial = (name ?? "").trim().slice(0, 1).toUpperCase() || "?";
  return el(
    "span",
    { className: "person" },
    el("span", { className: "person-avatar" }, initial),
    el("span", { className: "person-name" }, name || "Unknown"),
  );
}

/** The round initial used in a session-link header. */
export function avatarNode(name: string | null | undefined): HTMLElement {
  const initial = (name ?? "").trim().slice(0, 1).toUpperCase() || "?";
  return el("span", { className: "person-avatar" }, initial);
}

/** A repo label, mono-spaced like a task key. */
export function repoKey(owner: string, repo: string): HTMLElement {
  return el("span", { className: "task-key" }, `${owner}/${repo}`);
}
