# Summary Generation Queue Design

## Problem

Summary generation currently spawns one background task per request. There is no application-level queue or concurrency limit. The frontend can track polling intervals for different meetings, but navigating away stops the current meeting's poll while its backend task continues.

Repeated requests for the same meeting are unsafe. Both tasks share the meeting ID as their process ID, reset the same `summary_processes` row, replace the same cancellation token, and race to write the final result. The last completion wins, and cancellation can target or clean up the wrong task.

Different meetings are also not coordinated. HTTP providers receive concurrent requests without an application limit. Built-in AI shares one sidecar whose stdin and stdout are locked separately; concurrent callers are not guaranteed to retain request-response ownership, and changing models can restart a sidecar used by another request.

## Required behavior

- At most one summary job runs in the application at a time.
- Additional jobs wait in first-in, first-out order.
- A meeting can have at most one reserved, queued, or running job.
- Every accepted job has a unique job ID independent of the meeting ID.
- Queue and running state remain visible when the user navigates between meetings.
- Queued jobs show their current position; the running job shows `Generating`.
- Cancelling a queued job removes only that job and updates later positions.
- Cancelling the running job stops only that job and starts the next queued job.
- A rapid double click or repeated backend call never starts or resets a second job for the same meeting.
- Existing summary backup/restore behavior remains intact for regeneration, failure, and cancellation.
- Jobs interrupted by a real application exit or crash are recovered safely on the next launch rather than appearing permanently active.

## Architecture

### Backend queue manager

Add a single process-wide `SummaryQueueManager` with a small, testable state machine:

- a FIFO deque of job IDs;
- a map from job ID to meeting ID, cancellation token, and lifecycle state;
- a reverse map from meeting ID to its active job ID;
- at most one running job;
- a notification mechanism that wakes waiters when the front job completes or is cancelled.

The manager owns ordering, duplicate prevention, queue positions, cancellation routing, and guarded cleanup. Job payloads remain owned by their spawned tasks. A task cannot begin processing until the manager grants it the running slot.

The queue capacity is one running job with no small arbitrary waiting limit. This is deliberately provider-independent: built-in AI, Ollama, Custom OpenAI, and cloud providers all get deterministic behavior and cannot overload a local endpoint or external rate limit through this application.

### Reservation and enqueue transaction

`api_process_transcript` performs these steps in order:

1. Reserve the meeting in the queue manager and allocate a UUID job ID.
2. If the meeting is already active, return its existing job ID and state without resetting the database or spawning another task.
3. Initialize/reset `summary_processes` and save transcript input.
4. Commit the reservation as queued and spawn the waiting task.
5. If database initialization fails, release the reservation so the user can retry.

This ordering makes the backend authoritative against double clicks and concurrent callers. The response distinguishes a newly queued job from an already-active one and includes job ID, state, and queue position.

### Job lifecycle

`summary_processes.status` remains the persisted meeting-level status:

- `PENDING`: accepted and queued;
- `processing`: owns the running slot;
- `completed`, `failed`, or `cancelled`: terminal.

When a task reaches the front, the queue manager marks it running and the repository changes the persisted status to `processing` before any model call. The existing summary service then runs unchanged under that granted slot. Terminal database handling is followed by guarded queue cleanup using both meeting ID and job ID, so an older task can never remove newer state.

Queue payloads are not persisted separately. Transcript input is already stored in `transcript_chunks`, while prompts, templates, and provider settings may be sensitive or change over time. On startup, stale `PENDING` or `processing` rows are marked failed with an interruption message through the existing backup restoration semantics. The user can then retry explicitly with current settings.

### Cancellation

Cancellation accepts the meeting ID and optionally the job ID returned by enqueue. The backend resolves the exact active job:

- reserved or queued: cancel its token, remove it from FIFO, restore the prior summary, mark it cancelled, and wake the next waiter;
- running: cancel its token; the active provider call exits through the existing cancellation path, restores the prior summary, releases the slot, and wakes the next waiter;
- stale or mismatched job ID: return a non-destructive `not_active` result.

Cancellation registration happens before a task waits, not after it starts. This makes queued jobs cancellable and prevents one task from replacing another task's token.

## Frontend state and UI

Replace callback-owned polling with global summary job state in the existing top-level sidebar context or a focused provider owned at the same lifetime. It stores job ID, meeting ID, backend state, queue position, and error.

Polling is global and remains alive across meeting navigation. The meeting summary hook derives its status from the global entry instead of maintaining an isolated lifecycle that resets on unmount. On completion, the active meeting reloads its persisted summary; other meetings show their terminal state and load normally when opened.

User-facing behavior:

- the current meeting panel shows `Queued · position N`, `Generating`, `Cancelling`, or a terminal result;
- sidebar meeting rows with active jobs show a compact queued position or spinner;
- Generate changes immediately to Stop/Cancel after reservation;
- a repeated Generate action reports that the meeting is already queued or running and does not create another toast sequence or analytics start event;
- cancelling a queued item updates all displayed positions on the next poll.

The frontend may keep an immediate in-flight ref to suppress accidental double clicks, but it is only a usability optimization. Backend reservation remains the correctness boundary.

## Error handling

- Queue reservation failure does not touch SQLite.
- Database setup failure releases the reservation and returns an actionable error.
- Failure to mark a granted job `processing` terminates that job, releases the slot, and advances the queue.
- Provider failure uses the existing failed-result and summary-backup restoration path.
- Polling failures do not cancel backend jobs; the UI reports connection loss and retries with bounded backoff.
- A worker panic or unexpected task exit must release the running slot through an RAII-style guard and mark the job failed when possible.
- Application startup recovers stale persisted jobs before accepting new work.

## Tests

### Backend unit and repository tests

- jobs start strictly in FIFO order;
- no more than one job owns the running slot;
- a duplicate meeting reservation returns the existing job and does not enqueue twice;
- cancelling the middle queued job removes only it and recomputes positions;
- cancelling the running job grants the next job;
- cleanup with an old or mismatched job ID cannot remove current meeting state;
- persisted status changes from `PENDING` to `processing` to a terminal state;
- interrupted startup recovery restores backups and removes stale active statuses.

### Command and frontend tests

- two near-simultaneous Generate calls for one meeting produce one backend job;
- three meetings display positions and advance after completion/cancellation;
- navigating between meetings preserves queued/running state and polling;
- returning to a running meeting resumes the correct UI without starting a job;
- frontend cancellation targets the exact job ID;
- completed jobs reload the correct meeting summary.

### Release verification

Run the complete frontend suite, queue-focused Rust tests, repository tests, formatting, lint, production build, version consistency, and release preflight. Manually exercise same-meeting double click, three-meeting FIFO order, queued cancellation, running cancellation, navigation, and restart recovery with built-in AI and the configured Custom OpenAI provider.

## Scope

This change adds one global FIFO queue, durable meeting-level statuses, global UI tracking, cancellation safety, tests, and a patch release. It does not add configurable parallelism, job history, automatic retries, priority reordering, or automatic resume after restart. Those can be added later without changing the queue contract.
