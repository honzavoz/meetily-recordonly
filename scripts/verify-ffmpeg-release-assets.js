#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')

const requiredConfiguration = ['--disable-gpl', '--disable-nonfree', '--disable-autodetect']
const forbiddenConfiguration = [
  '--enable-gpl',
  '--enable-nonfree',
  '--enable-libx264',
  '--enable-libx265',
  '--enable-libvmaf',
]

function exactlyOne(assets, name, label) {
  const matches = assets.filter(asset => asset.name === name)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${matches.length}`)
  }
  return matches[0]
}

function content(contents, asset, label) {
  const value = contents.get(asset.name)
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new Error(`${label} is empty or was not downloaded`)
  }
  return value
}

function verifyFfmpegReleaseAssets(input) {
  const { assets, contents, expectedVersion, expectedSha256 } = input
  if (!Array.isArray(assets)) throw new Error('Release assets must be an array')
  if (!(contents instanceof Map)) throw new Error('Downloaded release contents must be a Map')
  if (!/^[0-9a-f]{64}$/i.test(expectedSha256 || '')) {
    throw new Error('Expected FFmpeg source checksum must be a SHA-256 value')
  }

  const names = {
    source: `ffmpeg-${expectedVersion}.tar.xz`,
    signature: `ffmpeg-${expectedVersion}.tar.xz.asc`,
    license: `FFmpeg-${expectedVersion}-LGPL-2.1.txt`,
    buildConfiguration: `FFmpeg-${expectedVersion}-build-configuration.txt`,
    binaryVersion: `FFmpeg-${expectedVersion}-binary-version.txt`,
    buildconf: `FFmpeg-${expectedVersion}-buildconf.txt`,
    licenseOutput: `FFmpeg-${expectedVersion}-license-output.txt`,
    checksums: `FFmpeg-${expectedVersion}-SHA256SUMS`,
  }
  const labels = {
    source: 'FFmpeg source archive',
    signature: 'FFmpeg detached source signature',
    license: 'FFmpeg LGPL license',
    buildConfiguration: 'FFmpeg build configuration',
    binaryVersion: 'FFmpeg binary version provenance',
    buildconf: 'FFmpeg buildconf provenance',
    licenseOutput: 'FFmpeg license output provenance',
    checksums: 'FFmpeg checksum manifest',
  }

  const verified = {}
  for (const key of Object.keys(names)) {
    verified[key] = exactlyOne(assets, names[key], labels[key])
  }

  const sourceBytes = content(contents, verified.source, labels.source)
  content(contents, verified.signature, labels.signature)
  const licenseText = content(contents, verified.license, labels.license).toString('utf8')
  const buildConfiguration = content(
    contents,
    verified.buildConfiguration,
    labels.buildConfiguration,
  ).toString('utf8')
  const binaryVersion = content(contents, verified.binaryVersion, labels.binaryVersion).toString('utf8')
  const buildconf = content(contents, verified.buildconf, labels.buildconf).toString('utf8')
  const licenseOutput = content(contents, verified.licenseOutput, labels.licenseOutput).toString('utf8')
  const checksums = content(contents, verified.checksums, labels.checksums).toString('utf8')

  const actualSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex')
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`FFmpeg source archive checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`)
  }
  if (!checksums.split(/\r?\n/).includes(`${expectedSha256}  ${names.source}`)) {
    throw new Error('FFmpeg checksum manifest does not contain the reviewed source archive checksum')
  }

  const configuration = `${buildConfiguration}\n${buildconf}`.toLowerCase()
  const forbidden = forbiddenConfiguration.filter(value => configuration.includes(value))
  if (forbidden.length > 0) {
    throw new Error(`FFmpeg release provenance contains forbidden configuration: ${forbidden.join(', ')}`)
  }
  for (const required of requiredConfiguration) {
    if (!configuration.includes(required)) {
      throw new Error(`FFmpeg release provenance is missing required configuration: ${required}`)
    }
  }
  if (!binaryVersion.toLowerCase().includes(`ffmpeg version ${expectedVersion}`)) {
    throw new Error(`FFmpeg binary provenance does not report version ${expectedVersion}`)
  }
  if (!licenseText.toLowerCase().includes('lesser general public license')) {
    throw new Error('FFmpeg bundled license is not the LGPL')
  }
  const reportedLicense = licenseOutput.toLowerCase()
  if (!reportedLicense.includes('lesser general public license') && !reportedLicense.includes('lgpl')) {
    throw new Error('FFmpeg binary license output does not report the LGPL')
  }

  return { source: verified.source, assets: Object.values(verified) }
}

module.exports = { verifyFfmpegReleaseAssets }
