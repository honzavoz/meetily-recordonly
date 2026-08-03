# Responsive Meeting Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Meetily meeting detail workspace fully usable from `1440 x 900` down to `720 x 520`, with adaptive panes, prioritized actions, and contained scrolling.

**Architecture:** `PageContent` will own a compact-only pane selection and render both meeting panes through a small workspace shell. Existing summary business logic stays in its current components; a focused overflow component exposes secondary actions on compact layouts. CSS media queries control presentation, while small pure helpers make priority and initial-state decisions testable.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Radix UI, Lucide icons, Bun tests, Tauri 2.

---

## File structure

- Create `frontend/src/lib/responsive-meeting-workspace.ts`: pure compact-pane and action-availability helpers.
- Create `frontend/tests/lib/responsive-meeting-workspace.test.ts`: behavior tests for those helpers.
- Create `frontend/src/components/MeetingDetails/MeetingWorkspaceTabs.tsx`: accessible compact pane switcher.
- Create `frontend/src/components/MeetingDetails/SummaryActionsOverflow.tsx`: compact secondary-action menu.
- Modify `frontend/src/app/meeting-details/page-content.tsx`: own selected pane and responsive workspace layout.
- Modify `frontend/src/components/MeetingDetails/TranscriptPanel.tsx`: remove viewport hiding and accept layout visibility classes.
- Modify `frontend/src/components/MeetingDetails/SummaryPanel.tsx`: responsive header, toolbar composition, scroll ownership, and removal of the fixed response overlay.
- Modify `frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx`: support primary-only rendering and responsive dialog containment.
- Modify `frontend/src/components/MeetingDetails/SummaryUpdaterButtonGroup.tsx`: support primary-only rendering.
- Modify `frontend/src/components/ui/dialog.tsx`: safe viewport bounds for all dialogs.

### Task 1: Define responsive workspace behavior

**Files:**
- Create: `frontend/tests/lib/responsive-meeting-workspace.test.ts`
- Create: `frontend/src/lib/responsive-meeting-workspace.ts`

- [ ] **Step 1: Write the failing behavior tests**

```ts
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_COMPACT_MEETING_PANE,
  getCompactSummaryActions,
  type CompactMeetingPane,
} from '@/lib/responsive-meeting-workspace';

describe('responsive meeting workspace', () => {
  test('opens the summary pane by default in compact mode', () => {
    expect(DEFAULT_COMPACT_MEETING_PANE satisfies CompactMeetingPane).toBe('summary');
  });

  test('keeps all available secondary summary actions in the compact menu', () => {
    expect(getCompactSummaryActions({ hasSummary: true, hasTemplates: true })).toEqual([
      'external-ai',
      'paste-ai-result',
      'ai-model',
      'template',
      'copy-summary',
    ]);
  });

  test('omits actions that need unavailable summary data', () => {
    expect(getCompactSummaryActions({ hasSummary: false, hasTemplates: false })).toEqual([
      'external-ai',
      'paste-ai-result',
      'ai-model',
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontend && bun test tests/lib/responsive-meeting-workspace.test.ts`

Expected: FAIL because `@/lib/responsive-meeting-workspace` does not exist.

- [ ] **Step 3: Implement the pure behavior contract**

```ts
export type CompactMeetingPane = 'transcript' | 'summary';

export const DEFAULT_COMPACT_MEETING_PANE: CompactMeetingPane = 'summary';

export type CompactSummaryAction =
  | 'external-ai'
  | 'paste-ai-result'
  | 'ai-model'
  | 'template'
  | 'copy-summary';

export function getCompactSummaryActions({
  hasSummary,
  hasTemplates,
}: {
  hasSummary: boolean;
  hasTemplates: boolean;
}): CompactSummaryAction[] {
  const actions: CompactSummaryAction[] = [
    'external-ai',
    'paste-ai-result',
    'ai-model',
  ];

  if (hasTemplates) actions.push('template');
  if (hasSummary) actions.push('copy-summary');
  return actions;
}
```

- [ ] **Step 4: Run the focused and full helper test suites**

Run: `cd frontend && bun test tests/lib/responsive-meeting-workspace.test.ts`

Expected: 3 PASS.

Run: `cd frontend && bun test tests/lib`

Expected: all tests pass.

- [ ] **Step 5: Commit the behavior contract**

```bash
git add frontend/src/lib/responsive-meeting-workspace.ts frontend/tests/lib/responsive-meeting-workspace.test.ts
git commit -m "test: define responsive meeting workspace behavior"
```

### Task 2: Add the adaptive meeting pane shell

**Files:**
- Create: `frontend/src/components/MeetingDetails/MeetingWorkspaceTabs.tsx`
- Modify: `frontend/src/app/meeting-details/page-content.tsx`
- Modify: `frontend/src/components/MeetingDetails/TranscriptPanel.tsx`

- [ ] **Step 1: Add the compact tab switcher**

Create a controlled component with this public API:

```tsx
import type { CompactMeetingPane } from '@/lib/responsive-meeting-workspace';

interface MeetingWorkspaceTabsProps {
  value: CompactMeetingPane;
  onChange: (pane: CompactMeetingPane) => void;
}

export function MeetingWorkspaceTabs({ value, onChange }: MeetingWorkspaceTabsProps) {
  return (
    <div
      className="grid grid-cols-2 gap-1 border-b border-gray-200 bg-white p-2 lg:hidden"
      role="tablist"
      aria-label="Meeting workspace"
    >
      {(['transcript', 'summary'] as const).map((pane) => (
        <button
          key={pane}
          type="button"
          role="tab"
          aria-selected={value === pane}
          onClick={() => onChange(pane)}
          className={value === pane
            ? 'rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white'
            : 'rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100'}
        >
          {pane === 'transcript' ? 'Transcript' : 'Summary'}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Make `PageContent` own compact pane state**

Import `MeetingWorkspaceTabs`, `CompactMeetingPane`, and `DEFAULT_COMPACT_MEETING_PANE`. Add:

```tsx
const [compactPane, setCompactPane] = useState<CompactMeetingPane>(
  DEFAULT_COMPACT_MEETING_PANE,
);
```

Replace the current inner wrapper with a `min-h-0 min-w-0 overflow-hidden` workspace, render the switcher above the pane row, and wrap each panel with responsive visibility:

```tsx
<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <MeetingWorkspaceTabs value={compactPane} onChange={setCompactPane} />
  <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div className={`${compactPane === 'transcript' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 lg:flex lg:max-w-[38%]`}>
      <TranscriptPanel {...transcriptProps} />
    </div>
    <div className={`${compactPane === 'summary' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 lg:flex`}>
      <SummaryPanel {...summaryProps} />
    </div>
  </div>
</div>
```

Keep the existing props unchanged when moving them into the wrappers. Reset `compactPane` to the default only when `meeting.id` changes, not when the window resizes.

- [ ] **Step 3: Make `TranscriptPanel` layout-neutral**

Change its root classes from viewport-driven hiding and fixed fractions to:

```tsx
className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-gray-200 bg-white"
```

Keep `VirtualizedTranscriptView` inside the existing `flex-1 overflow-hidden` owner. Give the prompt footer `max-h-[35%] shrink-0 overflow-y-auto` so resizing cannot push transcript controls out of view.

- [ ] **Step 4: Verify TypeScript and production compilation**

Run: `cd frontend && pnpm exec tsc --noEmit`

Expected: exit 0.

Run: `cd frontend && pnpm build`

Expected: Next.js build succeeds.

- [ ] **Step 5: Commit the adaptive shell**

```bash
git add frontend/src/components/MeetingDetails/MeetingWorkspaceTabs.tsx frontend/src/app/meeting-details/page-content.tsx frontend/src/components/MeetingDetails/TranscriptPanel.tsx
git commit -m "feat: add adaptive meeting workspace panes"
```

### Task 3: Prioritize summary actions on compact windows

**Files:**
- Create: `frontend/src/components/MeetingDetails/SummaryActionsOverflow.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryUpdaterButtonGroup.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`

- [ ] **Step 1: Add explicit primary-only modes to existing button groups**

Add `showSecondaryActions?: boolean` to `SummaryGeneratorButtonGroupProps`, default it to `true`, and render External AI, Paste AI Result, AI Model, and Template only when it is true. Preserve the generation and language controls in both modes.

Add `showCopy?: boolean` to `SummaryUpdaterButtonGroupProps`, default it to `true`, and render Copy only when it is true. Save remains visible.

- [ ] **Step 2: Create the compact overflow menu**

Give `SummaryActionsOverflow` the existing callbacks and state required by the five secondary actions:

```ts
interface SummaryActionsOverflowProps {
  hasSummary: boolean;
  templates: Array<{ id: string; name: string; description: string }>;
  selectedTemplate: string;
  isPreparingExternalAI: boolean;
  onPrepareExternalAI: () => void;
  onOpenPasteExternalAI: () => void;
  onOpenModelSettings: () => void;
  onTemplateSelect: (id: string, name: string) => void;
  onCopySummary: () => Promise<void>;
}
```

Render a `MoreHorizontal` button labeled `More` as the `DropdownMenuTrigger`. Build items from `getCompactSummaryActions`. Use icons and visible text for every item. Put templates in a `DropdownMenuSub`; use `Check` on the selected template. Disable External AI while its prompt is being prepared. Invoke the same analytics names used by the existing direct buttons.

- [ ] **Step 3: Compose wide and compact toolbars in `SummaryPanel`**

Replace the centered non-wrapping toolbar with:

```tsx
<div className="flex min-w-0 flex-wrap items-center justify-between gap-2 pt-1">
  <div className="hidden min-w-0 flex-wrap items-center gap-2 lg:flex">
    {/* existing full generator and updater groups */}
  </div>
  <div className="flex min-w-0 flex-1 items-center justify-between gap-2 lg:hidden">
    <SummaryGeneratorButtonGroup showSecondaryActions={false} {...generatorProps} />
    <div className="flex shrink-0 items-center gap-2">
      <SummaryUpdaterButtonGroup showCopy={false} {...updaterProps} />
      <SummaryActionsOverflow {...overflowProps} />
    </div>
  </div>
</div>
```

Use the same compact composition during generation and in the empty state. Register one stable model-settings opener in `SummaryPanel`, so both the wide direct button and compact menu open the same dialog.

- [ ] **Step 4: Remove the escaping fixed overlay**

Delete the `summaryResponse && <div className="fixed bottom-0 ...">` block from `SummaryPanel`. Remove imports or props made unused by the deletion only when TypeScript confirms they are no longer referenced. Do not change editable summary rendering.

- [ ] **Step 5: Run behavior tests and compilation**

Run: `cd frontend && bun test tests/lib/responsive-meeting-workspace.test.ts`

Expected: 3 PASS.

Run: `cd frontend && pnpm exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 6: Commit compact actions**

```bash
git add frontend/src/components/MeetingDetails/SummaryActionsOverflow.tsx frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx frontend/src/components/MeetingDetails/SummaryUpdaterButtonGroup.tsx frontend/src/components/MeetingDetails/SummaryPanel.tsx
git commit -m "feat: keep summary actions reachable in compact windows"
```

### Task 4: Contain scrolling and dialogs

**Files:**
- Modify: `frontend/src/components/ui/dialog.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx`
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`

- [ ] **Step 1: Bound the shared dialog primitive to the viewport**

Add these base classes to `DialogContent` without removing existing animation or positioning classes:

```text
max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto
```

Keep the close button absolutely positioned and above scrolling content with `z-10 bg-background/90`.

- [ ] **Step 2: Establish one summary scroll owner**

Give the `SummaryPanel` root `min-h-0 overflow-hidden`. Give its title and toolbar header `shrink-0`. Keep only the editor/content wrapper as `min-h-0 flex-1 overflow-y-auto overscroll-contain`. Ensure loading and empty states use `min-h-0 flex-1 overflow-y-auto` instead of `h-full` where content can exceed the viewport.

- [ ] **Step 3: Constrain popovers and menus**

Set the language popover to `max-w-[calc(100vw-2rem)]`. Set the compact overflow menu to `w-56 max-w-[calc(100vw-2rem)]`. Keep Radix collision detection and available-height scrolling enabled.

- [ ] **Step 4: Run regression checks**

Run: `cd frontend && bun test tests/lib`

Expected: all tests pass.

Run: `cd frontend && pnpm exec tsc --noEmit`

Expected: exit 0.

Run: `cd frontend && pnpm build`

Expected: Next.js production build succeeds without new warnings.

- [ ] **Step 5: Commit containment fixes**

```bash
git add frontend/src/components/ui/dialog.tsx frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx frontend/src/components/MeetingDetails/SummaryPanel.tsx
git commit -m "fix: contain meeting dialogs and scrolling"
```

### Task 5: Responsive desktop QA

**Files:**
- Modify only files required by issues reproduced during QA.

- [ ] **Step 1: Start Meetily in development mode**

Run: `cd frontend && pnpm tauri:dev`

Expected: the Tauri Meetily window opens and loads an existing meeting.

- [ ] **Step 2: Verify the wide layouts**

At `1440 x 900` and `1100 x 700`, verify transcript and summary are both visible, the title and project chips wrap within the summary header, all direct actions are reachable, each pane scrolls independently, and no horizontal scrollbar appears.

- [ ] **Step 3: Verify the compact layouts**

At `900 x 650` and `720 x 520`, verify the Transcript and Summary tabs switch panes without data loss, Generate, language, Save, and More remain visible, every secondary action appears in More, and long titles or project chips do not displace controls.

- [ ] **Step 4: Verify overlays and transient states**

At `720 x 520`, open Language, More, AI Model, Template, Paste AI Result, and any summary-related dialog. Verify every overlay fits the window, scrolls internally when needed, closes with its visible close control or Escape, and returns focus to its trigger. Verify empty-summary and active-generation states do not overflow.

- [ ] **Step 5: Fix each reproduced defect with RED-GREEN verification**

For logic defects, first add a focused failing Bun test, run it to observe the expected failure, implement the smallest fix, and rerun it. For CSS-only defects, capture the exact viewport and failing visible state before changing classes, then repeat the same viewport check after the fix.

- [ ] **Step 6: Run the final verification suite**

Run: `cd frontend && bun test tests/lib && pnpm exec tsc --noEmit && pnpm build`

Expected: all tests pass, TypeScript exits 0, and the production build succeeds.

- [ ] **Step 7: Commit QA fixes, if any**

```bash
git add frontend/src/app/meeting-details/page-content.tsx frontend/src/components/MeetingDetails/MeetingWorkspaceTabs.tsx frontend/src/components/MeetingDetails/SummaryActionsOverflow.tsx frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx frontend/src/components/MeetingDetails/SummaryPanel.tsx frontend/src/components/MeetingDetails/SummaryUpdaterButtonGroup.tsx frontend/src/components/MeetingDetails/TranscriptPanel.tsx frontend/src/components/ui/dialog.tsx frontend/src/lib/responsive-meeting-workspace.ts frontend/tests/lib/responsive-meeting-workspace.test.ts
git commit -m "fix: polish responsive meeting workspace"
```

If QA requires no fixes, do not create an empty commit.
