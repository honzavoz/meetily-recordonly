# Reliable Summary Saving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual summary saving wait for confirmed SQLite persistence, preserve edits on failure, and prevent stale summary data from overwriting saved edits.

**Architecture:** Add a small frontend persistence module that formats summary payloads, invokes Tauri, and sequences only dirty save operations. Keep editor dirty-state ownership in `BlockNoteSummaryView`, and make the SQLite repository confirm that its summary update matched a row.

**Tech Stack:** React, TypeScript, Bun test, Tauri 2, Rust, SQLx, SQLite

---

### Task 1: Define and test the frontend save contract

**Files:**
- Create: `frontend/src/lib/summary-saving.ts`
- Create: `frontend/tests/lib/summary-saving.test.ts`

- [ ] **Step 1: Write the failing tests**

Create Bun tests that require these behaviors:

```ts
test("persists BlockNote data and returns the exact accepted payload", async () => {
  invokeMock.mockResolvedValueOnce({ message: "saved" });
  const input = { markdown: "edited", summary_json: [{ id: "one", type: "paragraph" }] };

  await expect(persistMeetingSummary("meeting-1", "Title", input)).resolves.toEqual(input);
  expect(invokeMock).toHaveBeenCalledWith("api_save_meeting_summary", {
    meetingId: "meeting-1",
    summary: input,
  });
});

test("propagates Tauri persistence failures", async () => {
  invokeMock.mockRejectedValueOnce(new Error("database locked"));
  await expect(persistMeetingSummary("meeting-1", "Title", { markdown: "edited" }))
    .rejects.toThrow("database locked");
});

test("does not invoke a summary save when the editor is clean", async () => {
  const saveSummary = mock(async () => {});
  await saveDirtyMeetingChanges({
    isTitleDirty: false,
    isSummaryDirty: false,
    saveTitle: mock(async () => {}),
    saveSummary,
  });
  expect(saveSummary).not.toHaveBeenCalled();
});

test("waits for and propagates a dirty summary save failure", async () => {
  const saveSummary = mock(async () => { throw new Error("write failed"); });
  await expect(saveDirtyMeetingChanges({
    isTitleDirty: false,
    isSummaryDirty: true,
    saveTitle: mock(async () => {}),
    saveSummary,
  })).rejects.toThrow("write failed");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontend && pnpm exec bun test tests/lib/summary-saving.test.ts`

Expected: FAIL because `src/lib/summary-saving.ts` does not exist.

- [ ] **Step 3: Implement the minimal persistence module**

Implement:

```ts
export function formatSummaryForSave(summary: SummarySaveInput, meetingTitle: string): SummarySavePayload;
export async function persistMeetingSummary(
  meetingId: string,
  meetingTitle: string,
  summary: SummarySaveInput,
): Promise<SummarySavePayload>;
export async function saveDirtyMeetingChanges(options: SaveDirtyMeetingChangesOptions): Promise<void>;
```

Preserve BlockNote/Markdown payloads exactly. Convert legacy summaries to the existing `MeetingName` and `MeetingNotes.sections` shape. Await the Tauri command and return the formatted payload only after it resolves. Invoke title and summary callbacks only when their dirty flags are true.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd frontend && pnpm exec bun test tests/lib/summary-saving.test.ts`

Expected: all tests pass.

### Task 2: Connect editor state to confirmed persistence

**Files:**
- Modify: `frontend/src/components/AISummary/BlockNoteSummaryView.tsx`
- Modify: `frontend/src/hooks/meeting-details/useMeetingData.ts`
- Modify: `frontend/tests/lib/summary-saving.test.ts`

- [ ] **Step 1: Add failing source-contract assertions**

Add assertions that `BlockNoteSummaryView` declares `onSave` as `Promise<void>`, contains `await onSave(saveData)`, clears dirty state after that await, and does not call `alert`. Assert that `useMeetingData` uses `persistMeetingSummary` and `saveDirtyMeetingChanges`, updates `aiSummary` with the returned payload, and no longer contains the clean-editor fallback `else if (aiSummary)`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd frontend && pnpm exec bun test tests/lib/summary-saving.test.ts`

Expected: FAIL against the current fire-and-forget editor and stale fallback.

- [ ] **Step 3: Implement the editor and hook changes**

Make `onSave` asynchronous. In `handleSave`, await it before `setIsDirty(false)` and let rejection reach `saveAllChanges`; keep `setIsSaving(false)` in `finally`.

Use `persistMeetingSummary` in `handleSaveSummary`, call `setAiSummary(savedPayload as Summary)` only after success, record the error state, and rethrow. Make title persistence throw after recording its error. Use `saveDirtyMeetingChanges` in `saveAllChanges`; do not persist `aiSummary` when the editor is clean.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd frontend && pnpm exec bun test tests/lib/summary-saving.test.ts`

Expected: all tests pass.

### Task 3: Require a matching SQLite summary row

**Files:**
- Modify: `frontend/src-tauri/src/database/repositories/summary.rs`

- [ ] **Step 1: Add failing repository tests**

Extend the test database with a minimal `meetings` table. Add one test that inserts a meeting and summary row, updates it, and reads the new JSON back. Add a second test that inserts only the meeting and expects `update_meeting_summary` to return `false`.

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml database::repositories::summary::tests::update_meeting_summary_returns_false_without_summary_row --locked`

Expected: FAIL because the repository currently returns `true` after an update that affects zero rows.

- [ ] **Step 3: Implement the affected-row check**

Store the `UPDATE summary_processes` result. When `rows_affected() != 1`, roll back and return `Ok(false)`. Commit the transaction only after one summary row and the corresponding meeting timestamp have been updated.

- [ ] **Step 4: Run focused repository tests and verify GREEN**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml database::repositories::summary::tests --locked`

Expected: all summary repository tests pass.

### Task 4: Verify the complete repair

**Files:**
- Review all files changed by Tasks 1 through 3.

- [ ] **Step 1: Format and run focused checks**

Run:

```bash
cargo fmt --manifest-path frontend/src-tauri/Cargo.toml -- --check
cd frontend && pnpm exec bun test tests/lib/summary-saving.test.ts
cargo test --manifest-path frontend/src-tauri/Cargo.toml database::repositories::summary::tests --locked
```

Expected: all commands pass.

- [ ] **Step 2: Run broader regression checks**

Run:

```bash
cd frontend && pnpm exec bun test
cd frontend && pnpm lint
cd frontend && pnpm build
cargo test --manifest-path frontend/src-tauri/Cargo.toml --workspace --locked
git diff --check
```

Expected: all commands pass. If an existing environmental blocker prevents a command, record the exact command and output without claiming that check passed.

- [ ] **Step 3: Inspect the final diff**

Confirm the diff contains no unrelated changes, no swallowed save errors, no clean-editor summary write, and no premature dirty-state reset.

- [ ] **Step 4: Commit the implementation**

```bash
git add frontend/src/lib/summary-saving.ts frontend/tests/lib/summary-saving.test.ts frontend/src/components/AISummary/BlockNoteSummaryView.tsx frontend/src/hooks/meeting-details/useMeetingData.ts frontend/src-tauri/src/database/repositories/summary.rs
git commit -m "fix: make summary saving reliable"
```
