# Project Colors and Meetily App Name

## Goal

Make projects easier to distinguish visually while restoring the public macOS app name to `Meetily`.

## Project colors

- Every project has one persistent color from a fixed, accessible palette of eight muted colors.
- The color belongs to the project, not to an individual meeting or recording. A project therefore looks the same in project filters, meeting chips, pending-recording chips, and project pickers.
- Existing projects receive a deterministic default color during migration so upgrades do not require manual cleanup.
- Newly created projects receive the next palette color automatically, distributed deterministically across existing projects.
- A compact color-dot control beside a project in the project navigation opens the palette. Selecting a swatch updates the project immediately and refreshes all visible occurrences.
- Custom HEX values are intentionally excluded. This keeps contrast, dark text readability, and UI consistency under application control.

## Persistence and compatibility

- Add a non-null `color` column to `projects` through a new additive SQLite migration. Do not edit the already-shipped project migration.
- Rust project models, repository queries, commands, frontend types, recording metadata, and project-transfer logic all carry the color.
- Pending recordings keep a snapshot of the project id, name, normalized name, and color. When projects are transferred after transcription, the canonical database project remains authoritative.
- Unknown or older metadata colors fall back to the default palette color instead of breaking rendering.

## App identity

- Change the Tauri `productName` and main-window title to `Meetily`.
- Keep the existing bundle identifier `cz.honzavoz.meetily.recordonly` unchanged so application data, permissions, and user settings remain connected to the existing installation.
- The generated bundle is `Meetily.app`; no data-directory rename is performed.
- Bump all synchronized application versions from `0.4.3` to `0.4.4`.

## UX details

- Chips use a soft tinted background, matching border, and readable dark foreground derived from the selected palette token.
- Project navigation shows the same color as a small dot without reducing the space available to the project name and meeting count.
- The picker shows project colors beside each name. The color editor is only exposed on the project navigation item, avoiding duplicate controls on every chip.
- Color changes use optimistic UI with rollback and an error toast if persistence fails.

## Verification

- Repository tests cover migration compatibility, default color assignment, color validation/update, serialization, and transfer behavior.
- Frontend tests cover palette fallback and style resolution.
- Run the complete Bun test suite, version consistency checks, production frontend build, Rust tests where the toolchain allows, and the macOS GitHub Actions build.
- Download the 0.4.4 artifact and verify `CFBundleName`, `CFBundleDisplayName`, window title, version, project color editing, and persisted color after restart.
