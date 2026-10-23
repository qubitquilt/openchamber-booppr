import { test } from "node:test";
import assert from "node:assert/strict";

import {
  branchForPR,
  costLabel,
  durationLabel,
  firstLine,
  firstPRRefIn,
  locationOf,
  parsePRRef,
  prContext,
  prKey,
  prTitle,
  relativeTimeOf,
  runContext,
  severityLabel,
  tokenLabel,
} from "../build/format.mjs";

const NOW = Date.parse("2026-02-03T12:00:00.000Z");

test("prKey and parsePRRef round-trip", () => {
  assert.equal(prKey("qubitquilt", "boop", 191), "qubitquilt/boop#191");
  assert.deepEqual(parsePRRef("qubitquilt/boop#191"), {
    owner: "qubitquilt",
    repo: "boop",
    number: 191,
  });
  assert.equal(parsePRRef("qubitquilt/boop"), null);
  assert.equal(parsePRRef("#191"), null);
  assert.equal(parsePRRef(""), null);
});

test("parsePRRef reads GitHub PR URLs", () => {
  assert.deepEqual(parsePRRef("https://github.com/qubitquilt/boop/pull/191"), {
    owner: "qubitquilt",
    repo: "boop",
    number: 191,
  });
  assert.deepEqual(parsePRRef("https://github.com/qubitquilt/boop/pull/191#discussion_r1"), {
    owner: "qubitquilt",
    repo: "boop",
    number: 191,
  });
  assert.equal(parsePRRef("https://github.com/qubitquilt/boop/issues/191"), null);
});

test("firstPRRefIn finds the first reference in longer text", () => {
  assert.deepEqual(
    firstPRRefIn("As in qubitquilt/boop#191 and elsewhere, see https://github.com/a/b/pull/3"),
    { owner: "qubitquilt", repo: "boop", number: 191 },
  );
  assert.deepEqual(firstPRRefIn("see https://github.com/a/b/pull/3"), {
    owner: "a",
    repo: "b",
    number: 3,
  });
  assert.equal(firstPRRefIn("no reference here"), null);
});

test("prTitle falls back to the reference", () => {
  assert.equal(
    prTitle({ owner: "o", repo: "r", pr_number: 1, title: "Fix the thing" }),
    "Fix the thing",
  );
  assert.equal(prTitle({ owner: "o", repo: "r", pr_number: 1 }), "o/r#1");
});

test("relativeTimeOf buckets the age", () => {
  assert.equal(relativeTimeOf("2026-02-03T11:59:40.000Z", NOW), "just now");
  assert.equal(relativeTimeOf("2026-02-03T11:30:00.000Z", NOW), "30m");
  assert.equal(relativeTimeOf("2026-02-03T07:00:00.000Z", NOW), "5h");
  assert.equal(relativeTimeOf("2026-02-01T12:00:00.000Z", NOW), "2d");
  assert.equal(relativeTimeOf("", NOW), null);
  assert.equal(relativeTimeOf("not a date", NOW), null);
});

test("costLabel and tokenLabel stay short", () => {
  assert.equal(costLabel(0), "$0");
  assert.equal(costLabel(0.0042), "$0.0042");
  assert.equal(costLabel(1.234), "$1.23");
  assert.equal(costLabel(undefined), "");
  assert.equal(tokenLabel(990), "990");
  assert.equal(tokenLabel(12_345), "12.3k");
  assert.equal(tokenLabel(1_234_567), "1.2M");
  assert.equal(tokenLabel(0), "");
});

test("durationLabel reads like a stopwatch", () => {
  assert.equal(durationLabel(45_000), "45s");
  assert.equal(durationLabel(192_000), "3m 12s");
  assert.equal(durationLabel(3_600_000), "1h 0m");
  assert.equal(durationLabel(undefined), "");
});

test("firstLine strips Markdown and clamps", () => {
  assert.equal(firstLine("## Heading\n\nbody"), "Heading");
  assert.equal(firstLine(null), "");
  assert.equal(firstLine("x".repeat(200), 10), `${"x".repeat(9)}…`);
});

test("locationOf renders path:line", () => {
  assert.equal(locationOf({ path: "src/a.ts", line: 12 }), "src/a.ts:12");
  assert.equal(locationOf({ path: "src/a.ts" }), "src/a.ts");
  assert.equal(locationOf({}), "");
});

test("severityLabel capitalizes", () => {
  assert.equal(severityLabel("high"), "High");
  assert.equal(severityLabel(""), "Unknown");
  assert.equal(severityLabel(undefined), "Unknown");
});

test("prContext carries the open findings", () => {
  const text = prContext(
    {
      pr: {
        owner: "o",
        repo: "r",
        pr_number: 5,
        state: "open",
        review_status: "reviewed",
        head_sha: "abc123def456",
        additions: 10,
        deletions: 2,
      },
      findings: [
        {
          fingerprint: "f1",
          lens: "correctness",
          severity: "high",
          path: "src/a.ts",
          line: 3,
          headline: "Off-by-one",
          rationale: "why",
          state: "open",
        },
        {
          fingerprint: "f2",
          lens: "style",
          severity: "low",
          path: "src/b.ts",
          headline: "Naming",
          rationale: "why",
          state: "resolved",
        },
      ],
      telemetry_rollup: {
        run_count: 2,
        success_count: 2,
        cost_usd: 0.1,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        wall_clock_ms: 0,
      },
    },
    { webUrl: "https://github.com/o/r/pull/5" },
  );
  assert.match(text, /Boop reviews o\/r#5/);
  assert.match(text, /review status: reviewed/);
  assert.match(text, /Head: abc123def456/);
  assert.match(text, /Open findings from Boop \(1\)/);
  assert.match(text, /\[High\] src\/a\.ts:3 — Off-by-one/);
  assert.doesNotMatch(text, /Naming/);
  assert.match(text, /https:\/\/github\.com\/o\/r\/pull\/5/);
});

test("prContext caps the findings it carries", () => {
  const findings = Array.from({ length: 15 }, (_, index) => ({
    fingerprint: `f${index}`,
    lens: "correctness",
    severity: "medium",
    path: `src/${index}.ts`,
    headline: `Finding ${index}`,
    rationale: "why",
    state: "open",
  }));
  const text = prContext({ pr: { owner: "o", repo: "r", pr_number: 1 }, findings });
  assert.match(text, /…and 5 more/);
});

test("runContext names the run and its findings", () => {
  const text = runContext(
    {
      id: "run-1",
      owner: "o",
      repo: "r",
      pr_number: 3,
      review_number: 2,
      status: "failed",
      started_at: "2026-02-03T00:00:00.000Z",
      error: "clone failed",
    },
    [
      {
        pk: 1,
        id: "f",
        run_id: "run-1",
        lens: "style",
        severity: "low",
        headline: "h",
        rationale: "",
        posted: false,
        recorded_at: "",
      },
    ],
  );
  assert.match(text, /Boop run run-1: o\/r#3 \(review #2, failed\)/);
  assert.match(text, /Error: clone failed/);
  assert.match(text, /\[Low\] h/);
});

test("branchForPR makes a git-safe name", () => {
  assert.equal(branchForPR("o", "boop", 191, "Fix the thing!"), "boop/boop-pr-191-fix-the-thing");
  assert.equal(branchForPR("o", "boop", 7), "boop/boop-pr-7");
});
