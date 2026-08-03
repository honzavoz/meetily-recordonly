# Responsive Meeting Workspace Design

## Goal

Make the Meetily meeting workspace complete, readable, and operable across practical desktop window sizes. No action may become unreachable because of clipping, wrapping, or an off-screen dialog.

## Scope

This change covers the meeting detail workspace: sidebar interaction, transcript and summary panes, the summary action toolbar, scrolling, popovers, and dialogs opened from that workspace. It does not redesign unrelated settings pages or change meeting data, transcription, or summary generation behavior.

## Chosen approach

Use an adaptive workspace instead of forcing the same two-column composition at every width.

- Wide windows show transcript and summary side by side.
- Compact windows show one pane at a time behind an accessible `Transcript` / `Summary` tab switcher.
- Primary actions remain directly visible. Secondary summary actions move into a consistent `More` menu when space is constrained.
- The shell and each visible pane have explicit overflow ownership, so the application never gains a page-wide horizontal scrollbar.

This is preferred over wrapping the entire toolbar, which produces unstable header heights, and over horizontal toolbar scrolling, which makes actions difficult to discover.

## Responsive behavior

The meeting workspace has two layout modes controlled by CSS media queries:

1. At `1024px` and wider, transcript and summary are visible side by side. The transcript keeps a bounded width and the summary consumes the remaining space.
2. Below `1024px`, the workspace displays an in-content tab switcher and one full-width pane at a time. Summary is the initial compact pane because it contains the meeting title, projects, and principal output. Switching panes must not discard edits or reload meeting data.

At compact widths the existing navigation sidebar may use its current collapsed state, but the meeting content must still size from `min-width: 0` and remain usable without relying on the sidebar being manually hidden.

The supported minimum QA viewport is `720 x 520px`. Below that size the UI should still avoid destructive overlap, but the design does not promise an optimal editing experience.

## Meeting pane switcher

The compact switcher is placed at the top of the meeting workspace, not inside either pane. It uses real buttons with tab semantics, a visible selected state, keyboard focus styles, and labels that remain visible. The currently selected pane is stored as local UI state only.

Both panes remain part of the same meeting state. Changing tabs must preserve the current title, summary edits, project assignments, and scroll position where practical.

## Summary toolbar

The toolbar is divided by priority instead of shrinking every label independently.

Direct actions:

- Generate, regenerate, or stop generation
- Summary language
- Save when a summary exists
- `More` menu trigger

The `More` menu contains the available secondary actions:

- External AI
- Paste AI Result
- AI Model
- Template
- Copy Summary

Actions retain their existing disabled and loading behavior. Items that are not applicable are omitted or disabled consistently with the current buttons. Wide layouts may show the existing direct labeled controls, while compact layouts use the priority toolbar and `More` menu. Tooltips and accessible names remain available for icon-only controls.

The toolbar may wrap only at a deliberate group boundary; individual grouped controls must not be clipped. It stays attached to the summary header while summary content scrolls beneath it.

## Scrolling and containment

The app shell remains height-constrained. Each region has one scroll owner:

- The navigation sidebar scrolls independently.
- The visible transcript pane scrolls its transcript content.
- The visible summary pane scrolls its editor or content.
- Modal bodies scroll inside a height-constrained dialog.

Headers, the compact pane switcher, and required dialog actions remain visible. There is no horizontal scrollbar on the page or meeting workspace. Long titles and project chips wrap inside their own region without forcing toolbar controls off-screen.

The fixed bottom `summaryResponse` overlay is removed from normal rendering because it can cover the editor and escape the workspace boundaries. Existing editable summary content remains the sole visible summary result.

## Dialogs, menus, and closing behavior

Dialogs opened from the meeting toolbar use a maximum height derived from the viewport. Their content area scrolls while the close control and required footer actions remain reachable. Popovers and dropdowns use collision-aware placement provided by the existing Radix components and receive width constraints that fit compact windows.

Escape closes the active menu, popover, or dialog according to the existing component primitives. Closing returns focus to the trigger. No overlay is nested inside the pane's scrolling content in a way that clips it.

## Component boundaries

- `page-content.tsx` owns responsive pane selection and the workspace-level tab switcher.
- `TranscriptPanel.tsx` and `SummaryPanel.tsx` remain responsible for their own headers and scrollable content, but must accept being the only visible pane.
- A focused summary action component owns compact action prioritization and the `More` menu. Existing generator and updater callbacks remain the source of behavior; no business logic moves into layout code.
- Shared dialog sizing is handled through reusable classes or the existing dialog primitive instead of one-off viewport calculations.

## Error and state behavior

Responsive layout changes do not introduce new persistence. Existing toasts and loading states remain unchanged. Resizing the window or switching panes cannot start, stop, retry, save, or discard any operation. An in-progress summary generation remains visible through its current state when the summary pane is reopened.

## Verification

Automated component tests cover compact pane selection and the compact action menu's callback wiring. Existing tests cover unchanged summary actions. Production build and type checks must pass.

Manual responsive QA covers at least:

- `1440 x 900`: two-pane layout and full toolbar
- `1100 x 700`: two-pane layout without clipping
- `900 x 650`: compact tabs and action overflow menu
- `720 x 520`: reachable toolbar, scrollable content, closable dialogs, and no page-wide horizontal overflow

Each size is checked with a long meeting title, several project chips, an existing summary, no summary, and an active generation state.
