# Contributing

Thanks for your interest in this extension. It is small on purpose: a rail panel, a `+` picker, a
full-screen page and a `/boop` resolver, all of them reading the same Boop receiver API through the
same local service. The maintainer is a solo developer and reviews PRs on a best-effort basis;
please open an issue first if you want to discuss a direction before sending a patch.

## The one rule

**OpenChamber never compiles this code.** It loads the built `.js` files as they sit on disk. A
change to `src/` is invisible until `npm run build` runs, and a change that is not committed never
reaches a Git or zip install. PRs that change `src/` must also change the built `panel/*.js`,
`background/*.js` and `service/main.js`.

## Setup

```sh
npm ci
npm run check
```

`npm run check` lints, typechecks, checks the manifest, builds the bundles and runs the tests. CI
runs the same gate; it is the one signal that decides whether a PR is reviewable.

## Workflow

1. Fork the repo and create a branch from `main`.
2. Make the change. Read `AGENTS.md` first — it has the trust boundaries and code conventions.
3. Run `npm run check` locally. Fix everything it flags.
4. In OpenChamber, point **Settings → Extensions** at your fork's folder and confirm the panel, the
   `+` picker and the page all still render and act. The four surfaces share `src/shared/`, so a
   change there can break any of them.
5. Open a PR. The PR title and commit messages do not need a particular convention; the maintainer
   squash-merges.

## Trust boundaries

A PR that crosses one of the fences in `AGENTS.md` needs a note in the description explaining why:

- **Inbound trust.** Anything that comes back from the receiver is untrusted. Markdown bodies go
  through `DOMPurify.sanitize`; URLs only open through `host.openUrl` after a `^https?://` check.
- **Outbound trust.** The only network egress is the local service. The receiver is session-cookie
  authenticated, so no integration-card shape can replace it; a PR that adds a second network actor
  needs a very good reason.
- **Credential trust.** The session JWT lives only in `service/main.js`'s auth file. A PR that
  lets it reach `host.storage`, a chip, or the page will be refused.
- **Storage trust.** A new `host.storage` key needs a sanitizer in `src/shared/preferences.ts` and
  a unit test.
- **Renderer trust.** The renderer never uses `innerHTML` outside `renderMarkdown` in
  `src/shared/dom.ts`. A new use of HTML needs to go through that helper.
- **Repo detection.** `src/shared/repo.ts` reads only relative paths inside the open project. A PR
  that grows a `filesystem` pattern or an `exec` permission for repo detection will be refused.

## What the maintainer is happy to take

- A bug fix that includes a test or a manual repro.
- A small ergonomic tweak that matches the existing surface (a filter, a column, a chip variant).
- A new finding presentation in the details that has an obvious use across the panel and the page.

## What the maintainer is unlikely to take

- A new network call. Add it to `src/shared/client.ts` and walk the chain in `AGENTS.md`.
- A new dependency. The current `package.json` is intentionally small.
- A change to the four entry HTMLs that loosens the CSP.
- A change to the way chips store data, since the chip shape is the contract with the host.

## Reporting a vulnerability

See `SECURITY.md`. Do not file public issues for suspected vulnerabilities.
