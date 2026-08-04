#!/usr/bin/env node
'use strict'

const fs = require('node:fs')

const [configPath, outputPath] = process.argv.slice(2)
if (!configPath || !outputPath) {
  console.error('Usage: extract-updater-public-key.js <tauri.conf.json> <output.pub>')
  process.exit(2)
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const encodedKey = config.plugins?.updater?.pubkey
if (typeof encodedKey !== 'string' || !encodedKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) {
  throw new Error('Tauri updater public key is missing or is not canonical base64')
}

const decodedKey = Buffer.from(encodedKey, 'base64')
const canonicalInput = encodedKey.replace(/=+$/, '')
const canonicalDecoded = decodedKey.toString('base64').replace(/=+$/, '')
if (canonicalDecoded !== canonicalInput) {
  throw new Error('Tauri updater public key failed canonical base64 validation')
}

const keyText = decodedKey.toString('utf8')
if (!/^untrusted comment: minisign public key:\s[^\n]+\nRW[0-9A-Za-z+/]+=*\n?$/.test(keyText)) {
  throw new Error('Decoded Tauri updater public key is not a minisign public key')
}

fs.writeFileSync(outputPath, decodedKey, { mode: 0o600 })
console.log('Updater public key extracted from Tauri configuration')
