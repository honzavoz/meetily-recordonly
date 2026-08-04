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
    expectedOwner,
    expectedRepo,
    expectedTag
  } = input

  if (!Array.isArray(assets)) throw new Error('Release assets must be an array')

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

  const expectedUrlPrefix = `https://github.com/${expectedOwner}/${expectedRepo}/releases/download/${expectedTag}/`
  if (typeof archive.browser_download_url !== 'string' || !archive.browser_download_url.startsWith(expectedUrlPrefix)) {
    throw new Error(`Updater archive URL must use ${expectedOwner}/${expectedRepo} tag ${expectedTag}`)
  }

  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch (error) {
    throw new Error(`latest.json is not valid JSON: ${error.message}`)
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`latest.json version ${manifest.version} does not match ${expectedVersion}`)
  }

  const platformEntries = Object.entries(manifest.platforms || {}).filter(([platformKey]) => {
    const normalized = platformKey.toLowerCase()
    return normalized.includes('darwin') && normalized.includes('aarch64')
  })
  if (platformEntries.length !== 1) {
    throw new Error(`Expected exactly one darwin/aarch64 platform entry; found ${platformEntries.length}`)
  }
  const [, platform] = platformEntries[0]
  if (platform.url !== archive.browser_download_url) {
    throw new Error('latest.json URL must exactly match the aarch64 updater release asset URL')
  }
  if (typeof platform.signature !== 'string' || !platform.signature.trim()) {
    throw new Error('latest.json darwin/aarch64 signature is empty')
  }
  if (platform.signature !== signatureText) {
    throw new Error('latest.json signature must match the downloaded signature asset')
  }

  return { archive, signature, dmg, manifestAsset }
}

module.exports = { verifyUpdaterReleaseAssets }
