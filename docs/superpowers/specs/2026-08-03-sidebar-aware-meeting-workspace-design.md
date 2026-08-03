# Sidebar-Aware Meeting Workspace Design

## Goal

Make the meeting workspace respond to the width actually available after the fixed sidebar, so expanding the sidebar never clips Transcript, Summary, toolbar actions, or Markdown content.

## Confirmed root causes

The sidebar is fixed and therefore does not participate in the root flex layout. `MainContent` currently keeps `flex: 1` and adds `margin-left`, which makes its effective right edge extend beyond the window instead of subtracting the sidebar width.

The meeting workspace uses viewport-based Tailwind `lg` media queries. At a roughly 980 px window with the 256 px sidebar expanded, the workspace still selects its two-pane layout even though only about 724 px remain. The Summary pane and toolbar are consequently clipped.

## Chosen approach

`MainContent` will explicitly occupy the remaining inline space: viewport width minus 64 px for the collapsed sidebar or minus 256 px for the expanded sidebar. It will be a `min-width: 0` overflow boundary and a named inline-size query container.

The meeting workspace will replace viewport-based `lg` visibility and sizing rules with scoped container-query classes. Two panes appear only when the main-content container has at least 1024 px available. Below that threshold, the existing floating Transcript/Summary switcher controls one full-width pane. The toolbar's wide and compact forms will follow the same container rather than the browser viewport.

This is preferred over raising the global breakpoint because a fixed viewport threshold cannot correctly represent both sidebar widths.

## Transitions and state

Sidebar expansion keeps its existing width animation. Main content width and offset animate over the same duration, preventing temporary overlap. Switching between one and two panes preserves selected compact pane, editor state, meeting data, and scroll ownership.

No JavaScript resize listener is introduced. Sidebar state controls only the root content width; CSS container queries control descendants.

## Verification

Regression tests cover the remaining-width contract in `MainContent` and ensure meeting pane visibility, switcher visibility, and summary toolbar variants use container-query classes rather than viewport `lg` classes.

Direct desktop QA covers collapsed and expanded sidebar states at wide, intermediate, and narrow window widths. The verified failure case—expanded sidebar at approximately 980 px—is required to show one complete unclipped pane with the floating switcher.

The complete Bun suite and Next.js production build must pass before push and macOS installation.
