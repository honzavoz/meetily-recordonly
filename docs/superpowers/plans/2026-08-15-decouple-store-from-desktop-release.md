# Decouple Store From Desktop Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the signed 0.4.16 desktop updater without waiting for Google to make the already-submitted Chrome Store listing public.

**Architecture:** Keep every deterministic extension, identity, package, license, updater, and artifact gate in the normal release workflow. Remove only the external live-listing network check and encode that separation in a source-level regression test.

**Tech Stack:** GitHub Actions YAML, Node test runner, existing Chrome Store verification scripts.

---

### Task 1: Encode the desktop and Store boundary

**Files:**
- Modify: `scripts/tests/chrome-store-listing.test.js`
- Modify: `.github/workflows/release.yml`

- [x] **Step 1: Change the workflow contract test first**

Replace `release verifies the live listing before creating a draft` with a test that asserts:

```js
test('desktop release packages the extension without waiting for Store publication', () => {
  const identityCheck = releaseWorkflow.indexOf('node scripts/verify-chrome-store-identity.js');
  const listingCheck = releaseWorkflow.indexOf('node scripts/verify-chrome-store-listing.js');
  const storePackage = releaseWorkflow.indexOf('bun scripts/package-chrome-web-store.ts');
  const draftCreation = releaseWorkflow.indexOf('Find or Create Draft Release');
  assert.notEqual(identityCheck, -1, 'release does not verify Chrome Store identity');
  assert.equal(listingCheck, -1, 'desktop release still waits for Store publication');
  assert.notEqual(storePackage, -1, 'release does not build the reviewed Store package');
  assert.ok(identityCheck < draftCreation && storePackage < draftCreation);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/tests/chrome-store-listing.test.js`

Expected: one failure with `desktop release still waits for Store publication`.

- [x] **Step 3: Remove only the live-listing call from the desktop workflow**

Delete exactly this line from `.github/workflows/release.yml`:

```yaml
node scripts/verify-chrome-store-listing.js
```

Keep the extension tests, extension build, package verifier, Store identity verifier, and Store ZIP packaging in the same blocking step.

- [x] **Step 4: Run focused and full deterministic gates**

Run serially:

```bash
node --test scripts/tests/chrome-store-listing.test.js
node --test --test-concurrency=1 scripts/tests/*.test.js
bun test chrome-extension/tests
bash scripts/tests/release-preflight.test.sh
./scripts/check-version-consistency.sh
git diff --check
```

Expected: all tests pass and version remains 0.4.16.

- [ ] **Step 5: Commit and fast-forward verified main**

Stage only the workflow, regression test, spec, and plan. Commit `ci: decouple Store review from desktop release`, fast-forward `main`, rerun the focused/full gates on merged main, and push the exact verified commit.

### Task 2: Release and install 0.4.16

**Files:**
- No repository source changes expected.

- [ ] **Step 1: Dispatch the release workflow from exact main**

Use the authenticated GitHub API credential from macOS Keychain without logging or storing it. Dispatch `.github/workflows/release.yml` with `ref: main`, record the run URL and confirm its `head_sha` equals the pushed commit.

- [ ] **Step 2: Monitor through publication and audit artifacts**

Wait for completion. Confirm `v0.4.16`, release target commit, DMG, updater archive, signature, `latest.json`, project notices, FFmpeg source/signature/LGPL/build provenance/checksums, and run the repository artifact verifiers.

- [ ] **Step 3: Install with rollback and preserve data**

Confirm no Meetily process or recording is active. Preserve the existing `/Applications/Meetily.app` as a temporary rollback copy, install the verified 0.4.16 app, launch it, verify version and existing application data, updater state, and Google Meet integration registration.

- [ ] **Step 4: Leave only the latest installed application**

After 0.4.16 passes launch and data checks, remove the superseded `/Applications/Meetily.app` 0.4.14 backup and `/Applications/Meetily Record Only - Transcribe Later.app` 0.4.1 through a recoverable Trash operation. Re-scan `/Applications` and confirm only the 0.4.16 bundle remains installed; do not delete copies inside `Downloads` or backup archives.
