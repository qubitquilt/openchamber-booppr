# OpenChamber extension for BoopPr

Boop reviews inside OpenChamber: a rail panel over the tenant's tracked pull requests and review
runs, an attach picker behind the composer's `+` menu, a `/boop` slash command, and a full-screen
reviews page. Built for BoopPr — the PR-review pug behind
[booppr.com](https://booppr.com) ([github.com/qubitquilt/boop](https://github.com/qubitquilt/boop)).

## What you get

| Surface                     | How you reach it                            | What it does                                                                                                                                                 |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rail panel                  | the pug icon on the right-hand rail         | the tenant's tracked PRs and review runs in two tabs, repo/status/mine filters, an in-place detail with findings, telemetry, feedback and a Re-review action |
| Attach picker               | `+` next to the chat box                    | search the tenant's PRs and runs, preview the highlighted one with its findings, attach it as a chip, or start a session on it                               |
| `Boop Reviews` page         | Extension pages menu above the session list | the same PRs and runs in a resizable master-detail split, with the tenant and repo pickers in a toolbar                                                      |
| `/boop o/r#123`             | the chat box                                | attaches that PR as a chip — with its open findings — without opening anything; a run id works too                                                           |
| Message and session actions | the `⋯` menu on a message or a session      | `Review with Boop` parses an `owner/repo#N` reference out of the message text and opens that PR focused; the session action opens the picker                 |
| Rail badge                  | the pug icon                                | how many reviews are pending or running for the tenant                                                                                                       |

An attached chip carries the PR's review state and its open findings, so the agent starts from what
Boop already found instead of re-deriving it. A session started from any surface is remembered, its
outcome is shown on the PR's detail, and — if you turn on auto re-review — finishing one triggers a
fresh Boop review of the new head.

## Install

1. Run OpenChamber on web or desktop, open **Settings → Extensions**, paste the absolute path of
   this folder, and click **Add**. Approve the capability list, including the **local service** it
   asks for.
2. Open the pug icon on the rail. It shows a **Receiver URL** field (default
   `https://api.booppr.com`; http is accepted for `localhost` development receivers) and a **tenant
   slug** field — the same slug `boop auth login <tenant>` takes.
3. Click **Sign in with Boop**. Your browser opens the receiver's GitHub sign-in and bounces back to
   a local listener this extension started; the session never passes through the page.
4. The panel loads once approved. The `+` picker, the page and `/boop` all share the same session.

The receiver URL and tenant are remembered, so a later sign-in and every request go back to the same
place. Sign out from the account menu in the panel or page toolbar; sign in again to switch
accounts or tenants.

There is no card on **Settings → Integrations**, and there can be one: the receiver's tenant surface
authenticates with a `boop_session` **cookie**, not a bearer header, and no integration-card shape
sends a cookie. The local service holds the session instead.

A folder install runs from this folder, so edit, `npm run build`, and reload. A Git install copies
the folder instead, so commit the built `panel/*.js`, `background/*.js` and `service/main.js` and
bump `version` to ship an update.

## How sign-in works

OpenChamber sandboxes an extension's page and a guest has no call that stores a credential, and the
receiver's session is a cookie no token card can carry. So the part of the `boop` CLI that signs in
lives in a **local service**: a Node process the host spawns from this package (`service/main.js`).
It runs the receiver's loopback OAuth flow — the same dance `boop auth login` performs — keeps the
session JWT, refreshes it on use, and forwards the panel's API calls with the cookie attached.

1. The panel asks the service to start a login for a receiver origin and tenant slug.
2. The service binds a one-shot listener on `127.0.0.1` and answers with the login URL
   (`…/auth/tenant/<slug>/login?cli=1&client_id=boop-cli&state=…&port=…`). The panel opens it.
3. You complete the GitHub OAuth; the receiver 302s the browser to the service's listener with a
   one-time code.
4. The service trades the code at `POST /auth/tenant/<slug>/cli-callback`, stores the session, and
   the panel's polling picks the connection up.

The token never enters the page. It is written to
`$XDG_CONFIG_HOME/openchamber-booppr/auth.json` (or `~/.config/openchamber-booppr/auth.json`), mode
`0600`, alongside the origin it was minted for. Sessions last 24h; the service refreshes on use
through `POST /auth/tenant/<slug>/refresh`, so an active install does not expire mid-work.

The service runs with your user's rights — the approval dialog says so — which is why this extension
is not a pure sandboxed guest. It reaches the network only for the configured origin.

## Sign-in requirements

The login URL presents the CLI's public client id, `boop-cli`. The receiver checks it against the
tenant's `allowed_cli_client_ids` allow-list _before_ GitHub is involved, so a tenant that revoked
CLI access refuses the extension's sign-in with a plain 403 and the message says exactly that.
Multi-tenant accounts: sign in once per tenant — the panel's tenant picker lists every membership
the session can see (`/api/me/tenants`), and switching re-runs the login for that slug.

## The receiver URL

The panel's sign-in reads a **Receiver URL**, remembered in the extension's own storage. Leave it
blank for `https://api.booppr.com`, or point it at a port-forwarded development receiver —
`http://localhost:8080` and friends are accepted for loopback hosts only. The origin is stored with
the session, so every later call goes back to the receiver it was signed in against, and the service
validates it again before use.

## Capabilities

The extension asks for `prompt`, `sessions` and `files`, and `contributes.service` adds `service`
(the local process the user approves at install). There is no `contributes.integration`, so no
`network` capability and no Integrations card.

- `prompt` and `sessions` cover `host.attach`, `host.compose`, `host.startSession` and
  `host.prompt`.
- `files` covers one thing: reading `.git/config` (and a worktree's `.git` pointer) inside the open
  project, so the panel can default its repo filter to the project's own GitHub repo. It is never
  used for anything else, and a repo it cannot resolve is a manual filter, not an error.

The page never sees the session JWT; the local service holds it and forwards every call.

## API surface

Every call goes through `src/shared/client.ts`, which is the only place that knows the receiver's
routes, and `src/shared/service.ts`, which carries each one to the local service. The routes, under
the signed-in origin, all per-tenant (`/api/tenants/{id}/…`, the same session + RBAC the tenant
console uses):

| Call               | Route                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `me` / `meTenants` | `GET /api/me`, `GET /api/me/tenants`                                                                   |
| `listRuns`         | `GET …/runs`, cursor-paginated                                                                         |
| `getRun`           | `GET …/runs/{runID}`                                                                                   |
| `getRunFindings`   | `GET …/runs/{runID}/findings`                                                                          |
| `getRunTelemetry`  | `GET …/runs/{runID}/telemetry`                                                                         |
| `listPRs`          | `GET …/prs`                                                                                            |
| `getPRDetail`      | `GET …/prs/{owner}/{repo}/{number}` — the whole aggregate                                              |
| `triggerReview`    | `POST …/prs/{owner}/{repo}/{number}/review` — 409 on a duplicate head, 429 on the tenant's 10/hour cap |
| `postFeedback`     | `POST …/runs/{runID}/feedback`                                                                         |
| `getKPIs`          | `GET …/kpis`                                                                                           |

The ingress rate-limits `GET /api/*` at 60 requests a minute per source IP, so the client backs off
and retries a 429 twice before showing it, and the three surfaces share a one-minute bootstrap
cache.

## Notes

- Extensions load in OpenChamber web and desktop. VS Code and mobile do not load them, and neither
  spawns the local service.
- The active tenant, repo filter, tab and detail selection are remembered in `host.storage` and
  shared by all four surfaces.
- The extension never posts to GitHub: the receiver owns that surface. The PR's comment thread is
  Boop's to write.
- Session outcomes live in `host.storage` (newest 50 links) and are only recorded while a Boop
  surface is open — the watcher lives in the page, unlike Linear's server-side event hub.
- Auto re-review is off by default; turn it on in the page toolbar's account menu. It triggers the
  receiver's on-demand review when a linked session completes, which counts against the tenant's
  rate limits exactly like a click on Re-review.

## Contributing

PRs run `npm run check` in CI, which lints, typechecks, checks the manifest, builds and tests. A
contributor who has run the same gate locally and confirmed the panel, the `+` picker and the page
in OpenChamber lands a faster review. See `CONTRIBUTING.md` for the workflow and `AGENTS.md` for the
trust boundaries and code conventions a PR is expected to respect.

## Security

Report a vulnerability through `SECURITY.md`. The four entry HTMLs each carry a
`Content-Security-Policy` meta; the canonical line lives in `scripts/csp-meta.mjs` and the build
fails when an entry drifts. The panel opens no direct network (`connect-src 'none'`); every receiver
call travels through the host proxy to the local service. The service is the one component that
reaches the receiver, and the one that runs with the user's rights.
