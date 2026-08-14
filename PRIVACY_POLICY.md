# Record Only Privacy Policy

Effective date: 2026-08-14

Record Only is a local desktop application and an independent open-source fork
of Meetily Community Edition. This policy describes the behavior of the Record
Only builds published at https://github.com/honzavoz/meetily-recordonly.

## Local meeting data

Recordings, transcripts, notes, summaries, preferences, and downloaded models
are stored on your Mac. Record Only does not operate a cloud service that
receives this data. Files remain subject to your macOS account permissions,
backups, synchronization settings, and disk-encryption configuration.

## Network access you initiate

Record Only can make these network requests:

- The updater checks this fork's GitHub Releases and downloads an update only
  after you approve it.
- Local model downloads retrieve files from the source disclosed in the model
  license dialog, such as Hugging Face or GitHub.
- If you configure an external AI provider and request a summary, the text
  required for that request is sent to the provider you selected. The
  provider's privacy policy and terms then apply.
- A local Ollama or compatible endpoint receives only requests you direct to
  that endpoint.

## Usage analytics

Usage analytics is disabled in Record Only. The application does not initialize
the upstream Meetily PostHog project, and the transition release clears any
analytics opt-in value inherited from an earlier installation.

## Google Meet reminder

The optional Chrome extension detects only whether a Google Meet call is active
and sends join, heartbeat, and leave signals to the desktop app through Chrome
Native Messaging. It does not read or transmit meeting audio, video, titles,
participant names, chat, captions, meeting URLs, meeting codes, or browsing
history. It does not contact a remote server.

## Your control

You can inspect, export, or delete local meeting data through the application
and macOS. Removing local files or the application does not delete information
you intentionally sent to an external AI provider; use that provider's controls
for those requests.

## Changes and contact

Material changes are published in this repository and described in release
notes. Report privacy questions or issues at
https://github.com/honzavoz/meetily-recordonly/issues.
