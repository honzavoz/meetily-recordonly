# Transcribe Later Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filesystem-backed `To Transcribe` inbox for record-only audio files so recordings can be transcribed later from inside the app.

**Architecture:** The Rust/Tauri layer scans the configured recordings folder and persists a small JSON status index. The frontend consumes the scanner through a focused service and hook, renders pending items in the sidebar, and reuses the existing Import Audio dialog for actual transcription.

**Tech Stack:** Tauri v2, Rust backend commands, Next/React frontend, Bun tests for TypeScript helpers, existing Import Audio flow.

---

### Task 1: Scanner Contract And TypeScript Helpers

**Files:**
- Create: `frontend/src/lib/transcribe-later.ts`
- Test: `frontend/tests/lib/transcribe-later.test.ts`

- [ ] Add tests for choosing display titles, stale item filtering, and pending status semantics.
- [ ] Run `npx --yes bun test frontend/tests/lib/transcribe-later.test.ts` and verify it fails because the helper module does not exist.
- [ ] Implement helper types and functions in `frontend/src/lib/transcribe-later.ts`.
- [ ] Re-run the test and verify it passes.

### Task 2: Backend Scanner And Index Commands

**Files:**
- Modify: `frontend/src-tauri/src/commands/config.rs`
- Modify: `frontend/src-tauri/src/lib.rs`
- Modify or create adjacent backend module if the command layout requires it.

- [ ] Add Tauri commands `list_pending_recordings_to_transcribe`, `mark_recording_transcribed`, and `hide_recording_from_transcribe_later`.
- [ ] Scan the configured recordings folder for meeting subdirectories containing supported audio files.
- [ ] Prefer a named audio file matching the folder name, then `audio.mp4`, then the first supported audio file.
- [ ] Persist status in app data as `transcribe_later_index.json`.
- [ ] Register the commands in the Tauri command handler.

### Task 3: Frontend Service And Hook

**Files:**
- Create: `frontend/src/services/transcribeLaterService.ts`
- Create: `frontend/src/hooks/useTranscribeLaterRecordings.ts`

- [ ] Wrap the new Tauri commands in a typed service.
- [ ] Add a hook that loads pending recordings, exposes refresh, transcribe, hide, and open-folder actions, and dispatches a window event when Import Audio should open.
- [ ] Keep import failures pending by marking imported only from Import Audio completion.

### Task 4: Sidebar Inbox UI

**Files:**
- Modify: `frontend/src/components/Sidebar/index.tsx`
- Modify: `frontend/src/app/layout.tsx`

- [ ] Render `To Transcribe (N)` in the expanded sidebar when pending recordings exist.
- [ ] Render row actions for `Transcribe`, `Open Folder`, and `Hide`.
- [ ] Show a collapsed badge/icon when pending recordings exist.
- [ ] Listen for import completion and mark the source audio imported before refreshing the inbox.

### Task 5: Record-Only Stop Flow

**Files:**
- Modify: `frontend/src/hooks/useRecordingStop.ts`

- [ ] Remove automatic `open-record-only-import` dispatch after record-only stop.
- [ ] Replace the toast copy with a saved/ready-to-transcribe message.
- [ ] Dispatch a lightweight refresh event for the `To Transcribe` inbox.

### Task 6: Verification, Build, And Install

**Files:**
- No new source files unless verification exposes a bug.

- [ ] Run focused Bun tests.
- [ ] Run `pnpm build` in `frontend`.
- [ ] Commit implementation.
- [ ] Push to `record-only-mode` and `main`.
- [ ] Run GitHub Actions macOS release unsigned build.
- [ ] Download the artifact and install `/Applications/Meetily Record Only - Transcribe Later.app`.
- [ ] Verify app metadata and `codesign --verify --deep --strict`.
