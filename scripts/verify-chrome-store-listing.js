#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { verifyChromeStoreIdentity } = require('./verify-chrome-store-identity.js');

function verifyListing({ extensionId, extensionName, finalUrl, html }) {
  const parsedUrl = new URL(finalUrl);
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  const slug = pathParts.at(-2);
  const finalId = pathParts.at(-1);
  const titlePattern = new RegExp(
    `<meta[^>]+property=["']og:title["'][^>]+content=["']${extensionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`,
    'i',
  );

  if (
    parsedUrl.hostname !== 'chromewebstore.google.com'
    || pathParts[0] !== 'detail'
    || finalId !== extensionId
    || !slug
    || slug === 'empty-title'
    || /data:\[5\]/.test(html)
    || !titlePattern.test(html)
  ) {
    throw new Error(`Chrome Web Store listing for ${extensionId} is not live`);
  }
}

async function main() {
  const { extensionId, manifest, storeUrl } = verifyChromeStoreIdentity();
  let finalUrl;
  let html;

  if (process.env.RECORD_ONLY_CWS_HTML_FIXTURE) {
    html = fs.readFileSync(process.env.RECORD_ONLY_CWS_HTML_FIXTURE, 'utf8');
    finalUrl = process.env.RECORD_ONLY_CWS_FINAL_URL;
    if (!finalUrl) throw new Error('Fixture final URL is required');
  } else {
    const response = await fetch(storeUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Record-Only-release-verifier' },
    });
    if (!response.ok) {
      throw new Error(`Chrome Web Store returned HTTP ${response.status}`);
    }
    finalUrl = response.url;
    html = await response.text();
  }

  verifyListing({ extensionId, extensionName: manifest.name, finalUrl, html });
  console.log(`Chrome Web Store listing verified: ${extensionId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { verifyListing };
