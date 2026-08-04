# Reliable Summary Translation and GitHub Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long Czech summaries recover from translation timeouts and ship macOS 0.4.5 as the one-time bootstrap for signed GitHub auto-updates.

**Architecture:** Keep the canonical English report, translate bounded Markdown sections sequentially, retry only timed-out chunks once, and persist the English cache even when translation fails. Configure Tauri updater artifacts with a new Ed25519 identity stored only in GitHub Secrets, then publish a macOS-only GitHub Release whose `latest.json` drives the existing updater UI.

**Tech Stack:** Rust, Tokio, Reqwest, SQLx/SQLite, Tauri 2 updater, Bash, GitHub Actions, pnpm/Bun, macOS `codesign`/`hdiutil`.

---

### Task 1: Markdown-aware translation chunks

**Files:**
- Modify: `frontend/src-tauri/src/summary/processor.rs`

- [ ] **Step 1: Add failing unit tests for section boundaries and exact reassembly**

Add tests covering a short single chunk, multiple `##` sections, an oversized section split only at blank-line paragraph boundaries, and `translated.join("\n\n")` reproducing section order without invented separators. Use a small test budget such as 80 characters so fixtures remain readable.

```rust
#[test]
fn translation_chunks_keep_markdown_sections_intact() {
    let input = "# Report\n\n## Decisions\n\nKeep local data.\n\n## Actions\n\n- Ship update";
    let chunks = split_markdown_for_translation(input, 80);
    assert_eq!(chunks, vec![
        "# Report",
        "## Decisions\n\nKeep local data.",
        "## Actions\n\n- Ship update",
    ]);
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cargo test -p meetily translation_chunks --locked`

Expected: compilation fails because `split_markdown_for_translation` does not exist.

- [ ] **Step 3: Implement the bounded splitter**

Add `TRANSLATION_CHUNK_MAX_CHARS: usize = 6_000` and a pure `split_markdown_for_translation(markdown, max_chars)` helper. Start a new chunk at Markdown headings when the current chunk is non-empty; split only oversized sections by blank paragraphs; preserve fenced blocks as indivisible paragraphs. Trim outer blank lines while retaining all content and order.

- [ ] **Step 4: Run focused processor tests and verify GREEN**

Run: `cargo test -p meetily summary::processor::tests --locked`

Expected: all processor tests pass.

- [ ] **Step 5: Commit the chunking unit**

```bash
git add frontend/src-tauri/src/summary/processor.rs
git commit -m "fix: bound markdown translation chunks"
```

### Task 2: Timeout-only retry and truthful errors

**Files:**
- Modify: `frontend/src-tauri/src/summary/llm_client.rs`
- Modify: `frontend/src-tauri/src/summary/processor.rs`

- [ ] **Step 1: Add failing tests for timeout classification and message duration**

Extract pure helpers and test that only timeout text is retryable, cancellation is never retryable, and the displayed timeout uses `REQUEST_TIMEOUT_DURATION.as_secs()`.

```rust
#[test]
fn translation_retry_is_timeout_only() {
    assert!(is_retryable_translation_error("LLM request timed out after 300 seconds"));
    assert!(!is_retryable_translation_error("Summary generation was cancelled"));
    assert!(!is_retryable_translation_error("LLM API request failed: unauthorized"));
}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cargo test -p meetily translation_retry --locked && cargo test -p meetily timeout_error --locked`

Expected: compilation fails for the missing helpers.

- [ ] **Step 3: Replace the stale timeout literal**

Add `fn request_timeout_error() -> String` in `llm_client.rs` and use it in both timeout branches:

```rust
fn request_timeout_error() -> String {
    format!(
        "LLM request timed out after {} seconds",
        REQUEST_TIMEOUT_DURATION.as_secs()
    )
}
```

- [ ] **Step 4: Translate chunks sequentially with one timeout retry**

Refactor `translate_markdown` to loop through `split_markdown_for_translation`. For each chunk, call `run_markdown_transform`; on a retryable timeout call it exactly once more; return cancellation and other provider errors immediately. Prefix terminal failures with `Translation section {current}/{total}` and concatenate successful translated chunks with `\n\n`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cargo test -p meetily summary::llm_client::tests summary::processor::tests --locked`

Expected: timeout, retry, cancellation, and chunk tests pass.

- [ ] **Step 6: Commit retry and timeout behavior**

```bash
git add frontend/src-tauri/src/summary/llm_client.rs frontend/src-tauri/src/summary/processor.rs
git commit -m "fix: retry bounded summary translations"
```

### Task 3: Preserve canonical English output after translation failure

**Files:**
- Modify: `frontend/src-tauri/src/summary/processor.rs`
- Modify: `frontend/src-tauri/src/summary/service.rs`
- Modify: `frontend/src-tauri/src/database/repositories/summary.rs`

- [ ] **Step 1: Add failing processor and repository tests**

Define a failure carrying recoverable English Markdown and test that translation failures retain it while cancellations do not become ordinary failures. Add an in-memory SQLite repository test proving a failed process can store a cache-only JSON result while remaining `failed`.

```rust
#[test]
fn translation_failure_retains_english_markdown() {
    let failure = SummaryGenerationFailure::translation("timeout", "# English report", 1);
    assert_eq!(failure.english_markdown.as_deref(), Some("# English report"));
    assert_eq!(failure.chunk_count, 1);
}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cargo test -p meetily translation_failure_retains repository_failed_summary --locked`

Expected: compilation fails because the failure type and repository method do not exist.

- [ ] **Step 3: Add a structured generation failure**

Change `generate_meeting_summary` to return `Result<(String, String, i64), SummaryGenerationFailure>`. The type contains `message: String`, `english_markdown: Option<String>`, and `chunk_count: i64`; implement `Display` so existing user-facing text remains compatible. Wrap failures before the English report exists with `english_markdown: None`; wrap translation failures with the generated English report.

- [ ] **Step 4: Add atomic failed-result persistence**

Add `SummaryProcessesRepository::update_process_failed_with_result(pool, meeting_id, error, result, chunk_count, processing_time)`. Its single SQL update writes status/error/result/chunk metadata/end time while retaining the existing backup semantics. Build the cache-only result through the existing `build_summary_result_json`, using English Markdown for both visible `markdown` and `english_cache.markdown`; the failed status prevents the UI from presenting it as a successful Czech summary.

- [ ] **Step 5: Reuse the cache on retry**

In `SummaryService`, when `SummaryGenerationFailure.english_markdown` exists, persist the cache-only result with the exact `SummaryCacheSource`. A subsequent request for Czech then reaches `extract_cached_english_markdown` and skips pass one. Cancellation continues through `update_process_cancelled` and stores no new cache.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `cargo test -p meetily summary::processor::tests summary::service::tests database::repositories::summary::tests --locked`

Expected: all targeted tests pass.

- [ ] **Step 7: Commit recoverable cache behavior**

```bash
git add frontend/src-tauri/src/summary/processor.rs frontend/src-tauri/src/summary/service.rs frontend/src-tauri/src/database/repositories/summary.rs
git commit -m "fix: retain english summary after translation failure"
```

### Task 4: Bootstrap updater configuration and 0.4.5 version

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `Cargo.lock`
- Create locally only: a temporary Tauri updater private key and password under a `mktemp -d` directory

- [ ] **Step 1: Extend release preflight tests and verify RED**

In `scripts/tests/release-preflight.test.sh`, assert `createUpdaterArtifacts` is `true`, the updater endpoint is the repository's GitHub `latest.json`, release workflow references both updater secrets, builds only `aarch64-apple-darwin`, verifies four required assets, and publishes the release.

Run: `bash scripts/tests/release-preflight.test.sh`

Expected: FAIL because updater artifacts are disabled and the release remains an unpublished Apple-signed matrix draft.

- [ ] **Step 2: Generate the updater identity without logging secrets**

Use a unique temporary directory and a random password file, then run Tauri's signer generator with stdout redirected to files. Read only the generated public key into the configuration. Set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` with `gh secret set` from files/stdin; never print either value. Remove the temporary directory after `gh secret list` confirms both secret names exist.

- [ ] **Step 3: Enable updater artifacts and bump all versions**

Set `bundle.createUpdaterArtifacts` to `true`, replace `plugins.updater.pubkey` with the generated public key, and update all three application declarations from `0.4.4` to `0.4.5`. Run `cargo check -p meetily --locked` or the repository-approved lockfile refresh command so only the Meetily package entry changes in `Cargo.lock`.

- [ ] **Step 4: Verify configuration and commit**

Run:

```bash
./scripts/check-version-consistency.sh
bash scripts/tests/release-preflight.test.sh
git diff --check
```

Expected: version `0.4.5` is consistent and preflight tests pass.

Commit:

```bash
git add frontend/package.json frontend/src-tauri/Cargo.toml frontend/src-tauri/tauri.conf.json Cargo.lock scripts/tests/release-preflight.test.sh
git commit -m "release: bootstrap signed github updates"
```

### Task 5: macOS-only published release workflow

**Files:**
- Create: `scripts/check-updater-signing-secrets.sh`
- Modify: `scripts/tests/release-preflight.test.sh`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Add RED tests for secret preflight and publication gates**

Mirror the Apple preflight fixture style: both updater variables pass, either missing variable fails, and output contains names but never secret values. Assert the workflow calls this script before creating a release, uses `sign-binaries: false`, contains no Windows matrix entry, requires `.dmg`, `.app.tar.gz`, `.app.tar.gz.sig`, and `latest.json`, and calls `repos.updateRelease` with `draft: false` only after verification.

- [ ] **Step 2: Run preflight tests and verify RED**

Run: `bash scripts/tests/release-preflight.test.sh`

Expected: FAIL because the updater preflight script and publication gate do not exist.

- [ ] **Step 3: Implement updater secret preflight**

Create a strict Bash script that checks only `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, prints missing variable names, never values, and exits non-zero when incomplete.

- [ ] **Step 4: Restrict and harden the release workflow**

Replace the macOS/Windows matrix with one reusable macOS build targeting `aarch64-apple-darwin`, `sign-binaries: false`, updater secrets inherited, and updater artifacts enabled. Keep the draft-first safety model. After build completion, fetch asset names through the GitHub API, fail if any required suffix is absent, download and JSON-parse `latest.json`, verify version `0.4.5` and a matching macOS updater URL/signature, then publish the draft via `actions/github-script`.

- [ ] **Step 5: Run shell and contract checks and verify GREEN**

Run:

```bash
bash -n scripts/check-updater-signing-secrets.sh
bash scripts/tests/release-preflight.test.sh
./scripts/check-version-consistency.sh
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 6: Commit workflow hardening**

```bash
git add scripts/check-updater-signing-secrets.sh scripts/tests/release-preflight.test.sh .github/workflows/release.yml .github/workflows/build.yml
git commit -m "ci: publish verified macos updater releases"
```

### Task 6: Full validation, delivery, and live verification

**Files:**
- No source changes unless a validation failure identifies a scoped defect

- [ ] **Step 1: Run the full local quality gate**

```bash
cargo fmt --all -- --check
cargo test --workspace --locked
cd frontend && pnpm lint && pnpm exec bun test && pnpm build
cd .. && ./scripts/check-version-consistency.sh
bash scripts/tests/release-preflight.test.sh
git diff --check
```

Expected: all commands exit 0 with no failed tests.

- [ ] **Step 2: Push implementation commits to `main`**

```bash
git status --short
git push origin main
```

Expected: only the intentionally untracked `.pnpm-store/` remains and `main` advances on GitHub.

- [ ] **Step 3: Trigger the Release workflow**

Run: `gh workflow run Release --ref main`

Record the run URL. Do not claim publication until the workflow completes successfully.

- [ ] **Step 4: Verify the live release and updater manifest**

Use `gh release view v0.4.5 --json isDraft,assets,url` and download `latest.json`. Verify `isDraft=false`, required assets exist, the manifest version is `0.4.5`, its macOS URL is reachable, and its signature is non-empty.

- [ ] **Step 5: Install and validate the bootstrap build**

Download the release DMG, run `hdiutil verify`, mount it, run `codesign --verify --deep --strict` on `Meetily.app`, verify `CFBundleShortVersionString=0.4.5`, preserve the installed app as a reversible backup, install 0.4.5, and launch it. Use About → Check for updates to confirm the endpoint responds without a manifest/signature error.

- [ ] **Step 6: Re-run the failed Czech summary**

Use the existing meeting `meeting-0b658d7c-13af-46e6-9354-3515231b5a3e` without editing its transcript. Generate Czech summary, verify the process reaches `completed`, the stored Markdown is Czech, and no translation timeout is recorded. If the first translation attempt is deliberately forced to timeout in a test environment, verify retry/cache behavior from logs without exposing transcript content.

- [ ] **Step 7: Report exact evidence**

Report commit SHA, workflow URL, release URL, asset names, manifest version, installed app version, full validation commands, test counts, and the final summary process status. State explicitly that the release is updater-signed but not Apple notarized.
