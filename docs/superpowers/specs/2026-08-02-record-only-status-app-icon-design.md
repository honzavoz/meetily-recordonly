# Record Only Status and App Icon Design

## Goal

Make Record Only mode describe its real behavior and give the app a simple, recognizable icon.

## Recording status

The transcript empty state must distinguish Record Only from live transcription.

- In Record Only mode while recording, show `Recording audio…`.
- Under it, show `Transcription will be available after you stop recording.`
- Do not show `Listening for speech…`, `Speak to see live transcription`, or a live-listening indicator in Record Only mode.
- Keep the existing paused state and resume instruction.
- Keep the current live-transcription copy when live transcription is enabled.

The recording screen will pass the current recording mode into the transcript view. A small pure helper will select the empty-state copy so both transcript renderers use the same behavior and tests can cover it without mounting the full recording screen.

## App icon

Replace the current wordmark illustration with one compact symbol: a white `M` formed from a sound wave on a dark purple rounded-square background.

The symbol must remain legible at 16 px, use no text beyond the `M` shape, and avoid fine detail, shadows inside the mark, mascots, and microphone imagery. The macOS version may use subtle platform-appropriate depth around the rounded tile, while the central mark stays flat and high-contrast.

Generate one approved master image, inspect it at full size and at small-icon scale, then derive the PNG, ICNS, ICO, favicon, and public web icon assets already referenced by the project. Keep filenames and Tauri configuration unchanged.

## Error handling and compatibility

If the recording mode is absent, preserve the existing live-transcription behavior. This keeps older callers compatible. Icon generation must not remove or rename configured bundle assets.

## Verification

- Add failing unit tests for Record Only, live transcription, paused recording, and the compatibility default before changing production code.
- Run the focused frontend tests, then the relevant frontend test suite and build checks.
- Verify every configured icon file exists and inspect the generated 512 px and 16 px PNGs.
- Confirm the Record Only screen no longer contains live-transcription instructions while recording.

## Out of scope

This change does not alter recording, transcription, Transcribe Later, or meeting persistence. It does not add icon variants or an in-app icon selector.
