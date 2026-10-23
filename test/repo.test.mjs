import { test } from "node:test";
import assert from "node:assert/strict";

import {
  gitdirFromPointer,
  remoteUrlFromConfig,
  repoFromGitConfig,
  repoFromRemoteUrl,
  repoNameOf,
  resolveRepoFromDirectory,
} from "../build/repo.mjs";

const CONFIG = `[core]
    repositoryformatversion = 0
[remote "origin"]
    url = git@github.com:qubitquilt/boop.git
[remote "upstream"]
    url = https://github.com/example/other.git
[branch "main"]
    remote = origin
`;

test("remoteUrlFromConfig prefers origin, falls back to a lone remote", () => {
  assert.equal(remoteUrlFromConfig(CONFIG), "git@github.com:qubitquilt/boop.git");
  // A fork checkout with a single differently-named remote still resolves.
  assert.equal(
    remoteUrlFromConfig('[remote "upstream"]\n\turl = https://x/y.git\n'),
    "https://x/y.git",
  );
  // Two non-origin remotes are ambiguous; refuse to guess.
  assert.equal(
    remoteUrlFromConfig(
      '[remote "a"]\n\turl = https://x/y.git\n[remote "b"]\n\turl = https://x/z.git\n',
    ),
    "",
  );
  assert.equal(remoteUrlFromConfig(""), "");
});

test("repoFromRemoteUrl reads the shapes git remotes come in", () => {
  assert.equal(repoFromRemoteUrl("git@github.com:qubitquilt/boop.git"), "qubitquilt/boop");
  assert.equal(repoFromRemoteUrl("https://github.com/qubitquilt/boop.git"), "qubitquilt/boop");
  assert.equal(repoFromRemoteUrl("https://github.com/qubitquilt/boop"), "qubitquilt/boop");
  assert.equal(repoFromRemoteUrl("ssh://git@github.com/qubitquilt/boop.git"), "qubitquilt/boop");
  assert.equal(repoFromRemoteUrl("git://github.com/qubitquilt/boop.git"), "qubitquilt/boop");
  // Nested namespaces keep the last two segments.
  assert.equal(repoFromRemoteUrl("https://gitlab.com/group/sub/repo.git"), "sub/repo");
  assert.equal(repoFromRemoteUrl(""), "");
  assert.equal(repoFromRemoteUrl("not a url"), "");
});

test("repoFromGitConfig parses the body", () => {
  assert.equal(repoFromGitConfig(CONFIG), "qubitquilt/boop");
  assert.equal(repoFromGitConfig("[core]\n"), "");
});

test("gitdirFromPointer reads a worktree pointer", () => {
  assert.equal(gitdirFromPointer("gitdir: /repo/.git/worktrees/wt"), "/repo/.git/worktrees/wt");
  assert.equal(gitdirFromPointer(""), "");
  assert.equal(gitdirFromPointer("something else"), "");
});

test("repoNameOf reads the repo name out of a filter", () => {
  assert.equal(repoNameOf("qubitquilt/boop"), "boop");
  assert.equal(repoNameOf("boop"), "boop");
  assert.equal(repoNameOf(""), "");
  assert.equal(repoNameOf("  "), "");
});

test("resolveRepoFromDirectory reads .git/config directly", async () => {
  const repo = await resolveRepoFromDirectory("/repo", async (path) => {
    assert.equal(path, ".git/config");
    return CONFIG;
  });
  assert.equal(repo, "qubitquilt/boop");
});

test("resolveRepoFromDirectory follows a worktree pointer inside the project", async () => {
  const reads = [];
  const repo = await resolveRepoFromDirectory("/repo", async (path) => {
    reads.push(path);
    // In a worktree `.git` is a file, so the first config read fails.
    if (path === ".git/config") {
      if (reads.filter((entry) => entry === ".git/config").length === 1) {
        throw new Error("not a directory");
      }
      return CONFIG;
    }
    if (path === ".git") return "gitdir: /repo/.git/worktrees/wt\n";
    throw new Error(`unexpected read: ${path}`);
  });
  assert.equal(repo, "qubitquilt/boop");
  assert.deepEqual(reads, [".git/config", ".git", ".git/config"]);
});

test("resolveRepoFromDirectory gives up quietly outside its reach", async () => {
  const repo = await resolveRepoFromDirectory("/repo", async (path) => {
    if (path === ".git") return "gitdir: /elsewhere/repo/.git/worktrees/wt\n";
    throw new Error(`unexpected ${path}`);
  });
  assert.equal(repo, "");
});

test("resolveRepoFromDirectory answers empty for a missing repo", async () => {
  const repo = await resolveRepoFromDirectory("/repo", async () => {
    throw new Error("missing");
  });
  assert.equal(repo, "");
});
