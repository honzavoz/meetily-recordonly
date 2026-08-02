# Record Only Status and App Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show truthful recording-only status copy and replace the current wordmark icon with a compact sound-wave `M` icon.

**Architecture:** Keep recording-mode decisions in pure helpers under `frontend/src/lib/recording-mode.ts`, store the active session's transcription mode in `RecordingStateContext`, and pass it explicitly into both transcript views. Generate one 1024 px icon master, use Tauri's icon generator for platform assets, and preserve the bundle filenames already referenced by configuration.

**Tech Stack:** Next.js 14, React 18, TypeScript, Bun tests, Tauri 2, ImageGen, ImageMagick, macOS `iconutil`/`sips`.

---

## File map

- Modify `frontend/src/lib/recording-mode.ts`: pure status-copy and listening-indicator decisions.
- Modify `frontend/tests/lib/recording-mode.test.ts`: Record Only, live transcription, paused, and compatibility coverage.
- Modify `frontend/src/contexts/RecordingStateContext.tsx`: expose the transcription mode for the active recording session.
- Modify `frontend/src/hooks/useRecordingStart.ts`: save the preference used to choose `start_recording` or `start_record_only` into recording state.
- Modify `frontend/src/app/_components/TranscriptPanel.tsx`: pass the active mode into the transcript renderer.
- Modify `frontend/src/components/VirtualizedTranscriptView.tsx`: render the shared status copy and suppress live listening UI in Record Only mode.
- Modify `frontend/src/components/TranscriptView.tsx`: keep the legacy renderer behavior consistent.
- Create `frontend/src-tauri/icons/icon-master.png`: approved 1024 px source artwork.
- Replace existing generated files under `frontend/src-tauri/icons/`, `frontend/public/`, and `frontend/src/app/favicon.ico` without renaming configured assets.

### Task 1: Define recording transcript status behavior

**Files:**
- Modify: `frontend/tests/lib/recording-mode.test.ts`
- Modify: `frontend/src/lib/recording-mode.ts`

- [ ] **Step 1: Write failing helper tests**

Add this import and test block:

```ts
import {
  getLiveTranscriptionEnabled,
  getRecordingTranscriptStatus,
  shouldPersistTranscriptMeeting,
  shouldRequireTranscriptionModel,
} from "../../src/lib/recording-mode";

describe("recording transcript status", () => {
  test("describes deferred transcription in Record Only mode", () => {
    expect(getRecordingTranscriptStatus(false, false)).toEqual({
      title: "Recording audio…",
      description: "Transcription will be available after you stop recording.",
      showListeningIndicator: false,
    });
  });

  test("keeps live transcription instructions when enabled", () => {
    expect(getRecordingTranscriptStatus(false, true)).toEqual({
      title: "Listening for speech...",
      description: "Speak to see live transcription",
      showListeningIndicator: true,
    });
  });

  test("keeps paused copy in either recording mode", () => {
    expect(getRecordingTranscriptStatus(true, false)).toEqual({
      title: "Recording paused",
      description: "Click resume to continue recording",
      showListeningIndicator: false,
    });
  });

  test("defaults omitted mode to live transcription for older callers", () => {
    expect(getRecordingTranscriptStatus(false)).toMatchObject({
      title: "Listening for speech...",
      showListeningIndicator: true,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd frontend && npx --yes bun test tests/lib/recording-mode.test.ts`

Expected: FAIL because `getRecordingTranscriptStatus` is not exported.

- [ ] **Step 3: Add the minimal pure helper**

Add to `frontend/src/lib/recording-mode.ts`:

```ts
export interface RecordingTranscriptStatus {
  title: string;
  description: string;
  showListeningIndicator: boolean;
}

export function getRecordingTranscriptStatus(
  isPaused: boolean,
  liveTranscriptionEnabled = true,
): RecordingTranscriptStatus {
  if (isPaused) {
    return {
      title: 'Recording paused',
      description: 'Click resume to continue recording',
      showListeningIndicator: false,
    };
  }

  if (!liveTranscriptionEnabled) {
    return {
      title: 'Recording audio…',
      description: 'Transcription will be available after you stop recording.',
      showListeningIndicator: false,
    };
  }

  return {
    title: 'Listening for speech...',
    description: 'Speak to see live transcription',
    showListeningIndicator: true,
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd frontend && npx --yes bun test tests/lib/recording-mode.test.ts`

Expected: all recording-mode tests PASS.

- [ ] **Step 5: Commit the behavior contract**

```bash
git add frontend/src/lib/recording-mode.ts frontend/tests/lib/recording-mode.test.ts
git commit -m "test: define record-only transcript status"
```

### Task 2: Keep the active recording mode in shared state

**Files:**
- Modify: `frontend/src/contexts/RecordingStateContext.tsx`
- Modify: `frontend/src/hooks/useRecordingStart.ts`

- [ ] **Step 1: Extend recording state and its context API**

Add `liveTranscriptionEnabled: boolean` to `RecordingState`, add `setLiveTranscriptionEnabled: (enabled: boolean) => void` to `RecordingStateContextType`, initialize the state field to `true`, and add this callback:

```ts
const setLiveTranscriptionEnabled = useCallback((enabled: boolean) => {
  setState(prev => ({ ...prev, liveTranscriptionEnabled: enabled }));
}, []);
```

Include `setLiveTranscriptionEnabled` in `contextValue` and its dependency list.

- [ ] **Step 2: Store the exact preference used when recording starts**

In `useRecordingStart`, destructure the setter:

```ts
const { setStatus, setLiveTranscriptionEnabled } = useRecordingState();
```

Update `loadLiveTranscriptionEnabled` so every successful or fallback read updates shared state before returning:

```ts
const loadLiveTranscriptionEnabled = useCallback(async (): Promise<boolean> => {
  try {
    const preferences = await invoke('get_recording_preferences');
    const enabled = getLiveTranscriptionEnabled(preferences as any);
    setLiveTranscriptionEnabled(enabled);
    return enabled;
  } catch (error) {
    console.error('Failed to load recording mode preferences:', error);
    setLiveTranscriptionEnabled(true);
    return true;
  }
}, [setLiveTranscriptionEnabled]);
```

- [ ] **Step 3: Run TypeScript/build validation**

Run: `cd frontend && pnpm build`

Expected: Next.js build completes without TypeScript errors.

- [ ] **Step 4: Commit shared recording mode state**

```bash
git add frontend/src/contexts/RecordingStateContext.tsx frontend/src/hooks/useRecordingStart.ts
git commit -m "feat: expose active recording transcription mode"
```

### Task 3: Render truthful status in both transcript views

**Files:**
- Modify: `frontend/src/app/_components/TranscriptPanel.tsx`
- Modify: `frontend/src/components/VirtualizedTranscriptView.tsx`
- Modify: `frontend/src/components/TranscriptView.tsx`

- [ ] **Step 1: Pass the active mode from the recording screen**

Read `liveTranscriptionEnabled` from `useRecordingState()` in `TranscriptPanel` and pass it to `VirtualizedTranscriptView`:

```tsx
const { isRecording, isPaused, liveTranscriptionEnabled } = useRecordingState();

<VirtualizedTranscriptView
  segments={segments}
  isRecording={isRecording}
  isPaused={isPaused}
  isProcessing={isProcessingStop}
  isStopping={isStopping}
  enableStreaming={isRecording}
  showConfidence={true}
  liveTranscriptionEnabled={liveTranscriptionEnabled}
/>
```

- [ ] **Step 2: Use the helper in the virtualized view**

Add the optional prop with a compatibility default:

```ts
liveTranscriptionEnabled?: boolean;
```

Import `getRecordingTranscriptStatus`, set `liveTranscriptionEnabled = true` while destructuring props, and compute:

```ts
const recordingStatus = getRecordingTranscriptStatus(
  isPaused,
  liveTranscriptionEnabled,
);
```

Render `recordingStatus.title` and `recordingStatus.description` in the recording empty state. Gate the lower listening row with `recordingStatus.showListeningIndicator` so Record Only never displays `Listening...` when segments exist.

- [ ] **Step 3: Apply the same compatibility prop to the legacy view**

Add `liveTranscriptionEnabled?: boolean` to `TranscriptViewProps`, default it to `true`, compute the same `recordingStatus`, replace the two hard-coded empty-state strings, and gate its listening row with `recordingStatus.showListeningIndicator`.

- [ ] **Step 4: Verify the helper tests and frontend build**

Run: `cd frontend && npx --yes bun test tests/lib/recording-mode.test.ts`

Expected: PASS.

Run: `cd frontend && pnpm build`

Expected: build completes and static pages export successfully.

- [ ] **Step 5: Check that only live-mode fallback copy remains hard-coded**

Run: `rg -n "Listening for speech|Speak to see live transcription" frontend/src/components frontend/src/app`

Expected: matches occur only in `frontend/src/lib/recording-mode.ts`.

- [ ] **Step 6: Commit the UI fix**

```bash
git add frontend/src/app/_components/TranscriptPanel.tsx frontend/src/components/VirtualizedTranscriptView.tsx frontend/src/components/TranscriptView.tsx
git commit -m "fix: show record-only recording status"
```

### Task 4: Generate and install the sound-wave M icon

**Files:**
- Create: `frontend/src-tauri/icons/icon-master.png`
- Replace: generated image assets under `frontend/src-tauri/icons/`
- Replace: `frontend/public/icon_128x128.png`
- Replace: `frontend/public/icon_32x32@2x.png`
- Replace: `frontend/src/app/favicon.ico`

- [ ] **Step 1: Generate one project-bound master with ImageGen**

Use the built-in ImageGen tool with this prompt and copy its selected output to `frontend/src-tauri/icons/icon-master.png`:

```text
Use case: logo-brand
Asset type: desktop application icon master, 1024 by 1024
Primary request: create a compact white capital M whose strokes form one continuous audio waveform
Scene/backdrop: dark rich purple rounded-square app tile with transparent outer corners
Style/medium: minimal vector-friendly geometric brand mark, polished macOS app icon
Composition/framing: centered oversized M-wave symbol with generous optical padding and strong silhouette
Color palette: white symbol, deep purple tile; subtle purple tonal depth only on the tile
Constraints: readable at 16 px; one symbol; no words; no mascot; no microphone; no extra objects; no watermark; no fine detail; central mark stays flat and high contrast
```

- [ ] **Step 2: Inspect the master before replacing assets**

Open the master at original resolution and render a temporary 16 px preview:

Run: `magick frontend/src-tauri/icons/icon-master.png -resize 16x16 /private/tmp/meetily-icon-16.png`

Expected: the `M` and waveform remain recognizable at both sizes, with no text, watermark, or clipped edges.

- [ ] **Step 3: Generate Tauri platform icons**

Run: `cd frontend && pnpm tauri icon src-tauri/icons/icon-master.png`

Expected: Tauri regenerates PNG, ICNS, ICO, and Windows Store icon sizes under `frontend/src-tauri/icons/`.

- [ ] **Step 4: Preserve configured bundle aliases and web assets**

Run these mechanical copies/conversions:

```bash
cp frontend/src-tauri/icons/icon.icns frontend/src-tauri/icons/app_icon.icns
cp frontend/src-tauri/icons/icon.ico frontend/src-tauri/icons/app_icon.ico
cp frontend/src-tauri/icons/128x128.png frontend/public/icon_128x128.png
cp frontend/src-tauri/icons/32x32@2x.png frontend/public/icon_32x32@2x.png
cp frontend/src-tauri/icons/icon.ico frontend/src/app/favicon.ico
```

- [ ] **Step 5: Validate dimensions, formats, and bundle references**

Run:

```bash
file frontend/src-tauri/icons/icon.png frontend/src-tauri/icons/icon.icns frontend/src-tauri/icons/app_icon.icns frontend/src-tauri/icons/icon.ico frontend/src-tauri/icons/app_icon.ico frontend/public/icon_128x128.png frontend/public/icon_32x32@2x.png frontend/src/app/favicon.ico
```

Expected: valid 1024 px PNG, macOS ICNS files, Windows ICO files, 128 px and 64 px public PNGs, and a valid favicon ICO.

- [ ] **Step 6: Commit the icon set**

```bash
git add frontend/src-tauri/icons frontend/public/icon_128x128.png frontend/public/icon_32x32@2x.png frontend/src/app/favicon.ico
git commit -m "feat: refresh app icon with sound-wave mark"
```

### Task 5: Final verification

**Files:**
- Verify all modified files from Tasks 1 through 4.

- [ ] **Step 1: Run the frontend unit tests**

Run: `cd frontend && npx --yes bun test tests/lib tests/services`

Expected: all discovered tests PASS.

- [ ] **Step 2: Run the production frontend build**

Run: `cd frontend && pnpm build`

Expected: Next.js compilation, type checking, and export complete successfully.

- [ ] **Step 3: Inspect final icon sizes visually**

Inspect `frontend/src-tauri/icons/icon_512x512.png` and `frontend/src-tauri/icons/icon_16x16.png`.

Expected: the same white sound-wave `M` is centered and readable in both files.

- [ ] **Step 4: Review repository scope**

Run: `git status --short && git diff --check HEAD~3..HEAD`

Expected: no whitespace errors; the pre-existing deletion of `frontend/src-tauri/build/ffmpeg.rs` remains outside these commits and must not be staged.

- [ ] **Step 5: Report the result**

Report the exact test/build results, the icon master path, and any pre-existing unrelated worktree changes. Do not push or deploy unless the user requests it.
