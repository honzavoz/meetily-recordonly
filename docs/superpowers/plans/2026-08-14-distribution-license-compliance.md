# Distribution License Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a macOS and Chrome extension release that contains complete notices, a reproducible LGPL-only FFmpeg, model-license disclosure, automated release gates, and distinct Record Only branding.

**Architecture:** Build FFmpeg from a pinned official source archive before Tauri runs, validate the actual binary twice (build time and final artifact), and publish its exact source beside the application. Treat license inventory and model metadata as versioned product data, then enforce their presence in extension and application packaging.

**Tech Stack:** Rust/Tauri 2, Bun/TypeScript, Bash, GitHub Actions, FFmpeg configure/make, macOS application bundles.

---

### Task 1: Add deterministic notice packaging

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `third-party/ffmpeg/README.md`
- Create: `third-party/ffmpeg/COPYING.LGPLv2.1`
- Modify: `frontend/src-tauri/tauri.conf.json:108-115`
- Modify: `scripts/build-chrome-extension.ts`
- Test: `scripts/tests/license-packaging.test.js`

- [ ] **Step 1: Write a failing artifact-contract test**

Create a Node test that loads `tauri.conf.json`, asserts mappings for `LICENSE.md`, `THIRD_PARTY_NOTICES.md`, and `third-party/ffmpeg`, builds the Chrome extension in a temporary output, and asserts that both notice files exist in `chrome-extension/dist`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test scripts/tests/license-packaging.test.js`

Expected: failures for missing resource mappings and missing extension notice files.

- [ ] **Step 3: Add reviewed notices and packaging mappings**

Record the original Meetily MIT copyright, independent-fork disclosure, FFmpeg attribution/source procedure, selected MIT/Apache-2.0 choices for dual-licensed crates, MPL source links, and model license links. Add Tauri resource mappings:

```json
"../../LICENSE.md": "licenses/LICENSE.md",
"../../THIRD_PARTY_NOTICES.md": "licenses/THIRD_PARTY_NOTICES.md",
"../../third-party/ffmpeg/*": "licenses/ffmpeg/"
```

Copy `LICENSE.md` and `THIRD_PARTY_NOTICES.md` into the extension staging directory before its atomic rename.

- [ ] **Step 4: Verify GREEN**

Run: `node --test scripts/tests/license-packaging.test.js && bun scripts/build-chrome-extension.ts && node scripts/verify-chrome-extension.js chrome-extension/dist`

Expected: all checks pass and both notices exist in `chrome-extension/dist`.

- [ ] **Step 5: Commit the notice packaging**

```bash
git add LICENSE.md THIRD_PARTY_NOTICES.md third-party/ffmpeg scripts/build-chrome-extension.ts scripts/tests/license-packaging.test.js frontend/src-tauri/tauri.conf.json
git commit -m "build: bundle open source license notices"
```

### Task 2: Replace opaque FFmpeg downloads with a reproducible LGPL build

**Files:**
- Create: `scripts/build-ffmpeg-lgpl.sh`
- Create: `scripts/verify-ffmpeg-license.js`
- Test: `scripts/tests/ffmpeg-license.test.js`
- Modify: `frontend/src-tauri/build/ffmpeg.rs`
- Modify: `.github/workflows/build.yml`
- Modify: `.github/workflows/build-macos.yml`

- [ ] **Step 1: Write failing validator tests**

Use temporary executable fixtures whose `-buildconf` and `-L` output represent: allowed LGPL, `--enable-gpl`, `--enable-nonfree`, `libx264`, `libx265`, `libvmaf`, and missing license output. Assert only the LGPL fixture exits zero.

- [ ] **Step 2: Confirm RED**

Run: `node --test scripts/tests/ffmpeg-license.test.js`

Expected: failure because `scripts/verify-ffmpeg-license.js` does not exist.

- [ ] **Step 3: Implement the binary validator**

Execute the supplied binary with `-hide_banner -buildconf` and `-hide_banner -L`. Reject GPL/nonfree flags and banned external libraries, require an LGPL reference, and print the accepted version/configuration for release logs.

- [ ] **Step 4: Implement the pinned source build**

Download the official FFmpeg `8.0.3` source and detached signature from `https://ffmpeg.org/releases/`, verify a repository-pinned SHA-256 digest, extract to a private temporary directory, and configure with:

```bash
./configure \
  --prefix="$install_prefix" \
  --disable-gpl \
  --disable-nonfree \
  --disable-autodetect \
  --disable-doc \
  --disable-debug \
  --disable-ffplay \
  --disable-ffprobe \
  --enable-ffmpeg \
  --enable-static \
  --disable-shared
```

Build `ffmpeg`, copy it to the target-specific Tauri sidecar path, copy the exact source archive/signature/configuration into a release-source directory, and run the validator.

- [ ] **Step 5: Make Rust reject opaque or noncompliant binaries**

Remove platform download URLs and archive extractors from `frontend/src-tauri/build/ffmpeg.rs`. If the expected sidecar is absent, fail with an instruction to run the LGPL build script. If present, validate `-buildconf` and `-L` before allowing Tauri compilation.

- [ ] **Step 6: Integrate the source build before Tauri**

Run `scripts/build-ffmpeg-lgpl.sh "$TARGET"` after restoring the FFmpeg cache and before `tauri-action`. Include the script, pinned version, and checksum in cache keys.

- [ ] **Step 7: Verify behavior and licensing**

Run:

```bash
node --test scripts/tests/ffmpeg-license.test.js
scripts/build-ffmpeg-lgpl.sh aarch64-apple-darwin
node scripts/verify-ffmpeg-license.js frontend/src-tauri/binaries/ffmpeg-aarch64-apple-darwin
cargo test -p meetily audio:: --no-default-features
```

Expected: validator tests pass, local FFmpeg reports LGPL, and recording conversion tests pass.

- [ ] **Step 8: Commit the FFmpeg replacement**

```bash
git add scripts/build-ffmpeg-lgpl.sh scripts/verify-ffmpeg-license.js scripts/tests/ffmpeg-license.test.js frontend/src-tauri/build/ffmpeg.rs .github/workflows/build.yml .github/workflows/build-macos.yml third-party/ffmpeg
git commit -m "build: use reproducible LGPL FFmpeg"
```

### Task 3: Add model-license disclosure and safe defaults

**Files:**
- Modify: `frontend/src-tauri/src/summary/summary_engine/models.rs`
- Modify: `frontend/src-tauri/src/parakeet_engine/parakeet_engine.rs`
- Modify: `frontend/src-tauri/src/whisper_engine/whisper_engine.rs`
- Create: `frontend/src/lib/model-license.ts`
- Modify: model-selection/download components found by `rg -n 'downloadModel|download_model' frontend/src`
- Test: `frontend/tests/lib/model-license.test.ts`

- [ ] **Step 1: Write failing metadata and acceptance tests**

Require every downloadable model to expose `licenseId`, `licenseUrl`, `sourceUrl`, and `attribution`, and require an accepted license key before invoking its download. Assert Gemma is disabled until its terms URL and acceptance are implemented.

- [ ] **Step 2: Confirm RED**

Run: `cd frontend && bun test tests/lib/model-license.test.ts`

Expected: missing metadata and acceptance gate failures.

- [ ] **Step 3: Implement normalized model-license metadata**

Add Qwen Apache-2.0, Parakeet CC-BY-4.0, and Whisper attribution metadata. Represent Gemma as unavailable with an explanatory message instead of silently downloading weights with unsurfaced custom terms.

- [ ] **Step 4: Add the pre-download acceptance dialog**

Show model name, source, license identifier, attribution, and an external license link. Persist acceptance by exact model and license revision; changed terms require acceptance again.

- [ ] **Step 5: Verify GREEN**

Run: `cd frontend && bun test tests/lib/model-license.test.ts`

Expected: all model metadata and acceptance tests pass.

- [ ] **Step 6: Commit model disclosures**

```bash
git add frontend/src-tauri/src/summary/summary_engine/models.rs frontend/src-tauri/src/parakeet_engine/parakeet_engine.rs frontend/src-tauri/src/whisper_engine/whisper_engine.rs frontend/src/lib/model-license.ts frontend/src/components frontend/tests/lib/model-license.test.ts
git commit -m "feat: disclose downloadable model licenses"
```

### Task 4: Establish independent Record Only branding

**Files:**
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `llama-helper/Cargo.toml`
- Modify: `frontend/src/components/Info.tsx`
- Modify: `frontend/src/components/Logo.tsx`
- Modify: user-facing strings found by `rg -n 'Meetily' frontend/src frontend/src-tauri/src chrome-extension docs/BUILDING.md`
- Modify: `chrome-extension/manifest.json`
- Modify: `chrome-extension/store/LISTING.md`
- Modify: `chrome-extension/store/PRIVACY.md`
- Test: `frontend/tests/lib/product-identity.test.ts`

- [ ] **Step 1: Write a failing identity contract**

Assert public UI, window titles, extension manifest, store copy, and About dialog use `Record Only`; assert the About dialog contains the independent-fork disclosure and original Meetily MIT attribution; assert bundle identifier, updater endpoint, native host, and database compatibility paths remain unchanged.

- [ ] **Step 2: Confirm RED**

Run: `cd frontend && bun test tests/lib/product-identity.test.ts`

Expected: failures on current Meetily product strings.

- [ ] **Step 3: Apply the public rename without changing identity keys**

Use `Record Only` as visible product name and `Record Only – Meet Reminder` for Chrome. Keep `cz.honzavoz.meetily.recordonly` and `cz.honzavoz.meetily.recordonly.google_meet` unchanged. Add `license = "MIT"` and the fork repository URL to `llama-helper/Cargo.toml`.

- [ ] **Step 4: Verify the renamed frontend and extension**

Run:

```bash
cd frontend && bun test tests/lib/product-identity.test.ts
cd .. && bun test chrome-extension/tests
bun scripts/build-chrome-extension.ts
node scripts/verify-chrome-store-identity.js
```

Expected: all checks pass and no official-product implication remains in listing copy.

- [ ] **Step 5: Commit the identity transition**

```bash
git add frontend/src-tauri/tauri.conf.json frontend/src-tauri/Cargo.toml llama-helper/Cargo.toml frontend/src chrome-extension docs/BUILDING.md frontend/tests/lib/product-identity.test.ts
git commit -m "refactor: establish Record Only product identity"
```

### Task 5: Enforce final artifact and release-source compliance

**Files:**
- Create: `scripts/verify-license-artifact.js`
- Test: `scripts/tests/license-artifact.test.js`
- Modify: `scripts/package-chrome-web-store.ts`
- Modify: `scripts/verify-chrome-extension.js`
- Modify: `scripts/verify-updater-release-assets.js`
- Modify: `scripts/tests/updater-release-assets.test.js`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write failing final-artifact tests**

Test an extracted `.app` fixture with and without notices, FFmpeg provenance, and a compliant FFmpeg fixture. Extend updater release tests to require `ffmpeg-8.0.3.tar.xz`, its signature, checksum, and build configuration as release assets.

- [ ] **Step 2: Confirm RED**

Run: `node --test scripts/tests/license-artifact.test.js scripts/tests/updater-release-assets.test.js`

Expected: failures because current verification ignores license assets.

- [ ] **Step 3: Implement artifact and release checks**

Verify application resources, extension notices, FFmpeg binary output, source archive digest, and required draft-release assets. Upload source/provenance assets before `verify-and-publish` and leave the release in draft state on any mismatch.

- [ ] **Step 4: Run the full local verification suite**

Run:

```bash
node --test scripts/tests/*.test.js
bun test chrome-extension/tests
cd frontend && bun test
pnpm lint
pnpm build
cd .. && cargo test --workspace
git diff --check
```

Expected: zero failures, lint errors, build errors, or whitespace errors.

- [ ] **Step 5: Build and inspect a real macOS application bundle**

Build without restarting the installed app. Run `scripts/verify-license-artifact.js` against the produced `.app`, execute its bundled FFmpeg validator, and inspect the complete resource file list.

- [ ] **Step 6: Commit the release gates**

```bash
git add scripts .github/workflows/release.yml
git commit -m "ci: block noncompliant release artifacts"
```

### Task 6: Version, updater migration, review, and release

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: lockfiles if version synchronization requires them

- [ ] **Step 1: Bump all application versions to `0.4.15`**

Keep all three version sources identical and regenerate only required lockfile metadata.

- [ ] **Step 2: Verify the version gate**

Run: `./scripts/check-version-consistency.sh`

Expected: version `0.4.15` is consistent and tag `v0.4.15` does not exist.

- [ ] **Step 3: Test the real updater transition**

Preserve the installed application and user data. Build the renamed candidate, serve a locally signed update manifest, and verify a copy of `v0.4.14` updates without data loss, duplicate app bundles, or a broken launch path. Do not restart the user's active recording instance.

- [ ] **Step 4: Perform final review and verification**

Use `requesting-code-review`, resolve all Critical and Important findings, then rerun the complete verification commands from Task 5 with fresh output.

- [ ] **Step 5: Push the exact verified commit to `main`**

```bash
git push origin main
```

- [ ] **Step 6: Trigger the authorized release workflow**

Run the GitHub `Release` workflow for the exact pushed SHA. Report the workflow URL and initial status without claiming deployment until the published release and assets are verified.

- [ ] **Step 7: Verify the published replacement**

Download `v0.4.15`, verify signature, inspect resources, validate bundled FFmpeg, verify source assets, and exercise the in-app update. Only after that may the Chrome Web Store package continue to upload/review.
