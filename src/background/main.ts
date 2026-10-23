import { createBoopClient } from "../shared/client";
import { host } from "../shared/host";
import { serviceTransport } from "../shared/service";
import { chipForPR, chipForRun } from "../shared/attachments";
import { parsePRRef } from "../shared/format";
import { loadPreferences } from "../shared/preferences";

/**
 * The hidden frame behind `/boop`.
 *
 * OpenChamber routes slash commands to `background.entry` whenever it is
 * declared, so this is the only place the command resolver can live while a
 * visible panel exists. The frame draws nothing: `background/index.html` keeps
 * `#root` hidden, and `ctx.surface` is `background` for every invocation.
 */

const client = createBoopClient(serviceTransport);

/**
 * `/boop qubitquilt/boop#191` attaches a chip for that pull request, with its
 * open findings as the model context. `/boop <run-id>` attaches one run.
 * Returning `null` attaches nothing and leaves a short notice in the composer,
 * so an unknown PR stays quiet while a malformed argument explains itself.
 */
host.onResolve(async ({ command, args }) => {
  if (command !== "boop") return null;

  const raw = args.trim();
  if (!raw) {
    throw new Error("Name a pull request, like qubitquilt/boop#191, or paste a run id.");
  }

  const preferences = await loadPreferences();
  const prRef = parsePRRef(raw);
  if (prRef) {
    // The tenant matters only for the lookup; the chip's data prefers the
    // stored tenant when there is one, so the panel reopens the right one.
    const tenantId = preferences.tenantId || (await firstTenantId());
    const detail = await client.getPRDetail(tenantId, prRef.owner, prRef.repo, prRef.number);
    return chipForPR({ pr: detail.pr, tenantId, findings: detail.findings });
  }

  // A run id: `boop-<tenant>-<repo>-<pr>-<hash>`, pasted from a toast or a run.
  if (/^[a-z0-9][a-z0-9-]{4,120}$/i.test(raw)) {
    const tenantId = preferences.tenantId || (await firstTenantId());
    const run = await client.getRun(tenantId, raw);
    return chipForRun({ run, tenantId });
  }

  throw new Error(
    "Use a pull request reference like qubitquilt/boop#191, or a run id such as boop-acme-boop-42-a1b2c3d.",
  );
});

/** The tenant to look things up in, when none is stored yet. */
async function firstTenantId(): Promise<string> {
  const tenants = await client.meTenants();
  const first = tenants[0]?.id ?? "";
  if (!first) {
    throw new Error("This account has no Boop tenant membership yet.");
  }
  if (tenants.length > 1) {
    console.warn(
      `Multiple Boop memberships; using ${first}. Open the panel and pick a tenant to pin one.`,
    );
  }
  return first;
}
