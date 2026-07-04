# Transcribe Later Inbox Design

## Goal

Record-only meetings should be easy to find and transcribe later without manually browsing the recording folder or remembering to run Import Audio immediately after recording.

## Behavior

Meetily Record Only - Transcribe Later will show a `To Transcribe` inbox in the sidebar. The inbox is derived from the real recordings folder, not only from volatile session state. On startup and after record-only recording stops, the app scans the configured recordings folder and lists audio files that look like saved recordings and have not already been imported.

The app scans meeting folders under the configured recordings directory. A meeting folder is a directory containing a supported audio file. The preferred audio file is a named file matching the folder name, such as `Meeting 2026-07-04_17-55-31.mp4`. If no named file exists, `audio.mp4` is used as a compatibility fallback. Other supported audio files are listed only when no preferred file is found.

Record-only stop no longer opens the Import Audio dialog automatically. It saves the audio, shows a short success toast, refreshes the inbox, and leaves transcription for later.

Clicking `Transcribe` on an inbox item opens the existing Import Audio dialog with the audio file preselected. The meeting title is prefilled from the folder or file name. Language and model defaults come from the existing persistent Import Audio preferences. After import succeeds, the inbox item is marked imported and removed from `To Transcribe`.

## State

The source of truth is the filesystem. A small app-data index records per-audio status:

- `pending`: discovered by scan and ready to import.
- `imported`: successfully imported into a normal meeting.
- `hidden`: manually dismissed by the user.

Items are identified by `audioPath`, plus file `mtime` and `size` so that a changed file can reappear as pending. If the index is missing or stale, scanning the folder still recovers valid pending recordings.

## UI

The expanded sidebar shows `To Transcribe (N)` above or near the existing meeting list when pending items exist. Each row shows a short recording title and compact actions:

- `Transcribe`: opens Import Audio for that audio file.
- `Open Folder`: opens the recording folder.
- `Hide`: removes the row without deleting the audio file.

The collapsed sidebar shows an import/audio icon with a badge count when pending items exist.

## Error Handling

Unreadable folders or invalid audio files are skipped and logged. If the configured recordings folder is missing, the inbox is empty. If a pending file is deleted before the user clicks `Transcribe`, the app refreshes the inbox and shows a toast. Import failures leave the item pending.

## Tests

Unit tests cover scanner behavior: valid meeting folder detection, preferred audio file selection, imported/hidden filtering, changed-file reappearance, and stable display-title generation. Existing Import Audio preference tests continue to cover persistent language/model defaults. The final verification must include the focused Bun tests, frontend build, GitHub Actions macOS build, and local installed app verification.
