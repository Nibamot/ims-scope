# IMS Scope Rebrand — Sub-project A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the in-repo product/app identity from "Freelens" to "IMS Scope" across config/manifests, the internal hostname/certificate, source-level identifiers, the top-level directory, and docs/CI text — while leaving copyright headers, "OpenLens Authors" attribution, and all `freelens-k8s-proxy` references untouched.

**Architecture:** This is a staged rename, not a feature build. Each stage renames one category of identifier (config, hostname, source code, directory, docs) with a narrow, reviewable diff, followed by a build/lint/typecheck verification gate instead of unit-test TDD — a mechanical rename has no new business logic to test, so "does it still build, lint, and type-check clean" is the test cycle. Stages are ordered so earlier stages (config/manifests) don't depend on later ones (directory rename happens after source identifiers are already renamed, so the directory move is a pure `git mv` with no simultaneous content edit).

**Tech Stack:** pnpm workspaces, TypeScript, Biome, Trunk, electron-builder, electron-vite.

**Spec:** [docs/superpowers/specs/2026-09-01-ims-scope-rebrand-design.md](../specs/2026-09-01-ims-scope-rebrand-design.md)

## Global Constraints

- **Do not touch:** copyright header text ("Freelens Authors", both header variants), "OpenLens Authors" attribution, anything under `packages/ensure-binaries/**`, `**/kube-auth-proxy/**` or otherwise referencing `freelensapp/freelens-k8s-proxy` (binary name, DI wiring, GitHub repo/download URLs, provenance-verification strings), `LICENSE`, `freelens/license-header.txt`, `freelens/static/build/license.txt`, and vendored third-party upstream copyright notices.
- **Naming map** (verbatim from spec): Product name `Freelens` → `IMS Scope`; kebab-case `freelens` → `ims-scope`; PascalCase `Freelens` → `IMSScope`; npm scope `@freelensapp/*` → `@nibamot/*`; electron-builder appId `app.freelens.Freelens` → `io.github.nibamot.ims-scope`; notarize.cjs fallback appBundleId `io.freelens.freelensapp` → `io.github.nibamot.ims-scope`; protocol scheme `freelens://` → `ims-scope://`; internal Chromium hostname `renderer.freelens.app` → `renderer.ims-scope.app`; k8s annotation `freelens.app/resource-version` → `ims-scope.app/resource-version` (no back-compat shim); GitHub repo `freelensapp/freelens` → `Nibamot/ims-scope`.
- **Directory rename target:** `freelens/` → `ims-scope/` (confirmed, Stage 4).
- **No git action beyond what each task's commit step specifies** — never `git add -A`/`git add .`; always review `git status`/`git diff` before staging, per AGENTS.md.
- **One commit per task** (matches the spec's "one commit per stage or clearly separable sub-step" rule) — never batch two tasks into one commit, so a future bisect can isolate exactly which rename broke something.
- Every task ends with, at minimum: `pnpm biome check --write` (TS/HTML files touched), `trunk check` (other file types touched), `pnpm type:check`. Additional per-task verification is called out in that task.

---

## Task 1: Rename the `@freelensapp/*` npm workspace scope

**Files:**
- Modify: every `packages/*/package.json` — `name` field `@freelensapp/*` → `@nibamot/*`, and any `dependencies`/`devDependencies` keys referencing `@freelensapp/*`.
- Modify: every `.ts`/`.tsx` file under `packages/**` and `freelens/**` with an `import`/`require` specifier starting `@freelensapp/`.
- Modify: root `package.json` if it references `@freelensapp/*` anywhere (`dependencies`, `pnpm.overrides`, etc.).

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `@nibamot/*` npm scope, which Task 2 and later tasks' package.json edits assume already exists — any later task that touches a `package.json` `name`/`dependencies` field must use `@nibamot/*`, not `@freelensapp/*`.

- [ ] **Step 1: Enumerate every occurrence of the old scope**

Run:
```bash
rg -l '@freelensapp/' --type ts --type tsx --type json
```
Expected: a list of `package.json` files and TypeScript source files. Save this list mentally/in a scratch note — it's the diff surface for this task.

- [ ] **Step 2: Scripted replace of the scope string**

This is a literal string substitution — `@freelensapp/` → `@nibamot/`, no other content changes. Run:
```bash
rg -l '@freelensapp/' --type ts --type tsx --type json | xargs sed -i '' 's/@freelensapp\//@nibamot\//g'
```
(macOS `sed -i ''`; the search string `@freelensapp/` cannot match inside a copyright header or `freelens-k8s-proxy` reference, since neither of those contains the `@freelensapp/` npm-scope pattern — this substitution is inherently safe to run unscoped.)

- [ ] **Step 3: Verify no old-scope references remain**

Run: `rg '@freelensapp/'`
Expected: no matches (empty output).

- [ ] **Step 4: Reinstall to confirm workspace resolution**

Run: `pnpm install`
Expected: succeeds with no "workspace package not found" errors — this confirms every internal cross-package import/dependency now resolves under `@nibamot/*`.

- [ ] **Step 5: Type-check**

Run: `pnpm type:check`
Expected: passes (no new errors introduced by the scope rename).

- [ ] **Step 6: Lint**

Run: `pnpm biome check --write` then `trunk check`
Expected: clean, or only auto-fixed formatting changes.

- [ ] **Step 7: Commit**

```bash
git status
git add packages/**/package.json 'packages/**/*.ts' 'packages/**/*.tsx' freelens/**/package.json package.json
git commit -m "Rename npm workspace scope @freelensapp/* to @nibamot/*"
```
(Review `git status` output first — stage only the files the substitution actually touched, not a blind glob.)

---

## Task 2: Rename config & manifest identity (Stage 1, remainder)

**Files:**
- Modify: `freelens/electron-builder.yml`
- Modify: `freelens/package.json`
- Modify: `freelens/build/notarize.cjs`
- Modify: `freelens/build/metainfo.xml` (and any sibling AppStream/desktop metadata files referencing the old appId or product name)
- Modify: every remaining `packages/*/package.json` `bugs`/`repository` URL fields pointing at `freelensapp/freelens`

**Interfaces:**
- Consumes: nothing new from Task 1 (npm scope is orthogonal to appId/protocol/URLs).
- Produces: the new appId `io.github.nibamot.ims-scope`, protocol scheme `ims-scope`, and repo URL `https://github.com/Nibamot/ims-scope`, which Stage 5 (Task 7, docs) and Stage 4 (Task 6) assume are already in place everywhere config references them.

- [ ] **Step 1: Rename `electron-builder.yml` identity fields**

In `freelens/electron-builder.yml`:
- `appId` (all three target blocks: `linux`, `mac`, `win`): `app.freelens.Freelens` → `io.github.nibamot.ims-scope`
- AppStream metainfo path: `app.freelens.Freelens.metainfo.xml` → `io.github.nibamot.ims-scope.metainfo.xml` (rename the referenced file too — see Step 4)
- protocol handler block: `name: Freelens Protocol Handler` → `name: IMS Scope Protocol Handler`, `schemes: [freelens]` → `schemes: [ims-scope]`
- any remaining `Freelens` product-name string in this file → `IMS Scope`

- [ ] **Step 2: Rename `freelens/package.json` identity fields**

In `freelens/package.json`:
- `homepage` → `https://github.com/Nibamot/ims-scope`
- `bugs.url` → `https://github.com/Nibamot/ims-scope/issues`
- `repository.url` → the new repo's git URL (`git+https://github.com/Nibamot/ims-scope.git`)
- `email` (contact field, if present) → update domain/name to match the new identity per whatever contact address the user has set up; if no new address is known, leave the local-part unchanged and only update anything that literally says `freelens`
- `contentSecurityPolicy` string: `*.renderer.freelens.app` → `*.renderer.ims-scope.app` (frame-src directive)

- [ ] **Step 3: Reconcile `notarize.cjs` fallback appBundleId**

In `freelens/build/notarize.cjs`, the fallback `appBundleId` currently reads `io.freelens.freelensapp` — a pre-existing inconsistency with `electron-builder.yml`'s `app.freelens.Freelens`. Change it to `io.github.nibamot.ims-scope`, matching the new `electron-builder.yml` `appId` from Step 1 (this also fixes the inconsistency, not just renames it).

- [ ] **Step 4: Rename and update `metainfo.xml`**

Rename `freelens/build/metainfo.xml`'s referenced id to match the new appId (`io.github.nibamot.ims-scope.metainfo.xml` if the filename itself encodes the appId — check the actual filename in the repo first with `ls freelens/build/*.xml` and `ls freelens/static/build/*.xml`, since the spec references "AppStream/desktop metadata files referencing the old appId or product name" as plural). Update the `<id>`, `<name>`, and any `<url>` elements inside to the new appId/product name/repo URL.

- [ ] **Step 5: Rename remaining `bugs`/`repository` fields in workspace packages**

Run:
```bash
rg -l 'freelensapp/freelens' --type json
```
For each `package.json` found (excluding any that are actually about `freelens-k8s-proxy` — check the surrounding context before editing; `freelensapp/freelens-k8s-proxy` is a different repo string and must NOT be changed), update `bugs.url`/`repository.url` from `freelensapp/freelens` to `Nibamot/ims-scope`.

- [ ] **Step 6: Verify no stray old appId/protocol/URL references remain in this file set**

Run:
```bash
rg -i 'app\.freelens\.freelens|io\.freelens\.freelensapp|freelensapp/freelens[^-]' freelens/electron-builder.yml freelens/package.json freelens/build/notarize.cjs freelens/build/metainfo.xml
```
Expected: no matches. (The `[^-]` after `freelens` in the last pattern excludes `freelens-k8s-proxy` matches deliberately.)

- [ ] **Step 7: Type-check and lint**

Run: `pnpm type:check`, `pnpm biome check --write`, `trunk check`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git status
git diff freelens/electron-builder.yml freelens/package.json freelens/build/notarize.cjs freelens/build/metainfo.xml
git add freelens/electron-builder.yml freelens/package.json freelens/build/notarize.cjs freelens/build/metainfo.xml
# plus whichever packages/*/package.json files Step 5 touched
git commit -m "Rename appId, protocol scheme, and repo URLs in config and manifests"
```

---

## Task 3: Rename internal Chromium hostname and certificate SANs (Stage 2)

**Files:**
- Modify: `packages/core/src/main/start-main-application/runnables/setup-hostnames.injectable.ts`
- Modify: `packages/core/src/main/start-main-application/runnables/setup-lens-proxy-certificate.injectable.ts`
- Modify: `packages/core/src/main/start-main-application/runnables/setup-session-proxy-bypass.injectable.ts`
- Modify: `packages/core/src/renderer/k8s/api-base-server-address.injectable.ts`
- Modify: `packages/core/src/renderer/fetch/browser-fetch.injectable.ts`
- Modify: `packages/core/src/common/utils/cluster-id-url-parsing.ts`
- Modify: `packages/core/src/common/k8s-api/cluster-api-address-injection-token.ts`
- Modify: `packages/core/src/main/start-main-application/lens-window/application-window/create-application-window.injectable.ts`
- Modify: `packages/core/src/main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts`
- Modify: `packages/core/src/main/k8s/api-base-host-header.injectable.ts`
- Modify: `packages/utility-features/json-api/src/fetch.ts`
- Modify: `freelens/integration/helpers/utils.ts`
- Modify: `freelens/electron.vite.config.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the `renderer.ims-scope.app` hostname constant, which Task 5 (Stage 3, source identifiers) must NOT re-introduce `renderer.freelens.app` in any new string it touches.

- [ ] **Step 1: Rename the hostname string in each listed file**

In each file above, replace every occurrence of `renderer.freelens.app` with `renderer.ims-scope.app`. Do not touch copyright headers in these files (they stay "Freelens Authors" per the Global Constraints). Use per-file review, not a blind sed, since some of these files may have the hostname embedded in a larger string (e.g. a CSP directive or a regex) where surrounding context must be preserved exactly.

For `freelens/electron.vite.config.ts` specifically: also update `allowedHosts: [".freelens.app"]` → `allowedHosts: [".ims-scope.app"]`, and the dev-server comment referencing `renderer.freelens.app`.

- [ ] **Step 2: Verify no old hostname references remain outside excluded files**

Run:
```bash
rg 'renderer\.freelens\.app|\.freelens\.app'
```
Expected: no matches, or only matches inside files explicitly excluded by the Global Constraints (there should be none here — the hostname string doesn't appear in copyright headers or `freelens-k8s-proxy` references).

- [ ] **Step 3: Type-check**

Run: `pnpm type:check`
Expected: passes.

- [ ] **Step 4: Manual smoke test — app launch and cert**

Run: `pnpm dev`
Expected: the app starts, the renderer loads, and opening a cluster view (which renders in the cross-origin `<clusterId>.renderer.ims-scope.app` iframe) loads without a TLS/certificate error. The self-signed cert is generated at runtime from the hostname constant, so no manual cert regeneration step is needed — if this smoke test shows a cert error, the hostname constant is inconsistent somewhere Step 1 missed.

Stop `pnpm dev` after confirming.

- [ ] **Step 5: Lint**

Run: `pnpm biome check --write`, `trunk check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git status
git diff
git add packages/core/src/main/start-main-application/runnables/setup-hostnames.injectable.ts \
        packages/core/src/main/start-main-application/runnables/setup-lens-proxy-certificate.injectable.ts \
        packages/core/src/main/start-main-application/runnables/setup-session-proxy-bypass.injectable.ts \
        packages/core/src/renderer/k8s/api-base-server-address.injectable.ts \
        packages/core/src/renderer/fetch/browser-fetch.injectable.ts \
        packages/core/src/common/utils/cluster-id-url-parsing.ts \
        packages/core/src/common/k8s-api/cluster-api-address-injection-token.ts \
        packages/core/src/main/start-main-application/lens-window/application-window/create-application-window.injectable.ts \
        packages/core/src/main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts \
        packages/core/src/main/k8s/api-base-host-header.injectable.ts \
        packages/utility-features/json-api/src/fetch.ts \
        freelens/integration/helpers/utils.ts \
        freelens/electron.vite.config.ts
git commit -m "Rename internal Chromium hostname renderer.freelens.app to renderer.ims-scope.app"
```

---

## Task 4: Rename the k8s resource-annotation namespace (Stage 2, k8s annotation)

**Files:**
- Modify: `edit-resource-model.injectable.tsx` (locate exact path with `rg -l 'freelens.app/resource-version'` first — the spec names the file but not its full path)

**Interfaces:**
- Consumes: nothing new.
- Produces: the `ims-scope.app/resource-version` annotation key, with no dual-read fallback for the old `freelens.app/resource-version` key (confirmed decision — clean break).

- [ ] **Step 1: Locate the annotation constant**

Run: `rg -n 'freelens\.app/resource-version'`
Expected: one or more matches in `edit-resource-model.injectable.tsx` (and possibly its test file).

- [ ] **Step 2: Rename the annotation key**

Replace `freelens.app/resource-version` with `ims-scope.app/resource-version` at each match found in Step 1. Do not add a fallback that also reads the old key — this is a deliberate clean break per the resolved decision in the spec (no backward-compat shim for resources already annotated under the old key).

- [ ] **Step 3: Verify no old annotation references remain**

Run: `rg 'freelens\.app/resource-version'`
Expected: no matches.

- [ ] **Step 4: Type-check and run affected unit tests**

Run: `pnpm type:check`
Then run the test file covering `edit-resource-model.injectable.tsx` if one exists (find it with `find . -path '*/edit-resource-model*.test.*'`) and confirm it still passes with the renamed key (update any test fixture that hardcodes the old annotation string).

- [ ] **Step 5: Lint**

Run: `pnpm biome check --write`, `trunk check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git status
git diff
git add <the file(s) found in Step 1>
git commit -m "Rename k8s resource-annotation namespace freelens.app to ims-scope.app"
```

---

## Task 5: Rename remaining source-level identifiers (Stage 3)

**Files:**
- Modify: any remaining `.ts`/`.tsx` file under `packages/**/src` and `freelens/src` containing `Freelens`/`freelens` in an identifier, DI id, constant, or user-facing string — discovered via the grep in Step 1, **excluding**:
  - `packages/ensure-binaries/**`
  - `**/kube-auth-proxy/**` (including `freelens-k8s-proxy-path.injectable.ts` and its DI registration)
  - copyright header lines in any file
  - anything already renamed by Tasks 1–4

**Interfaces:**
- Consumes: the `ims-scope`/`IMSScope`/`ims-scope://` naming from Tasks 1–2 (protocol scheme, appId) — this task's renamed identifiers should read consistently with those, e.g. a renamed `FreelensProtocolHandler` class becomes `IMSScopeProtocolHandler`, matching the `ims-scope://` scheme already set in Task 2.
- Produces: the fully-renamed source tree that Task 6 (directory rename) depends on being complete — Task 6 assumes no remaining `freelens`-named source files or imports need touching, since it's a pure directory move.

- [ ] **Step 1: Enumerate remaining matches, scoped and filtered**

Run:
```bash
rg -il freelens packages/**/src freelens/src \
  --glob '!packages/ensure-binaries/**' \
  --glob '!**/kube-auth-proxy/**'
```
For each file returned, run `rg -n -i freelens <file>` and manually check each hit: skip lines that are copyright headers (top-of-file `/**\n * Copyright...` blocks) — everything else in that file is in scope for this task.

- [ ] **Step 2: Rename identifiers file by file**

Work through the file list from Step 1. For each file, rename:
- Class/function/variable/constant names containing `Freelens` → `IMSScope` (PascalCase) or `freelens` → `ims-scope`/`imsScope` (kebab/camelCase, matching the existing case convention at that call site)
- DI injectable ids and log prefixes containing `freelens` → `ims-scope`
- User-facing strings (app menu title, about dialog, window title, tray icon tooltip, notification titles) — `Freelens` → `IMS Scope`
- `freelens://` protocol-scheme handling code (URL parsing/dispatch — not the manifest, already done in Task 2) → `ims-scope://`

Do this incrementally, re-running the Step 1 grep periodically to track remaining count, rather than attempting the whole file list in one uninterrupted pass — if `pnpm build:di` is needed partway through (see Step 3), running it once near the end covers all injectable renames in this task.

- [ ] **Step 3: Regenerate DI registrations if any injectable files were renamed/moved**

If any `*.injectable.ts` file's exported injectable id (not just its filename) changed in Step 2, run:
```bash
pnpm build:di
```
Expected: regenerates registration files with no errors. If no injectable ids changed (only internal identifiers/strings), skip this step.

- [ ] **Step 4: Verify the scoped grep is now empty**

Run the same command as Step 1:
```bash
rg -il freelens packages/**/src freelens/src \
  --glob '!packages/ensure-binaries/**' \
  --glob '!**/kube-auth-proxy/**'
```
For any file still listed, confirm every remaining hit in it is a copyright header line (`rg -n -i freelens <file>` to double check) — if so, this task is complete for that file. If not, go back to Step 2.

- [ ] **Step 5: Type-check**

Run: `pnpm type:check`
Expected: passes.

- [ ] **Step 6: Full build**

Run: `pnpm build`
Expected: succeeds — this is the "once per major stage" full build the spec calls for, since Stage 3 is the widest-reaching stage by file count.

- [ ] **Step 7: Manual smoke test — user-facing strings**

Run: `pnpm dev`, and confirm the app menu title, window title, and tray icon tooltip all show "IMS Scope" rather than "Freelens". Stop `pnpm dev` after confirming.

- [ ] **Step 8: Lint**

Run: `pnpm biome check --write`, `trunk check`
Expected: clean.

- [ ] **Step 9: Commit**

Given the file count, this may be committed as several logical sub-commits (e.g. "rename DI ids and constants" separately from "rename user-facing strings") rather than one giant commit — use judgment based on how the diff naturally groups, but never batch this task's commit(s) together with any other task's changes.

```bash
git status
git diff --stat
git add <files touched in this task>
git commit -m "Rename source-level Freelens identifiers to IMS Scope"
```

---

## Task 6: Rename the top-level `freelens/` directory (Stage 4)

**Files:**
- Move: `freelens/` → `ims-scope/` (entire directory tree, via `git mv`)
- Modify: root `package.json` (workspace globs referencing `freelens/`)
- Modify: `pnpm-workspace.yaml` (workspace globs referencing `freelens/`)
- Modify: every `.github/workflows/*.yaml` with a path filter or working-directory referencing `freelens/`
- Modify: any build script (`scripts/**`) with a hardcoded `freelens/` path

**Interfaces:**
- Consumes: the fully-renamed source tree from Task 5 — this task is a pure move plus path-reference updates, with no simultaneous content rename inside the moved files.
- Produces: the `ims-scope/` directory path, which Task 7 (docs) assumes is already the correct path to reference.

- [ ] **Step 1: Confirm the app directory still builds before the move**

Run: `pnpm build:app:dir`
Expected: succeeds. This is the last checkpoint before the disruptive move, so any failure here is isolated to Tasks 1–5, not this task.

- [ ] **Step 2: Move the directory with `git mv`**

```bash
git mv freelens ims-scope
```
Expected: git registers this as a rename (verify with `git status` showing `renamed:` entries, not separate delete/add pairs) so history (`git log --follow`) is preserved.

- [ ] **Step 3: Update every workspace-glob and path reference**

Run:
```bash
rg -l "'freelens/|\"freelens/|freelens/\*\*" package.json pnpm-workspace.yaml .github/workflows/ scripts/
```
For each file found, update the `freelens/` path segment to `ims-scope/` — workspace glob patterns (`freelens/*`, `freelens/**`), CI path filters (`paths: ['freelens/**']`), working-directory declarations (`working-directory: freelens`), and any script that `cd`s into or reads from `freelens/`.

- [ ] **Step 4: Reinstall to confirm workspace resolution under the new path**

Run: `pnpm install`
Expected: succeeds with the workspace package now resolving from `ims-scope/` instead of `freelens/`.

- [ ] **Step 5: Full build**

Run: `pnpm build`
Expected: succeeds — confirms every relative import and build-tool path reference survived the move.

- [ ] **Step 6: Type-check and lint**

Run: `pnpm type:check`, `pnpm biome check --write`, `trunk check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git status
git add -A ims-scope/ freelens/ package.json pnpm-workspace.yaml .github/workflows/ scripts/
```
(Note: `git add -A` is used here deliberately and only for this rename-move step, scoped to the specific paths listed — not a blanket `git add -A` at repo root — because a directory rename via `git mv` followed by further edits inside it needs both the move and the in-place edits staged together for git to keep recognizing it as a rename. Run `git status` first and confirm only the expected paths appear before staging.)
```bash
git commit -m "Rename freelens/ directory to ims-scope/"
```

---

## Task 7: Rename docs & CI prose text (Stage 5)

**Files:**
- Modify: `AGENTS.md`, `CLAUDE.md` (wherever they describe the `ims-scope/` directory — update path references from `freelens/` to match Task 6's rename)
- Modify: `DEVELOPMENT.md`
- Modify: `docs/*.md`
- Modify: `.github/workflows/*.yaml` (comments, job names, artifact names mentioning "Freelens" in human-readable text — not already-renamed Homebrew/release-artifact naming, which is done)
- Modify: any remaining `freelensapp/freelens` GitHub URLs in docs that should point at `Nibamot/ims-scope`

**Interfaces:**
- Consumes: the `ims-scope/` directory path from Task 6, and the `Nibamot/ims-scope` repo URL already established in Task 2.
- Produces: nothing further consumed by other tasks — this is the last in-scope task before final verification.

- [ ] **Step 1: Enumerate remaining prose references**

Run:
```bash
rg -il freelens AGENTS.md CLAUDE.md DEVELOPMENT.md docs/ .github/workflows/
```
For each file, run `rg -n -i freelens <file>` and check each hit against the exclusions: skip any `freelens-k8s-proxy` mention, skip copyright/license text, skip anything already covered by Task 6.

- [ ] **Step 2: Update prose references file by file**

For each remaining hit: `Freelens` → `IMS Scope` in prose, `freelens/` path references → `ims-scope/`, `freelensapp/freelens` GitHub URLs → `Nibamot/ims-scope` (do not touch `freelensapp/freelens-k8s-proxy` URLs — those stay).

- [ ] **Step 3: Verify the scoped grep is now empty**

Run:
```bash
rg -il freelens AGENTS.md CLAUDE.md DEVELOPMENT.md docs/ .github/workflows/
```
Expected: no matches, or only matches that are legitimately about `freelens-k8s-proxy` (verify each remaining hit by eye).

- [ ] **Step 4: Lint**

Run: `trunk check` (Markdown and YAML are covered by trunk, not biome)
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git status
git diff
git add AGENTS.md CLAUDE.md DEVELOPMENT.md docs/ .github/workflows/
git commit -m "Update docs and CI prose references from Freelens to IMS Scope"
```

---

## Task 8: Final verification for Sub-project A

**Files:** none modified — this task is verification-only, with fixes folded back into whichever earlier task's file a residual match belongs to.

**Interfaces:**
- Consumes: the complete rename from Tasks 1–7.
- Produces: confirmation that Sub-project A is complete and ready to hand off to Sub-project B (user-data migration, separate spec).

- [ ] **Step 1: Full packaged build**

Run: `pnpm build:app:dir`
Expected: succeeds and produces a packaged app directory under the new `ims-scope/` path.

- [ ] **Step 2: Unit test suite**

Run: `pnpm test`
Expected: passes. If any snapshot test fails purely on a renamed string (e.g. a component snapshot containing literal "Freelens" text), regenerate that snapshot with `pnpm test:unit:updatesnapshot`, review the diff to confirm it's exactly the expected rename (and nothing else), then include the updated `.snap` file in this task's commit.

- [ ] **Step 3: Manual smoke test of the packaged app**

Launch the packaged app from Step 1's output. Confirm:
- Window title shows "IMS Scope"
- Tray icon tooltip shows "IMS Scope"
- App menu (About dialog) shows "IMS Scope"
- Adding a cluster works and the cluster view loads without a certificate error

- [ ] **Step 4: Repo-wide residual-string check**

Run: `rg -il freelens`
Expected: only the deliberately-excluded survivors remain:
- Copyright headers ("Freelens Authors")
- "OpenLens Authors" attribution lines
- `freelens-k8s-proxy`-related paths/strings (`packages/ensure-binaries/**`, `**/kube-auth-proxy/**`, `freelens/binaries.lock.json` equivalent under the new `ims-scope/` path, GitHub URLs for that repo)
- `LICENSE`, `license-header.txt`, `static/build/license.txt`

Any other hit means an earlier task missed a rename — go back to the task that owns that file/category, fix it there (not in this task), and re-run this check.

- [ ] **Step 5: Commit any fixes found in Step 2 or Step 4**

If Step 2 required snapshot updates or Step 4 surfaced a genuine miss, commit those fixes attributed to the task category they belong to (e.g. a missed source identifier goes in a follow-up commit referencing Task 5's scope), not lumped into an unrelated "final fixes" commit.

```bash
git status
git diff
git add <specific files>
git commit -m "<describe the specific fix, e.g. 'Fix missed Freelens reference in cluster settings snapshot'>"
```

- [ ] **Step 6: Confirm Sub-project A completion**

No code changes in this step. Sub-project A (in-repo identity rebrand) is complete once Steps 1–5 all pass with no unexplained residual matches. Sub-project B (user-data migration) and Sub-project C (external `freelens-k8s-proxy` repo rename) remain separate, out-of-scope follow-ons per the spec.
