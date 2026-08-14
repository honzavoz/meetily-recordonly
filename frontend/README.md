# Record Only frontend

This directory contains the Next.js interface and Tauri desktop backend for
Record Only. Use the repository-level [README](../README.md) and
[build guide](../docs/BUILDING.md) as the authoritative setup instructions.

## Local checks

```bash
pnpm install
pnpm lint
pnpm build
```

Run the desktop development build only when it is safe to start a separate app
process:

```bash
pnpm tauri dev
```

Release builds must use the pinned LGPL-only FFmpeg process and pass the
repository's packaging and license gates.
