# Responsive Markdown Summary Design

## Goal

Make the Markdown-only meeting summary readable and fully operable at every supported Meetily window size. Long Markdown content must not widen the workspace, and summary actions must remain reachable without relying on hidden page overflow.

## Scope

This change covers the rendered and editable Markdown summary, its scroll container, summary action controls, and the External AI dialogs opened from the summary panel. It does not change Markdown persistence, conversion, summary generation, or unrelated application screens.

## Chosen approach

Use explicit overflow ownership inside the summary panel:

- The summary panel is a bounded flex column with `min-width: 0` and `min-height: 0` through every layout ancestor.
- The Markdown body is the vertical scroll owner and wraps normal prose, headings, links, and other unbroken inline content.
- Tables and fenced code blocks keep their meaningful formatting and receive local horizontal scrolling instead of widening the complete workspace.
- Save and Copy remain in a sticky action region outside the scrolling Markdown body. The action group wraps at deliberate boundaries on compact widths, so controls never become clipped or unreachable.
- External AI dialog bodies scroll independently within a viewport-bounded dialog while their close and submit actions remain visible.

This is preferred over a generic `overflow: auto` on the complete panel, which can scroll required actions away, and over shrinking or hiding labels, which reduces discoverability without fixing overflow ownership.

## Markdown wrapping

Rendered editor content uses fluid inline sizing. Prose and headings receive safe overflow wrapping for long URLs, identifiers, and pasted strings. Descendants that participate in flex or grid layout use `min-width: 0` so their intrinsic Markdown width cannot force the pane wider.

Preformatted blocks preserve whitespace and scroll horizontally inside their own boundary. Tables live in a width-constrained wrapper with horizontal scrolling. Media and other embedded content cannot exceed the available inline size.

## Actions and scrolling

The Markdown body consumes the remaining panel height and scrolls vertically. The action area stays attached to the panel edge, remains visually separated from the content, and respects safe padding. At narrow widths actions may wrap into a second row, but they cannot be pushed outside the panel or covered by content.

The meeting page itself must not gain a horizontal scrollbar as a result of Markdown content. Compact pane switching and existing summary state remain unchanged.

## Dialog behavior

External AI Prompt and Paste AI Result dialogs use a viewport-relative maximum height. Their header and footer remain fixed within the dialog, while only the content body scrolls. Textareas and prompt previews shrink to the dialog width and wrap or scroll locally according to their content type.

## Accessibility and behavior preservation

All existing button labels, accessible names, keyboard focus behavior, disabled states, loading states, and callbacks remain unchanged. Responsive changes must not save, copy, regenerate, or discard content during resize.

## Verification

Regression tests assert the required layout contract for Markdown wrapping, local code/table overflow, bounded summary scrolling, persistent action visibility, and viewport-bounded dialogs. Existing unit tests, type checks, and production build must pass.

Static responsive verification covers the existing supported sizes:

- `1440 x 900`
- `1100 x 700`
- `900 x 650`
- `720 x 520`

The test fixture includes long prose, a long URL, an unbroken identifier, a wide Markdown table, and a long fenced code line.
