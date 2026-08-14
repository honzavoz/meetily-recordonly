import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readFrontendFile = (relativePath: string) => readFileSync(
  new URL(`../../${relativePath}`, import.meta.url),
  'utf8',
);

const settingsSource = readFrontendFile('src/app/settings/page.tsx');
const aboutSource = readFrontendFile('src/components/About.tsx');
const packageJson = JSON.parse(readFrontendFile('package.json')) as {
  scripts: Record<string, string>;
};
const macosWorkflow = readFileSync(
  new URL('../../../.github/workflows/build-macos.yml', import.meta.url),
  'utf8',
);

describe('release QA completion contracts', () => {
  test('isolates the scrollable Settings tabs from bounded panel content', () => {
    expect(settingsSource).toContain('settings-tabs-scroll');
    expect(settingsSource).toContain('overflow-x-auto');
    expect(settingsSource).toContain('min-w-max');
    expect(settingsSource).toContain('min-w-0');
    expect(settingsSource).toContain('px-3');
    expect(settingsSource).toContain('scrollIntoView');
  });

  test('runs ESLint directly without the interactive Next.js setup prompt', () => {
    expect(packageJson.scripts.lint).toBe('eslint .');
  });

  test('keeps the About surface independently branded with upstream attribution', () => {
    expect(aboutSource).toContain('Record Only');
    expect(aboutSource).toContain('independent fork of Meetily Community Edition');
    expect(aboutSource).toContain('not endorsed by Zackriya Solutions');
  });

  test('runs frontend and Rust quality gates before macOS packaging', () => {
    expect(macosWorkflow).toContain('pnpm lint');
    expect(macosWorkflow).toContain('pnpm exec bun test');
    expect(macosWorkflow).toContain('cargo test --workspace --locked');
  });
});
