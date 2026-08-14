import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const verifier = resolve(repositoryRoot, 'scripts/verify-ffmpeg-license.js');
const buildScript = readFileSync(
  resolve(repositoryRoot, 'scripts/build-ffmpeg-lgpl.sh'),
  'utf8',
);
const reusableBuildWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/build.yml'),
  'utf8',
);
const macosBuildWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/build-macos.yml'),
  'utf8',
);
const releaseWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/release.yml'),
  'utf8',
);

function makeFixture(buildConfiguration, licenseText) {
  const directory = mkdtempSync(resolve(tmpdir(), 'record-only-ffmpeg-license-'));
  const executable = resolve(directory, 'ffmpeg');
  writeFileSync(
    executable,
    `#!/bin/sh\ncase "$1" in\n  -version) printf '%s\\n' 'ffmpeg version 8.0.3' ;;\n  -hide_banner)\n    case "$2" in\n      -version) printf '%s\\n' 'ffmpeg version 8.0.3' ;;\n      -buildconf) printf '%s\\n' ${JSON.stringify(buildConfiguration)} ;;\n      -L) printf '%s\\n' ${JSON.stringify(licenseText)} ;;\n    esac\n    ;;\nesac\n`,
  );
  chmodSync(executable, 0o755);
  return { directory, executable };
}

function verify(buildConfiguration, licenseText) {
  const fixture = makeFixture(buildConfiguration, licenseText);
  try {
    return spawnSync(process.execPath, [verifier, fixture.executable], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
}

test('accepts an LGPL-only FFmpeg build', () => {
  const result = verify(
    'configuration: --disable-gpl --disable-nonfree --disable-autodetect --enable-static --disable-shared',
    'FFmpeg is free software under the GNU Lesser General Public License version 2.1 or later',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Accepted LGPL FFmpeg/);
});

for (const [name, configuration] of [
  ['GPL mode', '--enable-gpl'],
  ['nonfree mode', '--enable-nonfree'],
  ['libx264', '--enable-libx264'],
  ['libx265', '--enable-libx265'],
  ['libvmaf', '--enable-libvmaf'],
]) {
  test(`rejects ${name}`, () => {
    const result = verify(
      `configuration: --disable-autodetect ${configuration}`,
      'GNU Lesser General Public License version 2.1 or later',
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not compliant/i);
  });
}

test('rejects a binary without LGPL license output', () => {
  const result = verify(
    'configuration: --disable-gpl --disable-nonfree --disable-autodetect',
    'unknown license',
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LGPL/i);
});

test('build chooses a portable positive worker count without requiring sysctl', () => {
  assert.match(buildScript, /getconf _NPROCESSORS_ONLN/);
  assert.match(buildScript, /build_jobs=2/);
  assert.doesNotMatch(buildScript, /make -j "\$\(sysctl/);
});

test('build records a stable prefix and reuses only verified provenance', () => {
  assert.match(buildScript, /install_prefix="\/opt\/record-only\/ffmpeg-\$ffmpeg_version"/);
  assert.match(buildScript, /verify-ffmpeg-license\.js/);
  assert.match(buildScript, /FFMPEG_LICENSE_OUTPUT\.txt/);
  assert.doesNotMatch(buildScript, /install_prefix="\$work_directory/);
});

test('build cryptographically verifies the official FFmpeg release signature', () => {
  assert.match(buildScript, /FCF986EA15E6E293A5644F10B4322F04D67658D8/);
  assert.match(buildScript, /third-party\/ffmpeg\/ffmpeg-devel\.asc/);
  assert.match(buildScript, /gpg .*--verify/);
});

for (const [name, workflow] of [
  ['reusable build', reusableBuildWorkflow],
  ['standalone macOS build', macosBuildWorkflow],
]) {
  test(`${name} builds and verifies the reviewed FFmpeg before Tauri`, () => {
    const ffmpegBuild = workflow.indexOf('scripts/build-ffmpeg-lgpl.sh');
    const tauriBuild = workflow.indexOf('tauri-apps/tauri-action@');

    assert.notEqual(ffmpegBuild, -1, `${name} does not build reviewed FFmpeg`);
    assert.notEqual(tauriBuild, -1, `${name} does not build Tauri`);
    assert.ok(ffmpegBuild < tauriBuild, `${name} builds Tauri before FFmpeg validation`);
    assert.match(workflow, /artifacts\/ffmpeg-source\/\*/);
    assert.match(workflow, /scripts\/verify-ffmpeg-license\.js/);
    assert.match(workflow, /third-party\/ffmpeg\/SHA256SUMS/);
  });
}

test('release uploads and verifies exact FFmpeg source and LGPL provenance', () => {
  assert.match(reusableBuildWorkflow, /Upload FFmpeg source and LGPL provenance/);
  assert.match(reusableBuildWorkflow, /FFmpeg-\$\{version\}-LGPL-2\.1\.txt/);
  assert.match(reusableBuildWorkflow, /ffmpeg-\$\{version\}\.tar\.xz/);
  assert.match(releaseWorkflow, /verifyFfmpegReleaseAssets/);
  assert.match(releaseWorkflow, /third-party\/ffmpeg\/SHA256SUMS/);
});
