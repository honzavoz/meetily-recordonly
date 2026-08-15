# Decouple Chrome Store publication from desktop release

Date: 2026-08-15
Status: approved by the request to release the downloadable desktop app immediately

## Goal

Allow a signed Record Only desktop release to be published while its separately submitted Chrome Web Store listing is still under Google review.

## Design

The desktop release continues to run all extension unit tests, build the bundled extension, verify its restricted permissions and notices, verify the manifest key against the native-host extension ID and Store URL, and build the reviewed Store ZIP. The release no longer performs a network check that the external Store listing is already public.

The Store verifier remains in the repository and stays independently testable. Store identity and publication are not altered, resubmitted, or forced. Public Store availability becomes an acceptance condition for the one-click installation flow, not a prerequisite for publishing the desktop application and updater.

This is preferable to a non-fatal workflow step because a warning can hide real network or listing errors, and preferable to a one-off manual release because the normal signing, FFmpeg, notice, updater, checksum, and artifact gates remain reproducible and auditable.

## Verification

- The workflow test must fail while the desktop workflow still invokes the live-listing verifier.
- After the change, it must assert that the workflow keeps extension identity verification and Store ZIP packaging before draft creation while omitting the live-listing network gate.
- All deterministic Node, extension, release-preflight, version, Rust compile, and license gates must remain green.
- The actual release must still build from the exact verified `main` commit and publish the signed updater assets.
