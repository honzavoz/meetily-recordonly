'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')

const repositoryRoot = path.resolve(__dirname, '../..')
const verifier = path.join(repositoryRoot, 'scripts/verify-license-artifact.js')

function write(root, relativePath, contents, mode) {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
  if (mode) fs.chmodSync(target, mode)
  return target
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'record-only-license-artifact-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const app = path.join(directory, 'Meetily.app')
  const resources = path.join(app, 'Contents/Resources')
  const ffmpegDirectory = path.join(resources, 'licenses/ffmpeg')
  const version = '8.0.3'
  const sourceName = `ffmpeg-${version}.tar.xz`
  const source = Buffer.from('reviewed FFmpeg source archive fixture')
  const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex')
  const configuration = './configure --disable-gpl --disable-nonfree --disable-autodetect'

  write(app, 'Contents/Info.plist', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '<key>CFBundleDisplayName</key><string>Record Only</string>',
    '<key>CFBundleIdentifier</key><string>cz.honzavoz.meetily.recordonly</string>',
    '</dict></plist>',
  ].join(''))
  write(resources, 'licenses/LICENSE.md', 'MIT License\nCopyright (c) 2024 Zackriya Solutions\n')
  write(resources, 'licenses/THIRD_PARTY_NOTICES.md', [
    '# Third-Party Notices',
    'Meetily Community Edition',
    'GNU Lesser General Public License 2.1 or later',
  ].join('\n'))
  write(resources, 'chrome-extension/LICENSE.md', 'MIT License\nCopyright (c) 2024 Zackriya Solutions\n')
  write(resources, 'chrome-extension/THIRD_PARTY_NOTICES.md', '# Third-Party Notices\nMeetily Community Edition\n')
  write(resources, 'chrome-extension/manifest.json', JSON.stringify({
    manifest_version: 3,
    name: 'Record Only - Meet Reminder',
  }))

  write(ffmpegDirectory, 'VERSION.txt', `${version}\n`)
  write(ffmpegDirectory, 'COPYING.LGPLv2.1', 'GNU LESSER GENERAL PUBLIC LICENSE Version 2.1\n')
  write(ffmpegDirectory, 'ffmpeg-devel.asc', 'reviewed FFmpeg release signing key\n')
  write(ffmpegDirectory, sourceName, source)
  write(ffmpegDirectory, `${sourceName}.asc`, 'detached signature fixture\n')
  write(ffmpegDirectory, 'SHA256SUMS', `${sourceSha256}  ${sourceName}\n`)
  write(ffmpegDirectory, 'BUILD_CONFIGURATION.txt', `${configuration}\n`)
  write(ffmpegDirectory, 'FFMPEG_VERSION.txt', `ffmpeg version ${version}\n`)
  write(ffmpegDirectory, 'FFMPEG_BUILDCONF.txt', `configuration: ${configuration}\n`)
  write(ffmpegDirectory, 'FFMPEG_LICENSE_OUTPUT.txt', 'GNU Lesser General Public License version 2.1 or later\n')

  write(app, 'Contents/MacOS/ffmpeg', [
    '#!/bin/sh',
    'case "$1:$2" in',
    `  -hide_banner:-version) printf '%s\\n' 'ffmpeg version ${version}' ;;`,
    `  -hide_banner:-buildconf) printf '%s\\n' 'configuration: ${configuration}' ;;`,
    "  -hide_banner:-L) printf '%s\\n' 'GNU Lesser General Public License version 2.1 or later' ;;",
    '  *) exit 2 ;;',
    'esac',
  ].join('\n'), 0o755)

  return { app, resources, ffmpegDirectory, sourceName }
}

function verify(app, ...args) {
  return spawnSync(process.execPath, [verifier, app, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`
}

test('accepts a complete Record Only app with notices and LGPL FFmpeg provenance', (t) => {
  const { app } = fixture(t)
  const result = verify(app)
  assert.equal(result.status, 0, output(result))
  assert.match(result.stdout, /License-compliant Record Only app bundle/)
})

test('supports provenance-only validation after cross-platform archive extraction', (t) => {
  const { app } = fixture(t)
  fs.writeFileSync(path.join(app, 'Contents/MacOS/ffmpeg'), 'non-native binary fixture')
  const result = verify(app, '--skip-binary-execution')
  assert.equal(result.status, 0, output(result))
})

test('rejects a bundle without the project license', (t) => {
  const { app, resources } = fixture(t)
  fs.rmSync(path.join(resources, 'licenses/LICENSE.md'))
  const result = verify(app)
  assert.notEqual(result.status, 0)
  assert.match(output(result), /licenses\/LICENSE\.md/)
})

test('rejects a bundle without extension notices', (t) => {
  const { app, resources } = fixture(t)
  fs.rmSync(path.join(resources, 'chrome-extension/THIRD_PARTY_NOTICES.md'))
  const result = verify(app)
  assert.notEqual(result.status, 0)
  assert.match(output(result), /chrome-extension\/THIRD_PARTY_NOTICES\.md/)
})

test('rejects a tampered bundled FFmpeg source archive', (t) => {
  const { app, ffmpegDirectory, sourceName } = fixture(t)
  fs.writeFileSync(path.join(ffmpegDirectory, sourceName), 'tampered source')
  const result = verify(app)
  assert.notEqual(result.status, 0)
  assert.match(output(result), /checksum mismatch/i)
})

test('rejects GPL build provenance even when the executable fixture is LGPL', (t) => {
  const { app, ffmpegDirectory } = fixture(t)
  fs.writeFileSync(path.join(ffmpegDirectory, 'FFMPEG_BUILDCONF.txt'), 'configuration: --enable-gpl --enable-libx264\n')
  const result = verify(app)
  assert.notEqual(result.status, 0)
  assert.match(output(result), /forbidden configuration/i)
})

test('macOS build and release workflows gate app artifacts before handoff', () => {
  const reusableBuild = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/build.yml'), 'utf8')
  const macosBuild = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/build-macos.yml'), 'utf8')
  const release = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')

  for (const [name, workflow] of [['build.yml', reusableBuild], ['build-macos.yml', macosBuild]]) {
    const tauriBuild = workflow.lastIndexOf('tauri-apps/tauri-action@v0')
    const artifactGate = workflow.indexOf('node scripts/verify-license-artifact.js')
    const artifactUpload = workflow.indexOf('Upload artifacts', artifactGate)
    assert.notEqual(tauriBuild, -1, `${name} has no Tauri build`)
    assert.ok(artifactGate > tauriBuild, `${name} validates before the app exists`)
    assert.ok(artifactUpload > artifactGate, `${name} uploads before license validation`)
  }

  const releaseArtifactGate = release.indexOf('node scripts/verify-license-artifact.js')
  const publish = release.indexOf('Publish verified release')
  assert.match(release, /Record Only v\$\{\{/)
  assert.match(release, /--skip-binary-execution/)
  assert.ok(releaseArtifactGate !== -1 && releaseArtifactGate < publish)
})
