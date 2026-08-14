import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
});

test('third-party notices identify every downloadable model family and license', () => {
  assert.match(thirdPartyNotices, /Qwen 3\.5 GGUF — Apache-2\.0/);
  assert.match(thirdPartyNotices, /Parakeet TDT v2\/v3 ONNX conversions — CC-BY-4\.0/);
  assert.match(thirdPartyNotices, /whisper\.cpp model files/);
  assert.match(thirdPartyNotices, /Gemma weights are not offered for a new download/);
});
