import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { verifyChromeStoreIdentity } = require('../verify-chrome-store-identity.js');
const verifier = resolve(repositoryRoot, 'scripts/verify-chrome-store-listing.js');
const releaseWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/release.yml'),
  'utf8',
);
const { extensionId } = verifyChromeStoreIdentity();
const canonicalUrl = `https://chromewebstore.google.com/detail/record-only-meet-reminder/${extensionId}`;

function verifyFixture(html, finalUrl) {
  const directory = mkdtempSync(resolve(tmpdir(), 'record-only-cws-listing-'));
  const fixture = resolve(directory, 'listing.html');
  writeFileSync(fixture, html);
  try {
    return spawnSync(process.execPath, [verifier], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        RECORD_ONLY_CWS_HTML_FIXTURE: fixture,
        RECORD_ONLY_CWS_FINAL_URL: finalUrl,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('accepts the public Record Only Chrome Web Store listing', () => {
  const result = verifyFixture(
    '<meta property="og:title" content="Record Only - Meet Reminder">',
    canonicalUrl,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Chrome Web Store listing verified/);
});

test('rejects an unpublished empty-title listing', () => {
  const result = verifyFixture(
    '<meta name="robots" content="noindex"><script>data:[5]</script>',
    `https://chromewebstore.google.com/detail/empty-title/${extensionId}`,
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not live/i);
});

test('desktop release packages the extension without waiting for Store publication', () => {
  const identityCheck = releaseWorkflow.indexOf('node scripts/verify-chrome-store-identity.js');
  const listingCheck = releaseWorkflow.indexOf('node scripts/verify-chrome-store-listing.js');
  const storePackage = releaseWorkflow.indexOf('bun scripts/package-chrome-web-store.ts');
  const draftCreation = releaseWorkflow.indexOf('Find or Create Draft Release');
  assert.notEqual(identityCheck, -1, 'release does not verify Chrome Store identity');
  assert.equal(listingCheck, -1, 'desktop release still waits for Store publication');
  assert.notEqual(storePackage, -1, 'release does not build the reviewed Store package');
  assert.ok(identityCheck < draftCreation && storePackage < draftCreation);
});
