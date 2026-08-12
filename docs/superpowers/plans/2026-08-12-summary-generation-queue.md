# Summary Generation Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serialize all summary generation through one visible FIFO queue, prevent duplicate jobs per meeting, and make cancellation and navigation safe.

**Architecture:** A process-wide Rust queue manager owns job identity, FIFO order, per-meeting uniqueness, cancellation tokens, and the one running slot. SQLite retains meeting-level lifecycle state and the current job ID, while a global React context polls active jobs across navigation and exposes status to the meeting panel and sidebar.

**Tech Stack:** Rust, Tokio, Tauri 2, SQLx, SQLite, React, TypeScript, Bun test

---

## File structure

- Create `frontend/src-tauri/src/summary/queue.rs`: isolated queue state machine and process-wide manager.
- Modify `frontend/src-tauri/src/summary/mod.rs`: register and export the queue module.
- Modify `frontend/src-tauri/src/database/repositories/summary.rs`: persist job IDs, processing status, and interrupted-job recovery.
- Modify `frontend/src-tauri/src/summary/service.rs`: accept the queue-owned cancellation token instead of maintaining a second registry.
- Modify `frontend/src-tauri/src/summary/commands.rs`: reserve, enqueue, poll, and cancel exact jobs.
- Modify `frontend/src-tauri/src/database/setup.rs` and `frontend/src-tauri/src/database/commands.rs`: recover stale jobs whenever a database becomes active.
- Create `frontend/src/lib/summary-queue.ts`: shared frontend types and pure status mapping helpers.
- Create `frontend/tests/lib/summary-queue.test.ts`: frontend queue behavior and source-contract regressions.
- Modify `frontend/src/components/Sidebar/SidebarProvider.tsx`: global queue tracking and polling across navigation.
- Modify `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`: enqueue once, derive status globally, reload completed data, and target exact cancellation.
- Modify `frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx`: immediate duplicate-click guard and queued/cancelling labels.
- Modify `frontend/src/components/MeetingDetails/SummaryPanel.tsx`: current meeting queue position.
- Modify `frontend/src/components/Sidebar/index.tsx`: compact active-job indicators.
- Modify application version files and `frontend/tests/lib/app-version.test.mjs`: publish the patch release.

### Task 1: Build the backend FIFO state machine

**Files:**
- Create: `frontend/src-tauri/src/summary/queue.rs`
- Modify: `frontend/src-tauri/src/summary/mod.rs`

- [ ] **Step 1: Write queue tests first**

Create tests inside `queue.rs` for FIFO grants, duplicate meeting reservation, queued cancellation, running cancellation, guarded cleanup, and queue positions. Use three fixed meeting IDs and assert exact views:

```rust
use std::time::Duration;

#[tokio::test]
async fn grants_jobs_in_fifo_order_and_only_one_runs() {
    let queue = SummaryQueueManager::new();
    let ReservationOutcome::New { view: first, token: first_token } = queue.reserve("meeting-a").await else { panic!("expected new job") };
    let ReservationOutcome::New { view: second, token: second_token } = queue.reserve("meeting-b").await else { panic!("expected new job") };
    let ReservationOutcome::New { view: third, token: third_token } = queue.reserve("meeting-c").await else { panic!("expected new job") };
    queue.commit(&first.job_id).await.unwrap();
    queue.commit(&second.job_id).await.unwrap();
    queue.commit(&third.job_id).await.unwrap();

    assert_eq!(queue.wait_for_turn(&first.job_id, &first_token).await.unwrap().job_id, first.job_id);
    assert!(tokio::time::timeout(
        Duration::from_millis(20),
        queue.wait_for_turn(&second.job_id, &second_token),
    ).await.is_err());
    assert_eq!(queue.view_for_meeting("meeting-b").await.unwrap().queue_position, Some(1));
    assert_eq!(queue.view_for_meeting("meeting-c").await.unwrap().queue_position, Some(2));

    assert!(queue.finish("meeting-a", &first.job_id).await);
    assert_eq!(queue.wait_for_turn(&second.job_id, &second_token).await.unwrap().job_id, second.job_id);
    assert!(!third_token.is_cancelled());
}

#[tokio::test]
async fn duplicate_reservation_returns_existing_job() {
    let queue = SummaryQueueManager::new();
    let ReservationOutcome::New { view: first, .. } = queue.reserve("meeting-a").await else { panic!("expected new job") };
    let ReservationOutcome::Existing(duplicate) = queue.reserve("meeting-a").await else { panic!("expected existing job") };
    assert_eq!(duplicate.job_id, first.job_id);
    assert_eq!(queue.active_count().await, 1);
}

#[tokio::test]
async fn old_job_cannot_remove_newer_meeting_state() {
    let queue = SummaryQueueManager::new();
    let ReservationOutcome::New { view: old, .. } = queue.reserve("meeting-a").await else { panic!("expected new job") };
    queue.release_reservation("meeting-a", &old.job_id).await;
    let ReservationOutcome::New { view: current, .. } = queue.reserve("meeting-a").await else { panic!("expected new job") };
    assert!(!queue.finish("meeting-a", &old.job_id).await);
    assert_eq!(queue.view_for_meeting("meeting-a").await.unwrap().job_id, current.job_id);
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml summary::queue::tests --locked
```

Expected: compilation fails because `SummaryQueueManager` and its types do not exist. On this Mac, record the known full-Xcode `cidre` blocker if it stops compilation before the test target; CI remains the Rust execution authority.

- [ ] **Step 3: Implement the minimal queue manager**

Define the public contract:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SummaryJobPhase { Reserved, Queued, Running, Cancelling }

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SummaryJobView {
    pub job_id: String,
    pub meeting_id: String,
    pub phase: SummaryJobPhase,
    pub queue_position: Option<usize>,
}

pub enum ReservationOutcome {
    New { view: SummaryJobView, token: CancellationToken },
    Existing(SummaryJobView),
}

pub enum CancelOutcome {
    Queued(SummaryJobView),
    Running(SummaryJobView),
    NotActive,
}

pub struct SummaryQueueManager {
    state: tokio::sync::Mutex<QueueState>,
    changed: tokio::sync::Notify,
}

pub static SUMMARY_QUEUE: Lazy<SummaryQueueManager> = Lazy::new(SummaryQueueManager::new);
```

Use a `VecDeque<String>` for FIFO job IDs, `HashMap<String, JobEntry>` for jobs, `HashMap<String, String>` for meeting-to-job ownership, and `Option<String>` for the running job. `reserve` allocates `Uuid::new_v4()`, `commit` appends once, `wait_for_turn(job_id, token)` grants only when that exact job is at the FIFO front and `running` is empty, `cancel` cancels the exact token, and `finish` checks both meeting ID and job ID before cleanup. Implement the wait loop by creating `changed.notified()` before checking state, then selecting between that notification and `token.cancelled()` so no wakeup can be lost. Notify waiters after commit, queued removal, and finish.

- [ ] **Step 4: Export the module and verify GREEN where available**

Add `pub mod queue;` to `summary/mod.rs`, run the focused test again, and expect every queue test to pass or only the documented Xcode environment blocker.

- [ ] **Step 5: Commit the queue state machine**

```bash
git add frontend/src-tauri/src/summary/queue.rs frontend/src-tauri/src/summary/mod.rs
git commit -m "feat: add FIFO summary queue state machine"
```

### Task 2: Persist queue lifecycle and recover interrupted jobs

**Files:**
- Modify: `frontend/src-tauri/src/database/repositories/summary.rs`
- Modify: `frontend/src-tauri/src/database/setup.rs`
- Modify: `frontend/src-tauri/src/database/commands.rs`

- [ ] **Step 1: Add failing repository tests**

Extend the existing in-memory tests with:

```rust
async fn insert_meeting(pool: &SqlitePool, meeting_id: &str) {
    sqlx::query("INSERT INTO meetings (id, updated_at) VALUES (?, CURRENT_TIMESTAMP)")
        .bind(meeting_id).execute(pool).await.unwrap();
}

async fn insert_active_process(
    pool: &SqlitePool,
    meeting_id: &str,
    status: &str,
    backup: Option<&str>,
) {
    insert_meeting(pool, meeting_id).await;
    sqlx::query(
        "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result_backup, metadata) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, json_object('job_id', ?))",
    )
    .bind(meeting_id).bind(status).bind(backup).bind(format!("job-{meeting_id}"))
    .execute(pool).await.unwrap();
}

async fn assert_recovered(pool: &SqlitePool, meeting_id: &str, expected_result: &str) {
    let row: (String, String, Option<String>) = sqlx::query_as(
        "SELECT status, result, result_backup FROM summary_processes WHERE meeting_id = ?",
    )
    .bind(meeting_id).fetch_one(pool).await.unwrap();
    assert_eq!(row.0, "failed");
    assert_eq!(row.1, expected_result);
    assert!(row.2.is_none());
}

#[tokio::test]
async fn process_lifecycle_persists_job_id_and_processing_state() {
    let pool = test_pool().await;
    insert_meeting(&pool, "meeting-queue").await;
    SummaryProcessesRepository::create_or_reset_process(&pool, "meeting-queue", "job-1")
        .await.unwrap();
    SummaryProcessesRepository::mark_process_running(&pool, "meeting-queue", "job-1")
        .await.unwrap();
    let row: (String, String) = sqlx::query_as(
        "SELECT status, metadata FROM summary_processes WHERE meeting_id = ?"
    ).bind("meeting-queue").fetch_one(&pool).await.unwrap();
    assert_eq!(row.0, "processing");
    assert_eq!(serde_json::from_str::<Value>(&row.1).unwrap()["job_id"], "job-1");
}

#[tokio::test]
async fn startup_recovery_fails_active_rows_and_restores_backup() {
    let pool = test_pool().await;
    insert_active_process(&pool, "queued", "PENDING", Some(r#"{"markdown":"old"}"#)).await;
    insert_active_process(&pool, "running", "processing", Some(r#"{"markdown":"older"}"#)).await;
    let recovered = SummaryProcessesRepository::recover_interrupted_processes(&pool).await.unwrap();
    assert_eq!(recovered, 2);
    assert_recovered(&pool, "queued", r#"{"markdown":"old"}"#).await;
    assert_recovered(&pool, "running", r#"{"markdown":"older"}"#).await;
}
```

- [ ] **Step 2: Run the repository tests and verify RED**

Run `cargo test --manifest-path frontend/src-tauri/Cargo.toml database::repositories::summary::tests --locked`.

Expected: missing method/signature failures, or the documented `cidre` Xcode blocker before tests execute.

- [ ] **Step 3: Implement persisted job metadata and processing state**

Change the initializer signature to `create_or_reset_process(pool, meeting_id, job_id)`. Store only non-sensitive queue metadata:

```sql
metadata = json_object('job_id', ?)
```

Add `mark_process_running(pool, meeting_id, job_id) -> Result<bool, sqlx::Error>` using:

```sql
UPDATE summary_processes
SET status = 'processing', updated_at = ?, start_time = ?, error = NULL
WHERE meeting_id = ?
  AND json_extract(metadata, '$.job_id') = ?
  AND upper(status) = 'PENDING'
```

Return `true` only when one row changes. This prevents an old job from claiming a row initialized for a newer job.

- [ ] **Step 4: Implement startup recovery through backup semantics**

Add one transaction that updates only `upper(status) IN ('PENDING', 'PROCESSING')`, sets `status = 'failed'`, stores `Summary generation was interrupted when Meetily exited`, restores `result_backup` when present, clears backup fields, and sets `end_time`/`updated_at`. Return `rows_affected()`.

Call recovery immediately after every successful database activation:

```rust
let recovered = SummaryProcessesRepository::recover_interrupted_processes(db_manager.pool()).await?;
if recovered > 0 {
    log::warn!("Recovered {} interrupted summary jobs", recovered);
}
```

Apply it in normal startup, legacy import, and fresh database initialization before emitting database-ready events.

- [ ] **Step 5: Verify and commit lifecycle persistence**

Run repository tests, `rustfmt --edition 2021 --check frontend/src-tauri/src/database/repositories/summary.rs frontend/src-tauri/src/database/setup.rs frontend/src-tauri/src/database/commands.rs`, then commit:

```bash
git add frontend/src-tauri/src/database/repositories/summary.rs frontend/src-tauri/src/database/setup.rs frontend/src-tauri/src/database/commands.rs
git commit -m "feat: persist and recover summary queue state"
```

### Task 3: Enqueue commands and exact cancellation

**Files:**
- Modify: `frontend/src-tauri/src/summary/service.rs`
- Modify: `frontend/src-tauri/src/summary/commands.rs`
- Modify: `frontend/src-tauri/src/summary/mod.rs`

- [ ] **Step 1: Add queue-command contract tests**

Add Rust serialization tests for the response shapes and a source-level Bun contract in `frontend/tests/lib/summary-queue.test.ts` requiring unique `job_id`, `already_active`, queue position, queue-owned cancellation tokens, and absence of `CANCELLATION_REGISTRY`.

```ts
test("backend commands reserve before resetting SQLite", () => {
  const source = readFileSync(resolve(import.meta.dir, "../../src-tauri/src/summary/commands.rs"), "utf8");
  const reserve = source.indexOf("SUMMARY_QUEUE.reserve(&m_id).await");
  const reset = source.indexOf("create_or_reset_process", reserve);
  expect(reserve).toBeGreaterThan(-1);
  expect(reset).toBeGreaterThan(reserve);
  expect(source).toContain("already_active");
  expect(source).toContain("queue_position");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run `cd frontend && bun test tests/lib/summary-queue.test.ts` and the queue/repository Rust tests.

Expected: frontend source contract fails because commands still spawn directly and service still owns the old registry.

- [ ] **Step 3: Move cancellation ownership into the queue**

Remove `CANCELLATION_REGISTRY`, `register_cancellation_token`, `cancel_summary`, and `cleanup_cancellation_token` from `SummaryService`. Add a `CancellationToken` argument to `process_transcript_background` and use it for the existing provider cancellation path.

- [ ] **Step 4: Implement duplicate-safe enqueue**

Expand `ProcessTranscriptResponse`:

```rust
pub struct ProcessTranscriptResponse {
    pub message: String,
    pub process_id: String,
    pub meeting_id: String,
    pub status: String,
    pub queue_position: Option<usize>,
    pub already_active: bool,
}
```

Reserve before database writes. For `Existing`, return the existing view immediately. For `New`, initialize SQLite with the job ID and save transcript data; release the reservation on either error. Commit the queue entry only after both writes succeed.

Spawn a dispatcher task that calls `wait_for_turn(&job_id, &token)` for its own job. It must never dequeue a different job's ID. After its exact grant, mark SQLite `processing` with matching job ID, then spawn/await the existing summary service. Always call guarded `finish(meeting_id, job_id)` afterward. If the service task panics or is aborted, mark the process failed before releasing the slot.

- [ ] **Step 5: Return queue metadata from status and cancel exact jobs**

Add optional `process_id` and `queue_position` fields to `SummaryResponse`. `api_get_summary` combines the persisted row with `SUMMARY_QUEUE.view_for_meeting` so active positions are current while terminal responses retain the persisted metadata job ID.

Change cancellation arguments to `meeting_id` plus optional `process_id`. For queued jobs, update SQLite to cancelled immediately; for the running job, return `cancelling` and let the service's cancellation path write the terminal state. A mismatched ID returns `not_active` without touching SQLite.

- [ ] **Step 6: Verify and commit command integration**

Run focused Bun contracts, Rust queue/repository tests where available, formatting, and `git diff --check`, then commit:

```bash
git add frontend/src-tauri/src/summary/service.rs frontend/src-tauri/src/summary/commands.rs frontend/src-tauri/src/summary/mod.rs frontend/tests/lib/summary-queue.test.ts
git commit -m "feat: serialize summary generation through queue"
```

### Task 4: Create global frontend queue tracking

**Files:**
- Create: `frontend/src/lib/summary-queue.ts`
- Modify: `frontend/tests/lib/summary-queue.test.ts`
- Modify: `frontend/src/components/Sidebar/SidebarProvider.tsx`

- [ ] **Step 1: Add failing pure-state tests**

Define test inputs for three jobs and require stable updates by meeting ID:

```ts
test("maps backend pending status to visible FIFO position", () => {
  expect(toSummaryJob({ meeting_id: "b", process_id: "job-b", status: "pending", queue_position: 2 }))
    .toEqual({ meetingId: "b", jobId: "job-b", phase: "queued", queuePosition: 2, error: null });
});

test("terminal updates replace only their meeting", () => {
  const initialJobs = {
    a: { meetingId: "a", jobId: "job-a", phase: "generating", queuePosition: null, error: null },
    b: { meetingId: "b", jobId: "job-b", phase: "queued", queuePosition: 1, error: null },
  } satisfies Record<string, SummaryJob>;
  const completedA: SummaryJob = {
    meetingId: "a", jobId: "job-a", phase: "completed", queuePosition: null, error: null,
  };
  const state = upsertSummaryJob(initialJobs, completedA);
  expect(state["a"].phase).toBe("completed");
  expect(state["b"]).toEqual(initialJobs["b"]);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run `cd frontend && bun test tests/lib/summary-queue.test.ts`.

Expected: module import fails because `src/lib/summary-queue.ts` does not exist.

- [ ] **Step 3: Implement types and pure mappings**

Export:

```ts
export type SummaryJobPhase = "reserved" | "queued" | "generating" | "cancelling" | "completed" | "failed" | "cancelled";
export interface SummaryJob { meetingId: string; jobId: string; phase: SummaryJobPhase; queuePosition: number | null; error: string | null; }
export interface SummaryBackendStatus { meeting_id: string; process_id?: string | null; status: string; queue_position?: number | null; error?: string | null; data?: unknown; }
export function toSummaryJob(response: SummaryBackendStatus): SummaryJob;
export function upsertSummaryJob(state: Record<string, SummaryJob>, job: SummaryJob): Record<string, SummaryJob>;
export function isActiveSummaryJob(job?: SummaryJob): boolean;
```

Normalize `PENDING`/`queued` to `queued`, `processing` to `generating`, and preserve exact terminal states.

- [ ] **Step 4: Replace callback polling with provider-lifetime polling**

In `SidebarProvider`, store `summaryJobs: Record<string, SummaryJob>` and interval handles in a ref rather than React state. Expose:

```ts
trackSummaryJob(response: SummaryBackendStatus): void;
refreshSummaryJob(meetingId: string): Promise<SummaryBackendStatus>;
cancelSummaryJob(meetingId: string, jobId: string): Promise<void>;
```

`trackSummaryJob` immediately upserts the response and ensures one poller for that meeting. Each poll calls `api_get_summary`, updates global state, and stops only at a terminal status. A polling error leaves the job active, records the error, and retries with capped intervals of 2, 4, 8, then 15 seconds. Provider unmount clears all interval refs; meeting page unmount does not.

- [ ] **Step 5: Verify and commit global tracking**

Run the focused queue test and the full Bun suite, then commit:

```bash
git add frontend/src/lib/summary-queue.ts frontend/tests/lib/summary-queue.test.ts frontend/src/components/Sidebar/SidebarProvider.tsx
git commit -m "feat: track summary jobs across navigation"
```

### Task 5: Connect meeting generation and queue UI

**Files:**
- Modify: `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`
- Modify: `frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
- Modify: `frontend/src/components/Sidebar/index.tsx`
- Modify: `frontend/tests/lib/summary-queue.test.ts`

- [ ] **Step 1: Add failing source and UI-helper tests**

Assert that generation has an immediate request ref, tracks the backend response globally, derives visible status from `summaryJobs[meeting.id]`, cancels with exact `processId`, and no longer stops polling during meeting-hook cleanup. Assert sidebar source renders `Queued #` and `Generating` for active jobs.

- [ ] **Step 2: Run focused tests and verify RED**

Run `cd frontend && bun test tests/lib/summary-queue.test.ts`.

Expected: source contracts fail against local hook state and callback polling.

- [ ] **Step 3: Make enqueue idempotent in the hook**

Add `generationRequestInFlightRef`. Return early while it is true or while the global meeting job is active. Set it before transcript/model checks and clear it in `finally`.

After `api_process_transcript`, call `trackSummaryJob(result)`. Track the analytics start event only when `already_active` is false. For an existing job, show one informational toast and do not reset summary state.

Derive the displayed status from the global job. When its terminal job ID changes to `completed`, fetch `api_get_summary`, update `aiSummary`, and call `onMeetingUpdated`. Keep a handled-job-ID ref to prevent duplicate completion toasts.

- [ ] **Step 4: Route cancellation and render current status**

Call `cancelSummaryJob(meeting.id, activeJob.jobId)`. Show `Cancel queued summary` for queued jobs and `Stop generation` for the running job. Disable Generate while reservation/model validation is in flight.

In the summary panel render `Queued · position N`, `Generating summary…`, or `Cancelling…`. In sidebar rows read `summaryJobs[item.id]` and render a compact `Queued #N` badge or animated spinner plus `Generating`.

- [ ] **Step 5: Verify navigation-safe behavior and commit**

Run the focused queue test, `bun test`, ESLint, and production Next build. Inspect the hook to confirm no page-unmount cleanup clears provider pollers. Commit:

```bash
git add frontend/src/hooks/meeting-details/useSummaryGeneration.ts frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx frontend/src/components/MeetingDetails/SummaryPanel.tsx frontend/src/components/Sidebar/index.tsx frontend/tests/lib/summary-queue.test.ts
git commit -m "feat: show and control summary queue"
```

### Task 6: Complete concurrency verification and release

**Files:**
- Modify: `frontend/tests/lib/app-version.test.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `Cargo.lock`

- [ ] **Step 1: Run the complete pre-release verification**

Run:

```bash
cd frontend && bun test
cd frontend && pnpm lint
cd frontend && ./node_modules/.bin/next build
rustfmt --edition 2021 --check frontend/src-tauri/src/summary/queue.rs frontend/src-tauri/src/summary/commands.rs frontend/src-tauri/src/summary/service.rs frontend/src-tauri/src/database/repositories/summary.rs frontend/src-tauri/src/database/setup.rs frontend/src-tauri/src/database/commands.rs
cargo test --manifest-path frontend/src-tauri/Cargo.toml summary::queue::tests --locked
cargo test --manifest-path frontend/src-tauri/Cargo.toml database::repositories::summary::tests --locked
./scripts/check-version-consistency.sh
./scripts/tests/release-preflight.test.sh
git diff --check
```

Expected: frontend tests, lint with zero errors, build, focused Rust tests, formatting, version consistency, release preflight, and diff checks pass. If local Rust compilation is blocked by full Xcode, preserve the exact error and require the protected macOS CI build to execute it before publication.

- [ ] **Step 2: Exercise queue scenarios against a disposable test setup**

Using test meetings rather than existing user notes, verify:

1. Three jobs show positions 1 and 2 behind one running job and complete A → B → C.
2. A rapid double click for A returns one job ID and one summary row reset.
3. Cancelling queued B leaves A running and advances C.
4. Cancelling running A starts B and restores A's prior summary.
5. Navigating A → B → C preserves all indicators and completion results.
6. Closing and relaunching after a forced interrupted test marks stale jobs failed and restores backups.
7. Built-in AI and configured Custom OpenAI each remain at one active provider request.

- [ ] **Step 3: Bump the version test and verify RED**

Set only the expected application version to `0.4.10`, run `cd frontend && node --test tests/lib/app-version.test.mjs`, and expect failure because manifests still report `0.4.9`.

- [ ] **Step 4: Bump application manifests to 0.4.10 and verify GREEN**

Update only the Meetily version in `frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, and the `meetily` package entry in `Cargo.lock`. Re-run the version test and `scripts/check-version-consistency.sh`.

- [ ] **Step 5: Review, commit, and push main**

Request an independent code review against the design spec. Resolve all Critical and Important findings, rerun the complete evidence set, then commit the release metadata as `chore: release 0.4.10`. Push `main` only after local HEAD, clean status, and verification outputs are confirmed.

- [ ] **Step 6: Publish and verify the protected updater release**

Dispatch `release.yml` on `main` and monitor it through the Rust build, updater signing, cryptographic archive verification, and publication. Confirm `v0.4.10` is the latest non-draft release, validate `latest.json` with `scripts/verify-updater-release-assets.js`, and verify the anonymous `releases/latest/download/latest.json` endpoint reports `0.4.10` with an HTTP 200 `darwin-aarch64` archive.
