# FFmpeg distribution provenance

Record Only release builds use an unmodified official FFmpeg source archive
from https://ffmpeg.org/releases/ and build the `ffmpeg` executable without GPL,
nonfree, or automatically detected external libraries.

Every application release must include or publish together:

- the exact source archive and detached upstream signature;
- the pinned SHA-256 checksum;
- the configure command captured in `BUILD_CONFIGURATION.txt`;
- FFmpeg's `COPYING.LGPLv2.1` license text; and
- the output of `ffmpeg -version`, `ffmpeg -buildconf`, and `ffmpeg -L`.

The release workflow must remain a draft if any of these files are absent or
if the binary reports GPL/nonfree configuration.

