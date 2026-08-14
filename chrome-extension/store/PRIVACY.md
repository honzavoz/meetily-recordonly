# Privacy policy for Record Only - Meet Reminder

Effective date: 2026-08-14

Record Only - Meet Reminder is a local companion to the Record Only desktop app. It detects whether a Google Meet page has entered or left an active call and sends that state to the app installed on the same Mac.

## Data processed

The extension creates and processes:

- a random identifier for the current call lifecycle;
- the lifecycle event type, sequence number, protocol versions, and event timestamp.

The extension does not read, collect, transmit, or store meeting titles, meeting codes, URLs, participant identities, chat, captions, audio, video, microphone input, camera input, clipboard contents, or browsing history.

## Data use and sharing

Record Only uses lifecycle data to show a recording reminder. Chrome Native Messaging sends the data to the Record Only app on the same computer. The extension does not send data to the project maintainers, advertisers, analytics services, or other remote parties. It does not sell data or use it for advertising, profiling, credit decisions, or unrelated purposes.

Chrome session storage holds the random call identifier while the tab remains open. Chrome clears this data with the session. Record Only does not store Google Meet lifecycle identifiers in its meeting database or analytics.

## Permissions

- `meet.google.com` access checks whether a Google Meet call is active.
- `nativeMessaging` communicates with the Record Only app installed on the same computer.
- `storage` holds temporary session state for the current call lifecycle.

## Contact

Submit questions and privacy requests at https://github.com/honzavoz/meetily-recordonly/issues.

We publish material policy changes in this repository and include them with an extension update.
