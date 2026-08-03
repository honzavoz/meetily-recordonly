# Sidebar-Aware Meeting Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make meeting layout mode and toolbar density respond to the usable width remaining after the fixed sidebar.

**Architecture:** Give `MainContent` an explicit viewport-minus-sidebar width and establish it as a named inline-size container. Use scoped CSS container queries for meeting panes, the floating switcher, bottom inset, and summary toolbar variants while leaving existing React state and callbacks unchanged.

**Tech Stack:** React 18, Next.js 14, TypeScript, Tailwind CSS, native CSS container queries, Bun test.

---

### Task 1: Define the remaining-width and container-query contract

**Files:**
- Create: `frontend/tests/lib/sidebar-aware-workspace.test.ts`
- Modify: `frontend/tests/lib/responsive-meeting-workspace.test.ts`

- [ ] Read `MainContent`, meeting page, switcher, SummaryPanel, and global CSS as source fixtures.
- [ ] Assert collapsed main content uses `w-[calc(100%-4rem)]`, expanded uses `w-[calc(100%-16rem)]`, and the root includes `min-w-0`, `overflow-hidden`, and `meetily-main-content`.
- [ ] Assert global CSS declares `container: meetily-main / inline-size` and `@container meetily-main (min-width: 1024px)`.
- [ ] Assert panes, switcher, and summary action variants use dedicated `meeting-*` classes without responsive `lg:` visibility classes.
- [ ] Run `cd frontend && bun test tests/lib/sidebar-aware-workspace.test.ts tests/lib/responsive-meeting-workspace.test.ts` and verify failures identify the missing width/container behavior.

### Task 2: Make MainContent occupy only the remaining window width

**Files:**
- Modify: `frontend/src/components/MainContent/index.tsx`
- Modify: `frontend/src/app/globals.css`
- Test: `frontend/tests/lib/sidebar-aware-workspace.test.ts`

- [ ] Replace `flex-1` with `min-w-0 flex-none overflow-hidden`, preserve the sidebar offset, and add matching collapsed/expanded width calculations.
- [ ] Add `meetily-main-content` and `min-w-0 w-full` to the main wrapper and inner content boundary.
- [ ] Declare `.meetily-main-content { container: meetily-main / inline-size; }` in global CSS.
- [ ] Run the focused test and verify the remaining-width assertions pass.

### Task 3: Convert meeting layout and summary actions to container queries

**Files:**
- Modify: `frontend/src/app/meeting-details/page-content.tsx`
- Modify: `frontend/src/components/MeetingDetails/MeetingWorkspaceTabs.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
- Modify: `frontend/src/app/globals.css`
- Test: `frontend/tests/lib/sidebar-aware-workspace.test.ts`
- Test: `frontend/tests/lib/responsive-meeting-workspace.test.ts`

- [ ] Give transcript and summary wrappers stable classes, retain React compact visibility as their default, and remove their `lg:` display/max-width/padding rules.
- [ ] Give the floating switcher a stable class and remove `lg:hidden`.
- [ ] Replace every SummaryPanel wide/compact `lg:` visibility pair with `meeting-summary-actions-wide` and `meeting-summary-actions-compact` classes.
- [ ] In `@container meetily-main (min-width: 1024px)`, hide the switcher and compact actions, show both panes and wide actions, cap transcript at 38%, and remove compact pane bottom padding.
- [ ] Run both focused tests and verify all container-query contracts pass.

### Task 4: Verify in code and the installed desktop app

**Files:**
- Verify all changed files.

- [ ] Run `git diff --check`, `cd frontend && bun test`, and `cd frontend && pnpm build`.
- [ ] Commit implementation to `main`, push `origin/main`, trigger the macOS workflow, verify the workflow head SHA, and install its Apple Silicon artifact.
- [ ] In `/Applications/Meetily.app`, verify sidebar collapsed/expanded at wide and narrow widths. The expanded-sidebar ~980 px case must show one complete Summary pane, a reachable compact toolbar, wrapped Markdown, and the floating Transcript/Summary switcher without horizontal clipping.
