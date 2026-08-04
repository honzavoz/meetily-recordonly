#!/usr/bin/env node
'use strict'

const fs = require('node:fs')

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  console.error('Usage: decode-updater-signature.js <raw-base64.sig> <output.minisig>')
  process.exit(2)
}

const encodedSignature = fs.readFileSync(inputPath, 'utf8')
if (!encodedSignature || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSignature)) {
  throw new Error('Updater signature is not strict canonical base64')
}

const decodedSignature = Buffer.from(encodedSignature, 'base64')
const canonicalDecoded = decodedSignature.toString('base64')
if (canonicalDecoded !== encodedSignature) {
  throw new Error('Updater signature failed canonical base64 validation')
}

const signatureText = decodedSignature.toString('utf8')
const minisignHeader = 'untrusted comment: signature from minisign secret key\n'
if (!signatureText.startsWith(minisignHeader) || !/^R[A-Za-z0-9+/]+=*(?:\n|$)/.test(signatureText.slice(minisignHeader.length))) {
  throw new Error('Decoded updater signature is not in the expected minisign signature format')
}

fs.writeFileSync(outputPath, decodedSignature, { mode: 0o600 })
console.log('Updater minisign signature decoded')
