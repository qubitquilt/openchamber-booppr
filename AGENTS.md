# Working in this repository

An OpenChamber extension for BoopPr, the PR-review pug behind booppr.com. Read `README.md` first
for what ships and how it is installed.

## The one rule

**OpenChamber never compiles this code.** It loads the built `.js` files as they sit on disk. A
change to `src/` is invisible until `npm run build` runs, and a change that is not committed never
reaches a Git or zip install. Run `npm run check`, which lints, typechecks, checks the manifest,
builds and tests.

## Layout

```
src/shared/     code every surface shares: the API client, the service transport and sign-in,
                chip builders, the review-request flow (`review.ts`), the per-tenant detail
                caches (`details.ts`), preferences, stylesheet, storage helpers (`storage.ts`),
                the receiver-URL migration (`server-url.ts`), error formatting and load-error
                routing (`errors.ts`), the tenant bootstrap (`tenants.ts`), the git-remote
                resolver (`repo.ts`), the repo filter grammar (`repo-filter.ts`), and the one
                bare-origin rule (`origin.ts`)
src/service/    the local service      -> service/main.js (Node)
src/panel/      the rail panel        -> panel/main.js
src/page/       the full-screen page  -> panel/page.js
src/attach/     the + picker          -> panel/attach.js
src/background/ the /boop resolver    -> background/main.js
panel/*.html    one entry per surface, each loading its own built bundle
test/           node:test suites for the pure logic
scripts/        the manifest check
```

`src/shared/` must stay free of DOM-at-import-time work if you want it testable: `client.ts`,
`errors.ts`, `format.ts`, `repo.ts`, `repo-filter.ts`, `origin.ts`, `storage.ts`, `server-url.ts`
and `session-links.ts` are bundled separately for `npm test` and run under Node (with `--splitting`, so
`instanceof` holds across the bundles). `tenants.ts` and `preferences.ts` import `host`, so they
stay out of the test bundle.

`src/service/` is the only Node code. It is typechecked by `tsconfig.service.json` (which turns on
`@types/node`), not the surface `tsconfig.json` (which deliberately has `types: []`). It imports
only `src/shared/constants.ts` and `src/shared/origin.ts`, so the bundle stays small. `origin.ts`
is the one bare-origin rule both the service and `parseServerUrl` in `tenants.ts` run, so the
sign-in field can never accept a URL the service then rejects.

## Changing the Boop receiver

`TENANT_ORIGIN` in `src/shared/constants.ts` is the service's build-time default origin and the
receiver the sign-in view falls back to. It must be the receiver's tenant origin
(`https://app.booppr.com`), the one that serves `/auth/*` and `/api/*` same-origin: the sign-in's
OAuth state and CLI-hand-off cookies are host-only and GitHub's callback is fixed at
`/auth/callback`, so starting the flow on the API host (`https://api.booppr.com`, `/api/` only)
guarantees the receiver's "invalid state". A user can point the panel at another receiver at runtime
through the sign-in view's **Receiver URL** field (persisted as `serverUrl` in preferences,
validated by `parseServerUrl` in `src/shared/tenants.ts`). The origin is stored with the session
JWT and reused for every later call; the service re-validates it (`normalizeOrigin`) before use.
The sign-in view also clears a stored `serverUrl` that still holds the pre-fix default
(`LEGACY_API_ORIGIN`, the API host) when it loads — the migration lives in `src/shared/server-url.ts`
and is unit-tested in `test/server-url.test.mjs` — so a client upgraded across that change cannot
restart the invalid-state bug silently.

The receiver authenticates with a **session cookie**, not a bearer header, which is why this
extension has no `contributes.integration`: no token card shape can send `Cookie: boop_session`.
The local service holds the JWT and attaches the cookie. Do not "simplify" this into an
integration card; it cannot work.

## Conventions

- A surface talks to Boop only through the local service (`src/shared/service.ts` →
  `host.serviceRequest`). Never reach for `fetch` from a surface; the sandbox blocks it.
  `src/service/main.ts` is the one place that uses `fetch`, against the stored sign-in origin.
- A surface that answers nothing on screen still registers `onReady` and bails when
  `ctx.surface` is not what it expects.
- Render with `@openchamber/sdk/ui` first. Reach for `src/shared/dom.ts` `el()` only for layout
  the kit has no block for, and style it with the host's own variables so light and dark both
  follow the app.
- Every async paint takes a render token and drops its result when a newer render started. The
  panel, the picker and the page all reload independently and would otherwise overwrite each
  other.
- Errors from the API surface as a banner or a toast, never as a silent blank screen. `describe()`
  turns any thrown value into one line of text; toasts carry the action and the error code, with
  the full message on the console.
- Tests cover the pure modules (`client.ts`, `details.ts`, `errors.ts`, `format.ts`, `repo.ts`,
  `repo-filter.ts`, `origin.ts`, `server-url.ts`, `session-links.ts`, `storage.ts`) and the
  service's loopback contract. `review.ts` imports `host` (it toasts), so it stays out of the test
  bundle like `tenants.ts` and `preferences.ts`. Anything that needs the host is verified by opening
  the surface in OpenChamber, not by a unit test.

## Trust boundaries

Fences, named so a future contributor knows where they sit:

- **Inbound trust.** Anything that comes back from the receiver is untrusted. Markdown bodies go
  through `DOMPurify.sanitize` in `src/shared/dom.ts`; URLs only open through `host.openUrl` after
  a `^https?://` check.
- **Outbound trust.** A surface's only egress is `host.serviceRequest`, which the host proxies to
  this package's own loopback service. That service (`src/service/main.ts`) is the one component
  that reaches the network, and it puts every call on the stored sign-in origin. It runs with the
  user's rights — the approval dialog says so — so new outbound work belongs there, never in a
  surface.
- **Credential trust.** The session JWT lives only in the service, on disk under
  `~/.config/openchamber-booppr/auth.json` (mode `0600`), with the origin it was minted for. It
  never enters `host.storage`, the page, or a chip.
- **Inbound server trust.** The sign-in origin comes from the panel's **Receiver URL** field, so
  it is validated by the shared `normalizeOrigin` in `src/shared/origin.ts` (a bare origin; https
  everywhere except the loopback hosts) before any call — the same function the service runs, so
  the two sides cannot drift.
- **Storage trust.** The only writer of `host.storage` keys is this extension's code. Reads pass
  through a sanitizer in `src/shared/preferences.ts` (`read<T>(key, sanitize)`); the receiver-URL
  migration reads the same record through a narrow sanitizer in `src/shared/server-url.ts` that
  rewrites only `serverUrl`. A new key needs a sanitizer and a test.
- **Renderer trust.** The renderer never uses `innerHTML` outside `renderMarkdown` in
  `src/shared/dom.ts`. If you need HTML somewhere new, route it through `renderMarkdown` or extend
  `el()`; do not call `innerHTML` from a panel or page.
- **Repo detection.** `src/shared/repo.ts` reads only relative paths inside the open project
  (`.git/config`, the worktree `.git` pointer). It must never grow a `filesystem` pattern or an
  `exec` permission for this; a repo it cannot resolve is "", and the surfaces fall back to a
  manual filter.

The four entry HTMLs (`panel/*.html`, `background/index.html`) each carry a matching
`Content-Security-Policy` meta. The canonical line lives in `scripts/csp-meta.mjs`, and its
`connect-src 'none'` records that the pages open no direct network; `check:manifest` fails when any
entry drifts from it.

## Before you call a task done

```sh
npm run check
```

Then load the folder in **Settings → Extensions**, open the panel, the `+` picker and the page, and
confirm each surface renders and its actions work. Report what you verified.
