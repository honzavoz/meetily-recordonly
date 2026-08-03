# Stable Compact Switcher and Markdown Wrapping Design

## Goal

Remove layout movement when the meeting workspace crosses its compact breakpoint and ensure Markdown prose follows the summary pane width at every supported window size.

## Root causes

The compact `Transcript` / `Summary` switcher currently participates in normal document flow. Showing it below the `lg` breakpoint adds a new row and changes the workspace height, so the visible pane jumps during resize.

The existing summary CSS constrains the outer BlockNote containers but does not cover the complete intrinsic-width chain. In particular, nested block groups, inline-content wrappers, and their direct editable descendants can retain content-driven minimum widths.

## Chosen approach

Render the compact switcher as a bottom-centered floating control inside a positioned workspace boundary. It remains outside normal flow, so appearing or disappearing cannot change pane geometry. Compact scroll areas receive enough bottom inset for their final content to remain reachable behind the control. At wide widths the switcher is absent and both panes remain visible.

Extend the scoped `.meetily-summary-editor` containment rules through BlockNote block groups, inline-content wrappers, and editable descendants. Every structural wrapper uses `min-width: 0` and `max-width: 100%`. Normal text uses `white-space: pre-wrap`, `overflow-wrap: anywhere`, and `word-break: break-word`. Code blocks and tables retain local horizontal scrolling.

## Accessibility and behavior

The switcher keeps its existing labels, pressed state, keyboard arrow behavior, focus ring, and pane state. Its floating surface has an opaque background, border, shadow, and sufficient z-index without covering unrelated application navigation.

Resizing does not change the selected compact pane, editor state, scroll ownership, or meeting data. The solution introduces no resize listeners and relies only on responsive CSS.

## Verification

Regression tests assert that the switcher is positioned outside normal flow and that the workspace establishes a positioning boundary. CSS contract tests cover `.bn-block-group`, `.bn-inline-content`, editable descendants, and pre-wrapped prose. Existing responsive tests, the complete Bun suite, and the production Next.js build must pass before delivery.
