# External AI Summary Persistence Design

## Problem

External AI results are saved through the same Tauri command as edited summaries. The repository currently runs only an `UPDATE summary_processes`, so saving fails for a valid record-only meeting that has never generated an internal summary and therefore has no `summary_processes` row. Version 0.4.8 correctly surfaced that zero-row update as an error instead of reporting a false success.

There is a second persistence defect on the read path. `api_get_summary` uses a repository query that inner-joins `summary_processes` to `transcript_chunks`. A manually saved External AI result for a meeting without transcript chunks would consequently appear missing after the meeting is reopened.

## Required behavior

- A valid meeting can save a manual or External AI summary even when it has no summary-process row.
- Saving creates at most one summary-process row per meeting and stores the JSON atomically with the meeting timestamp update.
- Saving an existing summary updates its result without creating a duplicate.
- A newly created manual summary is immediately readable with status `completed`.
- Reading a stored summary does not require transcript chunks.
- Saving for a nonexistent meeting still fails without leaving orphan data.
- Existing internally generated summaries and regeneration state continue to use the same schema.

## Design

### Atomic upsert

Keep the existence check and transaction in `SummaryProcessesRepository::update_meeting_summary`. Replace the update-only statement with an SQLite upsert keyed by `meeting_id`:

- insert a missing row with `status = 'completed'`, the serialized result, and creation/update timestamps;
- on conflict, update `result` and `updated_at` only, preserving the existing process status and generation metadata;
- update the parent meeting timestamp in the same transaction;
- reject a nonexistent meeting before attempting the upsert.

Preserving process metadata on the conflict path matches the pre-existing edit behavior and avoids broadening this repair into generation-state changes.

### Transcript-independent read

Make `get_summary_data_for_meeting` query `summary_processes` directly by meeting ID. Summary ownership is already represented by the primary key and parent meeting check; transcript chunks are not a prerequisite for manually supplied notes.

No schema migration is required because the existing table already contains every needed column and `meeting_id` is unique.

## Error handling and compatibility

Serialization errors and SQL errors continue to propagate through the Tauri command. A missing parent meeting returns `false`, which the command turns into a save error. Existing summaries retain their result shape, so both Markdown and BlockNote rendering remain unchanged.

## Tests

Repository regression tests will prove:

- a valid meeting without a summary row gets a completed row with the exact JSON result;
- an existing row is updated without duplication and keeps its established status;
- a summary is readable without any transcript chunk;
- a nonexistent meeting is rejected and creates no summary row.

Verification will run the focused Rust tests, formatting, frontend summary-saving tests, the available frontend regression suite/build, release preflight checks, and diff inspection. The published build will then be checked through the normal signed updater release path.

## Scope

This repair changes only summary persistence and retrieval semantics plus the application patch release. It does not migrate existing data, generate transcripts, or redesign the External AI workflow.
