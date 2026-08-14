# Record Only

Record Only is a local macOS app for meeting recording, transcription, and summaries. You can record audio first and transcribe it later, or use live transcription. Local models keep processing on your Mac. External AI providers remain optional.

Record Only is an independent fork of [Meetily Community Edition](https://github.com/Zackriya-Solutions/meetily). The upstream project and this fork use the MIT License. Zackriya Solutions does not endorse or maintain Record Only.

## Features

- Records microphone and system audio with explicit user control.
- Supports deferred or live transcription with local Whisper and Parakeet models.
- Generates summaries with local Qwen models or a provider you configure.
- Stores meetings and recordings on your computer.
- Reminds you to start recording after you join Google Meet in Chrome.
- Checks signed GitHub releases for updates and asks before installation.

## Install

Download the current macOS package from [GitHub Releases](https://github.com/honzavoz/meetily-recordonly/releases/latest).

The transition release keeps the technical bundle name `Meetily.app`, executable name, bundle identifier, data directories, native-host identifier, and updater channel. Existing installations can update in place and keep their data. The app presents the Record Only name in its windows, menus, notifications, and extension.

## Google Meet reminder

Open **Settings > General > Google Meet reminder** and select **Install in Chrome**. The extension sends call start and end signals to the app through Chrome Native Messaging. It does not read meeting titles, participant names, chat, captions, audio, video, the meeting URL, or its meeting code.

See [Building Record Only from Source](docs/BUILDING.md) for local extension development and acceptance tests.

## Build

Install Rust, Bun, pnpm, and the platform dependencies described in [docs/BUILDING.md](docs/BUILDING.md). Release builds also require the repository's pinned LGPL-only FFmpeg build:

```bash
scripts/build-ffmpeg-lgpl.sh aarch64-apple-darwin
cd frontend
pnpm install
pnpm tauri build
```

The release workflow verifies the FFmpeg source, signature, checksum, build configuration, and packaged notices before publication.

## Licensing

Record Only source code is available under the [MIT License](LICENSE.md). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution, dependency licenses, FFmpeg provenance, and downloadable model terms.

Google Gemma weights are not offered for new downloads until the app can show and record acceptance of the current Gemma terms. Qwen, Parakeet, and Whisper downloads show their source, license, and attribution before the first download.

## Support

Report Record Only issues in this repository: https://github.com/honzavoz/meetily-recordonly/issues

For issues with upstream Meetily Community Edition, use the upstream repository.
