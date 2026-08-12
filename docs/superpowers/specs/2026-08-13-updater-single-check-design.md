# Reliable In-App Updater Design

## Problem

Meetily can successfully discover an update and then show `Failed to prepare update: Unknown error` before downloading it. The released 0.4.10 updater archive, manifest, minisign signature, application version, and macOS code signature have all been verified independently, so the published artifact is not the failing boundary.

The frontend currently performs two independent updater checks:

1. `UpdateService.checkForUpdates()` calls Tauri `check()` and reduces the returned `Update` resource to display-only metadata.
2. When `UpdateDialog` opens, it calls `check()` again to obtain another `Update` resource.

The second network request is unnecessary. If it fails, the already successful result cannot be used. Tauri may also reject with a string rather than an `Error`, while the dialog only reads `err.message`, which replaces the useful failure text with `Unknown error`.

## Goals

- One user-initiated or automatic check creates both the displayed metadata and the exact Tauri `Update` resource used for installation.
- Opening the update dialog does not perform another network request.
- Download and installation errors retain their real message regardless of the thrown JavaScript value shape.
- A lost or stale prepared resource can be recovered through one explicit retry without creating concurrent checks.
- Dismissing and reopening the dialog keeps the prepared update usable while it remains current.
- The shipped fix is verified through a real installed-app update, not only unit tests or release assets.

## Non-Goals

- Replacing the Tauri updater plugin.
- Adding background installation without user action.
- Changing GitHub as the update distribution provider.
- Changing meeting data, recordings, summaries, or their storage.

## Design

### Prepared update result

`UpdateService.checkForUpdates()` will retain the successful Tauri `Update` resource and return an `UpdateInfo` object that includes it as an opaque optional `preparedUpdate` field. Display metadata remains unchanged.

The service remains the only code responsible for calling Tauri `check()`. It continues to serialize checks with the existing `updateCheckInProgress` guard.

### Dialog lifecycle

`UpdateDialog` receives `UpdateInfo` and initializes its local resource from `updateInfo.preparedUpdate`. Opening the dialog only resets visual progress and errors; it does not call Tauri `check()`.

When the user selects `Download & Install`, the dialog uses that exact prepared resource. If the resource is absent, it requests one fresh forced check through `UpdateService` and uses the returned resource. This is the only fallback check and occurs after explicit user action.

The dialog will disable the install action while preparation, download, or installation is active. Repeated clicks cannot start parallel updater operations.

### Error normalization and retry

A small pure helper will convert unknown thrown values into a useful message:

- `Error` uses its non-empty `message`.
- A non-empty string is returned unchanged.
- Objects with a non-empty string `message` use that value.
- Other values use a stable fallback message.

Preparation failures remain in the dialog with a `Try Again` action. Retrying calls the serialized service check once and replaces the prepared resource only after success. Download or installation failures also remain visible and can be retried without silently launching a second operation.

Console logging will include the original error value for diagnosis but will not include updater signatures, private keys, meeting data, or credentials.

### Resource ownership

The current `UpdateInfo` state owns the prepared updater resource. Replacing `UpdateInfo` makes the previous resource eligible for Tauri resource cleanup. Closing only the dialog does not discard the resource, so reopening does not require another request.

After successful `downloadAndInstall`, the application relaunches as it does today. No additional close call is required because the Tauri combined command consumes the install flow.

## Affected-user bridge

Existing 0.4.8–0.4.10 builds cannot exercise the frontend updater fix until they install a newer build. For a machine that consistently hits the old dialog failure:

1. Stop Meetily cleanly.
2. Preserve the existing `/Applications/Meetily.app` as a reversible temporary backup.
3. Install the verified signed 0.4.11 application without modifying application-support data or recordings.
4. Verify bundle version and `codesign` before launch.
5. Publish a 0.4.12 verification release through the same signed release workflow.
6. Use the installed 0.4.11 UI to test `Check for Updates` → `Download & Install` → relaunch.
7. Verify the resulting 0.4.12 bundle signature and confirm meetings, projects, recordings, and summaries remain present.

The bridge is an installation procedure, not a migration of user data.

## Testing

Test-driven implementation will add failing tests before production changes for:

- a successful service check returns and retains the exact prepared `Update` resource;
- opening a dialog with a prepared resource does not invoke another check;
- a missing resource performs at most one serialized fallback check after user action;
- string, `Error`, object-message, and unknown failures produce stable useful text;
- repeated install clicks cannot launch concurrent operations;
- retry replaces the failed state after a successful preparation;
- the existing update progress and relaunch behavior remains intact.

Repository verification will include the targeted updater tests, the complete frontend test suite, ESLint, Next production build, version consistency, release preflight, and changed-file formatting checks.

## Release and acceptance

The fix will ship as 0.4.11 from `main` through the existing draft-first release workflow. The workflow must build the Apple Silicon application, generate the canonical `latest.json`, verify the updater signature cryptographically, and publish only after all gates succeed.

Because the update from 0.4.10 to 0.4.11 still runs the old 0.4.10 updater code, it cannot prove the fix. The test machine will therefore receive the verified 0.4.11 bundle directly, and a signed 0.4.12 verification release will exercise the repaired updater end to end. Version 0.4.12 contains the same updater fix and only the release-version change unless a test exposes another defect.

Acceptance requires all of the following:

- the public manifest reports 0.4.12 with a reachable `darwin-aarch64` archive and signature;
- an installed and signature-verified 0.4.11 application discovers 0.4.12;
- opening its dialog does not trigger a second updater check;
- `Download & Install` completes and relaunches into 0.4.12;
- the installed application passes strict macOS code-signature verification;
- existing user data is still present after relaunch;
- a simulated preparation failure displays the underlying message and offers a working retry.
