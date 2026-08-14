#!/usr/bin/env node
'use strict'

function exactlyOne(assets, predicate, label) {
  const matches = assets.filter(predicate)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${matches.length}`)
  }
  return matches[0]
}

function verifyUpdaterReleaseAssets(input) {
  const {
    assets,
    manifestText,
    signatureText,
    expectedVersion,
    expectedFfmpegVersion,
    expectedOwner,
    expectedRepo,
    expectedTag
  } = input

  if (!Array.isArray(assets)) throw new Error('Release assets must be an array')
  if (!/^\d+\.\d+\.\d+$/.test(expectedFfmpegVersion || '')) {
    throw new Error('Expected FFmpeg version must use strict X.Y.Z format')
  }

  const archive = exactlyOne(assets, asset => asset.name.endsWith('.app.tar.gz'), 'updater archive')
  if (!archive.name.toLowerCase().includes('aarch64')) {
    throw new Error(`Expected an aarch64 archive; got ${archive.name}`)
  }
  const signature = exactlyOne(
    assets,
    asset => asset.name === `${archive.name}.sig`,
    `signature asset for ${archive.name}`
  )
  exactlyOne(assets, asset => asset.name.endsWith('.app.tar.gz.sig'), 'updater signature asset')
  const dmg = exactlyOne(assets, asset => asset.name.endsWith('.dmg'), 'aarch64 DMG')
  if (!dmg.name.toLowerCase().includes('aarch64')) {
    throw new Error(`Expected an aarch64 DMG; got ${dmg.name}`)
  }
  const manifestAsset = exactlyOne(assets, asset => asset.name === 'latest.json', 'latest.json asset')
  const ffmpegAssetContracts = [
    [`ffmpeg-${expectedFfmpegVersion}.tar.xz`, 'FFmpeg source archive'],
    [`ffmpeg-${expectedFfmpegVersion}.tar.xz.asc`, 'FFmpeg detached source signature'],
    [`FFmpeg-${expectedFfmpegVersion}-LGPL-2.1.txt`, 'FFmpeg LGPL license'],
    [`FFmpeg-${expectedFfmpegVersion}-build-configuration.txt`, 'FFmpeg build configuration'],
    [`FFmpeg-${expectedFfmpegVersion}-binary-version.txt`, 'FFmpeg binary version provenance'],
    [`FFmpeg-${expectedFfmpegVersion}-buildconf.txt`, 'FFmpeg buildconf provenance'],
    [`FFmpeg-${expectedFfmpegVersion}-license-output.txt`, 'FFmpeg license output provenance'],
    [`FFmpeg-${expectedFfmpegVersion}-SHA256SUMS`, 'FFmpeg checksum manifest'],
  ]
  const ffmpegAssets = ffmpegAssetContracts.map(([name, label]) =>
    exactlyOne(assets, asset => asset.name === name, label)
  )

  const expectedUrlPrefix = `https://github.com/${expectedOwner}/${expectedRepo}/releases/download/${expectedTag}/`
  const expectedArchiveUrl = `${expectedUrlPrefix}${archive.name}`

  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch (error) {
    throw new Error(`latest.json is not valid JSON: ${error.message}`)
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`latest.json version ${manifest.version} does not match ${expectedVersion}`)
  }

  const platforms = manifest.platforms || {}
  const platform = platforms['darwin-aarch64']
  if (!platform || typeof platform !== 'object') {
    throw new Error('latest.json must contain the canonical darwin-aarch64 platform entry')
  }

  const verifyPlatform = (platformName, entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`latest.json ${platformName} entry is invalid`)
    }
    if (entry.url !== expectedArchiveUrl) {
      throw new Error(`latest.json ${platformName} URL must exactly match the canonical updater URL`)
    }
    if (typeof entry.signature !== 'string' || !entry.signature) {
      throw new Error(`latest.json ${platformName} signature is empty`)
    }
    if (entry.signature !== signatureText) {
      throw new Error(`latest.json ${platformName} signature must match the downloaded signature asset`)
    }
  }

  verifyPlatform('darwin-aarch64', platform)
  if (Object.hasOwn(platforms, 'darwin-aarch64-app')) {
    verifyPlatform('darwin-aarch64-app', platforms['darwin-aarch64-app'])
  }

  return { archive, signature, dmg, manifestAsset, ffmpegAssets }
}

module.exports = { verifyUpdaterReleaseAssets }
