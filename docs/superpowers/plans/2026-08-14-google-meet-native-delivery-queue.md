# Google Meet Native Delivery Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blocking Google Meet native-host acknowledgement handoff with a durable local queue that Chrome can acknowledge immediately.

**Architecture:** The pre-Tauri native host validates and atomically enqueues each event, then starts Record Only with a narrow pending-work signal. Both the single-instance callback and normal app setup drain validated events into the existing coordinator without focusing the main window; a timer provides recovery for missed signals.

**Tech Stack:** Rust, Tauri 2 single-instance plugin, serde JSON, UUID, filesystem atomic rename, Bun and Node release gates.

---

### Task 1: Add a validated filesystem queue

**Files:**
- Create: `frontend/src-tauri/src/google_meet/event_queue.rs`
- Modify: `frontend/src-tauri/src/google_meet/mod.rs`

- [x] **Step 1: Write failing queue tests**

Add tests using an isolated temporary directory. Enqueue two current `MeetEvent` values, assert that staging files are never returned, assert stable enqueue order, and assert that malformed or stale JSON is removed rather than dispatched.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::event_queue --lib`

Expected: compilation fails because `event_queue` and its queue functions do not exist.

- [x] **Step 3: Implement the minimal queue**

Create `enqueue_in(queue_dir: &Path, event: &MeetEvent) -> Result<PathBuf, EventQueueError>` and `drain_in(queue_dir: &Path, now: DateTime<Utc>) -> Result<Vec<MeetEvent>, EventQueueError>`. Write to `<uuid>.json.staging`, call `sync_all`, rename to `<timestamp>-<uuid>.json`, and read only final `.json` files. Revalidate every event with `MeetEvent::validate(now)`, delete each processed or invalid final file, and prune staging files older than ten minutes.

Expose production wrappers that resolve `std::env::temp_dir()/meetily-google-meet-events-<uid>` on macOS, create it with user-only permissions, and delegate to the testable helpers.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::event_queue --lib`

Expected: all event queue tests pass, or the known local `cidre` static-library blocker is documented while CI remains the Rust execution authority.

### Task 2: Make native-host delivery non-blocking

**Files:**
- Modify: `frontend/src-tauri/src/google_meet/native_host.rs`
- Modify: `frontend/src-tauri/src/google_meet/protocol.rs`

- [x] **Step 1: Write failing delivery and argument tests**

Add a pure `is_pending_event_invocation` test that accepts only `--google-meet-pending`. Add a delivery test with injected queue and launcher closures; assert one enqueue, one launch with the pending flag, an accepted response, and no acknowledgement polling.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::native_host google_meet::protocol --lib`

Expected: compilation fails because the pending invocation and injected delivery seam are absent.

- [x] **Step 3: Implement immediate delivery**

Replace the acknowledgement polling path with `deliver_with(event, enqueue, launch)`. Production delivery calls `event_queue::enqueue`, launches `current_exe()` with `--google-meet-pending` using `Command::arg`, removes the new queue item if launch fails, and immediately returns `NativeHostResponse::accepted(false, env!("CARGO_PKG_VERSION"))` after a successful spawn.

Keep legacy acknowledgement parsing and writing temporarily for compatibility, but do not use it for new native-host deliveries.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::native_host google_meet::protocol --lib`

Expected: new and existing native framing/protocol tests pass, subject only to the documented local `cidre` linker limitation.

### Task 3: Drain queued events in the GUI process

**Files:**
- Modify: `frontend/src-tauri/src/google_meet/commands.rs`
- Modify: `frontend/src-tauri/src/lib.rs`

- [x] **Step 1: Add a testable dispatch seam**

Add `drain_pending_events_with(queue_dir, now, dispatch)` that drains validated events and invokes the supplied closure once per event in queue order. Test two valid events and one malformed item; only the two valid events must reach the closure.

- [x] **Step 2: Verify the test fails**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::commands --lib`

Expected: compilation fails because the drain helper is absent.

- [x] **Step 3: Wire Tauri lifecycle handling**

In the single-instance callback, recognize `--google-meet-pending`, drain the queue, and return without focusing the main window. In setup, recognize the same flag, hide the main window, and drain the queue after managed state exists. Extend the existing coordinator timer to drain pending events once per tick before coordinator decisions.

- [x] **Step 4: Verify focused and complete Google Meet tests**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet --lib`

Expected: all Google Meet unit tests pass in CI; local results must distinguish the known `cidre` environment blocker from test failures.

### Task 4: Bump and verify release 0.4.16

**Files:**
- Modify: `package.json`
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/Cargo.lock`
- Modify: `frontend/src-tauri/tauri.conf.json`

- [x] **Step 1: Change only application version declarations**

Set the application version to `0.4.16` in all existing version sources and update only the root `meetily` package entry in `Cargo.lock`.

- [x] **Step 2: Run local gates**

Run serially:

```bash
./scripts/check-version-consistency.sh
bun test chrome-extension/tests
node --test --test-concurrency=1 scripts/tests/*.test.js
bash scripts/tests/release-preflight.test.sh
git diff --check
```

Expected: all deterministic local gates pass; the live Chrome Store listing test may remain pending only while Google review has not published the listing.

- [ ] **Step 3: Review and commit the exact diff**

Inspect `git status --short`, `git diff --stat`, and `git diff`. Stage only the queue, native-host, lifecycle, version, design, and plan files. Commit with `fix: deliver Google Meet reminders reliably`.

- [ ] **Step 4: Push and release only the verified commit**

Push the exact commit to `origin/main`, dispatch the release workflow for version `0.4.16`, and record the workflow URL. Do not rewrite tag `v0.4.15`.

- [ ] **Step 5: Verify published artifacts and installed behavior**

Confirm tag `v0.4.16` points to the verified commit; verify the DMG, updater archive, signature, `latest.json`, FFmpeg provenance, LGPL text, notices, and checksums with repository scripts. Install through the in-app updater only after recording has stopped, then run the real hidden-app Google Meet acceptance flow and inspect extension badge, prompt, console, and native-host response.
