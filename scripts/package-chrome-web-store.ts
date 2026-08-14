import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = join(repositoryRoot, 'chrome-extension', 'dist');
const manifest = await Bun.file(join(extensionDirectory, 'manifest.json')).json();
const artifactDirectory = join(repositoryRoot, 'artifacts', 'chrome-web-store');
const archive = join(
  artifactDirectory,
  `record-only-meet-reminder-${manifest.version}.zip`,
);

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries.sort()) {
    const absolute = join(directory, entry);
    if ((await stat(absolute)).isDirectory()) {
      files.push(...await filesBelow(absolute));
    } else {
      files.push(relative(extensionDirectory, absolute));
    }
  }
  return files;
}

await mkdir(artifactDirectory, { recursive: true });
await rm(archive, { force: true });

execFileSync(
  'node',
  [join(repositoryRoot, 'scripts', 'verify-chrome-extension.js'), extensionDirectory],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

const files = await filesBelow(extensionDirectory);
const fixedDate = new Date('2020-01-01T00:00:00.000Z');
for (const file of files) {
  await utimes(join(extensionDirectory, file), fixedDate, fixedDate);
}

execFileSync('zip', ['-X', '-q', archive, ...files], {
  cwd: extensionDirectory,
  env: { ...process.env, TZ: 'UTC' },
});
console.log(`Chrome Web Store package: ${relative(repositoryRoot, archive)}`);
console.log(`Files: ${files.length}; version: ${manifest.version}`);
