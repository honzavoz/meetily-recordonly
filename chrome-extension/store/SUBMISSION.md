# Chrome Web Store submission answers

## First-upload identity step

After uploading the initial ZIP, open Package > View public key. Before submitting for review, replace the development `manifest.key` with that public key, update Meetily's native-host allowed origin and Web Store URL to the dashboard Item ID, increment the extension version, rebuild the ZIP, and upload it as the final package. Verify that the dashboard Item ID matches the locally loaded extension ID.

## Single purpose

Detect when the user joins or leaves an active Google Meet call and notify the locally installed Meetily desktop application so it can offer a recording reminder.

## Permission justification: nativeMessaging

Required to deliver the call lifecycle signal to the local Meetily desktop application. The native host is fixed to `cz.honzavoz.meetily.recordonly.google_meet`; the extension cannot invoke arbitrary native programs or commands.

## Permission justification: storage

Required for `chrome.storage.session`, which temporarily associates a Google Meet browser tab with its random call-lifecycle identifier. This lets the extension send a leave signal if the tab closes. No meeting content or persistent user profile is stored.

## Host permission justification: https://meet.google.com/*

Required to run the detector only on Google Meet. The detector checks the page path and accessible call-control labels to derive a joined/not-joined boolean. Raw page text and URLs are never sent outside the page.

## Remote code

No. All executable JavaScript is included in the extension package. The extension does not download or execute remote code and does not use `eval` or dynamic function construction.

## Data usage declarations

The extension does not collect personally identifiable information, health information, financial information, authentication information, personal communications, location, web history, user activity, or website content. The random session identifier and lifecycle metadata remain local to the user's computer and are used only for the extension's single purpose.

## Reviewer instructions

1. Install the current Meetily macOS application.
2. In Meetily, open Settings > General > Google Meet reminder and select Install in Chrome once so the native host is registered.
3. Install this extension.
4. Join a Google Meet test call and wait at least three seconds.
5. Verify that Meetily shows a recording reminder and does not start recording until Start recording is selected.
6. Leave the call. If recording was started from the reminder, verify that Meetily offers to stop and save it.

The extension badge displays `!` when the local Meetily native host is unavailable. This is expected when Meetily is not installed or the integration has not been enabled.
