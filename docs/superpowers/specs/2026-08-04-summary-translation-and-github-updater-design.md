# Summary Translation Reliability and GitHub Updater Design

## Goal

Make Czech summary generation reliable for long meetings and establish a working macOS update channel backed by GitHub Releases. Preserve local meeting data, the existing English canonical summary, and the current user-confirmed update experience.

## Summary generation architecture

The summary pipeline keeps its English canonical report because that result supports later language changes without repeating transcript summarization. Translation becomes a bounded Markdown transform instead of one unbounded request:

1. Generate or reuse the canonical English report.
2. Split the report at Markdown section boundaries while keeping headings, lists, tables, and fenced blocks intact. Only sections that exceed the safe request budget may be split further at paragraph boundaries.
3. Translate chunks sequentially with the selected provider and model, then concatenate them without adding separators or commentary.
4. Retry one timed-out translation chunk once. Cancellation remains immediate and is never retried.
5. Cache the completed English report independently of the translated output so retrying after a translation failure does not repeat pass one.

Short reports remain a single translation request. English output and English-normalization behavior remain unchanged.

## Errors and recovery

Timeout messages must report the actual configured duration instead of the stale hard-coded 60-second value. Errors identify whether summary creation or translation failed and, for chunked translation, which section could not be completed. Provider response bodies and secrets must not be exposed in user-facing errors.

If translation still fails after its single retry, the process remains failed rather than silently presenting English as Czech. The preserved English cache is reused by the next retry when the transcript, template, prompt, provider, and model inputs are unchanged.

## GitHub update channel

Version 0.4.5 is the bootstrap release for the new updater signing identity.

- Generate one Tauri Ed25519 updater keypair locally without printing the private key.
- Store the private key and its password only as GitHub Actions secrets.
- Embed only the public key in `tauri.conf.json` and enable updater artifacts.
- Keep the updater endpoint at this repository's latest GitHub Release `latest.json`.
- Build the Apple Silicon application, updater archive, signature, DMG, and manifest from the same tagged commit.
- Publish the GitHub Release after every required macOS artifact has been verified; drafts must never be treated as an active update channel.

There is no Apple Developer signing identity on this machine or in repository secrets. The bootstrap release is therefore updater-signed but ad-hoc signed for macOS. Users install 0.4.5 manually once and may need Finder's **Open** confirmation. From 0.4.5 onward, Tauri verifies updater signatures and the application automatically checks GitHub shortly after launch; installation still requires explicit user confirmation.

The workflow fails before publishing if updater secrets are missing, version declarations disagree, the tag already exists, or any expected artifact/signature/manifest is absent. The private updater key is never committed, logged, uploaded as a normal artifact, or stored in the application bundle.

## UI behavior

No new settings surface is required. The existing update notification, update dialog, About-page manual check, progress display, install action, and relaunch behavior remain. Summary generation continues to use the existing progress and error surfaces; only the error accuracy and recovery behavior change.

## Testing and verification

Follow red-green TDD for:

- Markdown-aware translation chunk boundaries and exact reassembly.
- One retry for timeout failures and no retry for cancellation or ordinary provider errors.
- Reuse of the English cache after a failed translation.
- Timeout messages reflecting their real configured duration.
- Release workflow preflight, updater artifact generation, and publication gates.

Run focused Rust tests, the complete Rust workspace tests, frontend tests, lint, production frontend build, version-consistency checks, shell syntax checks, and `git diff --check`. Build 0.4.5 on GitHub, verify the published release contains the DMG, updater archive, `.sig`, and `latest.json`, verify the manifest points to the matching tagged artifact, then install the bootstrap DMG and perform a live update check. Re-run the previously failed Czech meeting summary and confirm the final stored Markdown is Czech.

## Safety boundaries

Do not modify, delete, or fabricate meetings, transcripts, recordings, projects, preferences, or model files. Read-only inspection of the failed summary row is allowed. Any live retry uses the existing meeting and must preserve its transcript. Preserve the untracked `.pnpm-store/` directory. Do not claim full Apple notarization until an Apple Developer certificate and notarization credentials are separately supplied.
