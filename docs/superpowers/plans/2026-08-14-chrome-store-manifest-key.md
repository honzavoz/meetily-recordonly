# Chrome Web Store Manifest Key Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Chrome Web Store ZIP without the forbidden `key` field while preserving the fixed key in source and local development builds.

**Architecture:** Add an explicit Store-package validation mode to the existing extension verifier. Build the Store archive from a temporary staged copy of `chrome-extension/dist`, remove `key` only from that copy, validate it in Store mode, normalize timestamps, and atomically replace the final ZIP.

**Tech Stack:** Bun, TypeScript, Node.js test runner, standard `fs`/`child_process`, macOS `zip` and `unzip`.

---

## File map

- Modify `scripts/verify-chrome-extension.js`: distinguish development manifests, which require `key`, from Store manifests, which forbid it.
- Create `scripts/tests/chrome-store-package.test.js`: exercise verifier modes and inspect the actual generated ZIP.
- Modify `scripts/package-chrome-web-store.ts`: stage, sanitize, verify, normalize, ZIP, and clean up without mutating `chrome-extension/dist`.

### Task 1: Add an explicit Store validation contract

**Files:**
- Create: `scripts/tests/chrome-store-package.test.js`
- Modify: `scripts/verify-chrome-extension.js:9-15`

- [ ] **Step 1: Write the failing verifier-mode test**

Create the test fixture helpers and this test in `scripts/tests/chrome-store-package.test.js`:

```js
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('Store validation forbids key while development validation requires it', (t) => {
  execFileSync('bun', ['scripts/build-chrome-extension.ts'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
  const fixture = mkdtempSync(resolve(tmpdir(), 'record-only-store-manifest-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(resolve(repositoryRoot, 'chrome-extension/dist'), fixture, { recursive: true });

  const manifestPath = resolve(fixture, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(typeof manifest.key, 'string');
  delete manifest.key;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const development = spawnSync(
    process.execPath,
    ['scripts/verify-chrome-extension.js', fixture],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.notEqual(development.status, 0);
  assert.match(`${development.stdout}\n${development.stderr}`, /fixed extension key is missing/);

  execFileSync(
    process.execPath,
    ['scripts/verify-chrome-extension.js', '--store', fixture],
    { cwd: repositoryRoot, stdio: 'pipe' },
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test scripts/tests/chrome-store-package.test.js
```

Expected: FAIL because `verify-chrome-extension.js` treats `--store` as the directory and cannot validate the staged fixture.

- [ ] **Step 3: Implement the minimal verifier mode**

Replace the verifier argument and key handling with:

```js
const args = process.argv.slice(2);
const storeMode = args.includes('--store');
const directoryArgument = args.find((argument) => argument !== '--store');
const directory = path.resolve(directoryArgument || 'chrome-extension/dist');
const manifestPath = path.join(directory, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('manifest.json', 'file is missing');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest.json', 'manifest_version must be 3');
if (storeMode) {
  if (Object.hasOwn(manifest, 'key')) fail('manifest.json', 'key is forbidden in Store packages');
} else if (!/^[A-Za-z0-9+/]+=*$/.test(manifest.key || '')) {
  fail('manifest.json', 'fixed extension key is missing');
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test scripts/tests/chrome-store-package.test.js
```

Expected: 1 test passes.

- [ ] **Step 5: Commit the verifier contract**

```bash
git add scripts/verify-chrome-extension.js scripts/tests/chrome-store-package.test.js
git commit -m "test: define Chrome Store manifest contract"
```

### Task 2: Sanitize only the staged Store package

**Files:**
- Modify: `scripts/tests/chrome-store-package.test.js`
- Modify: `scripts/package-chrome-web-store.ts:1-49`

- [ ] **Step 1: Add the failing end-to-end package test**

Append:

```js
test('Store ZIP omits key without changing the development manifest', () => {
  execFileSync('bun', ['scripts/build-chrome-extension.ts'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
  const developmentManifestPath = resolve(
    repositoryRoot,
    'chrome-extension/dist/manifest.json',
  );
  const developmentBefore = readFileSync(developmentManifestPath, 'utf8');
  const developmentManifest = JSON.parse(developmentBefore);
  assert.equal(typeof developmentManifest.key, 'string');

  execFileSync('bun', ['scripts/package-chrome-web-store.ts'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
  const archive = resolve(
    repositoryRoot,
    `artifacts/chrome-web-store/record-only-meet-reminder-${developmentManifest.version}.zip`,
  );
  const packagedManifest = JSON.parse(execFileSync(
    'unzip',
    ['-p', archive, 'manifest.json'],
    { encoding: 'utf8' },
  ));

  assert.equal(Object.hasOwn(packagedManifest, 'key'), false);
  assert.equal(readFileSync(developmentManifestPath, 'utf8'), developmentBefore);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/tests/chrome-store-package.test.js
```

Expected: the second test fails because the current ZIP still contains `key`.

- [ ] **Step 3: Implement staged, atomic Store packaging**

Update imports to include `cp`, `mkdtemp`, `readFile`, `rename`, and `writeFile`. Create the artifact directory first, then stage below it so the final archive can be atomically renamed on the same filesystem:

```ts
await mkdir(artifactDirectory, { recursive: true });
const stagingRoot = await mkdtemp(join(artifactDirectory, '.store-package-'));
const stagingDirectory = join(stagingRoot, 'extension');
const stagedArchive = join(stagingRoot, basename(archive));

try {
  execFileSync(
    'node',
    [join(repositoryRoot, 'scripts', 'verify-chrome-extension.js'), extensionDirectory],
    { cwd: repositoryRoot, stdio: 'inherit' },
  );
  await cp(extensionDirectory, stagingDirectory, { recursive: true });
  const stagedManifestPath = join(stagingDirectory, 'manifest.json');
  const stagedManifest = JSON.parse(await readFile(stagedManifestPath, 'utf8'));
  delete stagedManifest.key;
  await writeFile(stagedManifestPath, `${JSON.stringify(stagedManifest, null, 2)}\n`);

  execFileSync(
    'node',
    [
      join(repositoryRoot, 'scripts', 'verify-chrome-extension.js'),
      '--store',
      stagingDirectory,
    ],
    { cwd: repositoryRoot, stdio: 'inherit' },
  );

  const files = await filesBelow(stagingDirectory, stagingDirectory);
  const fixedDate = new Date('2020-01-01T00:00:00.000Z');
  for (const file of files) {
    await utimes(join(stagingDirectory, file), fixedDate, fixedDate);
  }

  execFileSync('zip', ['-X', '-q', stagedArchive, ...files], {
    cwd: stagingDirectory,
    env: { ...process.env, TZ: 'UTC' },
  });
  await rename(stagedArchive, archive);
  console.log(`Chrome Web Store package: ${relative(repositoryRoot, archive)}`);
  console.log(`Files: ${files.length}; version: ${manifest.version}`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
```

Change `filesBelow` so paths are relative to the staging root instead of the development directory:

```ts
async function filesBelow(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries.sort()) {
    const absolute = join(directory, entry);
    if ((await stat(absolute)).isDirectory()) {
      files.push(...await filesBelow(root, absolute));
    } else {
      files.push(relative(root, absolute));
    }
  }
  return files;
}
```

Remove the old timestamp mutation and ZIP creation against
`chrome-extension/dist`; retain development-mode verification before staging.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test scripts/tests/chrome-store-package.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit the packaging fix**

```bash
git add scripts/package-chrome-web-store.ts scripts/tests/chrome-store-package.test.js
git commit -m "fix: omit development key from Store package"
```

### Task 3: Verify and publish the corrected artifact

**Files:**
- Verify: `artifacts/chrome-web-store/record-only-meet-reminder-0.1.0.zip`
- Verify: `chrome-extension/dist/manifest.json`

- [ ] **Step 1: Run the full relevant suite**

```bash
bun test chrome-extension/tests
node --test scripts/tests/chrome-store-package.test.js scripts/tests/license-packaging.test.js scripts/tests/sync-chrome-store-identity.test.js
bun scripts/build-chrome-extension.ts
node scripts/verify-chrome-extension.js chrome-extension/dist
bun scripts/package-chrome-web-store.ts
```

Expected: all tests and both development/Store verification commands pass.

- [ ] **Step 2: Prove the ZIP manifest and deterministic checksum**

```bash
unzip -p artifacts/chrome-web-store/record-only-meet-reminder-0.1.0.zip manifest.json
shasum -a 256 artifacts/chrome-web-store/record-only-meet-reminder-0.1.0.zip
bun scripts/package-chrome-web-store.ts
shasum -a 256 artifacts/chrome-web-store/record-only-meet-reminder-0.1.0.zip
```

Expected: the printed Store manifest has no `key`, the two SHA-256 values match, and `chrome-extension/dist/manifest.json` still contains the fixed development key.

- [ ] **Step 3: Review repository state**

```bash
git diff --check
git status --short --branch
git log -3 --oneline
```

Expected: no unstaged source changes; generated `dist` and artifact files remain ignored or unchanged in Git status.

- [ ] **Step 4: Push the verified commits to authorized main**

```bash
git push origin main
git ls-remote origin refs/heads/main
```

Expected: remote `main` equals local `HEAD`.

- [ ] **Step 5: Prepare the corrected upload**

Highlight `artifacts/chrome-web-store/record-only-meet-reminder-0.1.0.zip` in Finder and have the user retry **New item**. Do not submit for review until the dashboard Item ID and public key have been synchronized through the existing identity workflow.
