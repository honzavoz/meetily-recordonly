# Stable Compact Switcher and Markdown Wrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent workspace reflow at the compact breakpoint and make all normal Markdown text follow the summary pane width.

**Architecture:** Keep the existing React pane state and breakpoint while moving the compact switcher out of normal flow inside a positioned workspace. Extend the existing scoped summary CSS through BlockNote's complete intrinsic-width chain; preserve local overflow only for code and tables.

**Tech Stack:** React 18, Next.js 14, TypeScript, Tailwind CSS, BlockNote 0.36, Bun test.

---

### Task 1: Lock down the two regressions

**Files:**
- Modify: `frontend/tests/lib/responsive-markdown-summary.test.ts`
- Modify: `frontend/tests/lib/responsive-meeting-workspace.test.ts`

- [ ] Add source-contract assertions that `MeetingWorkspaceTabs` uses fixed positioning and that the workspace is a `relative` positioning boundary.
- [ ] Add CSS assertions for scoped `.bn-block-group`, `.bn-inline-content`, `[contenteditable]`, and `white-space: pre-wrap` rules.
- [ ] Run `cd frontend && bun test tests/lib/responsive-markdown-summary.test.ts tests/lib/responsive-meeting-workspace.test.ts` and verify the new assertions fail for the missing behavior.

### Task 2: Remove compact-switcher reflow

**Files:**
- Modify: `frontend/src/components/MeetingDetails/MeetingWorkspaceTabs.tsx`
- Modify: `frontend/src/app/meeting-details/page-content.tsx`

- [ ] Make the workspace wrapper `relative`.
- [ ] Position the compact switcher fixed at the bottom center with a bounded width, opaque surface, border, shadow, safe inset, and unchanged keyboard/pressed semantics.
- [ ] Add compact bottom scroll padding to both panes so their final content remains reachable behind the floating switcher.
- [ ] Run the two focused responsive tests and verify they pass.

### Task 3: Complete BlockNote width containment

**Files:**
- Modify: `frontend/src/app/globals.css`
- Test: `frontend/tests/lib/responsive-markdown-summary.test.ts`

- [ ] Include `.bn-block-group`, `.bn-inline-content`, and editable descendants in the scoped `min-width: 0; max-width: 100%` containment chain.
- [ ] Apply `white-space: pre-wrap`, `overflow-wrap: anywhere`, and `word-break: break-word` to normal editable Markdown content while retaining local horizontal scrolling for `pre` and tables.
- [ ] Run the focused tests, then `cd frontend && bun test`.

### Task 4: Verify and deliver

**Files:**
- Verify all changed files.

- [ ] Run `git diff --check`, `cd frontend && bun test`, and `cd frontend && pnpm build`.
- [ ] Commit the tests and implementation to `main`, push `origin/main`, and trigger `Build and Test - macOS` for the resulting HEAD.
- [ ] Verify the workflow head SHA, download its Apple Silicon artifact, validate bundle identity and integrity, replace `/Applications/Meetily.app`, launch it, and verify the running process path.
