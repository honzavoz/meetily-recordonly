# Reliable Summary Saving Design

## Problem

The summary editor reports success before SQLite confirms the write. `BlockNoteSummaryView` invokes its asynchronous `onSave` callback without awaiting it and clears its dirty state immediately. `useMeetingData.handleSaveSummary` catches persistence errors instead of returning them to `saveAllChanges`, so the UI can display `Changes saved successfully` after a failed write.

The frontend also keeps the pre-edit summary in `aiSummary`. A later Save with no editor changes writes that stale value back to the database. The repository method returns success when the target meeting exists even if no matching `summary_processes` row was updated.

## Required behavior

- Save must remain in progress until SQLite confirms the summary write.
- The editor may clear its dirty state only after a successful write.
- A failed write must keep the edited content visible and dirty, and the UI must show an error instead of a success toast.
- A successful write must replace the local `aiSummary` value with the saved payload.
- Save must not write an unchanged stale summary merely because a summary exists.
- The backend must reject a summary update when no `summary_processes` row matches the meeting.
- Existing title saving and legacy-summary formatting must continue to work.

## Design

### Editor contract

Change `BlockNoteSummaryView.onSave` to return `Promise<void>`. `handleSave` awaits it before clearing `isDirty`. It lets persistence errors propagate to `saveAllChanges`, which owns the user-facing toast.

### Meeting state and orchestration

`handleSaveSummary` formats the payload, awaits the Tauri command, then updates `aiSummary` with the value SQLite accepted. It rethrows failures.

`saveAllChanges` saves only dirty resources. It will not send `aiSummary` when neither the title nor editor changed. A title failure also prevents the success toast.

The existing Save button remains disabled and shows `Saving...` while the operation runs.

### Backend confirmation

`SummaryProcessesRepository::update_meeting_summary` checks `rows_affected()` from the `UPDATE summary_processes` result. It rolls back and returns `false` when the row does not exist. The Tauri command already converts `false` into an error, so the frontend receives the failure through the same asynchronous chain.

## Error handling

One layer owns each responsibility:

- the repository confirms whether SQLite changed a row;
- the Tauri command returns success or an error;
- `handleSaveSummary` updates local state on success and rethrows on failure;
- `saveAllChanges` shows one success or error toast;
- the editor preserves unsaved content until the full chain succeeds.

No alert and success toast should compete for the same operation.

## Tests

Frontend regression coverage will verify these contracts:

- the editor awaits `onSave` before clearing dirty state;
- a rejected save remains dirty and rejects to the caller;
- `handleSaveSummary` propagates persistence failures and synchronizes the saved payload;
- Save does not rewrite an unchanged stale summary.

Rust repository tests will cover a successful update and the missing-summary-row case. The final verification will run the focused frontend tests, focused Rust tests, the broader frontend test suite, lint/type or build checks available in the repository, and `git diff --check`.

## Scope

This change keeps manual Save and the current summary schema. It does not add autosave, version history, or change summary generation.
