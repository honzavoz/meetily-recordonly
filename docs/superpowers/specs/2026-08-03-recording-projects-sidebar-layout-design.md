# Recording Projects and Sidebar Row Layout

## Goal

Keep meeting titles readable in the narrow sidebar and allow record-only audio to be organized into projects before transcription. Project assignments made before transcription must automatically carry over to the resulting meeting.

## Sidebar layout

### Meeting Notes

Each meeting row uses three vertical areas:

1. the meeting title at the full available width;
2. the existing date/time subtitle;
3. a compact action row containing assigned project chips or the project picker, rename, and delete.

Actions no longer share the title row. This prevents the title from being compressed into a narrow column. The existing hover treatment may remain for destructive or secondary actions, but project assignment must be discoverable and keyboard accessible.

### To Transcribe

Each pending recording uses the same hierarchy:

1. the recording title;
2. duration, size, and date/time;
3. a compact action row containing the project picker followed by Play, Transcribe, Rename, Open Folder, and Delete.

The recording title and subtitle retain the full width of their content column.

## Persistence

Pending recordings are filesystem-backed and do not yet have a row in the meetings table. Their project assignments are therefore stored in the recording folder's `metadata.json` as stable project identifiers and names.

New Tauri commands read, assign, and remove recording projects using the recording folder path. Writes must use the repository's existing atomic metadata update pattern and preserve all unrelated metadata fields. Commands validate that the target is an existing recording directory.

The pending-recording list includes the stored projects, allowing the sidebar to render assignments without a separate per-row request. Renaming a recording must preserve its project metadata.

## Transfer during transcription

When a pending recording is successfully imported and a database meeting ID has been created, every project stored in its metadata is assigned to that meeting through the existing project repository. Assignment remains idempotent through the unique meeting/project relation.

Projects are transferred before the pending recording is marked imported. If transfer fails, transcription artifacts and the meeting remain intact, the pending item is not silently discarded, and the UI reports an actionable error so the operation can be retried. A successful retry must not create duplicate assignments.

If a referenced project was deleted after it was stored in recording metadata, that stale reference is ignored during transfer and removed from the recording metadata on the next successful write. Real meetings, transcripts, and audio are never deleted as part of project handling.

## State and error handling

The frontend uses optimistic assignment and removal for pending recordings, with rollback and a toast on failure, matching meeting-project behavior. Project creation continues to use the shared create-or-get behavior, then writes the resulting project reference to recording metadata.

Project search and inline creation use the existing `ProjectPicker`. Pending-recording search also matches assigned project names.

## Verification

- Pure frontend tests cover the new row/search mapping and project metadata state helpers.
- Rust tests cover metadata preservation, idempotent assignment/removal, stale references, and transfer to a meeting.
- The migration test confirms no existing meeting data is changed.
- The production frontend build and macOS Tauri build must pass.
- Manual macOS UI verification confirms full-width titles, project assignment in both sections, and transfer after transcription without deleting user data.

## Out of scope

- Showing pending recordings inside All Meetings or project meeting views.
- Creating placeholder meetings before transcription.
- Moving or renaming recording folders when assigning a project.
- Adding project colors, nesting, or bulk assignment.
