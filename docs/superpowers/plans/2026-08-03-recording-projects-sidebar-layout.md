# Recording Projects and Sidebar Row Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sidebar titles readable and let pending record-only audio carry project assignments into the meeting created by transcription.

**Architecture:** Store pending-recording project references in each recording folder's existing `metadata.json`, expose them through focused Tauri commands and the pending-recording list, then reuse the existing project picker and project repository. Pass the completed import's meeting ID through the dialog callback so a single backend transfer command can idempotently attach valid projects before the pending item is marked imported.

**Tech Stack:** Rust, Tauri 2, serde_json, sqlx/SQLite, React 18, TypeScript, Next.js 14, Tailwind CSS, Node test runner.

---

### Task 1: Recording project metadata model

**Files:**
- Modify: `frontend/src-tauri/src/audio/transcribe_later.rs`
- Test: Rust unit tests inside `frontend/src-tauri/src/audio/transcribe_later.rs`

- [ ] **Step 1: Write failing metadata tests**

Add tests that create a temporary recording folder with unrelated metadata, call the planned metadata helpers, and assert:

```rust
assert_eq!(read_recording_projects(dir.path()).unwrap(), vec![project.clone()]);
assert_eq!(saved["custom_field"], serde_json::json!("preserved"));
assert_eq!(saved["projects"].as_array().unwrap().len(), 1);
```

Cover idempotent assignment, removal, a missing metadata file, malformed project entries, and rejection of a non-directory target.

- [ ] **Step 2: Run the focused Rust tests and verify failure**

Run:

```bash
cd frontend/src-tauri
cargo test audio::transcribe_later::tests::recording_projects --lib
```

Expected: compilation failure because the project metadata helpers and type do not exist. If local compilation is blocked by Command Line Tools, record the exact blocker and require GitHub macOS CI for the Rust gate.

- [ ] **Step 3: Implement the metadata helpers**

Add a serializable reference that matches the frontend project shape:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingProject {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
}
```

Implement `read_recording_projects`, `write_recording_projects`, `assign_recording_project`, and `remove_recording_project`. Use a temporary file beside `metadata.json` followed by `fs::rename`, preserve unrelated JSON keys, deduplicate by project ID, and sort by display name.

- [ ] **Step 4: Include projects in pending recording scans**

Extend `TranscribeLaterRecording` with:

```rust
pub projects: Vec<RecordingProject>,
```

Populate it in `scan_recordings_folder` from `metadata.json`, defaulting safely to an empty vector.

- [ ] **Step 5: Run formatter and focused tests**

Run:

```bash
mise exec rust@stable -- rustfmt frontend/src-tauri/src/audio/transcribe_later.rs
cd frontend/src-tauri && cargo test audio::transcribe_later::tests::recording_projects --lib
```

Expected: formatting succeeds; tests pass locally or the previously documented full-Xcode blocker recurs before project code compiles.

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/src/audio/transcribe_later.rs
git commit -m "feat: persist projects on pending recordings"
```

### Task 2: Tauri commands and meeting transfer

**Files:**
- Modify: `frontend/src-tauri/src/audio/transcribe_later.rs`
- Modify: `frontend/src-tauri/src/lib.rs`
- Test: Rust unit tests inside `frontend/src-tauri/src/audio/transcribe_later.rs`

- [ ] **Step 1: Write failing transfer tests**

Create an in-memory SQLite database using the project repository test schema. Store two valid project references plus one stale ID in recording metadata, transfer them to a meeting, and assert:

```rust
assert_eq!(ProjectRepository::list_for_meeting(&pool, meeting_id).await?.len(), 2);
transfer_recording_projects(&pool, dir.path(), meeting_id).await?;
assert_eq!(ProjectRepository::list_for_meeting(&pool, meeting_id).await?.len(), 2);
```

Also assert stale IDs do not fail the transfer and are removed from the rewritten metadata.

- [ ] **Step 2: Run the focused Rust test and verify failure**

Run the same focused cargo test command. Expected: failure because transfer and commands are missing.

- [ ] **Step 3: Implement commands**

Expose these commands:

```rust
assign_transcribe_later_recording_project(folder_path, project_id)
remove_transcribe_later_recording_project(folder_path, project_id)
transfer_transcribe_later_recording_projects(folder_path, meeting_id)
```

Assignment loads the authoritative project from `ProjectRepository` before writing metadata. Transfer validates the meeting, ignores missing projects, calls the existing idempotent assignment method, rewrites only valid references, and returns the transferred projects.

- [ ] **Step 4: Register the commands**

Add all three functions to `tauri::generate_handler!` in `frontend/src-tauri/src/lib.rs`.

- [ ] **Step 5: Run checks**

Run `rustfmt` on only the two touched Rust files, then the focused cargo test. Expected: pass or the documented local Xcode blocker.

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/src/audio/transcribe_later.rs frontend/src-tauri/src/lib.rs
git commit -m "feat: transfer recording projects to meetings"
```

### Task 3: Frontend recording project state

**Files:**
- Modify: `frontend/src/lib/transcribe-later.ts`
- Modify: `frontend/src/services/transcribeLaterService.ts`
- Modify: `frontend/src/hooks/useTranscribeLaterRecordings.ts`
- Modify: `frontend/tests/lib/transcribe-later.test.mjs`

- [ ] **Step 1: Write failing helper tests**

Extend the pending-recording fixtures with `projects` and assert search matches a project name while unrelated queries return no result:

```javascript
assert.deepEqual(
  filterTranscribeLaterRecordings([recording], 'povolstav').map(({ id }) => id),
  [recording.id],
);
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node --test frontend/tests/lib/transcribe-later.test.mjs
```

Expected: the project-name query returns an empty array.

- [ ] **Step 3: Add types and service calls**

Add `projects: Project[]` to `TranscribeLaterRecording`. Add service methods invoking the three new commands, including:

```ts
transferProjects(recording: TranscribeLaterRecording, meetingId: string): Promise<Project[]>
```

- [ ] **Step 4: Add optimistic hook actions**

Expose `assignProject`, `removeProject`, and `createAndAssignProject` from `useTranscribeLaterRecordings`. Update the selected recording in state immediately, call the service, and restore the previous array plus show an actionable toast on failure. Use `projectService.createProject` for create-or-get.

- [ ] **Step 5: Include project names in pending search**

Append `...(recording.projects ?? []).map(project => project.name)` to the helper's searchable text.

- [ ] **Step 6: Run tests and frontend build**

Run:

```bash
node --test frontend/tests/lib/transcribe-later.test.mjs
cd frontend && pnpm build
```

Expected: all helper tests and the production build pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/transcribe-later.ts frontend/src/services/transcribeLaterService.ts frontend/src/hooks/useTranscribeLaterRecordings.ts frontend/tests/lib/transcribe-later.test.mjs
git commit -m "feat: add pending recording project state"
```

### Task 4: Transfer projects after successful import

**Files:**
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/components/ImportAudio/ImportAudioDialog.tsx`
- Modify: `frontend/src/hooks/useImportAudio.ts`

- [ ] **Step 1: Preserve the import result through callbacks**

Change callback types from `() => void` to:

```ts
onComplete?: (result: ImportResult) => void | Promise<void>;
```

Pass the exact listener payload through `ImportAudioDialog` to the layout callback rather than discarding it.

- [ ] **Step 2: Transfer before marking imported**

Change `handleImportComplete` to accept `ImportResult`, then execute:

```ts
await transcribeLaterService.transferProjects(transcribeLaterImport, result.meeting_id);
await transcribeLaterService.markTranscribed(transcribeLaterImport);
```

If transfer fails, keep the recording visible in To Transcribe and explain that the meeting and audio are safe. Only mark imported after transfer succeeds.

- [ ] **Step 3: Run type/build verification**

Run `cd frontend && pnpm build`. Expected: TypeScript and production build pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/layout.tsx frontend/src/components/ImportAudio/ImportAudioDialog.tsx frontend/src/hooks/useImportAudio.ts
git commit -m "feat: carry recording projects through transcription"
```

### Task 5: Reflow meeting and recording sidebar rows

**Files:**
- Modify: `frontend/src/components/Sidebar/index.tsx`
- Modify: `frontend/src/components/Projects/ProjectPicker.tsx`
- Modify: `frontend/src/components/Projects/ProjectChips.tsx`

- [ ] **Step 1: Reflow meeting rows**

Keep icon plus content in the first structural row, but make the content column contain title, date, and a separate action row. Move `ProjectPicker`, rename, and delete below the date. Render assigned `ProjectChips` before the picker so the current classification remains visible.

- [ ] **Step 2: Reflow pending recording rows**

Keep the recording title and metadata as full-width lines. In the third line render `ProjectChips`, a compact `ProjectPicker`, then Play, Transcribe, Rename, Open Folder, and Delete. Connect picker callbacks to the optimistic hook actions.

- [ ] **Step 3: Keep narrow-sidebar behavior usable**

Allow action rows to wrap, keep touch targets at least 28px, add specific `aria-label` values, and ensure row click handlers do not fire when an action or picker is used.

- [ ] **Step 4: Run production build**

Run `cd frontend && pnpm build`. Expected: compilation, lint/type checking, and static generation pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar/index.tsx frontend/src/components/Projects/ProjectPicker.tsx frontend/src/components/Projects/ProjectChips.tsx
git commit -m "fix: keep sidebar titles readable"
```

### Task 6: Full verification and macOS delivery

**Files:**
- Modify only if a verification failure proves a scoped fix is required.

- [ ] **Step 1: Run focused and regression checks**

Run:

```bash
./scripts/check-version-consistency.sh
bash scripts/tests/meeting-projects-migration.test.sh
node --test frontend/tests/lib/meeting-projects.test.mjs frontend/tests/lib/transcribe-later.test.mjs
cd frontend && pnpm build
git diff --check
```

Expected: all tests pass, build exits zero, and no whitespace errors exist.

- [ ] **Step 2: Push an isolated branch and run macOS CI**

Push the implementation branch and dispatch `.github/workflows/build-macos.yml` as an unsigned Apple Silicon release with artifacts enabled. Expected: the exact branch SHA completes successfully.

- [ ] **Step 3: Inspect and run the artifact**

Download the artifact, confirm `CFBundleShortVersionString`, launch that exact `.app`, and verify:

- meeting title and date remain full width;
- meeting actions sit below the date;
- pending recording can receive and remove a project;
- pending recording search finds a project name;
- a controlled transcription carries the project into Meeting Notes;
- existing recordings, meetings, transcripts, and summaries remain present.

- [ ] **Step 4: Integrate only the verified SHA**

Fast-forward `main`, push, and confirm local `HEAD` equals `origin/main` with a clean working tree.
