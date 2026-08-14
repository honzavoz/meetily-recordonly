# Third-Party Notices

Record Only is an independent fork of the Meetily Community Edition. It is not
affiliated with or endorsed by Zackriya Solutions.

This file records the principal third-party components distributed with the
application. The corresponding source repository and lockfiles contain the
complete dependency graph and exact versions for each release.

## Meetily Community Edition

- Project: Meetily Community Edition
- Copyright: Copyright (c) 2024 Zackriya Solutions
- License: MIT
- Source: https://github.com/Zackriya-Solutions/meetily

The complete MIT text is included as `LICENSE.md` beside this notice.

## FFmpeg

- Project: FFmpeg
- License: GNU Lesser General Public License 2.1 or later
- Project site: https://ffmpeg.org/
- Source: the exact source archive, detached signature, checksum, and build
  configuration are attached to the same GitHub release as the application

Record Only invokes FFmpeg as a separate executable. Release builds use no GPL
or nonfree FFmpeg components and no external codec libraries. The exact build
configuration is included in `licenses/ffmpeg/` in the application bundle.

## Rust and native components

The application includes Rust crates under permissive or weak-copyleft
licenses, principally MIT, Apache-2.0, BSD, ISC, Unlicense, Zlib, Unicode-3.0,
and MPL-2.0. Exact versions are pinned in `Cargo.lock`.

Notable MPL-2.0 components include:

- Symphonia and its codec/format crates: https://github.com/pdeljanov/Symphonia
- cssparser, selectors, and dtoa-short: https://github.com/servo
- webpki-roots: https://github.com/rustls/webpki-roots
- colored: https://github.com/colored-rs/colored

Notable inference components include:

- llama-cpp-rs / llama.cpp bindings — MIT OR Apache-2.0:
  https://github.com/utilityai/llama-cpp-rs
- whisper-rs — Unlicense: https://github.com/tazz4843/whisper-rs
- ONNX Runtime Rust bindings — MIT OR Apache-2.0:
  https://github.com/pykeio/ort

The source form of MPL-covered dependencies is available from the linked
repositories and the exact crate sources identified by `Cargo.lock`.

## JavaScript components

The frontend includes packages under permissive licenses and these MPL-2.0
packages, with exact versions pinned in `pnpm-lock.yaml`:

- BlockNote core, React, and ShadCN packages:
  https://github.com/TypeCellOS/BlockNote
- axe-core: https://github.com/dequelabs/axe-core

The source form is available from the linked repositories and the exact npm
package archives identified by `pnpm-lock.yaml`.

## Downloadable models

Model weights are not part of the application installer. When a user chooses
to download a model, Record Only displays its source, attribution, and license
before downloading it.

- Qwen 3.5 GGUF — Apache-2.0:
  https://huggingface.co/unsloth/Qwen3.5-2B-GGUF
- NVIDIA Parakeet TDT v2/v3 ONNX conversions — CC-BY-4.0:
  https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx and
  https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx
- whisper.cpp model files — MIT:
  https://huggingface.co/ggerganov/whisper.cpp

Google Gemma weights are not offered for a new download unless their current
terms can be displayed and explicitly accepted.
