# Privacy policy for Meetily Google Meet Reminder

Effective date: 2026-08-14

Meetily Google Meet Reminder is a local companion to the Meetily desktop application. Its sole purpose is to detect whether the current Google Meet page has entered or left an active call and to notify the locally installed Meetily application.

## Data processed

The extension creates and processes only:

- a randomly generated identifier for the current call lifecycle;
- the lifecycle event type: joined, left, heartbeat, or integration ping;
- a sequence number;
- the extension and protocol versions;
- the event timestamp.

The extension does not read, collect, transmit, or store meeting titles, meeting codes, URLs, participant identities, chat, captions, audio, video, microphone input, camera input, clipboard contents, or browsing history.

## Data use and sharing

Lifecycle data is used only to show recording reminders in Meetily. It is sent through Chrome Native Messaging to the Meetily application installed on the same computer. It is not sent to Meetily's developers, advertising services, analytics services, or any other remote third party. It is not sold and is not used for advertising, profiling, credit decisions, or purposes unrelated to the extension's single purpose.

The extension temporarily uses Chrome session storage to match an open Google Meet tab with its call lifecycle. Chrome clears this session-scoped data automatically. Meetily does not persist Google Meet lifecycle identifiers in its meeting database or analytics.

## Permissions

- `meet.google.com` access is used only to determine whether a Google Meet call is active.
- `nativeMessaging` is used only to communicate with the locally installed Meetily application.
- `storage` is used only for temporary, session-scoped lifecycle state.

## Contact

Questions and privacy requests can be submitted at https://github.com/honzavoz/meetily-recordonly/issues.

Material changes to this policy will be published in this repository and included with an extension update.
