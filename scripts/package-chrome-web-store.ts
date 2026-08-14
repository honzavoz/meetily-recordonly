import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
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

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries.sort()) {
    const absolute = join(directory, entry);
    if ((await stat(absolute)).isDirectory()) {
      files.push(...await filesBelow(root, absolute));
    } else {
      files.push(relative(root, absolute));
    }
  }
  return files;
}

await mkdir(artifactDirectory, { recursive: true });
const stagingRoot = await mkdtemp(join(artifactDirectory, '.store-package-'));
const stagingDirectory = join(stagingRoot, 'extension');
const stagedArchive = join(stagingRoot, basename(archive));

try {
  execFileSync(
    'node',
    [join(repositoryRoot, 'scripts', 'verify-chrome-extension.js'), extensionDirectory],
    { cwd: repositoryRoot, stdio: 'inherit' },
  );
  await cp(extensionDirectory, stagingDirectory, { recursive: true });
  const stagedManifestPath = join(stagingDirectory, 'manifest.json');
  const stagedManifest = JSON.parse(await readFile(stagedManifestPath, 'utf8'));
  delete stagedManifest.key;
  await writeFile(stagedManifestPath, `${JSON.stringify(stagedManifest, null, 2)}\n`);

  execFileSync(
    'node',
    [
      join(repositoryRoot, 'scripts', 'verify-chrome-extension.js'),
      '--store',
      stagingDirectory,
    ],
    { cwd: repositoryRoot, stdio: 'inherit' },
  );

  const files = await filesBelow(stagingDirectory);
  const fixedDate = new Date('2020-01-01T00:00:00.000Z');
  for (const file of files) {
    await utimes(join(stagingDirectory, file), fixedDate, fixedDate);
  }

  execFileSync('zip', ['-X', '-q', stagedArchive, ...files], {
    cwd: stagingDirectory,
    env: { ...process.env, TZ: 'UTC' },
  });
  await rename(stagedArchive, archive);
  console.log(`Chrome Web Store package: ${relative(repositoryRoot, archive)}`);
  console.log(`Files: ${files.length}; version: ${manifest.version}`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
