# Release QA Completion Design

## Goal

Close every actionable gap from the Meetily 0.4.4 audit while preserving user data and the current product behavior.

## Settings responsiveness

The settings page must never make the complete content canvas horizontally scroll. The page header and content use responsive horizontal padding and `min-w-0`. The tab bar gets its own bounded `overflow-x-auto` viewport with a non-shrinking inner tab list. Selecting an off-screen tab may scroll only that tab viewport; the active panel remains anchored to the left and fills the available width. Existing desktop spacing and the animated underline remain.

## Lint and CI quality gates

The repository already has a flat ESLint configuration, so the `lint` script will call ESLint directly instead of the deprecated interactive `next lint` command. The configuration will ignore generated and binary-heavy output. The macOS workflow will run frontend lint, frontend unit tests, and Rust workspace tests before packaging. This makes Rust verification a reproducible CI responsibility and does not install a toolchain on the user's Mac.

## Meetily branding

The About dialog remains a local product-information surface. Remove the Zackriya sales CTA and attribution, replace them with a concise Meetily attribution, and keep version, privacy, analytics, and update controls. Existing upstream URLs outside the About dialog are not rewritten unless they are directly exposed by the resulting About surface.

## Testing and delivery

Add source-level regression tests for the isolated settings tab scroller, bounded content width, direct ESLint script, macOS quality gates, and absence of Zackriya text in About. Follow red-green TDD, then run focused tests, the complete frontend suite, lint, production build, and `git diff --check`. Push to `main`, wait for the macOS workflow, install its arm64 artifact, and visually verify Settings at narrow and wide window sizes.

## Safety boundaries

Do not edit application data, meetings, projects, colors, recording preferences, or local model state. Do not create a test recording. Preserve the untracked `.pnpm-store/` directory.
