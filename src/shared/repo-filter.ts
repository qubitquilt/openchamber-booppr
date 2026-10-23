/**
 * The repo filter grammar, the one home every side shares.
 *
 * A filter is "", a bare repo name, or an `owner/repo` pair; "" matches every
 * repo. `sanitizeRepoFilter` is what a stored value passes through before
 * either view runs, so a junk or whitespace value can never reach a fetcher.
 * `repoNameOf` is the server's view — the receiver's `repo` query param is
 * the name alone. `repoMatchesFilter` is the row view, so a bare-name filter
 * matches that repo under any owner the server returned, and an `owner/repo`
 * pair matches the pair exactly. The fetchers and the renderers read these
 * three, never their own copies of the rule.
 */

const NAME = "[A-Za-z0-9_.-]+";
const NAME_ONLY = new RegExp(`^${NAME}$`);
const PAIR = new RegExp(`^${NAME}\\/${NAME}$`);

/** Read a stored repo filter down to "", a bare name, or a clean pair. */
export function sanitizeRepoFilter(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (NAME_ONLY.test(trimmed) || PAIR.test(trimmed)) return trimmed;
  return "";
}

/** The repo name the server's `repo` query param takes, or "" for no filter. */
export function repoNameOf(filter: string): string {
  const clean = sanitizeRepoFilter(filter);
  const slash = clean.lastIndexOf("/");
  return slash >= 0 ? clean.slice(slash + 1) : clean;
}

/** Does one `owner/repo` row match the filter? "" matches everything. */
export function repoMatchesFilter(ownerRepo: string, filter: string): boolean {
  const clean = sanitizeRepoFilter(filter);
  if (!clean) return true;
  if (ownerRepo === clean) return true;
  // A full pair must match exactly; only a bare name matches by repo name.
  if (PAIR.test(clean)) return false;
  return ownerRepo.endsWith(`/${clean}`);
}
