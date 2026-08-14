# Google Meet native delivery queue design

Date: 2026-08-14
Status: approved for implementation from the existing Google Meet reminder authorization

## Goal

Make Chrome Native Messaging acknowledge a validated Google Meet lifecycle event promptly while guaranteeing that the running or newly launched Record Only app can process it without opening or focusing the main window.

## Root cause

The native-host process currently starts a second Record Only process with `--google-meet-event` and waits up to 30 seconds for an acknowledgement file. On macOS, the single-instance handoff can remain blocked until that native-host process exits. The GUI writes a successful acknowledgement only as the host reaches its timeout, so Chrome receives a failure even though the event eventually reaches the app.

Increasing the timeout does not remove the circular wait. A direct socket would work, but adds listener lifecycle, authentication, stale-socket cleanup, and update migration concerns that are unnecessary for a small local event stream.

## Architecture

The native host validates the message exactly as it does today, atomically stores the compact JSON event in a private per-user queue directory, and launches the same executable with a narrow `--google-meet-pending` signal. It returns an accepted native response immediately after the signal process is successfully spawned.

If Record Only is already running, the single-instance callback recognizes the pending signal, drains the queue, and does not focus the main window. If it is not running, normal Tauri setup hides the main window, drains the queue, and starts the coordinator timer. A lightweight timer also drains the queue so a transient single-instance signal failure cannot strand a successfully queued event.

Each queue item has a random UUID filename, is written through a sibling staging file, and is renamed atomically. Queue reads validate the event schema and timestamp again before dispatch. Processed and invalid items are removed; staging files and stale queue items are pruned. The existing coordinator remains responsible for sequence deduplication and reminder policy.

## Native response contract

`accepted: true` means the validated event was durably queued and the app signal process was launched. The response keeps `recording: false` because recording state is not synchronously available in host mode and the extension does not use that field. Reminder suppression still queries the authoritative backend state when the GUI dispatches the event.

If queue creation or process launch fails, the host removes the newly queued item where possible and returns a rejected response. It never invokes a shell and never accepts an arbitrary file path from Chrome.

## Compatibility and migration

The Chrome message schema, native host name, extension identity, and coordinator protocol remain unchanged. Existing `--google-meet-event` and acknowledgement parsing can remain temporarily compatible for already-running older handoff processes, but new native delivery uses only `--google-meet-pending` and the queue.

This behavioral fix must be released as 0.4.16 because public tag 0.4.15 already exists and points to an older commit. Existing application data and updater identity remain unchanged.

## Verification

- Unit tests prove atomic queue round trips, invalid-item cleanup, stable ordering, and pending-signal parsing.
- Native-host delivery tests use a fake executable launcher and prove that delivery no longer waits for a GUI acknowledgement.
- Existing protocol, coordinator, frontend, extension, license, packaging, and release-preflight tests remain green.
- The release artifact must pass the existing license and updater verifiers.
- Final acceptance requires installing 0.4.16 through the in-app updater and joining a real Google Meet call with the app hidden; the large reminder must appear and the extension badge must remain clear.
