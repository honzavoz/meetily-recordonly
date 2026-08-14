#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const requiredConfiguration = ['--disable-gpl', '--disable-nonfree', '--disable-autodetect']
const forbiddenConfiguration = [
  '--enable-gpl',
  '--enable-nonfree',
  '--enable-libx264',
  '--enable-libx265',
  '--enable-libvmaf',
]

function fail(message) {
  throw new Error(`License artifact verification failed: ${message}`)
}

function requiredFile(root, relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    fail(`${relativePath} is missing`)
  }
  if (fs.statSync(absolutePath).size === 0) fail(`${relativePath} is empty`)
  return absolutePath
}

function text(root, relativePath) {
  return fs.readFileSync(requiredFile(root, relativePath), 'utf8')
}

function requireText(contents, pattern, label) {
  if (!pattern.test(contents)) fail(`${label} has unexpected content`)
}

function verifyLicenseArtifact(appArgument, options = {}) {
  if (!appArgument) fail('usage: verify-license-artifact.js <app-bundle> [--skip-binary-execution]')

  const app = path.resolve(appArgument)
  if (!fs.existsSync(app) || !fs.statSync(app).isDirectory() || !app.endsWith('.app')) {
    fail(`app bundle does not exist or is not a .app directory: ${app}`)
  }

  const contents = path.join(app, 'Contents')
  const resources = path.join(contents, 'Resources')
  const macos = path.join(contents, 'MacOS')
  const info = text(contents, 'Info.plist')
  requireText(info, /<key>CFBundleDisplayName<\/key>\s*<string>Record Only<\/string>/, 'Info.plist display name')
  requireText(
    info,
    /<key>CFBundleIdentifier<\/key>\s*<string>cz\.honzavoz\.meetily\.recordonly<\/string>/,
    'Info.plist bundle identifier',
  )

  const license = text(resources, 'licenses/LICENSE.md')
  requireText(license, /MIT License/, 'licenses/LICENSE.md')
  requireText(license, /Copyright \(c\) 2024 Zackriya Solutions/, 'licenses/LICENSE.md attribution')

  const notices = text(resources, 'licenses/THIRD_PARTY_NOTICES.md')
  requireText(notices, /Meetily Community Edition/, 'licenses/THIRD_PARTY_NOTICES.md attribution')
  requireText(notices, /GNU Lesser General Public License 2\.1 or later/, 'licenses/THIRD_PARTY_NOTICES.md FFmpeg license')

  const extensionLicense = text(resources, 'chrome-extension/LICENSE.md')
  requireText(extensionLicense, /MIT License/, 'chrome-extension/LICENSE.md')
  const extensionNotices = text(resources, 'chrome-extension/THIRD_PARTY_NOTICES.md')
  requireText(extensionNotices, /Meetily Community Edition/, 'chrome-extension/THIRD_PARTY_NOTICES.md')
  const extensionManifestPath = requiredFile(resources, 'chrome-extension/manifest.json')
  let extensionManifest
  try {
    extensionManifest = JSON.parse(fs.readFileSync(extensionManifestPath, 'utf8'))
  } catch (error) {
    fail(`chrome-extension/manifest.json is invalid JSON: ${error.message}`)
  }
  if (extensionManifest.manifest_version !== 3 || extensionManifest.name !== 'Record Only - Meet Reminder') {
    fail('chrome-extension/manifest.json has an unexpected identity or manifest version')
  }

  const ffmpegDirectory = path.join(resources, 'licenses/ffmpeg')
  const version = text(ffmpegDirectory, 'VERSION.txt').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`licenses/ffmpeg/VERSION.txt is invalid: ${version}`)
  const sourceName = `ffmpeg-${version}.tar.xz`
  const sourcePath = requiredFile(ffmpegDirectory, sourceName)
  requiredFile(ffmpegDirectory, `${sourceName}.asc`)
  requiredFile(ffmpegDirectory, 'ffmpeg-devel.asc')

  const checksumManifest = text(ffmpegDirectory, 'SHA256SUMS')
  const checksumMatch = checksumManifest.match(
    new RegExp(`^([0-9a-f]{64})  ${sourceName.replaceAll('.', '\\.')}$`, 'mi'),
  )
  if (!checksumMatch) fail(`licenses/ffmpeg/SHA256SUMS has no checksum for ${sourceName}`)
  const expectedChecksum = checksumMatch[1].toLowerCase()
  const actualChecksum = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')
  if (actualChecksum !== expectedChecksum) {
    fail(`FFmpeg source checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`)
  }

  const lgpl = text(ffmpegDirectory, 'COPYING.LGPLv2.1')
  requireText(lgpl, /LESSER GENERAL PUBLIC LICENSE/, 'licenses/ffmpeg/COPYING.LGPLv2.1')
  const buildConfiguration = text(ffmpegDirectory, 'BUILD_CONFIGURATION.txt')
  const buildconf = text(ffmpegDirectory, 'FFMPEG_BUILDCONF.txt')
  const provenanceConfiguration = `${buildConfiguration}\n${buildconf}`.toLowerCase()
  const forbidden = forbiddenConfiguration.filter((value) => provenanceConfiguration.includes(value))
  if (forbidden.length > 0) fail(`FFmpeg provenance contains forbidden configuration: ${forbidden.join(', ')}`)
  for (const required of requiredConfiguration) {
    if (!provenanceConfiguration.includes(required)) {
      fail(`FFmpeg provenance is missing required configuration: ${required}`)
    }
  }

  const binaryVersion = text(ffmpegDirectory, 'FFMPEG_VERSION.txt').toLowerCase()
  if (!binaryVersion.includes(`ffmpeg version ${version}`)) {
    fail(`FFMPEG_VERSION.txt does not report FFmpeg ${version}`)
  }
  const binaryLicense = text(ffmpegDirectory, 'FFMPEG_LICENSE_OUTPUT.txt')
  requireText(binaryLicense, /lesser general public license|\blgpl\b/i, 'FFMPEG_LICENSE_OUTPUT.txt')

  if (!fs.existsSync(macos) || !fs.statSync(macos).isDirectory()) fail('Contents/MacOS is missing')
  const ffmpegBinaries = fs.readdirSync(macos).filter((name) => /^ffmpeg(?:-|$)/.test(name))
  if (ffmpegBinaries.length !== 1) {
    fail(`expected exactly one bundled FFmpeg executable; found ${ffmpegBinaries.length}`)
  }
  const ffmpegBinary = path.join(macos, ffmpegBinaries[0])
  if (!fs.statSync(ffmpegBinary).isFile()) fail('bundled FFmpeg path is not a file')

  if (!options.skipBinaryExecution) {
    const verifier = path.join(__dirname, 'verify-ffmpeg-license.js')
    const result = spawnSync(process.execPath, [verifier, ffmpegBinary], { encoding: 'utf8' })
    if (result.error) fail(`could not run bundled FFmpeg verifier: ${result.error.message}`)
    if (result.status !== 0) {
      fail(`bundled FFmpeg failed validation:\n${result.stdout}\n${result.stderr}`)
    }
  }

  return { app, ffmpegBinary, sourceName, sourceSha256: actualChecksum }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    const skipBinaryExecution = args.includes('--skip-binary-execution')
    const positional = args.filter((value) => value !== '--skip-binary-execution')
    if (positional.length !== 1) fail('usage: verify-license-artifact.js <app-bundle> [--skip-binary-execution]')
    const result = verifyLicenseArtifact(positional[0], { skipBinaryExecution })
    process.stdout.write(
      `License-compliant Record Only app bundle: ${result.app}\n` +
      `Bundled FFmpeg: ${result.ffmpegBinary}\n` +
      `FFmpeg source: ${result.sourceName} (${result.sourceSha256})\n`,
    )
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}

module.exports = { verifyLicenseArtifact }
