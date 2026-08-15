# Legacy Google Meet Extension Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore automatic Google Meet reminders for users who still have Record Only extension 0.1.0 loaded while preserving the new 0.1.1 Chrome Web Store identity.

**Architecture:** Generate a Chrome native-host manifest with an exact ordered allowlist containing the current Store origin and the project-owned legacy development origin. Keep Store URL and package identity validation tied only to the current ID, then release the compatibility contract as desktop 0.4.17.

**Tech Stack:** Rust, serde_json, Tauri native messaging, Node release tests, Bun Chrome extension tests, GitHub Actions updater release.

---

### Task 1: Encode the exact two-origin native-host contract

**Files:**
- Modify: `frontend/src-tauri/src/google_meet/registration.rs`
- Modify: `frontend/src-tauri/src/google_meet/protocol.rs`

- [ ] **Step 1: Change the registration tests first**

Update `host_manifest_allows_only_the_bundled_extension` to expect both exact origins, using a test-local legacy-origin literal so no production behavior exists before RED. Extend `removes_only_a_manifest_owned_by_this_installation` with missing-origin, reordered-origin, and additional-origin mutations that must all return false.

```rust
const EXPECTED_LEGACY_EXTENSION_ORIGIN: &str =
    "chrome-extension://fonilmfiddnidgjpcijiocffkbbeaddo/";

assert_eq!(
    value["allowed_origins"],
    serde_json::json!([EXTENSION_ORIGIN, EXPECTED_LEGACY_EXTENSION_ORIGIN])
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::registration::tests --lib
```

Expected: `host_manifest_allows_only_the_bundled_extension` fails because the generated manifest contains only the current Store origin.

- [ ] **Step 3: Implement the minimal manifest change**

Add `LEGACY_EXTENSION_ID` and `LEGACY_EXTENSION_ORIGIN`, change `build_host_manifest` to serialize `[EXTENSION_ORIGIN, LEGACY_EXTENSION_ORIGIN]`, and change `manifest_is_owned` to require an array of length two whose entries exactly match that order. Do not change `EXTENSION_ID`, `EXTENSION_ORIGIN`, or `CHROME_WEB_STORE_URL`.

- [ ] **Step 4: Write and verify the legacy invocation RED test**

Extend the existing native-host invocation test in `protocol.rs` to require true for `LEGACY_EXTENSION_ORIGIN` and false for an unrelated extension origin. Run the isolated Google Meet protocol harness and require the legacy assertion to fail because only `EXTENSION_ORIGIN` is currently recognized.

- [ ] **Step 5: Implement the minimal invocation classifier change**

Import `LEGACY_EXTENSION_ORIGIN` beside `EXTENSION_ORIGIN` and recognize either exact value in `is_native_host_invocation`. Do not loosen validation to a prefix or wildcard.

- [ ] **Step 6: Run focused and integration gates**

Run:

```bash
cargo test --manifest-path frontend/src-tauri/Cargo.toml google_meet::registration::tests --lib
cargo check --manifest-path frontend/src-tauri/Cargo.toml --lib
node --test --test-concurrency=1 scripts/tests/*.test.js
bun test chrome-extension/tests
```

Expected: all commands exit zero; Store identity tests continue targeting `mojclipfmoooddobmohinlnlpmnpjmjf`.

- [ ] **Step 7: Commit the compatibility fix**

```bash
git add frontend/src-tauri/src/google_meet/registration.rs frontend/src-tauri/src/google_meet/protocol.rs docs/superpowers/specs/2026-08-15-legacy-meet-extension-compat-design.md docs/superpowers/plans/2026-08-15-legacy-meet-extension-compat.md
git commit -m "fix: accept legacy Meet reminder extension"
```

### Task 2: Apply the compatibility manifest locally and validate delivery

**Files:**
- Modify at runtime: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/cz.honzavoz.meetily.recordonly.google_meet.json`

- [ ] **Step 1: Back up and validate the current manifest**

Require host name `cz.honzavoz.meetily.recordonly.google_meet`, executable `/Applications/Meetily.app/Contents/MacOS/meetily`, type `stdio`, and the current single Store origin. Copy it to `/private/tmp/meetily-native-host-manifest-v0.4.16-before-legacy.json`.

- [ ] **Step 2: Write the two-origin manifest atomically**

Create a mode-0600 staging file beside the manifest, containing the Store origin followed by the legacy origin, then rename it over the validated manifest. Do not restart Chrome or Record Only.

- [ ] **Step 3: Verify old and new origin delivery boundaries**

Run native-messaging framed `integration_ping` events from the legacy and current origins and require `accepted: true`, `recording: false` or the actual current recording state, and `appVersion: 0.4.16`. Confirm no helper process or queued event remains.

- [ ] **Step 4: Validate automatic reminder when safe**

If Record Only is not recording, send one framed `meeting_joined` event from the legacy origin and visually verify the separate reminder window with `Start recording` and `Skip this call`; dismiss with `meeting_left`. If recording is active, do not disturb it and defer only this visual condition until after the recording ends.

### Task 3: Version, release, audit, and install 0.4.17

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `Cargo.lock`
- Create: `docs/superpowers/plans/2026-08-15-legacy-meet-extension-compat.md`

- [ ] **Step 1: Bump every application version source to 0.4.17**

Update the four existing version sources without changing extension version 0.1.1 or FFmpeg version 8.0.3.

- [ ] **Step 2: Run all release gates**

Run:

```bash
./scripts/check-version-consistency.sh
bash scripts/tests/release-preflight.test.sh
node --test --test-concurrency=1 scripts/tests/*.test.js
bun test chrome-extension/tests
cargo check --manifest-path frontend/src-tauri/Cargo.toml --lib
git diff --check
```

Expected: version 0.4.17, Node 39/39 or higher, Chrome 12/12 or higher, release preflight 14/14 or higher, Rust check exit zero, and no whitespace errors.

- [ ] **Step 3: Commit and fast-forward verified main**

```bash
git add frontend/package.json frontend/src-tauri/Cargo.toml frontend/src-tauri/tauri.conf.json Cargo.lock docs/superpowers/plans/2026-08-15-legacy-meet-extension-compat.md
git commit -m "chore: release Record Only 0.4.17"
```

Fast-forward `main`, rerun the full gates on merged main, verify `origin/main` has not moved unexpectedly, and push the exact verified commit.

- [ ] **Step 4: Dispatch and monitor the release workflow**

Dispatch `.github/workflows/release.yml` with `ref: main` using the existing GitHub Keychain credential without logging the token. Require the run `head_sha` to equal the pushed commit and monitor through successful `verify-and-publish`.

- [ ] **Step 5: Audit public artifacts**

Confirm public tag and release target, download the DMG, updater archive, signature, `latest.json`, and all eight FFmpeg LGPL provenance files. Run updater asset verification, FFmpeg checksum/provenance verification, minisign verification, license artifact verification, bundle version/identifier checks, and `codesign --verify --deep --strict`.

- [ ] **Step 6: Install and verify 0.4.17 without losing data**

Wait until no recording is active before replacing `/Applications/Meetily.app`. Preserve an online/checkpointed database backup and rollback app copy, install the verified 0.4.17 bundle, launch it, verify database counts and integrity, verify both allowed native origins, and run framed native-host smoke tests for both identities. Leave only 0.4.17 installed and move the superseded bundle to recoverable Trash after verification.
