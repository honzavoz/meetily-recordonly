#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const { verifyUpdaterReleaseAssets } = require('../verify-updater-release-assets.js')

const expected = {
  expectedVersion: '0.4.5',
  expectedOwner: 'honzavoz',
  expectedRepo: 'meetily-recordonly',
  expectedTag: 'v0.4.5'
}
const signature = 'fixture-signature'
const archiveName = 'Meetily_0.4.5_aarch64.app.tar.gz'
const archiveUrl = `https://github.com/honzavoz/meetily-recordonly/releases/download/v0.4.5/${archiveName}`

function fixture() {
  return {
    ...expected,
    assets: [
      { id: 1, name: 'Meetily_0.4.5_aarch64.dmg', browser_download_url: 'https://example.invalid/dmg' },
      { id: 2, name: archiveName, browser_download_url: archiveUrl },
      { id: 3, name: `${archiveName}.sig`, browser_download_url: 'https://example.invalid/sig' },
      { id: 4, name: 'latest.json', browser_download_url: 'https://example.invalid/latest' }
    ],
    manifestText: JSON.stringify({
      version: '0.4.5',
      platforms: {
        'darwin-aarch64': { url: archiveUrl, signature }
      }
    }),
    signatureText: signature
  }
}

function expectFailure(label, mutate, pattern) {
  const input = fixture()
  mutate(input)
  assert.throws(() => verifyUpdaterReleaseAssets(input), pattern, label)
}

const verified = verifyUpdaterReleaseAssets(fixture())
assert.equal(verified.archive.name, archiveName)

const aliasFixture = fixture()
const aliasManifest = JSON.parse(aliasFixture.manifestText)
aliasManifest.platforms['darwin-aarch64-app'] = { url: archiveUrl, signature }
aliasFixture.manifestText = JSON.stringify(aliasManifest)
assert.equal(verifyUpdaterReleaseAssets(aliasFixture).archive.name, archiveName)

expectFailure('mismatched darwin app alias', input => {
  const manifest = JSON.parse(input.manifestText)
  manifest.platforms['darwin-aarch64-app'] = { url: `${archiveUrl}.wrong`, signature }
  input.manifestText = JSON.stringify(manifest)
}, /darwin-aarch64-app.*exactly match/i)

expectFailure('wrong repository URL', input => {
  const archive = input.assets.find(asset => asset.name === archiveName)
  archive.browser_download_url = archive.browser_download_url.replace('honzavoz/', 'attacker/')
  const manifest = JSON.parse(input.manifestText)
  manifest.platforms['darwin-aarch64'].url = archive.browser_download_url
  input.manifestText = JSON.stringify(manifest)
}, /must use honzavoz\/meetily-recordonly tag/i)

expectFailure('wrong tag URL', input => {
  const archive = input.assets.find(asset => asset.name === archiveName)
  archive.browser_download_url = archive.browser_download_url.replace('/v0.4.5/', '/v9.9.9/')
  const manifest = JSON.parse(input.manifestText)
  manifest.platforms['darwin-aarch64'].url = archive.browser_download_url
  input.manifestText = JSON.stringify(manifest)
}, /must use honzavoz\/meetily-recordonly tag v0\.4\.5/i)

expectFailure('manifest URL differs from asset URL', input => {
  const manifest = JSON.parse(input.manifestText)
  manifest.platforms['darwin-aarch64'].url = `${archiveUrl}.wrong`
  input.manifestText = JSON.stringify(manifest)
}, /exactly match.*asset URL/i)

expectFailure('wrong architecture', input => {
  const manifest = JSON.parse(input.manifestText)
  manifest.platforms = { 'darwin-x86_64': manifest.platforms['darwin-aarch64'] }
  input.manifestText = JSON.stringify(manifest)
}, /canonical darwin-aarch64/i)

expectFailure('substring is not canonical platform', input => {
  const manifest = JSON.parse(input.manifestText)
  manifest.platforms = { 'prefix-darwin-aarch64-suffix': manifest.platforms['darwin-aarch64'] }
  input.manifestText = JSON.stringify(manifest)
}, /canonical darwin-aarch64/i)

expectFailure('signature mismatch', input => {
  input.signatureText = 'different-signature'
}, /signature.*match/i)

expectFailure('signature content has extra bytes', input => {
  input.signatureText = `${signature}\n`
}, /signature.*match/i)

expectFailure('duplicate archive', input => {
  input.assets.push({ id: 5, name: 'Duplicate_aarch64.app.tar.gz', browser_download_url: 'https://example.invalid/duplicate' })
}, /exactly one.*archive/i)

expectFailure('duplicate DMG', input => {
  input.assets.push({ id: 5, name: 'Duplicate_aarch64.dmg', browser_download_url: 'https://example.invalid/duplicate' })
}, /exactly one.*DMG/i)

expectFailure('duplicate signature', input => {
  input.assets.push({ id: 5, name: 'Duplicate_aarch64.app.tar.gz.sig', browser_download_url: 'https://example.invalid/duplicate' })
}, /exactly one.*signature/i)

expectFailure('missing archive', input => {
  input.assets = input.assets.filter(asset => !asset.name.endsWith('.app.tar.gz'))
}, /exactly one.*archive/i)

expectFailure('missing DMG', input => {
  input.assets = input.assets.filter(asset => !asset.name.endsWith('.dmg'))
}, /exactly one.*DMG/i)

expectFailure('missing manifest', input => {
  input.assets = input.assets.filter(asset => asset.name !== 'latest.json')
}, /latest\.json asset/i)

expectFailure('missing signature asset', input => {
  input.assets = input.assets.filter(asset => !asset.name.endsWith('.sig'))
}, /signature asset/i)

expectFailure('wrong archive architecture', input => {
  input.assets.find(asset => asset.name === archiveName).name = 'Meetily_0.4.5_x64.app.tar.gz'
}, /aarch64 archive/i)

expectFailure('wrong DMG architecture', input => {
  input.assets.find(asset => asset.name.endsWith('.dmg')).name = 'Meetily_0.4.5_x64.dmg'
}, /aarch64 DMG/i)

console.log('PASS: updater release asset verifier fixtures')
