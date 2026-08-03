# Responsive Markdown Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Markdown summaries readable and every summary/dialog action reachable from `1440 x 900` down to `720 x 520`.

**Architecture:** Scope responsive overflow rules to a dedicated summary-editor boundary instead of applying unrestricted global BlockNote overflow. Keep the summary panel as the sole vertical scroll owner, constrain intrinsically wide Markdown nodes locally, and use the existing sticky dialog primitives with flex-safe content sizing.

**Tech Stack:** React 18, Next.js 14, TypeScript, Tailwind CSS, BlockNote 0.36, Bun test.

---

### Task 1: Define the responsive Markdown layout contract

**Files:**
- Create: `frontend/tests/lib/responsive-markdown-summary.test.ts`
- Create: `frontend/src/lib/responsive-markdown-summary.ts`

- [ ] **Step 1: Write the failing contract test**

Create a test that imports `RESPONSIVE_MARKDOWN_SUMMARY_CLASSES` and asserts distinct class contracts for the panel scroll area, editor boundary, and dialog body. The editor contract must include `min-w-0`, the scroll owner must include `overflow-y-auto`, and the dialog contract must include `min-h-0` and `overflow-y-auto`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd frontend && bun test tests/lib/responsive-markdown-summary.test.ts`

Expected: FAIL because `@/lib/responsive-markdown-summary` does not exist.

- [ ] **Step 3: Add the minimal shared class contract**

Export a frozen object from `frontend/src/lib/responsive-markdown-summary.ts`:

```ts
export const RESPONSIVE_MARKDOWN_SUMMARY_CLASSES = Object.freeze({
  scrollArea: 'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain',
  editorBoundary: 'meetily-summary-editor min-w-0 w-full max-w-full',
  dialog: 'flex max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] flex-col overflow-hidden',
  dialogBody: 'min-h-0 min-w-0 overflow-x-hidden overflow-y-auto',
});
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd frontend && bun test tests/lib/responsive-markdown-summary.test.ts`

Expected: all responsive Markdown contract tests pass.

- [ ] **Step 5: Commit the contract**

```bash
git add frontend/src/lib/responsive-markdown-summary.ts frontend/tests/lib/responsive-markdown-summary.test.ts
git commit -m "test: define responsive markdown summary contract"
```

### Task 2: Constrain BlockNote Markdown content locally

**Files:**
- Modify: `frontend/src/components/AISummary/BlockNoteSummaryView.tsx`
- Modify: `frontend/src/app/globals.css`
- Test: `frontend/tests/lib/responsive-markdown-summary.test.ts`

- [ ] **Step 1: Extend the failing test for editor styling**

Read `frontend/src/app/globals.css` and assert that `.meetily-summary-editor` contains `overflow-wrap: anywhere`, that `pre` and table wrappers use local `overflow-x: auto`, and that the old global `[data-node-type] { overflow: visible !important; }` override is absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd frontend && bun test tests/lib/responsive-markdown-summary.test.ts`

Expected: FAIL on the missing scoped wrapping rules and remaining global overflow override.

- [ ] **Step 3: Apply the editor boundary and scoped CSS**

Wrap both BlockNote and Markdown render paths in `RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.editorBoundary`. Replace the unrestricted global BlockNote overflow overrides with `.meetily-summary-editor` rules that keep containers at `min-width: 0; width: 100%; max-width: 100%`, wrap prose/links/headings with `overflow-wrap: anywhere`, constrain images/media to `max-width: 100%`, and give `pre` plus BlockNote table wrappers local `max-width: 100%; overflow-x: auto`.

- [ ] **Step 4: Run focused and existing workspace tests**

Run: `cd frontend && bun test tests/lib/responsive-markdown-summary.test.ts tests/lib/responsive-meeting-workspace.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit the editor fix**

```bash
git add frontend/src/components/AISummary/BlockNoteSummaryView.tsx frontend/src/app/globals.css frontend/tests/lib/responsive-markdown-summary.test.ts
git commit -m "fix: constrain markdown summary overflow"
```

### Task 3: Keep summary actions and External AI dialogs reachable

**Files:**
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryUpdaterButtonGroup.tsx`
- Test: `frontend/tests/lib/responsive-markdown-summary.test.ts`

- [ ] **Step 1: Extend the failing contract test**

Assert that the exported scroll-area contract hides horizontal overflow, the updater group exposes a wrapping layout class, and dialog bodies have their own bounded vertical overflow class.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd frontend && bun test tests/lib/responsive-markdown-summary.test.ts`

Expected: FAIL because the updater wrapping contract is absent from the components.

- [ ] **Step 3: Apply bounded layout classes**

Use the shared `scrollArea` and `editorBoundary` contracts around the summary body. Give the title/action header `min-w-0`, allow the updater button group to wrap without shrinking buttons, and render each External AI dialog as a bounded three-region layout with a `dialogBody` wrapper around alerts, controls, and textarea. Keep `DialogHeader` and `DialogFooter` outside that body so they remain visible.

- [ ] **Step 4: Run focused and complete unit tests**

Run: `cd frontend && bun test`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Commit the reachable-action fix**

```bash
git add frontend/src/components/MeetingDetails/SummaryPanel.tsx frontend/src/components/MeetingDetails/SummaryUpdaterButtonGroup.tsx frontend/tests/lib/responsive-markdown-summary.test.ts
git commit -m "fix: keep summary actions reachable"
```

### Task 4: Production verification

**Files:**
- Verify only; no additional production files expected.

- [ ] **Step 1: Run formatting and whitespace verification**

Run: `git diff --check`

Expected: exit code 0 with no output.

- [ ] **Step 2: Run the complete frontend test suite**

Run: `cd frontend && bun test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run the production frontend build**

Run: `cd frontend && pnpm build`

Expected: Next.js production build exits with code 0.

- [ ] **Step 4: Inspect final scope**

Run: `git status --short && git log -5 --oneline`

Expected: only the pre-existing `.pnpm-store/` remains untracked and the Markdown responsiveness commits are on `main`.
