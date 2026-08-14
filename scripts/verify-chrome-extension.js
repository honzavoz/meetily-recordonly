#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function fail(file, rule) {
  throw new Error(`${file}: ${rule}`);
}

const directory = path.resolve(process.argv[2] || 'chrome-extension/dist');
const manifestPath = path.join(directory, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('manifest.json', 'file is missing');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest.json', 'manifest_version must be 3');
if (!/^[A-Za-z0-9+/]+=*$/.test(manifest.key || '')) fail('manifest.json', 'fixed extension key is missing');

const expectedPermissions = ['nativeMessaging', 'storage'];
if (JSON.stringify([...(manifest.permissions || [])].sort()) !== JSON.stringify(expectedPermissions.sort())) {
  fail('manifest.json', `permissions must be exactly ${expectedPermissions.join(', ')}`);
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://meet.google.com/*'])) {
  fail('manifest.json', 'host_permissions must contain only Google Meet');
}

const expectedIcons = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};
if (JSON.stringify(manifest.icons) !== JSON.stringify(expectedIcons)) {
  fail('manifest.json', 'extension icons must include 16, 32, 48, and 128 pixel assets');
}
for (const filename of Object.values(expectedIcons)) {
  if (!fs.existsSync(path.join(directory, filename))) fail(filename, 'file is missing');
}

for (const filename of ['content.js', 'service-worker.js']) {
  const filePath = path.join(directory, filename);
  if (!fs.existsSync(filePath)) fail(filename, 'file is missing');
  const source = fs.readFileSync(filePath, 'utf8');
  if (/https?:\/\/(?!meet\.google\.com)/.test(source)) fail(filename, 'remote URL is forbidden');
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) fail(filename, 'dynamic code execution is forbidden');
}

if (manifest.background?.service_worker !== 'service-worker.js') {
  fail('manifest.json', 'unexpected service worker entrypoint');
}
if (manifest.content_scripts?.length !== 1 || manifest.content_scripts[0].js?.[0] !== 'content.js') {
  fail('manifest.json', 'unexpected content script entrypoint');
}

console.log(`Chrome extension package verified: ${directory}`);
