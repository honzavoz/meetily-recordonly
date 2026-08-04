#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const decoder = path.resolve(__dirname, '../decode-updater-signature.js')
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meetily-signature-test-'))

function decodeFixture(rawContent) {
  const input = path.join(fixtureRoot, 'updater.sig.raw')
  const output = path.join(fixtureRoot, 'updater.sig.minisig')
  fs.rmSync(output, { force: true })
  fs.writeFileSync(input, rawContent)
  const result = spawnSync(process.execPath, [decoder, input, output], { encoding: 'utf8' })
  return { ...result, output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' }
}

try {
  const textualSignature = `${[
    'untrusted comment: signature from minisign secret key',
    'RWTm9yYXNpbWlsYXRlZHNpZ25hdHVyZQ==',
    'trusted comment: timestamp:0',
    'RWZpeHR1cmV0cnVzdGVkc2lnbmF0dXJl'
  ].join('\n')}\n`
  const encodedSignature = Buffer.from(textualSignature).toString('base64')
  const valid = decodeFixture(encodedSignature)
  assert.equal(valid.status, 0, valid.stderr)
  assert.equal(valid.output, textualSignature)

  const tauriSignature = textualSignature.replace(
    'signature from minisign secret key',
    'signature from tauri secret key'
  )
  const validTauri = decodeFixture(Buffer.from(tauriSignature).toString('base64'))
  assert.equal(validTauri.status, 0, validTauri.stderr)
  assert.equal(validTauri.output, tauriSignature)

  const nonCanonical = decodeFixture(`${encodedSignature}\n`)
  assert.notEqual(nonCanonical.status, 0)
  assert.match(nonCanonical.stderr, /canonical base64/i)

  const missingPadding = decodeFixture(encodedSignature.replace(/=+$/, ''))
  assert.notEqual(missingPadding.status, 0)
  assert.match(missingPadding.stderr, /canonical base64/i)

  const wrongFormat = decodeFixture(Buffer.from('not a minisign signature').toString('base64'))
  assert.notEqual(wrongFormat.status, 0)
  assert.match(wrongFormat.stderr, /minisign signature/i)

  console.log('PASS: updater signature decoder fixtures')
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
