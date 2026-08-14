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
