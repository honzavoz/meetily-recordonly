#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { extensionIdFromKey } = require('./verify-chrome-store-identity.js');

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}`);
  }
  return process.argv[index + 1];
}

function normalizePublicKey(value) {
  const normalized = value
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('Chrome Web Store public key is not valid base64');
  }
  const der = Buffer.from(normalized, 'base64');
  if (der.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new Error('Chrome Web Store public key is not canonical base64');
  }
  crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  return der.toString('base64');
}

function replaceRustConstant(source, name, value) {
  const pattern = new RegExp(`(pub const ${name}: &str =\\s*)"[^"]+"`);
  const matches = source.match(new RegExp(pattern.source, 'g')) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Rust constant ${name}; found ${matches.length}`);
  }
  return source.replace(pattern, `$1"${value}"`);
}

function stageFile(filePath, contents) {
  const temporaryPath = `${filePath}.record-only-sync-${process.pid}`;
  fs.writeFileSync(temporaryPath, contents, { mode: 0o644, flag: 'wx' });
  return temporaryPath;
}

function parseExtensionVersion(value) {
  if (!/^\d+(?:\.\d+){0,3}$/.test(value)) {
    throw new Error('Extension version must contain one to four numeric components');
  }
  const components = value.split('.').map(Number);
  if (components.some((component) => component > 65535)) {
    throw new Error('Extension version components must not exceed 65535');
  }
  return [...components, 0, 0, 0, 0].slice(0, 4);
}

function compareVersions(left, right) {
  const leftParts = parseExtensionVersion(left);
  const rightParts = parseExtensionVersion(right);
  for (let index = 0; index < 4; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function main() {
  const itemId = argument('--item-id').toLowerCase();
  if (!/^[a-p]{32}$/.test(itemId)) {
    throw new Error('Chrome Web Store item ID must be 32 letters in the range a-p');
  }
  const publicKey = normalizePublicKey(argument('--public-key'));
  const extensionVersion = argument('--extension-version');
  const derivedId = extensionIdFromKey(publicKey);
  if (derivedId !== itemId) {
    throw new Error(`Public key derives ${derivedId}, but Store assigned ${itemId}`);
  }

  const repositoryRoot = path.resolve(process.env.RECORD_ONLY_REPO_ROOT || path.join(__dirname, '..'));
  const manifestPath = path.join(repositoryRoot, 'chrome-extension', 'manifest.json');
  const registrationPath = path.join(
    repositoryRoot,
    'frontend',
    'src-tauri',
    'src',
    'google_meet',
    'registration.rs',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let registration = fs.readFileSync(registrationPath, 'utf8');

  if (compareVersions(extensionVersion, manifest.version) <= 0) {
    throw new Error(
      `Extension version ${extensionVersion} must be greater than current version ${manifest.version}`,
    );
  }

  manifest.key = publicKey;
  manifest.version = extensionVersion;
  registration = replaceRustConstant(registration, 'EXTENSION_ID', itemId);
  registration = replaceRustConstant(
    registration,
    'EXTENSION_ORIGIN',
    `chrome-extension://${itemId}/`,
  );
  registration = replaceRustConstant(
    registration,
    'CHROME_WEB_STORE_URL',
    `https://chromewebstore.google.com/detail/${itemId}`,
  );

  const stagedManifest = stageFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let stagedRegistration;
  try {
    stagedRegistration = stageFile(registrationPath, registration);
    fs.renameSync(stagedManifest, manifestPath);
    fs.renameSync(stagedRegistration, registrationPath);
  } catch (error) {
    for (const temporaryPath of [stagedManifest, stagedRegistration]) {
      if (temporaryPath) fs.rmSync(temporaryPath, { force: true });
    }
    throw error;
  }

  console.log(`Chrome Web Store identity synchronized: ${itemId}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

module.exports = { compareVersions, normalizePublicKey, parseExtensionVersion, replaceRustConstant };
