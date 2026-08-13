# Google Meet Recording Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect an active Google Meet call in Chrome on macOS and show a one-click Meetily recording reminder without collecting meeting content.

**Architecture:** A Manifest V3 extension converts Google Meet DOM state into a minimal session lifecycle and sends it through Chrome Native Messaging. Meetily validates those events in a pre-Tauri host mode, forwards them through its single-instance channel, and owns deduplication plus a dedicated always-on-top reminder webview. The existing frontend recording start and Rust stop/post-processing paths remain the only recording workflows.

**Tech Stack:** Chrome Manifest V3, JavaScript modules, Bun tests, Rust/Tauri 2, Next.js 14, React 18, TypeScript, macOS Chrome Native Messaging.

---

## File map

### Chrome extension

- Create `chrome-extension/manifest.json`: permissions, fixed development key, content script, and service worker.
- Create `chrome-extension/src/protocol.js`: event constants and serialization shared by detector and service worker.
- Create `chrome-extension/src/detector.js`: URL and DOM-signal classifier with stable transition handling.
- Create `chrome-extension/src/content.js`: MutationObserver, heartbeat, and content-to-worker messages.
- Create `chrome-extension/src/service-worker.js`: native host calls, badge status, and bounded retry.
- Create `scripts/build-chrome-extension.ts`: bundle module-based sources into Chrome-compatible extension files.
- Create `chrome-extension/tests/detector.test.ts`: English/Czech lifecycle fixtures and false-positive cases.
- Create `chrome-extension/tests/service-worker.test.ts`: native messaging success and failure behavior.

### Rust backend

- Create `frontend/src-tauri/src/google_meet/mod.rs`: module exports and shared constants.
- Create `frontend/src-tauri/src/google_meet/protocol.rs`: validated protocol types.
- Create `frontend/src-tauri/src/google_meet/native_host.rs`: native-message framing and GUI process delivery.
- Create `frontend/src-tauri/src/google_meet/registration.rs`: extension copy, host manifest registration, and status.
- Create `frontend/src-tauri/src/google_meet/coordinator.rs`: session state and prompt policy.
- Create `frontend/src-tauri/src/google_meet/window.rs`: reminder window creation and typed payload emission.
- Create `frontend/src-tauri/src/google_meet/commands.rs`: Tauri commands for setup and reminder actions.
- Modify `frontend/src-tauri/src/main.rs`: branch into native-host mode before logger/Tauri startup.
- Modify `frontend/src-tauri/src/lib.rs`: manage coordinator, accept launch/single-instance events, and register commands.
- Modify `frontend/src-tauri/src/tray.rs`: expose the existing stop-and-post-process operation without forcing the main window forward.
- Modify `frontend/src-tauri/tauri.conf.json`: bundle the extension and add reminder-window capabilities.

### Frontend

- Create `frontend/src/lib/google-meet-reminder.ts`: frontend protocol types and operation gate.
- Create `frontend/src/app/google-meet-reminder/page.tsx`: compact start/stop reminder route.
- Create `frontend/src/components/GoogleMeetReminderSettings.tsx`: install, enable, status, and test controls.
- Modify `frontend/src/components/PreferenceSettings.tsx`: mount the new settings section.
- Modify `frontend/src/hooks/useRecordingStart.ts`: report reminder-owned start success or failure.
- Create `frontend/tests/lib/google-meet-reminder.test.ts`: UI state/gate contracts.
- Create `frontend/tests/lib/google-meet-recording-bridge.test.ts`: source-session handoff contracts.

### Build and documentation

- Create `scripts/verify-chrome-extension.js`: validate packaged files and privacy-sensitive permissions.
- Modify `.github/workflows/release.yml`: run extension tests and package verification before release creation.
- Modify `docs/BUILDING.md`: pilot extension installation and acceptance test.

---

### Task 1: Define the extension protocol and active-call detector

**Files:**
- Create: `chrome-extension/src/protocol.js`
- Create: `chrome-extension/src/detector.js`
- Create: `chrome-extension/tests/detector.test.ts`

- [ ] **Step 1: Write failing detector tests**

Create fixtures with a real Meet path and localized leave buttons:

```ts
import { describe, expect, test } from 'bun:test';
import { classifyMeetPage, MeetLifecycle } from '../src/detector.js';

describe('Google Meet detector', () => {
  test.each([
    ['Leave call', 'https://meet.google.com/abc-defg-hij'],
    ['Opustit hovor', 'https://meet.google.com/abc-defg-hij'],
  ])('recognizes active call label %s', (label, url) => {
    expect(classifyMeetPage(new URL(url), [label]))
      .toBe(MeetLifecycle.Joined);
  });

  test.each([
    ['https://meet.google.com/', ['Leave call']],
    ['https://meet.google.com/abc-defg-hij', ['Join now']],
    ['https://example.com/abc-defg-hij', ['Leave call']],
  ])('does not classify non-call state %s', (url, labels) => {
    expect(classifyMeetPage(new URL(url), labels)).toBe(MeetLifecycle.NotJoined);
  });
});
```

- [ ] **Step 2: Run the detector test and verify failure**

Run: `bun test chrome-extension/tests/detector.test.ts`

Expected: FAIL because `chrome-extension/src/detector.js` does not exist.

- [ ] **Step 3: Implement the minimal protocol and detector**

```js
// chrome-extension/src/protocol.js
export const PROTOCOL_VERSION = 1;
export const NATIVE_HOST = 'cz.honzavoz.meetily.recordonly.google_meet';
export const MeetEvent = Object.freeze({
  Joined: 'meeting_joined',
  Left: 'meeting_left',
  Heartbeat: 'heartbeat',
});

export function createMeetEvent(event, sessionId, sequence, occurredAt = new Date()) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
    event,
    sessionId,
    sequence,
    occurredAt: occurredAt.toISOString(),
  };
}
```

```js
// chrome-extension/src/detector.js
export const MeetLifecycle = Object.freeze({ Joined: 'joined', NotJoined: 'not_joined' });
const CALL_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\/|$)/i;
const LEAVE_LABELS = new Set(['leave call', 'opustit hovor']);

export function classifyMeetPage(url, controlLabels) {
  if (url.origin !== 'https://meet.google.com' || !CALL_PATH.test(url.pathname)) {
    return MeetLifecycle.NotJoined;
  }
  return controlLabels.some((label) => LEAVE_LABELS.has(label.trim().toLocaleLowerCase('en-US')))
    ? MeetLifecycle.Joined
    : MeetLifecycle.NotJoined;
}
```

- [ ] **Step 4: Run focused and full Bun tests**

Run: `bun test chrome-extension/tests/detector.test.ts && bun test`

Expected: detector tests pass; existing 125 tests remain green.

- [ ] **Step 5: Commit the detector**

```bash
git add chrome-extension/src/protocol.js chrome-extension/src/detector.js chrome-extension/tests/detector.test.ts
git commit -m "feat: detect active Google Meet calls"
```

### Task 2: Add stable lifecycle observation and Native Messaging service worker

**Files:**
- Create: `chrome-extension/manifest.json`
- Create: `chrome-extension/src/content.js`
- Create: `chrome-extension/src/service-worker.js`
- Create: `chrome-extension/tests/service-worker.test.ts`
- Create: `scripts/build-chrome-extension.ts`

- [ ] **Step 1: Write failing service-worker tests**

Expose a dependency-injected `sendToNative(sendNativeMessage, payload)` function and test one retry only:

```ts
import { expect, test } from 'bun:test';
import { sendToNative } from '../src/service-worker.js';

test('returns the accepted native response', async () => {
  const calls: unknown[] = [];
  const response = await sendToNative(async (_host, payload) => {
    calls.push(payload);
    return { accepted: true, recording: false, appVersion: '0.4.13' };
  }, { event: 'meeting_joined' });
  expect(response.accepted).toBe(true);
  expect(calls).toHaveLength(1);
});

test('retries a missing host once', async () => {
  let calls = 0;
  await expect(sendToNative(async () => {
    calls += 1;
    throw new Error('Specified native messaging host not found.');
  }, { event: 'meeting_joined' })).rejects.toThrow('native messaging host');
  expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `bun test chrome-extension/tests/service-worker.test.ts`

Expected: FAIL because `sendToNative` is missing.

- [ ] **Step 3: Implement content lifecycle ownership**

`content.js` must:

```js
import { classifyMeetPage, MeetLifecycle } from './detector.js';
import { createMeetEvent, MeetEvent } from './protocol.js';

const STABILITY_MS = 3000;
const HEARTBEAT_MS = 60000;
let sessionId = null;
let sequence = 0;
let stableState = MeetLifecycle.NotJoined;
let candidateState = stableState;
let candidateSince = Date.now();

function emit(event) {
  sequence += 1;
  chrome.runtime.sendMessage(createMeetEvent(event, sessionId, sequence));
}

function reconcile(now = Date.now()) {
  const labels = [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
    .map((node) => node.getAttribute('aria-label') ?? '');
  const next = classifyMeetPage(new URL(location.href), labels);
  if (next !== candidateState) {
    candidateState = next;
    candidateSince = now;
    return;
  }
  if (next === stableState || now - candidateSince < STABILITY_MS) return;
  stableState = next;
  if (next === MeetLifecycle.Joined) {
    sessionId = crypto.randomUUID();
    sequence = 0;
    emit(MeetEvent.Joined);
  } else if (sessionId) {
    emit(MeetEvent.Left);
    sessionId = null;
  }
}

new MutationObserver(() => reconcile()).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
setInterval(reconcile, 1000);
setInterval(() => sessionId && emit(MeetEvent.Heartbeat), HEARTBEAT_MS);
```

- [ ] **Step 4: Implement the bounded service worker**

```js
import { NATIVE_HOST } from './protocol.js';

export async function sendToNative(sendNativeMessage, payload) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await sendNativeMessage(NATIVE_HOST, payload);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

if (typeof chrome !== 'undefined') {
  chrome.runtime.onMessage.addListener((payload, sender, sendResponse) => {
    sendToNative(chrome.runtime.sendNativeMessage.bind(chrome.runtime), payload)
      .then((response) => {
        chrome.action.setBadgeText({ text: response.accepted ? '' : '!' });
        sendResponse(response);
      })
      .catch((error) => {
        chrome.action.setBadgeText({ text: '!' });
        sendResponse({ accepted: false, errorCode: 'native_host_unavailable', message: String(error) });
      });
    return true;
  });
}
```

Create a Manifest V3 source manifest with only `nativeMessaging`, `storage`, and `https://meet.google.com/*`. Generate one RSA key pair with `openssl genrsa`; put the base64 DER public key in the manifest's `key` field and keep the temporary private key outside the repository. The manifest references bundled `content.js` and `service-worker.js`, with the worker declared as `"type": "module"`.

Create `scripts/build-chrome-extension.ts` using `Bun.build` with `src/content.js` and `src/service-worker.js` as entrypoints, browser target, minification disabled, and `chrome-extension/dist` as an atomically replaced output directory. Copy `manifest.json` after bundling. This removes unsupported static imports from the content script while keeping source modules testable.

- [ ] **Step 5: Verify extension tests and manifest privacy**

Run: `bun test chrome-extension/tests && bun scripts/build-chrome-extension.ts && bun -e "const m=require('./chrome-extension/dist/manifest.json'); if(m.permissions.some(p=>['tabs','history','microphone','camera','clipboardRead'].includes(p))) process.exit(1)"`

Expected: all extension tests pass and the permission assertion exits 0.

- [ ] **Step 6: Commit the extension runtime**

```bash
git add chrome-extension scripts/build-chrome-extension.ts
git commit -m "feat: send Google Meet lifecycle events"
```

### Task 3: Implement native-message framing and validation in Rust

**Files:**
- Create: `frontend/src-tauri/src/google_meet/mod.rs`
- Create: `frontend/src-tauri/src/google_meet/protocol.rs`
- Create: `frontend/src-tauri/src/google_meet/native_host.rs`
- Modify: `frontend/src-tauri/src/main.rs`
- Modify: `frontend/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests for framing and schema validation**

Add unit tests that build little-endian frames and assert:

```rust
#[test]
fn reads_one_valid_native_message() {
    let json = br#"{"protocolVersion":1,"extensionVersion":"0.1.0","event":"meeting_joined","sessionId":"550e8400-e29b-41d4-a716-446655440000","sequence":1,"occurredAt":"2026-08-13T12:00:00Z"}"#;
    let mut frame = (json.len() as u32).to_le_bytes().to_vec();
    frame.extend_from_slice(json);
    let event = read_message(&mut frame.as_slice()).unwrap();
    assert_eq!(event.sequence, 1);
}

#[test]
fn rejects_messages_over_16_kib() {
    let mut frame = (16_385_u32).to_le_bytes().to_vec();
    frame.resize(16_389, b'x');
    assert!(matches!(read_message(&mut frame.as_slice()), Err(NativeHostError::TooLarge)));
}
```

Add protocol tests for unknown versions/events, malformed UUIDs, zero sequence, and timestamps outside a ten-minute clock-skew window.

- [ ] **Step 2: Run focused Rust tests and verify failure**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet --lib`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement protocol types and validation**

Use serde field renames matching the extension:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MeetEventKind { MeetingJoined, MeetingLeft, Heartbeat }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetEvent {
    pub protocol_version: u8,
    pub extension_version: String,
    pub event: MeetEventKind,
    pub session_id: Uuid,
    pub sequence: u64,
    pub occurred_at: DateTime<Utc>,
}

impl MeetEvent {
    pub fn validate(&self, now: DateTime<Utc>) -> Result<(), ProtocolError> {
        if self.protocol_version != 1 { return Err(ProtocolError::UnsupportedVersion); }
        if self.sequence == 0 { return Err(ProtocolError::InvalidSequence); }
        if (now - self.occurred_at).num_minutes().abs() > 10 { return Err(ProtocolError::StaleTimestamp); }
        Ok(())
    }
}
```

- [ ] **Step 4: Implement native framing and pre-Tauri host mode**

`native_host::run()` reads one frame, validates it, spawns `current_exe()` with `--google-meet-event` and compact JSON as separate arguments, writes one framed `NativeHostResponse`, flushes stdout, and exits. It must use `Command::arg`, never a shell.

Change `main.rs` before logger setup:

```rust
fn main() {
    if std::env::args().any(|arg| arg == "--chrome-native-host") {
        std::process::exit(app_lib::google_meet::native_host::run_stdio());
    }
    std::env::set_var("RUST_LOG", "info");
    env_logger::init();
    app_lib::run();
}
```

- [ ] **Step 5: Run Rust tests**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet --lib`

Expected: all protocol and native-host tests pass.

- [ ] **Step 6: Commit framing and validation**

```bash
git add frontend/src-tauri/src/main.rs frontend/src-tauri/src/lib.rs frontend/src-tauri/src/google_meet
git commit -m "feat: validate Chrome native messages"
```

### Task 4: Install the extension and register the macOS native host

**Files:**
- Create: `frontend/src-tauri/src/google_meet/registration.rs`
- Create: `frontend/src-tauri/src/google_meet/commands.rs`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing registration tests**

Test pure helpers for the host manifest and copied paths:

```rust
#[test]
fn host_manifest_allows_only_meetily_extension() {
    let value = build_host_manifest(Path::new("/Applications/Meetily.app/Contents/MacOS/meetily"));
    assert_eq!(value["name"], NATIVE_HOST_NAME);
    assert_eq!(value["type"], "stdio");
    assert_eq!(value["allowed_origins"].as_array().unwrap().len(), 1);
    assert!(value["path"].as_str().unwrap().ends_with("/meetily"));
}
```

Use a temporary directory to prove that extension replacement writes a sibling staging directory and renames it, leaving no partial destination.

- [ ] **Step 2: Run registration tests and verify failure**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::registration --lib`

Expected: FAIL because registration helpers are missing.

- [ ] **Step 3: Implement registration and commands**

Implement:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleMeetIntegrationStatus {
    pub enabled: bool,
    pub extension_path: Option<String>,
    pub native_host_registered: bool,
    pub last_seen_at: Option<DateTime<Utc>>,
}

#[tauri::command]
pub async fn install_google_meet_integration(app: AppHandle) -> Result<GoogleMeetIntegrationStatus, String>;

#[tauri::command]
pub async fn set_google_meet_integration_enabled(app: AppHandle, enabled: bool) -> Result<GoogleMeetIntegrationStatus, String>;

#[tauri::command]
pub async fn get_google_meet_integration_status(app: AppHandle) -> Result<GoogleMeetIntegrationStatus, String>;
```

On macOS, write the host manifest to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/cz.honzavoz.meetily.recordonly.google_meet.json`. Store integration preferences in `google_meet_integration.json`. Reject removal if the existing host manifest does not contain Meetily's host name and current executable path.

- [ ] **Step 4: Bundle extension resources**

Change `tauri.conf.json` resources to map `../../chrome-extension/dist` into `chrome-extension` while retaining `templates/*.json`. Change `beforeBuildCommand` to run `bun ../scripts/build-chrome-extension.ts` before the Next.js build. Add only the permissions needed by the reminder webview.

- [ ] **Step 5: Run tests and Tauri config validation**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::registration --lib && cd frontend && bunx tauri info`

Expected: tests pass and Tauri parses the config without errors.

- [ ] **Step 6: Commit registration**

```bash
git add frontend/src-tauri/src/google_meet frontend/src-tauri/src/lib.rs frontend/src-tauri/tauri.conf.json
git commit -m "feat: register Meetily Chrome integration"
```

### Task 5: Add the session coordinator and reminder window lifecycle

**Files:**
- Create: `frontend/src-tauri/src/google_meet/coordinator.rs`
- Create: `frontend/src-tauri/src/google_meet/window.rs`
- Modify: `frontend/src-tauri/src/google_meet/mod.rs`
- Modify: `frontend/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing coordinator tests**

Cover these transitions with a fake clock:

```rust
#[test]
fn joined_session_prompts_at_most_twice() {
    let mut coordinator = Coordinator::default();
    let id = Uuid::new_v4();
    assert_eq!(coordinator.accept(joined(id, 1), false, at(0)), Decision::ShowStart);
    assert_eq!(coordinator.accept(heartbeat(id, 2), false, at(10)), Decision::None);
    assert_eq!(coordinator.tick(false, at(50)), vec![Decision::ShowStart]);
    assert!(coordinator.tick(false, at(500)).is_empty());
}

#[test]
fn stop_prompt_requires_reminder_owned_recording() {
    let mut coordinator = Coordinator::default();
    let id = Uuid::new_v4();
    coordinator.accept(joined(id, 1), false, at(0));
    coordinator.mark_recording_started(id).unwrap();
    assert_eq!(coordinator.accept(left(id, 2), true, at(30)), Decision::ShowStop);
}
```

Also test skip, non-increasing sequence rejection, sequence gaps, six-hour expiry, already-recording suppression, and heartbeat repair.

- [ ] **Step 2: Run coordinator tests and verify failure**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::coordinator --lib`

Expected: FAIL because coordinator types are missing.

- [ ] **Step 3: Implement coordinator decisions**

Keep the coordinator pure and synchronous. Its public API must be:

```rust
pub enum Decision { None, ShowStart { session_id: Uuid, attempt: u8 }, Hide, ShowStop { session_id: Uuid } }

impl Coordinator {
    pub fn accept(&mut self, event: MeetEvent, recording: bool, now: DateTime<Utc>) -> Result<Decision, CoordinatorError>;
    pub fn tick(&mut self, recording: bool, now: DateTime<Utc>) -> Vec<Decision>;
    pub fn skip(&mut self, session_id: Uuid) -> Result<(), CoordinatorError>;
    pub fn mark_recording_started(&mut self, session_id: Uuid) -> Result<(), CoordinatorError>;
    pub fn keep_recording(&mut self, session_id: Uuid) -> Result<(), CoordinatorError>;
}
```

- [ ] **Step 4: Implement the dedicated webview window**

Create or reuse `google-meet-reminder` with `WebviewUrl::App("google-meet-reminder".into())`, size `380x210`, no decorations, no resize, no taskbar entry, and always-on-top. Emit a `google-meet-reminder-state` payload after the page reports `google-meet-reminder-ready`. Hide instead of destroying it so repeated prompts do not rebuild the webview.

Spawn one coordinator timer during Tauri setup. Every second it calls `tick` with the backend recording state, hides a start prompt after 20 seconds, and permits the second prompt 30 seconds later. Store the timer handle once so setup or a second-instance event cannot start another loop.

- [ ] **Step 5: Run coordinator and existing window lifecycle tests**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet --lib && bun test frontend/tests/lib/window-close-lifecycle.test.ts`

Expected: all pass.

- [ ] **Step 6: Commit coordinator and window**

```bash
git add frontend/src-tauri/src/google_meet frontend/src-tauri/src/lib.rs
git commit -m "feat: coordinate Google Meet reminders"
```

### Task 6: Deliver launch and single-instance events without focusing the main window

**Files:**
- Modify: `frontend/src-tauri/src/lib.rs`
- Modify: `frontend/src-tauri/src/google_meet/commands.rs`
- Test: `frontend/src-tauri/src/google_meet/coordinator.rs`

- [ ] **Step 1: Write failing argument-routing tests**

Extract `parse_google_meet_event_arg(args: &[String]) -> Result<Option<MeetEvent>, ProtocolError>` and test normal launch, second instance, unrelated args, and malformed JSON.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml parse_google_meet_event_arg --lib`

Expected: FAIL because the parser is missing.

- [ ] **Step 3: Implement no-focus routing**

Update the single-instance closure:

```rust
tauri_plugin_single_instance::init(|app, args, cwd| {
    match google_meet::protocol::parse_google_meet_event_arg(&args) {
        Ok(Some(event)) => google_meet::commands::dispatch_event(app.clone(), event),
        Ok(None) => tray::focus_main_window(app),
        Err(error) => log::warn!("Rejected Google Meet event: {error}"),
    }
})
```

During setup, parse the initial process args, hide the main window before it becomes visible for a reminder-launched app, then dispatch after the coordinator is managed.

- [ ] **Step 4: Verify argument routing and app startup tests**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet --lib`

Expected: all tests pass.

- [ ] **Step 5: Commit event delivery**

```bash
git add frontend/src-tauri/src/lib.rs frontend/src-tauri/src/google_meet
git commit -m "feat: deliver Meet events to running app"
```

### Task 7: Build the reminder UI with guarded actions

**Files:**
- Create: `frontend/src/lib/google-meet-reminder.ts`
- Create: `frontend/src/app/google-meet-reminder/page.tsx`
- Create: `frontend/tests/lib/google-meet-reminder.test.ts`

- [ ] **Step 1: Write failing frontend state tests**

```ts
import { expect, test } from 'bun:test';
import { ReminderOperationGate, reduceReminderState } from '../../src/lib/google-meet-reminder';

test('operation gate blocks concurrent starts', async () => {
  const gate = new ReminderOperationGate();
  let resolve!: () => void;
  const pending = gate.run(() => new Promise<void>((done) => { resolve = done; }));
  expect(gate.run(async () => undefined)).toBeNull();
  resolve();
  await pending;
});

test('failed action preserves a retryable prompt', () => {
  const state = reduceReminderState({ kind: 'start', phase: 'running', sessionId: 'x' }, { type: 'failed', message: 'Microphone unavailable' });
  expect(state).toEqual({ kind: 'start', phase: 'error', sessionId: 'x', message: 'Microphone unavailable' });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `bun test frontend/tests/lib/google-meet-reminder.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement typed state and operation gate**

Define `ReminderPayload`, `ReminderState`, `ReminderAction`, `reduceReminderState`, and a gate that releases in `finally`.

- [ ] **Step 4: Implement the reminder route**

The page listens for `google-meet-reminder-state`, emits `google-meet-reminder-ready`, and renders:

- start: `Google Meet is in progress`, `Start recording`, `Skip this call`;
- stop: `Google Meet ended`, `Stop and save`, `Keep recording`;
- running: disabled buttons and inline progress;
- error: the exact normalized backend message plus `Try again` and `Open Meetily`.

Every action must await its Tauri command. The page must not import meeting, transcript, or analytics data.

- [ ] **Step 5: Run focused tests, lint, and production build**

Run: `bun test frontend/tests/lib/google-meet-reminder.test.ts && cd frontend && bun run lint && bun run build`

Expected: test passes; lint has zero errors; build succeeds and includes `/google-meet-reminder`.

- [ ] **Step 6: Commit reminder UI**

```bash
git add frontend/src/lib/google-meet-reminder.ts frontend/src/app/google-meet-reminder/page.tsx frontend/tests/lib/google-meet-reminder.test.ts
git commit -m "feat: add Google Meet reminder window"
```

### Task 8: Bridge reminder actions into existing recording workflows

**Files:**
- Modify: `frontend/src-tauri/src/google_meet/commands.rs`
- Modify: `frontend/src-tauri/src/tray.rs`
- Modify: `frontend/src/hooks/useRecordingStart.ts`
- Create: `frontend/tests/lib/google-meet-recording-bridge.test.ts`

- [ ] **Step 1: Write failing source-session tests**

Extract helpers that store and consume a reminder start source:

```ts
test('consumes a Google Meet session exactly once', () => {
  const storage = new MapStorage();
  storeGoogleMeetStart(storage, '550e8400-e29b-41d4-a716-446655440000');
  expect(consumeGoogleMeetStart(storage)).toBe('550e8400-e29b-41d4-a716-446655440000');
  expect(consumeGoogleMeetStart(storage)).toBeNull();
});
```

- [ ] **Step 2: Run bridge tests and verify failure**

Run: `bun test frontend/tests/lib/google-meet-recording-bridge.test.ts`

Expected: FAIL because bridge helpers are missing.

- [ ] **Step 3: Implement one-click start handoff**

`start_google_meet_recording(session_id)` validates coordinator state, evaluates these assignments in the hidden main webview, and returns only after scheduling succeeds:

```js
sessionStorage.setItem('googleMeetStartSession', sessionId);
sessionStorage.setItem('autoStartRecording', 'true');
window.location.assign('/');
```

`useRecordingStart` consumes `googleMeetStartSession` only for the auto-start attempt. On success it invokes `complete_google_meet_recording_start`; on every model/device/permission/backend failure it invokes `fail_google_meet_recording_start` with the normalized error. The reminder closes only on the success command.

- [ ] **Step 4: Implement stop-and-save reuse**

Extract tray's current stop plus `recording-stop-complete` emission into:

```rust
pub async fn stop_recording_and_post_process<R: Runtime>(app: AppHandle<R>) -> Result<(), String>
```

Call it from both tray handlers and `stop_google_meet_recording`. Do not focus the main window for the reminder command. Mark ownership complete only after the backend stop succeeds.

- [ ] **Step 5: Run bridge, recording, and Rust tests**

Run: `bun test frontend/tests/lib/google-meet-recording-bridge.test.ts frontend/tests/lib/recording-mode.test.ts && cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet --lib`

Expected: all pass.

- [ ] **Step 6: Commit recording integration**

```bash
git add frontend/src-tauri/src/google_meet frontend/src-tauri/src/tray.rs frontend/src/hooks/useRecordingStart.ts frontend/src/lib/google-meet-reminder.ts frontend/tests/lib/google-meet-recording-bridge.test.ts
git commit -m "feat: start Meetily from Google Meet reminder"
```

### Task 9: Add integration settings and setup status

**Files:**
- Create: `frontend/src/components/GoogleMeetReminderSettings.tsx`
- Modify: `frontend/src/components/PreferenceSettings.tsx`
- Modify: `frontend/src-tauri/src/google_meet/commands.rs`
- Test: `frontend/tests/lib/google-meet-reminder.test.ts`

- [ ] **Step 1: Extend failing tests for status mapping**

Test `Not installed`, `Connected`, and `Needs attention` from explicit backend status fields. Test that a failed install reverts the switch and preserves the error.

- [ ] **Step 2: Run the test and verify failure**

Run: `bun test frontend/tests/lib/google-meet-reminder.test.ts`

Expected: FAIL for missing status mapping.

- [ ] **Step 3: Implement settings component**

The component loads `get_google_meet_integration_status`, invokes installation from an explicit button, and toggles via `set_google_meet_integration_enabled`. `Test reminder` invokes `show_google_meet_test_reminder`; it never starts recording.

The disable command must close the reminder window, clear coordinator sessions, and remove only a host manifest whose parsed name and executable path belong to this Meetily installation. It leaves the Chrome extension directory intact so re-enabling does not require another `Load unpacked` action.

Mount it immediately below the existing Notifications card in `PreferenceSettings`.

- [ ] **Step 4: Implement Finder and Chrome setup actions**

After copying files and registering the host, use argument-safe `Command::new("open")` calls to reveal the extension directory and open `chrome://extensions` in Google Chrome. Return the exact extension directory in status so the UI can display it.

- [ ] **Step 5: Run tests, lint, and build**

Run: `bun test frontend/tests/lib/google-meet-reminder.test.ts && cd frontend && bun run lint && bun run build`

Expected: zero test failures, zero lint errors, successful build.

- [ ] **Step 6: Commit settings**

```bash
git add frontend/src/components/GoogleMeetReminderSettings.tsx frontend/src/components/PreferenceSettings.tsx frontend/src-tauri/src/google_meet/commands.rs frontend/tests/lib/google-meet-reminder.test.ts
git commit -m "feat: configure Google Meet reminders"
```

### Task 10: Add packaging and release gates

**Files:**
- Create: `scripts/verify-chrome-extension.js`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/BUILDING.md`
- Modify: `scripts/tests/release-preflight.test.sh`

- [ ] **Step 1: Add failing release-preflight assertions**

Require the release workflow to run:

```sh
bun test chrome-extension/tests
bun scripts/build-chrome-extension.ts
node scripts/verify-chrome-extension.js chrome-extension/dist
```

before the Tauri build or draft release step.

- [ ] **Step 2: Run preflight and verify failure**

Run: `bash scripts/tests/release-preflight.test.sh`

Expected: FAIL because the Chrome extension checks are absent.

- [ ] **Step 3: Implement deterministic package verification**

The verifier parses `manifest.json`, asserts Manifest V3, exact host match, exact permissions, fixed `key`, required files, and no remote script URLs or `eval(` calls. It exits non-zero with a specific filename and rule.

- [ ] **Step 4: Update release workflow and building guide**

Run extension checks before packaging. Document the one-time pilot installation, extension badge states, native-host manifest path, uninstall behavior, and six-step real-call acceptance test from the design.

- [ ] **Step 5: Run all release checks**

Run: `bun scripts/build-chrome-extension.ts && node scripts/verify-chrome-extension.js chrome-extension/dist && bash scripts/tests/release-preflight.test.sh && ./scripts/check-version-consistency.sh`

Expected: verifier passes, all release preflight scenarios pass, and versions remain consistent.

- [ ] **Step 6: Commit packaging gates**

```bash
git add scripts/verify-chrome-extension.js scripts/tests/release-preflight.test.sh .github/workflows/release.yml docs/BUILDING.md
git commit -m "ci: verify bundled Chrome reminder extension"
```

### Task 11: Run complete verification and macOS acceptance

**Files:**
- Modify only if a verification failure exposes a scoped defect.

- [ ] **Step 1: Run all automated tests**

Run:

```bash
bun test
cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib
cd frontend && bun run lint && bun run build
```

Expected: all Bun and Rust tests pass, lint reports zero errors, production build succeeds.

- [ ] **Step 2: Build the macOS application**

Run: `cd frontend && bun run tauri:build:metal`

Expected: `.app`, `.dmg`, and updater artifacts include `Resources/chrome-extension` and the binary supports `--chrome-native-host` framing.

- [ ] **Step 3: Test Native Messaging without Chrome**

Pipe one valid little-endian framed event to the packaged binary in native-host mode. Decode its framed stdout response and assert `accepted: true`. Confirm no meeting URL or code appears in logs.

- [ ] **Step 4: Install the local app and extension**

Back up the current `/Applications/Meetily.app`, install the new build, launch it, select `Install Chrome extension`, load the revealed folder from `chrome://extensions`, and confirm settings show `Connected`.

- [ ] **Step 5: Run a real Google Meet acceptance test**

Join a disposable Meet call in Chrome with Meetily hidden. Confirm one reminder appears after three stable seconds, starts recording with one click, suppresses duplicates, prompts to stop on leave, and saves a playable recording. Confirm the pre-existing SQLite meetings remain present; the count may increase by one when the selected recording mode persists a meeting.

- [ ] **Step 6: Test recovery and update behavior**

Repeat with Meetily not running, with `Skip this call`, and after replacing the app bundle at the same path. Confirm the native host path stays valid, the extension reconnects, and no black main window or duplicate reminder appears.

- [ ] **Step 7: Final repository and privacy audit**

Run:

```bash
git status --short --branch
rg -n "meet\.google\.com|participant|caption|chat|meetingCode|meetingUrl" chrome-extension frontend/src-tauri/src/google_meet frontend/src/app/google-meet-reminder
```

Expected: clean worktree after commits; matches contain only host permission, detector URL checks, and tests proving that sensitive fields are absent.
