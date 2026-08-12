# Safe Fullscreen Close Design

## Problem

The macOS close action is intentionally converted into “hide to tray”. When the main window is fullscreen, Meetily currently hides it immediately while macOS is still performing the native fullscreen transition. This leaves the fullscreen Space visible without a usable window, which appears as a black screen, while the application keeps running.

## Behavior

- Closing the normal main window continues to hide it to the tray.
- Closing the fullscreen main window first requests an exit from fullscreen.
- The window is hidden only after the native macOS `NSWindowStyleMaskFullScreen` bit is cleared.
- If querying or leaving fullscreen fails, the window remains visible and the pending hide is cancelled.
- Reopening the app from the Dock or tray cancels any pending hide.
- A normal user-initiated fullscreen exit does not hide the window.

## Implementation

Keep a process-local generation token for the single main window. Each accepted close owns a unique token; repeated closes are ignored while it is pending, reopening cancels it, and an older task can never consume a newer request. Tauri 2.11 does not expose the native fullscreen-change event through its public `WindowEvent`, and its cached `is_fullscreen()` state changes before the macOS animation completes. The task therefore reads the native `NSWindow` style mask on the main thread and waits for its fullscreen bit to clear before hiding the window. If the close arrives while fullscreen is still being entered, it first observes the native fullscreen state and then waits for the completed exit. Hide and reopen are both serialized on the main thread, so reopen either cancels a not-yet-executed hide or runs after the hide and visibly wins. Non-fullscreen closes hide immediately after the asynchronous native-state check.

## Verification

A source-level regression test checks the required event ordering and failure handling. The release also runs the existing frontend suite, lint, production build, and the macOS Rust tests in CI.
