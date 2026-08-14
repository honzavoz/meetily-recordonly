import { cp, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(repositoryRoot, 'chrome-extension');
const outputDirectory = join(extensionRoot, 'dist');
const stagingRoot = await mkdtemp(join(tmpdir(), 'meetily-chrome-extension-'));
const stagingDirectory = join(stagingRoot, 'dist');

try {
  const build = await Bun.build({
    entrypoints: [
      join(extensionRoot, 'src/content.js'),
      join(extensionRoot, 'src/service-worker.js'),
    ],
    outdir: stagingDirectory,
    target: 'browser',
    minify: false,
    naming: '[dir]/[name].[ext]',
  });

  if (!build.success) {
    throw new AggregateError(build.logs, 'Chrome extension build failed');
  }

  const manifest = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
  await Bun.write(join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(join(extensionRoot, 'icons'), join(stagingDirectory, 'icons'), { recursive: true });
  await cp(join(repositoryRoot, 'LICENSE.md'), join(stagingDirectory, 'LICENSE.md'));
  await cp(
    join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'),
    join(stagingDirectory, 'THIRD_PARTY_NOTICES.md'),
  );

  await rm(outputDirectory, { recursive: true, force: true });
  await rename(stagingDirectory, outputDirectory);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
