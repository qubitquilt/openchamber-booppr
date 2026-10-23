import { test } from "node:test";
import assert from "node:assert/strict";

import { repoMatchesFilter, repoNameOf, sanitizeRepoFilter } from "../build/repo-filter.mjs";

/**
 * The repo filter grammar, the one home every side shares: the fetchers read
 * `repoNameOf`, the row renderers read `repoMatchesFilter`, and the stored
 * value passes through `sanitizeRepoFilter` before either runs. The panel's
 * default state is the empty filter, which matches everything — the failure
 * the first review round caught lived exactly here.
 */

test("sanitizeRepoFilter keeps shapes the grammar understands", () => {
  assert.equal(sanitizeRepoFilter("qubitquilt/boop"), "qubitquilt/boop");
  assert.equal(sanitizeRepoFilter("boop"), "boop");
  assert.equal(sanitizeRepoFilter("  qubitquilt/boop  "), "qubitquilt/boop");
  assert.equal(sanitizeRepoFilter(""), "");
  assert.equal(sanitizeRepoFilter("   "), "");
  // Trailing slash, spaces inside, and non-strings are junk, not filters.
  assert.equal(sanitizeRepoFilter("qubitquilt/"), "");
  assert.equal(sanitizeRepoFilter("qubitquilt / boop"), "");
  assert.equal(sanitizeRepoFilter(undefined), "");
  assert.equal(sanitizeRepoFilter(42), "");
});

test("repoNameOf reads the repo name the server's query param takes", () => {
  assert.equal(repoNameOf("qubitquilt/boop"), "boop");
  assert.equal(repoNameOf("boop"), "boop");
  // Junk sanitizes to "", which the fetcher sends as no filter at all. These
  // two are what distinguish the sanitize-first implementation from a
  // trim-and-slice one, which would answer "boop" and "name" here.
  assert.equal(repoNameOf("qubitquilt / boop"), "");
  assert.equal(repoNameOf("@bad/name"), "");
  assert.equal(repoNameOf(""), "");
  assert.equal(repoNameOf("qubitquilt/"), "");
});

test("an empty filter matches every repo", () => {
  assert.equal(repoMatchesFilter("qubitquilt/boop", ""), true);
  assert.equal(repoMatchesFilter("other/repo", ""), true);
  assert.equal(repoMatchesFilter("qubitquilt/boop", "   "), true);
});

test("a pair filter matches the pair exactly", () => {
  assert.equal(repoMatchesFilter("qubitquilt/boop", "qubitquilt/boop"), true);
  assert.equal(repoMatchesFilter("other/boop", "qubitquilt/boop"), false);
  assert.equal(repoMatchesFilter("qubitquilt/other", "qubitquilt/boop"), false);
});

test("a bare-name filter matches the repo under any owner", () => {
  assert.equal(repoMatchesFilter("qubitquilt/boop", "boop"), true);
  assert.equal(repoMatchesFilter("other/boop", "boop"), true);
  assert.equal(repoMatchesFilter("other/other", "boop"), false);
  // The name must be a whole segment, not a suffix.
  assert.equal(repoMatchesFilter("other/xboop", "boop"), false);
});
