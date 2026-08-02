# macOS CI and Release Hardening Design

## Goal

Make routine Apple Silicon builds succeed without Apple credentials, fail clearly when signing is requested without credentials, remove Node 20 action warnings, and give each build one consistent application version.

## Build modes

`Build and Test - macOS` keeps its manual `sign-build` input but changes the default to `false`. The normal development build produces an unsigned, ad-hoc signed Apple Silicon `.app` artifact. It does not claim Gatekeeper notarization or produce a production release.

When `sign-build` is `true`, a preflight step checks every required signing and notarization secret before installing dependencies or compiling:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `APPLE_TEAM_ID`

The preflight prints only missing secret names. It never prints secret values. A missing value stops the job with an actionable message explaining that the user can rerun with `sign-build=false` or configure the repository secrets.

The reusable production build and `Release` workflow keep signing mandatory. They run the same secret preflight before creating a draft release. This prevents an empty draft release when credentials are unavailable.

## Signing boundary

This change prepares and validates the signing path but does not create Apple credentials. A notarized public release remains unavailable until an Apple Developer Program account provides a valid `Developer ID Application` certificate and notarization credentials.

Unsigned artifacts must be labeled `unsigned` in the artifact name and job summary. Signed artifacts must be labeled `signed`. Verification steps remain conditional:

- every `.app` runs through `codesign --verify --deep --strict`;
- signed builds also require a non-ad-hoc authority and pass `spctl` notarization assessment;
- unsigned builds report their ad-hoc status without calling them notarized.

## GitHub Actions runtime updates

Update first-party actions and `pnpm/action-setup` across all workflow files to current major versions that declare a supported modern Node runtime. Pin one major consistently per action family rather than mixing versions between platform workflows.

The implementation must read the migration notes for each selected major before editing. It must validate every workflow with `actionlint`. A workflow-only smoke run will verify the macOS unsigned path after push; signed execution stays blocked until credentials exist.

## Versioning

Bump the application from `0.4.0` to `0.4.1` in:

- `frontend/src-tauri/tauri.conf.json`
- `frontend/src-tauri/Cargo.toml`
- `frontend/package.json`

The sidebar must stop hard-coding `v0.4.0`. It loads the packaged version from Tauri's application API and displays `v0.4.1`. Browser/static-render fallback may use the package version supplied at build time.

Add a repository script that compares the three source versions and exits nonzero when they differ. Run it in macOS, Windows, Linux, reusable, validation, and release workflows before compilation or release creation.

Artifact and build-summary names derive from the validated version. The release workflow must use standard semantic versions and must not create four-component versions such as `0.4.1.1`. If tag `v0.4.1` already exists, the workflow stops and asks for a source version bump.

## Workflow structure

Keep secret validation in one checked-in shell script so manual macOS builds and production releases share the same rules. Keep version validation in one checked-in script for the same reason. Both scripts use strict shell settings, produce concise errors, and never mutate repository files.

The manual macOS workflow order becomes:

1. checkout;
2. validate source versions;
3. validate signing secrets only when requested;
4. set up Node, pnpm, Rust, and caches;
5. build sidecars and the Tauri app;
6. verify the bundle according to its signing mode;
7. upload a mode-labeled artifact;
8. write an accurate summary.

The release workflow validates versions and signing prerequisites before creating its draft release, then builds signed macOS and Windows assets through the reusable workflow.

## Error handling

- Missing Apple secrets produce a named preflight error before compilation.
- Version disagreement identifies each file and its detected value.
- An existing release tag produces an explicit version-bump error and no draft release.
- Artifact upload fails when no expected `.app` or installer exists.
- Verification fails when a build marked signed has an ad-hoc signature or fails notarization assessment.
- Unsigned builds remain downloadable but are never described as production releases.

## Verification

- Unit-style shell checks cover complete/missing secret-name sets without using real credentials.
- Version-check tests cover matching versions, each individual mismatch, and invalid semantic versions.
- `actionlint` validates every workflow file.
- Frontend tests and production build verify dynamic version display.
- A manual unsigned macOS workflow on `main` must complete and upload a `0.4.1-unsigned` artifact.
- Signed workflow preflight must fail early with the expected missing-secret names until credentials are configured.

## Out of scope

This change does not purchase an Apple Developer membership, create certificates, add Apple credentials, notarize the current build, publish a GitHub Release, or upload updater metadata to S3.
