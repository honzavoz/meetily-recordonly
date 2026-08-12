# External AI Summary Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make External AI and manual summaries persist and reload for valid record-only meetings that have no internal summary or transcript rows.

**Architecture:** Keep the current Tauri command and frontend save contract. Repair the SQLite repository with a transaction-scoped upsert and make summary retrieval independent of transcript chunks, then publish the patch through the existing protected release workflow.

**Tech Stack:** Rust, SQLx, SQLite, Tauri 2, TypeScript, Bun, GitHub Actions updater release

---

### Task 1: Specify missing-row persistence with failing repository tests

**Files:**
- Modify: `frontend/src-tauri/src/database/repositories/summary.rs`

- [ ] **Step 1: Replace the obsolete missing-row expectation**

Change `update_meeting_summary_returns_false_without_summary_row` into a test that inserts a valid meeting, saves `{ "markdown": "external result" }`, expects `true`, then asserts exactly one `summary_processes` row with status `completed` and the exact parsed JSON.

- [ ] **Step 2: Add read and invalid-parent regressions**

Add the minimal `transcript_chunks` test table and tests which call `get_summary_data_for_meeting` without inserting a transcript chunk, and which verify a nonexistent meeting returns `false` without inserting an orphan summary row.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml database::repositories::summary::tests --locked
```

Expected: the missing-row save test fails because the update-only repository returns `false`, and the transcript-independent read test fails because the inner join returns `None`.

### Task 2: Implement atomic upsert and transcript-independent retrieval

**Files:**
- Modify: `frontend/src-tauri/src/database/repositories/summary.rs`

- [ ] **Step 1: Implement the minimal upsert**

After confirming the parent meeting and serializing JSON, execute:

```sql
INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result, error)
VALUES (?, 'completed', ?, ?, ?, NULL)
ON CONFLICT(meeting_id) DO UPDATE SET
    result = excluded.result,
    updated_at = excluded.updated_at
```

Require exactly one affected row before updating `meetings.updated_at` and committing the transaction.

- [ ] **Step 2: Remove the transcript join from summary retrieval**

Query `SELECT * FROM summary_processes WHERE meeting_id = ?` in `get_summary_data_for_meeting`, preserving its existing return type and error propagation.

- [ ] **Step 3: Run focused tests and verify GREEN**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml database::repositories::summary::tests --locked
```

Expected: all summary repository tests pass. If local macOS dependencies require full Xcode and prevent compilation, record the exact blocker and use CI as the Rust execution authority.

### Task 3: Verify the complete persistence repair

**Files:**
- Review: `frontend/src-tauri/src/database/repositories/summary.rs`
- Review: `frontend/src/hooks/meeting-details/useExternalAISummary.ts`
- Review: `frontend/src/lib/summary-saving.ts`

- [ ] **Step 1: Run formatting and focused frontend regressions**

Run:

```bash
cargo fmt --manifest-path frontend/src-tauri/Cargo.toml -- --check
cd frontend && pnpm exec bun test tests/lib/summary-saving.test.ts tests/lib/external-ai-summary.test.ts
```

Expected: formatting and focused tests pass.

- [ ] **Step 2: Run broader available checks**

Run:

```bash
cd frontend && pnpm exec bun test
cd frontend && pnpm lint
cd frontend && pnpm build
./scripts/check-version-consistency.sh
./scripts/tests/release-preflight.test.sh
git diff --check
```

Expected: all checks pass. Record any repository baseline or environment failures verbatim and do not label them as passing.

- [ ] **Step 3: Inspect the final diff**

Confirm the change creates no schema migration, does not touch user database files, preserves existing summary process metadata on update, and cannot create a summary for a nonexistent meeting.

### Task 4: Publish the corrected updater build

**Files:**
- Modify: `frontend/tests/lib/app-version.test.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `Cargo.lock`

- [ ] **Step 1: Change the version test to 0.4.9 and verify RED**

Run `cd frontend && node --test tests/lib/app-version.test.mjs` after changing only the expected version.

Expected: FAIL because declarations still report `0.4.8`.

- [ ] **Step 2: Bump application declarations to 0.4.9**

Update only the application version declarations and the root `Cargo.lock` entry for package `meetily`; do not change dependency versions.

- [ ] **Step 3: Verify and commit scoped changes**

Run the version consistency test, release preflight, relevant test suites, formatting, and `git diff --check`. Stage only the design, plan, repository, tests, and version files, then commit the repair and release metadata.

- [ ] **Step 4: Push main and dispatch the protected release workflow**

Push `main`, confirm `origin/main` equals the local release commit, run `release.yml` for `main`, and monitor it to completion. Do not publish artifacts manually if the workflow fails.

- [ ] **Step 5: Verify updater availability**

Confirm `v0.4.9` is the latest non-draft GitHub release and validate its `latest.json`, canonical `darwin-aarch64` archive URL, signature, archive, and DMG assets with the repository release verifier.
