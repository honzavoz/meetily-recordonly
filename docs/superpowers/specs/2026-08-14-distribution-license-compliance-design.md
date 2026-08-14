# Distribution License Compliance Design

## Goal

Make the desktop application, updater archive, and Chrome extension distributable with complete notices, reproducible FFmpeg provenance, model-license disclosure, and a distinct public identity.

## Product identity

The public product and extension name becomes **Record Only**. The existing bundle identifier `cz.honzavoz.meetily.recordonly`, database locations, native-messaging host name, updater key, and updater endpoint remain unchanged so installed users keep their data and update path. Documentation credits the MIT-licensed Meetily Community Edition as the upstream project and states that Record Only is an independent fork not endorsed by Zackriya Solutions.

The first renamed release must be tested as an in-app update from the installed `Meetily.app`. If Tauri cannot safely replace the existing macOS bundle after the product-name change, the release keeps the technical bundle filename `Meetily.app` for one transition release while all visible branding and the Chrome Web Store listing use Record Only. A later release may rename the bundle after a verified migration path exists.

## FFmpeg

Release builds no longer download opaque third-party FFmpeg binaries. A repository script downloads a pinned official FFmpeg source archive, verifies its SHA-256 digest, and builds only the `ffmpeg` command with no external libraries, GPL components, nonfree components, `ffplay`, or `ffprobe`.

The macOS configuration uses static internal FFmpeg libraries because the application executes FFmpeg as a separate sidecar process. The build configuration must include `--disable-gpl`, `--disable-nonfree`, and `--disable-autodetect`. The resulting binary must identify itself as LGPL and must not contain `--enable-gpl`, `--enable-nonfree`, `libx264`, `libx265`, or `libvmaf` in `-buildconf` output.

The exact official source archive, signature, checksum, configure command, FFmpeg LGPL text, and an unmodified-source statement are published with each release. The source archive is hosted in the same GitHub release as the application binaries.

## Notices and dependencies

The root MIT license and a generated `THIRD_PARTY_NOTICES.md` are bundled in the macOS resources and Chrome extension ZIP. The notices identify upstream Meetily, FFmpeg, llama.cpp bindings, Rust and JavaScript dependencies, and downloadable models. The About dialog links to the bundled notices and clearly identifies the fork.

Dependency checks fail on GPL, AGPL, SSPL, BUSL, Commons Clause, missing licenses, or licenses outside the reviewed allowlist. MPL dependencies remain allowed, with their license and source locations recorded in the notices.

## Downloadable models

Each built-in model definition carries a license identifier, attribution, source URL, and license URL. The first model download presents these terms and requires explicit acceptance. Qwen uses Apache-2.0, Parakeet uses CC-BY-4.0, Whisper model files retain their upstream attribution, and Gemma remains unavailable until its current Google terms can be shown and accepted reliably.

## Release gates

Release verification must prove:

- the extension ZIP contains `LICENSE.md` and `THIRD_PARTY_NOTICES.md`;
- the application resources contain both notice files and FFmpeg license/provenance files;
- bundled FFmpeg is functional and reports an allowed LGPL configuration;
- the exact FFmpeg source archive is attached to the draft release;
- public names and store copy use Record Only and disclose the upstream fork relationship;
- version sources are consistent and all existing tests, lint, frontend build, Rust tests, and artifact checks pass.

The workflow keeps the GitHub release as a draft until every gate succeeds.

## Existing release

Version `0.4.14` remains historical evidence but must not be treated as the preferred download. The first compliant release supersedes it immediately. If exact corresponding source for the old GPL FFmpeg binary cannot be obtained, its application assets should be removed only after explicit approval, while retaining the tag and release notes.

## Out of scope

- Legal registration of the Record Only name or logo.
- Contacting Zackriya Solutions or accepting third-party legal agreements.
- Windows and Linux binary publication before equivalent reproducible FFmpeg builds and artifact checks exist.
