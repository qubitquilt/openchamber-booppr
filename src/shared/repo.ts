/**
 * Which GitHub repo the open project is, resolved without shelling out.
 *
 * The panel knows the open directory (`ctx.directory`) but not its remote; the
 * receiver's world is keyed by `owner/repo`. The `files` capability can read
 * `.git/config` inside the open project, and a worktree's `.git` pointer file
 * names the main repo's git dir — when that lives under the project directory
 * the config is read through a relative path too, so no `filesystem` pattern
 * is ever needed. Anything unreadable resolves to "" and the surfaces fall
 * back to a manual repo filter.
 *
 * Kept free of `host` so `npm test` can exercise it with a stubbed reader.
 */

/** The file reader the resolver takes: `host.readFile` in production. */
export type FileReader = (path: string) => Promise<string>;

/** Pull the remote URL out of a .git/config body: `origin` when it exists,
 * otherwise the single remote a checkout declares. */
export function remoteUrlFromConfig(config: string): string {
  const lines = config.split("\n");
  let section = "";
  let origin = "";
  const others: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const remote = /^\[remote\s+"([^"]+)"\]$/.exec(line);
    if (remote) {
      section = remote[1] ?? "";
      continue;
    }
    if (/^\[/.test(line)) {
      section = "";
      continue;
    }
    if (!section) continue;
    const url = /^url\s*=\s*(.+)$/.exec(line);
    const captured = url?.[1]?.trim();
    if (!captured) continue;
    if (section === "origin") origin = captured;
    else others.push(captured);
  }
  if (origin) return origin;
  return others.length === 1 ? (others[0] as string) : "";
}

/** `owner/repo` from a git remote URL, or "" when it is not one we know. */
export function repoFromRemoteUrl(url: string): string {
  const value = url.trim();
  if (!value) return "";
  const patterns: Array<RegExp> = [
    // https://github.com/owner/repo.git and https://host/owner/repo
    /^https?:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/,
    // git@github.com:owner/repo.git
    /^[^@]+@[^:]+:(.+?)(?:\.git)?$/,
    // ssh://git@github.com/owner/repo.git
    /^ssh:\/\/[^@]+@[^/]+\/(.+?)(?:\.git)?$/,
    // git://github.com/owner/repo.git
    /^git:\/\/[^/]+\/(.+?)(?:\.git)?$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    const path = match?.[1];
    if (!path) continue;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 2) return `${segments[0]}/${segments[1]}`;
    // A nested path (GitLab group/sub/repo): keep the last two.
    if (segments.length > 2)
      return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  }
  return "";
}

/** `owner/repo` from a `.git/config` body, or "". */
export function repoFromGitConfig(config: string): string {
  return repoFromRemoteUrl(remoteUrlFromConfig(config));
}

/**
 * The `gitdir:` value of a worktree's `.git` pointer file, or "" for a normal
 * checkout (where `.git` is a directory and the read fails).
 */
export function gitdirFromPointer(pointer: string): string {
  const line = pointer
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("gitdir:"));
  return line ? line.slice("gitdir:".length).trim() : "";
}

/**
 * Resolve `owner/repo` for the open directory.
 *
 * `directory` is the open project or worktree (`ctx.directory`). The reads are
 * relative paths, so the `files` capability covers every one of them and the
 * resolver never asks for a `filesystem` pattern. A repo that cannot be
 * resolved is "" — a normal answer, not an error.
 */
export async function resolveRepoFromDirectory(
  directory: string | null | undefined,
  readFile: FileReader,
): Promise<string> {
  let config: string | null = null;
  try {
    config = await readFile(".git/config");
  } catch {
    config = null;
  }
  if (config !== null) return repoFromGitConfig(config);

  // A linked worktree: `.git` is a file naming the main repo's git dir.
  let pointer = "";
  try {
    pointer = await readFile(".git");
  } catch {
    return "";
  }
  const gitdir = gitdirFromPointer(pointer);
  if (!gitdir) return "";
  const boundary = gitdir.lastIndexOf("/.git/");
  if (boundary < 0) return "";
  const mainRoot = gitdir.slice(0, boundary);
  // The main repo's config is readable only through a relative path; that
  // requires the worktree to sit inside the project, which is how OpenChamber
  // creates them. Anything else gives up quietly.
  if (!directory) return "";
  const base = directory.replace(/\/+$/, "");
  const relative =
    mainRoot === base
      ? ".git/config"
      : mainRoot.startsWith(`${base}/`)
        ? `${mainRoot.slice(base.length + 1)}/.git/config`
        : "";
  if (!relative) return "";
  try {
    return repoFromGitConfig(await readFile(relative));
  } catch {
    return "";
  }
}
