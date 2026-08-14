# FFmpeg distribution provenance

Record Only release builds use an unmodified official FFmpeg source archive
from https://ffmpeg.org/releases/ and build the `ffmpeg` executable without GPL,
nonfree, or automatically detected external libraries.

The build pins FFmpeg 8.0.3 by SHA-256 and cryptographically verifies its
detached signature against the official FFmpeg release key stored as
`ffmpeg-devel.asc` (fingerprint
`FCF986EA15E6E293A5644F10B4322F04D67658D8`). Reproduce the reviewed Apple
Silicon sidecar from the repository root with:

```sh
scripts/build-ffmpeg-lgpl.sh aarch64-apple-darwin
```

Every application release must include or publish together:

- the exact source archive and detached upstream signature;
- the pinned SHA-256 checksum;
- the configure command captured in `BUILD_CONFIGURATION.txt`;
- FFmpeg's `COPYING.LGPLv2.1` license text; and
- the output of `ffmpeg -version`, `ffmpeg -buildconf`, and `ffmpeg -L`.

The release workflow must remain a draft if any of these files are absent or
if the binary reports GPL/nonfree configuration.
