# Google Meet recording reminder design

Date: 2026-08-13
Status: approved direction, implementation pending written-spec review

## Goal

Meetily should remind a macOS user to start recording after they join a Google Meet call in Google Chrome. The reminder must work while the Meetily window is hidden, avoid duplicate prompts, and require an explicit click before recording starts.

The first release targets Google Chrome on macOS. It does not read participant names, meeting titles, chat, captions, audio, or video from Google Meet.

## User flow

1. The user selects `Install Chrome extension` in Meetily. Meetily registers its Chrome native-messaging host and copies the bundled Chrome extension to a stable application-support directory.
2. The user installs the extension once from the folder opened by Meetily. A later Chrome Web Store listing can replace this pilot installation flow without changing the app protocol.
3. A content script on `https://meet.google.com/*` watches the page for the controls that indicate an active call.
4. After the active-call state remains stable for three seconds, the extension sends a `meeting_joined` event to Meetily.
5. If Meetily is not recording, it opens a compact reminder window above Chrome. The window says `Google Meet is in progress` and offers `Start recording` and `Skip this call`.
6. `Start recording` invokes the existing Meetily recording-start path with the user's selected devices and recording mode. The reminder closes only after the backend confirms that recording started. A start failure stays visible with the existing actionable error.
7. `Skip this call` suppresses further start reminders for that browser session.
8. If the user does not act, the reminder hides after 20 seconds and appears once more after 30 seconds. It does not appear a third time.
9. When the call ends, the extension sends `meeting_left`. If Meetily is recording a session started from this reminder, it shows a second compact prompt: `Google Meet ended. Stop recording?` with `Stop and save` and `Keep recording`.

Meetily never starts or stops recording solely because the extension emitted an event.

## Chosen architecture

### Chrome extension

The repository will contain a Manifest V3 extension under `chrome-extension/` with three focused units:

- `content/detector.ts` owns Google Meet DOM observation and emits only state transitions.
- `background/service-worker.ts` owns native messaging, retry limits, and extension status.
- `shared/protocol.ts` defines and validates the messages shared with the native host.

The content script uses a `MutationObserver` plus a low-frequency reconciliation timer. Detection requires a real meeting path and an active-call control. The detector supports English and Czech accessibility labels through a versioned signal table. It does not depend on generated CSS class names. A three-second stability window filters page transitions and waiting-room mutations.

The detector creates a random session ID for each joined-call lifecycle. It sends this ID, the event type, extension version, and protocol version. It does not send the Meet code or URL.

### Native messaging bridge

The extension communicates through Chrome Native Messaging. The host manifest:

- uses the name `cz.honzavoz.meetily.recordonly.google_meet`;
- allows only the fixed extension origin;
- lives in Chrome's per-user `NativeMessagingHosts` directory on macOS;
- points to the current Meetily executable path.

Meetily's executable will support a narrow `--chrome-native-host` mode before Tauri starts. This mode reads one length-prefixed JSON message from stdin, rejects oversized or invalid input, launches or signals the GUI process with a validated event, writes one response, and exits. It never accepts shell fragments or arbitrary arguments from the extension.

The existing single-instance path will forward validated events to the running GUI without opening the main window. If Meetily is not running, the bridge launches it in the background and delivers the event after setup.

### Reminder coordinator

A Rust `GoogleMeetReminderCoordinator` owns session state independently of the web UI. For each session it tracks:

- joined or left state;
- prompt count and last prompt time;
- skipped state;
- whether the reminder started the current recording;
- the last accepted sequence number.

The coordinator asks the recording backend for its current state before showing a prompt. Repeated or reordered events remain idempotent. It expires abandoned sessions after six hours and stores no meeting history in SQLite.

### Reminder window

Tauri's desktop notification actions are unavailable on macOS, so the feature will use a dedicated `google-meet-reminder` webview window. It is small, always on top, non-resizable, absent from the Dock, and shown without bringing the main Meetily window forward. The window contains no meeting metadata.

The renderer receives a typed event from Rust and can invoke only four commands:

- `start_google_meet_recording`
- `skip_google_meet_session`
- `stop_google_meet_recording`
- `keep_google_meet_recording`

Rust checks the session ID and current recording state again before each action. The window shows a busy state during start or stop and preserves the error when an operation fails.

## Settings and installation

Settings > General will gain a `Google Meet reminders` section with:

- an enable switch, turned on after the extension setup succeeds;
- connection status: `Not installed`, `Connected`, or `Needs attention`;
- `Install Chrome extension`, which copies the bundled extension to the app-support directory, opens that directory in Finder, and opens `chrome://extensions`;
- `Test reminder` for checking the overlay without starting a recording.

Meetily refreshes the copied extension files atomically when the bundled version changes. The stable directory and fixed extension key preserve the extension ID across app updates. The repository contains only the public extension key. A Chrome Web Store release remains a separate publishing task because it requires a store account and review.

The native host registration occurs only when the user enables the feature. Disabling it closes active reminder windows, clears coordinator state, and removes the host manifest that Meetily owns. It does not uninstall the extension from Chrome.

## Event protocol

Extension-to-host messages use this shape:

```json
{
  "protocolVersion": 1,
  "extensionVersion": "0.1.0",
  "event": "meeting_joined",
  "sessionId": "random-uuid",
  "sequence": 1,
  "occurredAt": "2026-08-13T12:00:00.000Z"
}
```

Accepted events are `meeting_joined`, `meeting_left`, and `heartbeat`. The host response contains `accepted`, the app version, recording state, and a machine-readable error code when rejected. No message may exceed 16 KiB even though Chrome allows larger native messages.

## Failure handling

- Missing native host: the extension badge shows `!`; the service worker retries once and then waits for the next state transition or a manual retry.
- Meetily launch failure: the extension reports `Meetily unavailable` without retrying in a loop.
- Extension disconnect during a call: a heartbeat every 60 seconds repairs missed join state. It does not create another prompt for the same session.
- Google Meet DOM change: the detector reports `unknown` and does not guess. The extension badge explains that call detection needs an update.
- Recording already active: Meetily acknowledges the event and shows no start reminder.
- Device, permission, or model error: the overlay displays the backend error and offers `Open Meetily`; the session remains eligible for a manual retry.
- App update during a call: the coordinator state is transient. A post-update heartbeat can create at most one new prompt.

## Privacy and security

- The content script runs only on `https://meet.google.com/*`.
- The extension requests `nativeMessaging`, `storage`, and the Google Meet host permission. It requests no browsing-history, tabs, microphone, camera, or clipboard permission.
- The detector converts DOM state into a boolean lifecycle before messaging. Raw DOM text never leaves the page.
- Chrome validates the extension origin against the native host's `allowed_origins` list.
- The native host validates message type, schema, version, length, UUID, sequence, and timestamp before launching or signaling Meetily.
- Meetily does not persist Google Meet session identifiers or include them in analytics.
- Recording still requires the user's explicit click and follows the existing local permission checks.

## Testing

### Extension tests

- English and Czech joined-call fixtures produce one `meeting_joined` transition.
- Lobby, home page, pre-join screen, post-call page, and unrelated Meet pages produce no joined transition.
- DOM churn within the stability window produces no event.
- Join, leave, and rejoin create distinct ordered lifecycles.
- The service worker handles missing-host, timeout, malformed-response, and reconnect cases without loops.

### Rust tests

- Native message framing accepts valid input and rejects truncated, oversized, unknown-version, and malformed messages.
- Event validation rejects stale timestamps, invalid UUIDs, repeated or decreasing sequence numbers, and unknown events. It accepts sequence gaps so a dropped native message cannot deadlock the session.
- Coordinator tests cover deduplication, two-prompt limit, skip, expiry, already-recording behavior, and ownership of stop reminders.
- A second Meetily process forwards an event to the existing instance without focusing the main window.

### Frontend tests

- Reminder actions wait for backend completion and keep errors visible.
- The start prompt cannot issue concurrent recording requests.
- The stop prompt appears only for a recording started by the matching reminder session.
- Settings status and setup instructions match native registration state.

### macOS acceptance test

1. Install Meetily and load the bundled extension in Chrome.
2. Hide the Meetily window and join a real Google Meet call.
3. Confirm the overlay appears once, starts recording, and does not expose meeting metadata.
4. Leave the call and confirm `Stop and save` produces a valid recording.
5. Repeat with Meetily not running and confirm the bridge launches it in the background.
6. Repeat after an in-app update and confirm native host registration, extension connection, and reminder behavior still work.

## Release scope

The first release includes the macOS app changes, the bundled unpacked extension, setup UI, automated tests, and a signed updater release. Chrome Web Store publication is excluded because it requires an external developer account and review. Windows and Linux reminder support are excluded until the macOS workflow passes real-call acceptance testing.
