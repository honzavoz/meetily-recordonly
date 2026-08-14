#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'chrome-extension', 'manifest.json'),
  'utf8',
));
const registration = fs.readFileSync(
  path.join(repositoryRoot, 'frontend', 'src-tauri', 'src', 'google_meet', 'registration.rs'),
  'utf8',
);

function rustConstant(name) {
  const match = registration.match(new RegExp(`pub const ${name}: &str =\\s*"([^"]+)"`));
  if (!match) throw new Error(`Rust constant ${name} is missing`);
  return match[1];
}

function extensionIdFromKey(key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  return [...digest.subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode('a'.charCodeAt(0) + nibble))
    .join('');
}

const derivedId = extensionIdFromKey(manifest.key);
const configuredId = rustConstant('EXTENSION_ID');
const configuredOrigin = rustConstant('EXTENSION_ORIGIN');
const configuredStoreUrl = rustConstant('CHROME_WEB_STORE_URL');

if (derivedId !== configuredId) {
  throw new Error(`Manifest key derives ${derivedId}, but native host allows ${configuredId}`);
}
if (configuredOrigin !== `chrome-extension://${derivedId}/`) {
  throw new Error(`Native host origin does not match ${derivedId}`);
}
if (configuredStoreUrl !== `https://chromewebstore.google.com/detail/${derivedId}`) {
  throw new Error(`Chrome Web Store URL does not match ${derivedId}`);
}

console.log(`Chrome extension identity verified: ${derivedId}`);
