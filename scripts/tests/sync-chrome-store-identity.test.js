import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const syncScript = resolve(repositoryRoot, 'scripts/sync-chrome-store-identity.js');
const assignedKey = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtoICCR4byemIhY4JCAkpT2sg3gFdE0kSsiF9R/cPpPM5AT+jOczUKB3jT3t2rQ8jiwcdqb8/p1JrzUfvsrN8YrpO0/f992Jb5gag/rB9zriAXprlW1LSO4A5ilYsLIFLSAm5YVqlLbaN95NaURaap7W7ZA2pZXxNoywdjMqUkKnjonDBq2QxipRr/Je4jCLnP4l5OvmZcRCIsX11GHqP+jL5nIZn8AplBQGbXuSwrNIhoHOZR3harpJdkhDLHap6iqQGiJO8WYoZHOTd+OBeejl6NiI2u8ibI5ZR7Xe68by4KdAaTduK1Cwe/Xjvhyk1PR4PwRYxv5eEjFyOv5CsEwIDAQAB';
const assignedId = 'fonilmfiddnidgjpcijiocffkbbeaddo';

function makeFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'record-only-cws-sync-'));
  const manifestPath = resolve(root, 'chrome-extension/manifest.json');
  const registrationPath = resolve(
    root,
    'frontend/src-tauri/src/google_meet/registration.rs',
  );
  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(dirname(registrationPath), { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify({ name: 'Record Only - Meet Reminder', version: '0.1.0', key: 'old' }, null, 2) + '\n',
  );
  writeFileSync(
    registrationPath,
    'pub const EXTENSION_ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n'
      + 'pub const EXTENSION_ORIGIN: &str = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/";\n'
      + 'pub const CHROME_WEB_STORE_URL: &str =\n'
      + '    "https://chromewebstore.google.com/detail/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n',
  );
  return { root, manifestPath, registrationPath };
}

function runSync(root, itemId, publicKey, extensionVersion = '0.1.1') {
  return spawnSync(process.execPath, [
    syncScript,
    '--item-id', itemId,
    '--public-key', publicKey,
    '--extension-version', extensionVersion,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, RECORD_ONLY_REPO_ROOT: root },
  });
}

test('atomically synchronizes a matching Store public key and item ID', () => {
  const fixture = makeFixture();
  try {
    const pemKey = `-----BEGIN PUBLIC KEY-----\n${assignedKey}\n-----END PUBLIC KEY-----`;
    const result = runSync(fixture.root, assignedId, pemKey);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Chrome Web Store identity synchronized: ${assignedId}`));

    const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8'));
    const registration = readFileSync(fixture.registrationPath, 'utf8');
    assert.equal(manifest.key, assignedKey);
    assert.equal(manifest.version, '0.1.1');
    assert.match(registration, new RegExp(`EXTENSION_ID: &str = "${assignedId}"`));
    assert.match(registration, new RegExp(`chrome-extension://${assignedId}/`));
    assert.match(registration, new RegExp(`chromewebstore\\.google\\.com/detail/${assignedId}`));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects a non-increasing extension version without changing files', () => {
  const fixture = makeFixture();
  try {
    const beforeManifest = readFileSync(fixture.manifestPath, 'utf8');
    const result = runSync(fixture.root, assignedId, assignedKey, '0.1.0');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be greater than current version/i);
    assert.equal(readFileSync(fixture.manifestPath, 'utf8'), beforeManifest);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects a mismatched item ID without changing either file', () => {
  const fixture = makeFixture();
  try {
    const beforeManifest = readFileSync(fixture.manifestPath, 'utf8');
    const beforeRegistration = readFileSync(fixture.registrationPath, 'utf8');
    const result = runSync(fixture.root, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', assignedKey);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /derives .* but Store assigned/i);
    assert.equal(readFileSync(fixture.manifestPath, 'utf8'), beforeManifest);
    assert.equal(readFileSync(fixture.registrationPath, 'utf8'), beforeRegistration);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
