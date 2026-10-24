/**
 * One stylesheet for all four surfaces.
 *
 * `applyHostReady` writes the host's own variables onto the iframe root
 * (`--surface-*`, `--interactive-*`, `--primary`, `--primary-text`, `--status-*`,
 * `--font-*`, `--radius`) alongside the `--oc-*` aliases. This file reads the
 * host names first through a small `--b-*` layer, so the extension uses the
 * same foreground, muted, border, surface and type scale as the app's own
 * panels instead of approximating them.
 *
 * `--primary-text` is the readable accent the UI kit uses for text on neutral
 * surfaces; `--surface-foreground` is the body colour. Using the first as the
 * body colour tints every surface, which is the usual reason a guest looks
 * "off" next to the host.
 */
export const SHARED_CSS = `
:root {
  --b-bg: var(--surface-background, var(--oc-bg, transparent));
  --b-fg: var(--surface-foreground, var(--oc-fg, inherit));
  --b-muted: var(--surface-muted-foreground, var(--oc-muted, #71717a));
  --b-muted-surface: var(--surface-muted, var(--oc-muted-surface, #ececef));
  --b-elevated: var(--surface-elevated, var(--oc-elevated, var(--b-muted-surface)));
  --b-border: var(--interactive-border, var(--oc-border, #e4e4e7));
  --b-border-soft: color-mix(in srgb, var(--b-border) 60%, transparent);
  --b-hover: var(--interactive-hover, var(--oc-hover, color-mix(in srgb, var(--b-fg) 6%, transparent)));
  --b-selection: var(--interactive-selection, var(--oc-selection, color-mix(in srgb, var(--b-fg) 8%, transparent)));
  --b-selection-fg: var(--interactive-selection-foreground, var(--oc-selection-fg, inherit));
  --b-primary: var(--primary, var(--oc-primary, currentColor));
  --b-primary-text: var(--primary-text, var(--oc-primary-text, var(--b-primary)));
  --b-success-text: var(--success-text, var(--oc-success, #16a34a));
  --b-warning-text: var(--warning-text, var(--oc-warning, #d97706));
  --b-error-text: var(--error-text, var(--oc-error-text, #b91c1c));
  --b-info-text: var(--info-text, var(--oc-info, #2563eb));
  --b-radius: var(--radius, var(--oc-radius, 8px));
  --b-font: var(--font-sans, var(--oc-font, system-ui, -apple-system, sans-serif));
  --b-mono: var(--font-mono, var(--oc-mono, ui-monospace, SFMono-Regular, Menlo, monospace));
  --b-text-ui: var(--text-ui-header, 0.875rem);
  --b-text-label: var(--text-ui-label, 0.84375rem);
  --b-text-meta: var(--text-meta, 0.8125rem);
  --b-text-micro: var(--text-micro, 0.8125rem);
  --b-text-md: var(--text-markdown, 0.875rem);
  --b-text-code: var(--text-code, 0.75rem);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  font-family: var(--b-font);
  font-size: var(--b-text-ui);
  line-height: 1.45;
  color: var(--b-fg);
  background: var(--b-bg);
}

#root {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.toolbar > * { min-width: 0; }

.row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spacer { flex: 1; }

.muted {
  color: var(--b-muted);
  font-size: var(--b-text-meta);
}

.eyebrow {
  font-size: var(--b-text-meta);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--b-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.panel-title {
  font-size: var(--b-text-ui);
  font-weight: 600;
}

/* Grouped headings: the page groups PRs by repo. */
.group { display: flex; flex-direction: column; gap: 4px; }

.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 0;
}

.count-pill {
  font-size: var(--b-text-micro);
  color: var(--b-muted);
  background: var(--b-muted-surface);
  border-radius: 999px;
  padding: 1px 7px;
}

/* Keys, refs and locations read as code. */
.task-key {
  font-family: var(--b-mono);
  font-size: var(--b-text-micro);
  color: var(--b-muted);
}

/* The panel header: search, filters, then the scope pickers. */
.panel-head { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }

.filters { gap: 4px; }
.filter-active .oc-sdk-btn { color: var(--b-primary-text); }
/* filter-refresh carries margin-left: auto so refresh and the account menu both end up on the right edge of the filter row. */
.filter-refresh { margin-left: auto; }
.scope { gap: 8px; }

/* The detail sheet, laid out like the host's issue view. */
.detail {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--b-border);
  padding: 8px 12px;
}

.detail-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 16px;
}

.detail-heading { display: flex; flex-direction: column; }
.detail-id { font-size: var(--b-text-meta); color: var(--b-muted); }
.detail-title { margin: 2px 0 0; font-size: var(--b-text-ui); font-weight: 600; line-height: 1.45; }

.detail-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.detail-status { min-width: 150px; }

.detail-section { display: flex; flex-direction: column; gap: 8px; }
.detail-section-title { margin: 0; font-size: var(--b-text-label); font-weight: 600; }

.detail-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--b-border);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block .oc-sdk-btn { width: 100%; }
.detail-secondary .oc-sdk-btn { width: auto; }
.detail-secondary { justify-content: flex-start; }

.meta-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  align-items: baseline;
  font-size: var(--b-text-meta);
}

.meta-grid dt { color: var(--b-muted); }

.meta-grid dd { margin: 0; overflow-wrap: anywhere; }

.link-button {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--b-primary-text);
  cursor: pointer;
  text-align: left;
}

.link-button:hover { text-decoration: underline; }

/* Markdown bodies: the PR description, finding rationales. */
.md {
  font-size: var(--b-text-md);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p { margin: 0 0 8px; }
.md ul, .md ol { margin: 0 0 8px; padding-left: 18px; }
.md li { margin: 2px 0; }
.md h1, .md h2, .md h3, .md h4 { margin: 12px 0 6px; line-height: 1.3; font-size: var(--b-text-md); }
.md h1 { font-weight: 700; }
.md h2, .md h3, .md h4 { font-weight: 600; }
.md code {
  font-family: var(--b-mono);
  font-size: var(--b-text-code);
  background: var(--b-muted-surface);
  padding: 1px 4px;
  border-radius: 4px;
}
.md pre {
  background: var(--b-muted-surface);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0 0 8px;
}
.md pre code { background: none; padding: 0; }
.md blockquote {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 2px solid var(--b-border);
  color: var(--b-muted);
}
.md table { border-collapse: collapse; font-size: var(--b-text-meta); }
.md th, .md td { border: 1px solid var(--b-border); padding: 3px 6px; text-align: left; }
.md a { color: var(--b-primary-text); }

.md-collapsed {
  max-height: 168px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
}

.md-wrap { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }

/* Dialog and page chrome. */
.dialog-body { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; }
.dialog-foot { display: flex; gap: 6px; justify-content: flex-end; padding-top: 6px; }

/* The attach picker: the reference picker's header, list + preview, footer. */
.attach-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--b-border-soft);
}
.attach-head-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.attach-search { flex: 1; min-width: 160px; }
.attach-scope { min-width: 130px; }

.attach-body { flex: 1; min-height: 0; display: flex; }
.attach-split { flex: 1; min-height: 0; display: flex; }
.attach-list {
  flex: 5 1 0;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
}
.attach-preview {
  flex: 7 1 0;
  min-width: 0;
  overflow-y: auto;
  border-left: 1px solid var(--b-border-soft);
  padding: 12px 4px 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.attach-body.narrow .attach-list {
  flex: 1 1 auto;
  width: 100%;
  padding-right: 0;
}
.attach-body.narrow .attach-preview {
  flex: 1 1 auto;
  width: 100%;
  border-left: 0;
  padding: 12px 0;
}

.picker-head { display: flex; align-items: center; gap: 8px; }
.pick-note {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--b-border-soft);
  padding-top: 12px;
}

.attach-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding-top: 8px;
  border-top: 1px solid var(--b-border-soft);
}
.attach-hint {
  margin-right: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--b-muted);
  font-size: var(--b-text-meta);
}

/* Status pills and chips. */
.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--b-border);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: var(--b-text-meta);
  white-space: nowrap;
}

.state-pill.tone-info { color: var(--b-info-text); border-color: color-mix(in srgb, currentColor 45%, transparent); }
.state-pill.tone-success { color: var(--b-success-text); border-color: color-mix(in srgb, currentColor 45%, transparent); }
.state-pill.tone-warning { color: var(--b-warning-text); border-color: color-mix(in srgb, currentColor 45%, transparent); }
.state-pill.tone-error { color: var(--b-error-text); border-color: color-mix(in srgb, currentColor 45%, transparent); }

.severity-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: var(--b-text-micro);
  font-weight: 600;
  background: var(--b-muted-surface);
  color: var(--b-muted);
  white-space: nowrap;
}
.severity-chip.tone-info { color: var(--b-info-text); background: color-mix(in srgb, var(--b-info-text) 12%, transparent); }
.severity-chip.tone-warning { color: var(--b-warning-text); background: color-mix(in srgb, var(--b-warning-text) 12%, transparent); }
.severity-chip.tone-error { color: var(--b-error-text); background: color-mix(in srgb, var(--b-error-text) 12%, transparent); }

.lens-chip {
  font-family: var(--b-mono);
  font-size: var(--b-text-micro);
  color: var(--b-muted);
  white-space: nowrap;
}

/* The KPI strip atop the page and the panel detail. */
.kpi-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--b-border);
  border-radius: var(--b-radius);
  padding: 8px 12px;
  min-width: 110px;
}
.kpi-label { font-size: var(--b-text-micro); color: var(--b-muted); }
.kpi-value { font-size: var(--b-text-ui); font-weight: 600; font-variant-numeric: tabular-nums; }

/* Findings: one row each, severity chip first. */
.finding-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--b-border-soft);
  padding-bottom: 10px;
}
.finding-row:last-child { border-bottom: 0; padding-bottom: 0; }
.finding-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.finding-location {
  font-family: var(--b-mono);
  font-size: var(--b-text-micro);
  color: var(--b-primary-text);
  overflow-wrap: anywhere;
}
.finding-title { font-weight: 500; overflow-wrap: anywhere; }
.finding-body { font-size: var(--b-text-meta); color: var(--b-muted); }

/* Stages: the run's waterfall, one line each. */
.stage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--b-text-meta);
  padding: 2px 0;
}
.stage-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stage-status { flex-shrink: 0; }
.stage-status.passed { color: var(--b-success-text); }
.stage-status.failed { color: var(--b-error-text); }
.stage-status.retrying, .stage-status.running { color: var(--b-info-text); }
.stage-duration { margin-left: auto; color: var(--b-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }

/* The session links on a PR detail. */
.session-links { display: flex; flex-direction: column; gap: 6px; }
.session-link {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--b-text-meta);
}
.session-link-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-link .outcome { margin-left: auto; flex-shrink: 0; color: var(--b-muted); }
.session-link .outcome.success { color: var(--b-success-text); }
.session-link .outcome.error { color: var(--b-error-text); }

.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}

.page-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

/* The one toolbar row: kind tabs, scope picker, search, filters. */
.oc-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--b-border);
}

/* The master-detail split behind the full-screen page. */
.split {
  flex: 1;
  min-height: 0;
  display: flex;
}

.split-list {
  min-width: min(300px, 50%);
  max-width: 60%;
  flex-shrink: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.split-sep {
  width: 1px;
  flex-shrink: 0;
  background: var(--b-border);
}

.split-preview {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* List rows, shaped like the reference rows. */
.row-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
}

.row-item:hover { background: var(--b-hover); }
.row-item-selected { background: var(--b-selection); color: var(--b-selection-fg); }

.row-glyph { margin-top: 2px; flex-shrink: 0; }

.row-body { min-width: 0; flex: 1; }

.row-title {
  font-weight: 600;
  font-size: var(--b-text-ui);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.row-meta {
  margin-top: 3px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 12px;
  row-gap: 2px;
  font-size: var(--b-text-micro);
  color: var(--b-muted);
}

.tabular { font-variant-numeric: tabular-nums; }

.person { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.person-avatar {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--b-muted-surface);
  color: var(--b-muted);
  font-size: 0.625rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.person-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* The loopback sign-in: the empty state, and the waiting card once started. */
.signin-fill {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
.signin-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  width: min(360px, 100%);
}
.signin-hint { margin: 0; font-size: var(--b-text-ui); color: var(--b-muted); text-align: center; }
.signin-field { width: 100%; }
.signin-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.signin-waiting { display: flex; justify-content: center; min-height: 24px; }

.boop-mark { flex-shrink: 0; fill: currentColor; }

.boop-wordmark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--b-text-ui);
  font-weight: 600;
}
`;

/** Add the stylesheet once per document. Safe to call on every `onReady`. */
export function installStyles(target: HTMLElement = document.documentElement): void {
  const id = "boop-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = SHARED_CSS;
  target.append(style);
}
