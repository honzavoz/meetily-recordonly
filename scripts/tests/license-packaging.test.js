import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tauriConfig = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'frontend/src-tauri/tauri.conf.json'), 'utf8'),
);
const thirdPartyNotices = readFileSync(
  resolve(repositoryRoot, 'THIRD_PARTY_NOTICES.md'),
  'utf8',
);
const chromeStorePackager = readFileSync(
  resolve(repositoryRoot, 'scripts/package-chrome-web-store.ts'),
  'utf8',
);

test('desktop bundle maps the project and FFmpeg license notices into resources', () => {
  assert.equal(tauriConfig.bundle.resources['../../LICENSE.md'], 'licenses/LICENSE.md');
  assert.equal(
    tauriConfig.bundle.resources['../../THIRD_PARTY_NOTICES.md'],
    'licenses/THIRD_PARTY_NOTICES.md',
  );
  assert.equal(
    tauriConfig.bundle.resources['../../third-party/ffmpeg/*'],
    'licenses/ffmpeg/',
  );
  assert.equal(
    tauriConfig.bundle.resources['../../artifacts/ffmpeg-source/*'],
    'licenses/ffmpeg/',
  );
});

test('Chrome extension build contains the project and third-party notices', () => {
  execFileSync('bun', ['scripts/build-chrome-extension.ts'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });

  for (const filename of ['LICENSE.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.equal(
      existsSync(resolve(repositoryRoot, 'chrome-extension/dist', filename)),
      true,
      `${filename} must be bundled in the extension`,
    );
  }

  execFileSync('node', ['scripts/verify-chrome-extension.js', 'chrome-extension/dist'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
});

test('Chrome extension verifier rejects a package with missing notices', (t) => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'record-only-extension-license-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(resolve(repositoryRoot, 'chrome-extension/dist'), fixture, { recursive: true });
  rmSync(resolve(fixture, 'THIRD_PARTY_NOTICES.md'));

  const result = spawnSync(
    process.execPath,
    ['scripts/verify-chrome-extension.js', fixture],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /THIRD_PARTY_NOTICES\.md/);
});

test('third-party notices identify every downloadable model family and license', () => {
  assert.match(thirdPartyNotices, /Qwen 3\.5 GGUF — Apache-2\.0/);
  assert.match(thirdPartyNotices, /Parakeet TDT v2\/v3 ONNX conversions — CC-BY-4\.0/);
  assert.match(thirdPartyNotices, /whisper\.cpp model files/);
  assert.match(thirdPartyNotices, /Gemma weights are not offered for a new download/);
});

test('Chrome Web Store packaging runs the extension verifier before zip creation', () => {
  const verifier = chromeStorePackager.indexOf('verify-chrome-extension.js');
  const zip = chromeStorePackager.indexOf("execFileSync('zip'");
  assert.ok(verifier !== -1 && verifier < zip);
});
