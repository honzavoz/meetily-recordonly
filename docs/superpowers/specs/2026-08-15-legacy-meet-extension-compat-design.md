# Legacy Google Meet Extension Compatibility

Date: 2026-08-15
Status: approved by the request to complete the automatic reminder fix

## Problem

Record Only extension 0.1.0 used the development identity `fonilmfiddnidgjpcijiocffkbbeaddo`. Extension 0.1.1 adopted the Chrome Web Store identity `mojclipfmoooddobmohinlnlpmnpjmjf`, and desktop 0.4.16 writes a native-host manifest that allows only the new origin. A Chrome process that still has the unpacked 0.1.0 extension loaded cannot open the native host, so its `meeting_joined` event never reaches Record Only and no reminder appears.

## Considered approaches

1. Require every user to quit Chrome, remove the old extension, and load 0.1.1. This is fast but fragile and repeats after migrations.
2. Allow the two exact Record Only extension identities during the migration. This fixes existing users without a Chrome restart and keeps the native-messaging boundary explicit. This is the selected approach.
3. Wait for the Store listing and require a Store reinstall. This does not solve the current unpublished-listing state.

## Design

The native-host manifest will contain exactly the current Store origin followed by the legacy development origin. The executable's native-host invocation classifier will recognize those same two exact origins plus the existing explicit `--chrome-native-host` development argument. Both public keys and extension IDs belong to this project; no wildcard or third-party origin is introduced. The Store URL and bundled extension identity remain tied only to the current Store ID.

`manifest_is_owned` will require the exact ordered two-origin allowlist plus the existing host name and executable path. A manifest missing either origin, containing an extra origin, or pointing at another executable will not be considered owned and will not be removed automatically.

The change will be regression-tested in `registration.rs`. Application version 0.4.17 will be released through the existing signed updater workflow. Before the release finishes, the installed manifest may be updated atomically with the same exact two-origin contract so the already-running 0.1.0 extension can connect without restarting Chrome or Record Only.

## Acceptance criteria

- A generated Chrome native-host manifest allows exactly `mojclipfmoooddobmohinlnlpmnpjmjf` and `fonilmfiddnidgjpcijiocffkbbeaddo`.
- Store identity verification continues to target only `mojclipfmoooddobmohinlnlpmnpjmjf`.
- Ownership rejects missing, reordered, or additional origins and a different executable path.
- Native-host dispatch recognizes both project origins and still rejects unrelated Chrome extension origins.
- Existing Rust, Chrome, Node, license, version, and release gates pass.
- The published 0.4.17 updater and installed app pass artifact, signature, license, data-preservation, and native-host checks.
- An old-origin native messaging event is accepted without restarting Chrome, and a non-recording `meeting_joined` event displays the automatic reminder.
