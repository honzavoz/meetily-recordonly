# macOS CI and Release Hardening Implementation Plan

> **For Codex:** Execute this plan task by task. Start with failing tests for every behavior change and verify each task before committing it.

**Goal:** Make unsigned Apple Silicon builds reliable today, keep a clear signed/notarized path for later, remove Node 20 action warnings, and identify every build consistently as version 0.4.1.

**Architecture:** Small shell preflight scripts will own version consistency and Apple-secret validation so local and CI behavior match. GitHub workflows will use Node 24-compatible action majors, unsigned builds by default, and signing only when explicitly requested. The frontend will derive its displayed version from Tauri/package metadata instead of hard-coded copy.

**Tech stack:** GitHub Actions, Bash, pnpm/Vitest, React/TypeScript, Tauri/Rust.

---

## Task 1: Add tested release preflight scripts

**Files:**
- Create: `scripts/check-version-consistency.sh`
- Create: `scripts/check-apple-signing-secrets.sh`
- Create: `scripts/tests/release-preflight.test.sh`

1. Write shell tests using temporary fixture files. Cover matching versions, a mismatched version, complete Apple credentials, and a missing credential with a readable error listing the missing variable names.
2. Run `bash scripts/tests/release-preflight.test.sh` and confirm it fails because the scripts do not exist.
3. Implement `check-version-consistency.sh` to compare the versions in `frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, and `frontend/src-tauri/Cargo.toml`.
4. Implement `check-apple-signing-secrets.sh` to require the exact signing/notarization variables used by the macOS workflow, without printing secret values.
5. Re-run the test script and `shellcheck` when available. Commit as `test: add release preflight checks`.

## Task 2: Bump and expose application version

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/Cargo.lock` if Cargo updates it
- Create: `frontend/src/lib/app-version.ts`
- Create: `frontend/src/hooks/useAppVersion.ts`
- Create: `frontend/tests/lib/app-version.test.ts`
- Modify: the sidebar/about components containing hard-coded `0.4.0`

1. Locate all displayed and configured versions with `rg -n '0\.4\.0|version' frontend`.
2. Add a failing Vitest test for version normalization/fallback behavior in `app-version.ts`.
3. Implement the version helper and hook, using Tauri's application version API where available and a safe package-version fallback for browser tests.
4. Replace hard-coded UI versions with the shared value.
5. Set all three release sources to `0.4.1`, update the lockfile through Cargo if necessary, then run the Vitest test and `bash scripts/check-version-consistency.sh`.
6. Commit as `chore: bump app version to 0.4.1`.

## Task 3: Move workflows to Node 24-compatible actions

**Files:**
- Modify: `.github/workflows/*.yml`
- Modify: `.github/workflows/*.yaml` if present

1. Inventory all action references with `rg -n 'uses:|node-version:' .github/workflows`.
2. Update to `actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache@v6`, `actions/upload-artifact@v7`, and `pnpm/action-setup@v6` wherever those actions occur. Set explicit project Node versions to `24` where the workflow owns Node setup.
3. Preserve every existing trigger, permission, cache path, build command, and artifact path.
4. Validate YAML and run `actionlint` if installed. Re-run the inventory to ensure deprecated majors are gone.
5. Commit as `ci: update workflows for Node 24`.

## Task 4: Separate unsigned and signed macOS builds

**Files:**
- Modify: the macOS build workflow under `.github/workflows/`
- Modify: the release workflow under `.github/workflows/`

1. Add a workflow input `sign-build` defaulting to `false`.
2. Run the Apple-secret preflight only when `sign-build` is true, before the expensive build. Its failure must explain that Apple Developer credentials are required and name the missing variables.
3. Keep signing and notarization steps conditional on `sign-build`. Do not silently fall back to unsigned when signing was requested.
4. For unsigned builds, retain ad-hoc/local verification and publish an artifact clearly labeled `unsigned`. Label signed artifacts `signed-notarized`.
5. Run the version-consistency preflight in build and release jobs.
6. Make the release workflow accept strict `X.Y.Z` versions, remove any four-component fallback, and verify its requested/tag version matches application metadata.
7. Validate the workflow files and inspect the diff for unchanged triggers/permissions. Commit as `ci: harden macOS build and release flows`.

## Task 5: Verify and hand off

1. Run `bash scripts/tests/release-preflight.test.sh`.
2. Run `bash scripts/check-version-consistency.sh`.
3. Run the focused frontend tests, then the repository's normal frontend test/build commands.
4. Run Rust/Tauri checks already used by the repository where practical.
5. Run `actionlint` when installed and `git diff --check`.
6. Review `git status --short` and the complete diff; preserve unrelated user changes.
7. Ask before pushing. After an approved push, trigger the default unsigned macOS workflow and report its run URL/status; do not wait for completion unless requested.

## Acceptance criteria

- The app and UI consistently report version `0.4.1`.
- Version drift fails locally and in CI with an actionable message.
- Default macOS CI succeeds without Apple Developer secrets and produces an explicitly unsigned artifact.
- Explicit signed builds fail immediately and clearly if any required secret is absent.
- The signed/notarized path remains wired for later credential provisioning.
- No workflow uses the deprecated Node 20-based action majors listed above.
- Release versions follow strict `X.Y.Z` semantics.
