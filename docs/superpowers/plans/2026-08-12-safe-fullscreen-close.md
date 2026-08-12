# Safe Fullscreen Close Implementation Plan

1. Add a failing regression test for deferred hiding during fullscreen exit.
2. Track a pending fullscreen-close hide in the Tauri window event handler.
3. Exit fullscreen first and asynchronously hide only after `is_fullscreen()` becomes false.
4. Cancel the pending hide and keep the window visible on errors.
5. Run targeted and full verification, then include the fix in release 0.4.8.
