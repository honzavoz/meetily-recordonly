#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const binaryArgument = process.argv[2];

function fail(message) {
  process.stderr.write(`FFmpeg license check failed: ${message}\n`);
  process.exit(1);
}

if (!binaryArgument) {
  fail('usage: verify-ffmpeg-license.js <ffmpeg-binary>');
}

const binaryPath = resolve(binaryArgument);
if (!existsSync(binaryPath)) {
  fail(`binary does not exist: ${binaryPath}`);
}

function run(args) {
  const result = spawnSync(binaryPath, args, { encoding: 'utf8' });
  if (result.error) {
    fail(`could not execute ${binaryPath}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${args.join(' ')} exited with status ${result.status}: ${result.stderr.trim()}`);
  }
  return `${result.stdout}\n${result.stderr}`.trim();
}

const versionOutput = run(['-hide_banner', '-version']);
const buildConfiguration = run(['-hide_banner', '-buildconf']);
const licenseOutput = run(['-hide_banner', '-L']);
const combined = `${buildConfiguration}\n${licenseOutput}`.toLowerCase();

const bannedPatterns = [
  '--enable-gpl',
  '--enable-nonfree',
  '--enable-libx264',
  '--enable-libx265',
  '--enable-libvmaf',
];
const foundBanned = bannedPatterns.filter((pattern) => combined.includes(pattern));

if (foundBanned.length > 0) {
  fail(`binary is not compliant; forbidden configuration: ${foundBanned.join(', ')}`);
}

for (const required of ['--disable-gpl', '--disable-nonfree', '--disable-autodetect']) {
  if (!combined.includes(required)) {
    fail(`binary is not compliant; required configuration is missing: ${required}`);
  }
}

if (!/lesser general public license|\blgpl\b/i.test(licenseOutput)) {
  fail('binary does not report an LGPL license');
}

const firstVersionLine = versionOutput.split(/\r?\n/, 1)[0];
process.stdout.write(`Accepted LGPL FFmpeg: ${firstVersionLine}\n${buildConfiguration}\n`);
