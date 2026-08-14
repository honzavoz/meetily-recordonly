'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const test = require('node:test')
const { verifyFfmpegReleaseAssets } = require('../verify-ffmpeg-release-assets.js')

const version = '8.0.3'
const sourceBytes = Buffer.from('reviewed ffmpeg source archive fixture')
const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex')

function fixture() {
  const contents = new Map([
    [`ffmpeg-${version}.tar.xz`, sourceBytes],
    [`ffmpeg-${version}.tar.xz.asc`, Buffer.from('detached signature')],
    [`FFmpeg-${version}-LGPL-2.1.txt`, Buffer.from('GNU LESSER GENERAL PUBLIC LICENSE Version 2.1')],
    [`FFmpeg-${version}-build-configuration.txt`, Buffer.from('./configure --disable-gpl --disable-nonfree --disable-autodetect')],
    [`FFmpeg-${version}-binary-version.txt`, Buffer.from(`ffmpeg version ${version}`)],
    [`FFmpeg-${version}-buildconf.txt`, Buffer.from('configuration: --disable-gpl --disable-nonfree --disable-autodetect')],
    [`FFmpeg-${version}-license-output.txt`, Buffer.from('GNU Lesser General Public License version 2.1 or later')],
    [`FFmpeg-${version}-SHA256SUMS`, Buffer.from(`${sourceSha256}  ffmpeg-${version}.tar.xz\n`)],
  ])
  return {
    assets: [...contents.keys()].map((name, index) => ({ id: index + 1, name })),
    contents,
    expectedVersion: version,
    expectedSha256: sourceSha256,
  }
}

test('accepts a complete LGPL FFmpeg source and provenance release set', () => {
  const result = verifyFfmpegReleaseAssets(fixture())
  assert.equal(result.source.name, `ffmpeg-${version}.tar.xz`)
  assert.equal(result.assets.length, 8)
})

test('rejects a missing source archive', () => {
  const input = fixture()
  input.assets = input.assets.filter(asset => asset.name !== `ffmpeg-${version}.tar.xz`)
  assert.throws(() => verifyFfmpegReleaseAssets(input), /source archive/)
})

test('rejects a source archive with the wrong checksum', () => {
  const input = fixture()
  input.contents.set(`ffmpeg-${version}.tar.xz`, Buffer.from('tampered source'))
  assert.throws(() => verifyFfmpegReleaseAssets(input), /checksum/i)
})

test('rejects GPL or nonfree build provenance', () => {
  const input = fixture()
  input.contents.set(`FFmpeg-${version}-buildconf.txt`, Buffer.from('configuration: --enable-gpl --enable-libx264'))
  assert.throws(() => verifyFfmpegReleaseAssets(input), /forbidden/i)
})
