# Chrome Web Store manifest key packaging design

**Status:** Approved

## Problem

The Chrome Web Store rejects the initial upload because the packaged
`manifest.json` contains the development-only `key` field. The current build
copies the source manifest into `chrome-extension/dist`, and the Store packager
then archives that manifest unchanged.

## Design

Keep `key` in the source and local development manifests so unpacked builds
retain a stable extension ID for Chrome Native Messaging. When creating the
Chrome Web Store archive, stage a temporary copy of the built extension, remove
only `key` from the staged `manifest.json`, verify the staged package, and ZIP
that staged copy. Do not modify `chrome-extension/dist` or the source manifest.

The existing Store identity synchronization continues to write the
Store-assigned public key into the source manifest after the first draft upload.
Subsequent Store packages still omit `key`; local builds use the synchronized
key to match the Store item ID.

## Failure handling

Packaging must fail before replacing the published artifact if the staged
manifest cannot be parsed, the staged extension fails verification, or archive
creation fails. Temporary staging data must always be removed.

## Verification

- A regression test proves that the development build contains `key` while the
  packaged Store ZIP does not.
- Existing extension verification, identity, license, and deterministic-package
  checks remain green.
- Rebuilding the same sources twice produces the same Store ZIP checksum.

## Scope

This change affects Store packaging only. It does not change extension runtime
permissions, Google Meet behavior, the desktop application, the installed app,
or the currently running recording.
