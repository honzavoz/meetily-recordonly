# Summary More Button Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the compact `More` summary action exactly the same height as the adjacent `Save` action.

**Architecture:** Retain the shared small `Button` sizing contract for both controls. Remove only the overflow trigger's local minimum-height override and protect that contract with a focused source-level regression test.

**Tech Stack:** React, TypeScript, Tailwind CSS, shadcn-style Button, Bun test

---

### Task 1: Align the overflow trigger

**Files:**
- Modify: `frontend/src/components/MeetingDetails/SummaryActionsOverflow.tsx`
- Test: `frontend/tests/lib/responsive-markdown-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Read `SummaryActionsOverflow.tsx` in the responsive summary test and assert that the trigger retains `size="sm"` while the source does not contain `min-h-11`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd frontend && pnpm exec bun test tests/lib/responsive-markdown-summary.test.ts`

Expected: FAIL because `SummaryActionsOverflow.tsx` still contains `min-h-11`.

- [ ] **Step 3: Implement the minimal fix**

Change the trigger class from:

```tsx
className="min-h-11 shrink-0 cursor-pointer gap-2"
```

to:

```tsx
className="shrink-0 cursor-pointer gap-2"
```

- [ ] **Step 4: Verify the focused and complete test suites**

Run:

```bash
cd frontend
pnpm exec bun test tests/lib/responsive-markdown-summary.test.ts
pnpm exec bun test
pnpm build
```

Expected: all tests and the production build pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add frontend/tests/lib/responsive-markdown-summary.test.ts frontend/src/components/MeetingDetails/SummaryActionsOverflow.tsx
git commit -m "fix: align compact summary actions"
```
