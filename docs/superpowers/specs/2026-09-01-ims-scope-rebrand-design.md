# IMS-Scope Rebrand — Sub-project A: In-Repo Identity Rebrand

Status: Draft, pending user review
Date: 2026-09-01

## Background

The project is a hard fork of `freelensapp/freelens` (itself a fork of
OpenLens/Lens). The name "Freelens" is causing confusion and the project is
being renamed to **IMS-Scope**, distributed under the `Nibamot` GitHub user
account (not an organization). External distribution artifacts (README install instructions,
Homebrew tap `Nibamot/homebrew-ims-scope`, cask `ims-scope`) already use the
new name. The application's internal identity — package names, app
identifiers, internal hostnames, source-level identifiers, directory names,
and docs — still says "Freelens" throughout (~1,777 matches for `freelens`
across the repository, case-insensitive).

This is a hard fork: there is no intent to keep syncing with upstream
`freelensapp/freelens`, so identifiers can be renamed freely without
preserving merge-friendliness.

This spec covers **Sub-project A only**: the in-repo rename of product/app
identity. It explicitly excludes:

- **Sub-project B** (user-data migration from existing Freelens/OpenLens/Lens
  install directories to the new IMS-Scope location) — a follow-on covered by
  its own spec once Sub-project A's naming has landed, since the migration
  needs the final directory/appId names as input.
- **Sub-project C** (forking and renaming the external
  `freelensapp/freelens-k8s-proxy` binary/repo) — entirely out of scope for
  this repository; a separate project against that other repo.

## Goals

- Replace all internal "Freelens" identity — product name, package scope,
  app identifiers, protocol scheme, internal hostname, source-level
  identifiers, directory names, and docs/CI text — with the "IMS-Scope"
  identity, consistently.
- Do this safely: no blind global find/replace, because several classes of
  string must NOT be touched (see Non-goals).
- Leave the app in a working, buildable, lint-clean state after every stage.

## Non-goals / explicitly excluded

- **Copyright header text stays "Freelens Authors"** — do not change the
  copyright line in either header variant (single-line new-file header, or
  two-line header that also carries "OpenLens Authors" for files continuing
  fork-era code). This is an explicit, deliberate user decision, independent
  of the rest of the rebrand.
- **"OpenLens Authors" attribution stays unchanged** wherever it appears —
  this is legal/historical attribution, not a "Freelens" branding artifact.
- **`freelensapp/freelens-k8s-proxy` references stay unchanged** — the binary
  name, its DI wiring (`freelens-k8s-proxy-path.injectable.ts` and similar),
  the GitHub repo URL, download URLs, and provenance verification strings
  (`packages/ensure-binaries/src/verify.ts`, `packages/ensure-binaries/src/artifacts.ts`,
  `freelens/binaries.lock.json`) all continue to reference the real, separate,
  externally-hosted `freelens-k8s-proxy` project. Renaming this is
  Sub-project C, out of scope here.

  (`packages/core/src/main/kube-auth-proxy/freelens-k8s-proxy-path.injectable.ts`
  and its DI wiring in `register-injectables.ts` also stay unchanged for the
  same reason.)
- Legal/license files (`LICENSE`, `freelens/license-header.txt`,
  `freelens/static/build/license.txt`) and vendored third-party upstream
  copyright notices are not touched.
- No new external infrastructure is required or being purchased: no real
  domain registration (the internal hostname is a local Chromium
  `host-resolver-rules` mapping + self-signed cert, not a hosted domain), no
  npm registry/org action (these packages are never published — the
  `@freelensapp/*` → `@nibamot/*` scope is a local pnpm workspace label
  only), and no new code-signing certificates (signing/notarization is driven
  by env vars/secrets, not by the appId/product-name string).

## Naming reference table

| Identifier type | Old (Freelens) | New (IMS-Scope) |
|---|---|---|
| Product name | Freelens | IMS-Scope |
| kebab-case / slug | freelens | ims-scope |
| PascalCase identifier | Freelens | IMSScope |
| npm workspace scope | `@freelensapp/*` | `@nibamot/*` |
| electron-builder appId | `app.freelens.Freelens` | `io.github.nibamot.ims-scope` |
| notarize.cjs fallback appBundleId | `io.freelens.freelensapp` | `io.github.nibamot.ims-scope` (reconciled to match electron-builder appId — pre-existing inconsistency being fixed as part of this rename) |
| Protocol scheme | `freelens://` | `ims-scope://` |
| Internal Chromium hostname | `renderer.freelens.app` | `renderer.ims-scope.app` (kept `.app` suffix deliberately — Chrome's HSTS-preload list covers the entire `.app` TLD, forcing HTTPS regardless of DNS ownership; no real domain is registered either way) |
| Copyright line | "Freelens Authors" | unchanged — "Freelens Authors" (explicit user decision) |
| `freelens-k8s-proxy` dependency | `freelensapp/freelens-k8s-proxy` | unchanged (Sub-project C, separate repo) |

## Approach

Stage the rename by category, with a build/lint/typecheck verification gate
between each stage, rather than one global find-and-replace. A blind
substitution would corrupt the excluded classes above (copyright lines,
OpenLens attribution, `freelens-k8s-proxy` references) since they share the
literal substring `freelens`. Category-by-category renaming lets each stage
use a narrow, reviewable diff and a scoped search that naturally excludes the
protected files/strings.

### Alternative considered: global find/replace with an exclusion list

Run one repo-wide substitution of `freelens`→`ims-scope` (and case variants),
carving out excluded paths/strings via a denylist. Rejected as the primary
approach: the excluded strings are interspersed within otherwise-renamed
files (e.g. a copyright header sits at the top of a file whose hostname
constant elsewhere in the same file must change), so a denylist would have to
operate at the substring level, not the file level, which is exactly the
per-line care the staged approach already provides. A global pass is more
error-prone to review (one enormous diff) and harder to bisect if something
breaks the build. The staged approach is recommended.

## Stages

Each stage ends with: `pnpm build:di` (only if injectable files were
added/moved/renamed), `pnpm biome check --write` (TS/HTML), `trunk check`
(other file types), `pnpm type:check`, and a targeted build
(`pnpm build:app:dir` at minimum once per major stage, not necessarily every
stage) before moving on. Commits happen per stage (or per logical group
within a stage), never batched across stages, so a break can be bisected to
one stage's diff.

### Stage 1 — Config & manifests

Rename identity in the files that define the app's build-time and
package-level identity, without touching source code:

- `freelens/electron-builder.yml`: `appId` (all three targets: linux, mac,
  win), the AppStream metainfo path
  (`app.freelens.Freelens.metainfo.xml` → matching new appId), the protocol
  handler block (`name: Freelens Protocol Handler` and `schemes: [freelens]`
  → `ims-scope`), and `Freelens` product-name references.
- `freelens/package.json`: `homepage`, `bugs.url`, `repository.url`, contact
  `email`, and the `contentSecurityPolicy` string's `*.renderer.freelens.app`
  frame-src.
- `freelens/build/notarize.cjs`: fallback `appBundleId`, reconciled to the
  new appId (fixing the pre-existing `io.freelens.freelensapp` vs.
  `app.freelens.Freelens` inconsistency at the same time).
- Every workspace `package.json` under `packages/*`: `name` field
  `@freelensapp/*` → `@nibamot/*`, plus `bugs`/`repository` URL fields
  pointing at `freelensapp/freelens` (updated to the new GitHub org/repo,
  matching whatever the actual new repo location is).
- `freelens/build/metainfo.xml` and any other AppStream/desktop metadata
  files referencing the old appId or product name.

Cross-package renames of `@freelensapp/*` imports are mechanical
(search/replace the scope prefix across all `import`/`require` specifiers and
`package.json` `dependencies`/`devDependencies` keys) but touch a very large
number of files, so this is done with a scoped scripted replace limited to
the npm-scope string specifically, verified by `pnpm install` succeeding and
`pnpm type:check` passing.

### Stage 2 — Internal hostname & certificate

Rename `renderer.freelens.app` → `renderer.ims-scope.app` across:

- `packages/core/src/main/start-main-application/runnables/setup-hostnames.injectable.ts`
  (host-resolver-rules mapping) — copyright header text stays unchanged.
- `packages/core/src/main/start-main-application/runnables/setup-lens-proxy-certificate.injectable.ts`
  (self-signed cert SANs).
- `packages/core/src/main/start-main-application/runnables/setup-session-proxy-bypass.injectable.ts`
- `packages/core/src/renderer/k8s/api-base-server-address.injectable.ts`
- `packages/core/src/renderer/fetch/browser-fetch.injectable.ts`
- `packages/core/src/common/utils/cluster-id-url-parsing.ts`
- `packages/core/src/common/k8s-api/cluster-api-address-injection-token.ts`
- `packages/core/src/main/start-main-application/lens-window/application-window/create-application-window.injectable.ts`
- `packages/core/src/main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts`
- `packages/core/src/main/k8s/api-base-host-header.injectable.ts`
- `packages/utility-features/json-api/src/fetch.ts`
- `freelens/integration/helpers/utils.ts`
- `freelens/electron.vite.config.ts` (`allowedHosts: [".freelens.app"]` and
  the dev-server comment referencing `renderer.freelens.app`)

Because a fresh self-signed cert is generated by the app itself at runtime
(not a checked-in artifact), no manual cert regeneration step is needed —
the existing cert-generation code will produce a cert for the new SANs
automatically once the hostname constant changes. Verify by running
`pnpm dev` and confirming the app starts, the renderer loads, and cluster
views (in their cross-origin iframe) load without a certificate error.

The k8s resource-annotation namespace `freelens.app/resource-version` (in
`edit-resource-model.injectable.tsx`) is a separate concern from the
Chromium-only hostname: it is a Kubernetes annotation key that may already
exist on live user resources in the wild. Renaming it would silently break
diffing/version-tracking for any resource edited under the old annotation
key. Decision for this stage: rename it to `ims-scope.app/resource-version`
to match the new identity, since Freelens itself only recently forked and
annotation adoption is expected to be low; no migration shim is added for
the old key. (Flagged here explicitly since it's the one identifier in this
stage with external, not just internal, visibility.)

### Stage 3 — Source-level identifiers

Rename remaining internal identifiers not covered by Stages 1–2:

- TypeScript/JS identifiers, DI ids, constant names, and string literals
  containing `Freelens`/`freelens` (e.g. class names, injectable ids, log
  prefixes, window titles, tray tooltip text, menu labels) — excluding
  anything already carved out as `freelens-k8s-proxy`-related (Sub-project C)
  or copyright-header related.
- `freelens://` protocol-scheme handling code (URL parsing/dispatch, not just
  the electron-builder manifest from Stage 1).
- User-facing strings: app menu title, about dialog, window title, tray
  icon tooltip, notification titles.

This is the widest-reaching stage by file count. Use `rg -il freelens` scoped
to `packages/**/src` and `freelens/src`, excluding paths already known to be
`freelens-k8s-proxy`-only (`packages/ensure-binaries/**`,
`**/kube-auth-proxy/**`) and grep out lines that are copyright headers before
touching a file, to keep the diff review tractable.

### Stage 4 — Directory rename

Rename the top-level `freelens/` application directory to `ims-scope/` (or
the user's preferred final directory name — confirm before this stage,
since it is the most disruptive single change: every relative import,
workspace-glob pattern in root `package.json`/`pnpm-workspace.yaml`, CI
workflow path filter, and build script path that references `freelens/`
needs updating in the same commit). Use `git mv` to preserve history.
Verify with a full `pnpm install && pnpm build`.

### Stage 5 — Docs & CI text

Update remaining prose references: `AGENTS.md`/`CLAUDE.md` (where they
describe the `freelens/` directory — update to match Stage 4's chosen name),
`DEVELOPMENT.md`, `docs/*.md`, GitHub workflow YAML comments/job names/
artifact names in `.github/workflows/*.yaml` that mention "Freelens" in
human-readable text (not the already-renamed Homebrew/release-artifact
naming, which is done), and any remaining `freelensapp/freelens` GitHub URLs
in docs that should point at the new repo location.

Explicitly excluded from this stage: `freelensapp/freelens-k8s-proxy` URLs
and any text describing that dependency.

### Stage 6 — User-data migration (Sub-project B)

Out of scope for this spec — tracked as a separate follow-on spec once
Stage 1–5 naming has landed, since the migration code needs the final
appId/product-name/userData-path strings as concrete input. Requirement
carried forward from user decision: migrate existing user data from
Freelens, OpenLens, and Lens install directories (in that fallback order)
into the new IMS-Scope userData path on first launch after upgrade.

## Verification strategy

- After each stage: `pnpm biome check --write` (TS/HTML per AGENTS.md),
  `trunk check` (all other file types), `pnpm type:check`.
- After Stage 1 (workspace-scope rename) and Stage 4 (directory rename):
  full `pnpm install` to confirm workspace resolution.
- After Stage 2: `pnpm dev`, manually confirm app launch and a cluster view
  loads without a TLS/cert error in the cross-origin renderer iframe.
- After Stage 3: `pnpm build:di` if any injectable files were touched/moved,
  then `pnpm type:check`.
- Before considering Sub-project A complete: `pnpm build:app:dir` (a full
  packaged build) and `pnpm test` (unit test suite), plus a manual smoke
  test of the packaged app (launch, add a cluster, confirm window
  title/tray/menu show "IMS-Scope").
- Final check: `rg -il freelens` across the repo should return only the
  expected survivors — copyright headers, "OpenLens Authors" lines, and
  `freelens-k8s-proxy`-related paths/strings. Any other hit indicates a
  missed rename.

## Commit strategy

One commit per stage (or per clearly separable sub-step within a stage, e.g.
"rename npm scope" vs. "rename electron-builder appId" within Stage 1), each
reviewed via `git status`/`git diff` before staging, per AGENTS.md's rule
against `git add -A`. No stage is squashed into another so a future bisect
can isolate exactly which rename broke something.

## Resolved decisions (formerly open questions)

1. Stage 4's final directory name: `freelens/` → `ims-scope/`. Confirmed.
2. Stage 2's k8s annotation namespace rename
   (`freelens.app/resource-version` → `ims-scope.app/resource-version`) has
   no backward-compat shim for resources already annotated under the old
   key. Confirmed acceptable — clean break, no dual-read fallback.
3. GitHub repo location for `repository`/`bugs` URL fields (Stage 1 and
   Stage 5): `Nibamot/ims-scope`, under the `Nibamot` personal GitHub
   account. Confirmed.

Spec approved by user on 2026-09-01.
