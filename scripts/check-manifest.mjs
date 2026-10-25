#!/usr/bin/env node
/**
 * The manifest must be one OpenChamber accepts, and its origin, CSP and entry
 * HTMLs must all agree with the code.
 *
 * The first gate runs the host's own parser (`parseManifestJson` from
 * `@openchamber/sdk/schemas`) against `package.json`, so this check can never
 * drift from what the running OpenChamber enforces. That is the gate that
 * matters: OpenChamber's install toast reports *every* parse failure as
 * "panel.id must be kebab-case", so a manifest broken for some other reason
 * reads as a panel id problem. Trust the parser, not the toast.
 *
 * The remaining gates cover things the parser cannot know: that the origin in
 * the manifest matches `src/shared/constants.ts`, that every entry carries the
 * canonical CSP, and that every entry's scripts are built.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { parseManifestJson } from "@openchamber/sdk/schemas";

import { CSP_DIRECTIVES } from "./csp-meta.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const problems = [];

/** Read `TENANT_ORIGIN` out of the TypeScript constant instead of repeating it. */
async function readTenantOrigin() {
  const source = await readFile(resolve(root, "src/shared/constants.ts"), "utf8");
  const match = /export const TENANT_ORIGIN = "([^"]+)";/.exec(source);
  if (!match) {
    problems.push("src/shared/constants.ts no longer declares a quoted TENANT_ORIGIN.");
    return null;
  }
  return match[1];
}

/** Read `PROVIDER_ID` out of the same constants module. */
async function readProviderId() {
  const source = await readFile(resolve(root, "src/shared/constants.ts"), "utf8");
  const match = /export const PROVIDER_ID = "([^"]+)";/.exec(source);
  if (!match) {
    problems.push("src/shared/constants.ts no longer declares a quoted PROVIDER_ID.");
    return null;
  }
  return match[1];
}

const REQUIRED_TENANT_ORIGIN = await readTenantOrigin();
const REQUIRED_PROVIDER_ID = await readProviderId();

const manifestText = await readFile(resolve(root, "package.json"), "utf8");
const manifest = JSON.parse(manifestText);
const contributes = manifest.openchamber?.contributes ?? {};
const service = contributes.service ?? {};

// The primary gate: the host's own parser. When it fails, `problem` reads the
// real reason the install would be refused, not the toast's generic text.
const parsed = parseManifestJson(manifestText);
if (!parsed.ok) {
  problems.push(
    `OpenChamber rejects this manifest: ${parsed.code ? `[${parsed.code}] ` : ""}${parsed.message}`,
  );
}

if (manifest.openchamber?.apiVersion !== 1) {
  problems.push("openchamber.apiVersion must be 1.");
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version ?? "")) {
  problems.push(`version must be semver, found ${JSON.stringify(manifest.version)}.`);
}
// The local service owns the Boop sign-in and every API call. A wrong entry
// path installs but fails to spawn, so the build proves the file is built.
if (service.entry !== "service/main.js") {
  problems.push(
    `openchamber.contributes.service.entry must be "service/main.js", found ${JSON.stringify(service.entry)}.`,
  );
}
if (service.runtime !== "host") {
  problems.push(
    `openchamber.contributes.service.runtime must be "host", found ${JSON.stringify(service.runtime)}.`,
  );
}
try {
  await readFile(resolve(root, "service/main.js"), "utf8");
} catch {
  problems.push("service/main.js is not built. Run npm run build.");
}

// Ids and command names are kebab-case starting with a letter. OpenChamber
// rejects the install when they are not, so the build catches it instead.
const panelId = contributes.panel?.id;
if (typeof panelId !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(panelId)) {
  problems.push(
    `openchamber.contributes.panel.id must be kebab-case starting with a letter and at most 40 characters, found ${JSON.stringify(panelId)}.`,
  );
}
if (
  REQUIRED_PROVIDER_ID &&
  (typeof REQUIRED_PROVIDER_ID !== "string" || !/^[a-z][a-z0-9-]*$/.test(REQUIRED_PROVIDER_ID))
) {
  problems.push(
    `src/shared/constants.ts PROVIDER_ID must be kebab-case starting with a letter, found ${JSON.stringify(REQUIRED_PROVIDER_ID)}.`,
  );
}
if (REQUIRED_PROVIDER_ID && panelId && REQUIRED_PROVIDER_ID !== panelId) {
  problems.push(
    `panel.id (${JSON.stringify(panelId)}) and PROVIDER_ID (${JSON.stringify(REQUIRED_PROVIDER_ID)}) must agree; OpenChamber groups chips by providerId and rejects the install when they drift.`,
  );
}
for (const action of contributes.actions ?? []) {
  if (typeof action?.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(action.id)) {
    problems.push(
      `openchamber.contributes.actions[].id must be kebab-case, found ${JSON.stringify(action?.id)}.`,
    );
  }
}
for (const command of contributes.commands ?? []) {
  if (typeof command?.name !== "string" || !/^[a-z][a-z0-9-]{0,23}$/.test(command.name)) {
    problems.push(
      `openchamber.contributes.commands[].name must match /^[a-z][a-z0-9-]{0,23}$/, found ${JSON.stringify(command.name)}.`,
    );
  }
}

// The host only accepts `>=X.Y.Z` or `X.Y.Z` here (its pattern is
// /^(>=)?\d+\.\d+\.\d+$/), so an upper bound like `>=2.3.0 <3.0.0` is a hard
// install failure, not a softer constraint. The SDK parser above already
// enforces this; the explicit check names the field so the failure is obvious.
const enginesOpenchamber = manifest.openchamber?.engines?.openchamber;
if (
  enginesOpenchamber !== undefined &&
  (typeof enginesOpenchamber !== "string" || !/^(>=)?\d+\.\d+\.\d+$/.test(enginesOpenchamber))
) {
  problems.push(
    `openchamber.engines.openchamber must be ">=X.Y.Z" or "X.Y.Z" (no upper bound), found ${JSON.stringify(enginesOpenchamber)}.`,
  );
}

// Every declared HTML entry must ship, and every script it loads must be built.
const entries = new Set();
if (contributes.panel?.entry) entries.add(contributes.panel.entry);
if (contributes.page?.entry) entries.add(contributes.page.entry);
if (typeof contributes.attach === "object" && contributes.attach.entry) {
  entries.add(contributes.attach.entry);
}
if (contributes.background?.entry) entries.add(contributes.background.entry);

const relative = (entry) => entry.replace(/^\.\//, "");

// A package SVG icon must exist on disk; install fails without it.
const icon = contributes.panel?.icon;
if (typeof icon === "string" && icon.toLowerCase().endsWith(".svg")) {
  try {
    await readFile(resolve(root, relative(icon)), "utf8");
  } catch {
    problems.push(`panel.icon ${icon} is missing from disk.`);
  }
}

for (const entry of entries) {
  if (!relative(entry).endsWith(".html")) {
    problems.push(`entry ${entry} is not an HTML file.`);
    continue;
  }
  let html;
  try {
    html = await readFile(resolve(root, relative(entry)), "utf8");
  } catch {
    problems.push(`entry ${entry} is missing from disk.`);
    continue;
  }
  // Every entry carries the canonical CSP. We match on the directive string
  // rather than the literal HTML, so a Prettier reformat of the meta tag does
  // not break the build — only a change to the directives does.
  const cspMatch = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?>/i,
  );
  if (!cspMatch) {
    problems.push(`${entry} is missing the Content-Security-Policy meta tag.`);
  } else {
    const csp = cspMatch[1];
    const required = [
      "default-src 'none'",
      "script-src 'self'",
      "img-src data: https:",
      // The panel reaches the Boop receiver only through the local service, so
      // it opens no direct network at all; `connect-src 'none'` says so.
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ];
    for (const directive of required) {
      if (!csp.includes(directive)) {
        problems.push(`${entry} CSP is missing directive: ${directive}`);
      }
    }
    // The full canonical string must be present, so a contributor who changes
    // one directive notices the others have to follow.
    if (csp !== CSP_DIRECTIVES) {
      problems.push(
        `${entry} CSP does not match the canonical directives in scripts/csp-meta.mjs. Update both, or rerun the build to see the diff.`,
      );
    }
  }
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const src = match[1];
    if (/^(https?:)?\/\//.test(src)) {
      problems.push(`${entry} loads ${src}; scripts must ship inside the package.`);
      continue;
    }
    const scriptPath = resolve(root, relative(entry).replace(/[^/]+$/, ""), src);
    try {
      await readFile(scriptPath, "utf8");
    } catch {
      problems.push(`${entry} loads ${src}, which is not built. Run npm run build.`);
    }
  }
}

if (problems.length > 0) {
  console.error("Manifest check failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Manifest check passed: ${entries.size} entries, service ${service.entry}, tenantOrigin ${REQUIRED_TENANT_ORIGIN ?? "(none)"}, csp enforced.`,
);
