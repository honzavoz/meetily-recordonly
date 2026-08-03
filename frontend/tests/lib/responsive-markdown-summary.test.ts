import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { RESPONSIVE_MARKDOWN_SUMMARY_CLASSES } from '@/lib/responsive-markdown-summary';

const globalStyles = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

describe('responsive markdown summary layout contract', () => {
  test('keeps the summary content as a bounded vertical scroll area', () => {
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.scrollArea).toContain('min-h-0');
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.scrollArea).toContain('min-w-0');
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.scrollArea).toContain('overflow-x-hidden');
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.scrollArea).toContain('overflow-y-auto');
  });

  test('gives the markdown editor a width-constrained styling boundary', () => {
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.editorBoundary).toContain('meetily-summary-editor');
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.editorBoundary).toContain('min-w-0');
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.editorBoundary).toContain('max-w-full');
  });

  test('keeps dialog chrome fixed around an independently scrolling body', () => {
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.dialog).toContain('overflow-hidden');
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.dialogBody).toContain('min-h-0');
    expect(RESPONSIVE_MARKDOWN_SUMMARY_CLASSES.dialogBody).toContain('overflow-y-auto');
  });

  test('wraps wide markdown content inside the scoped editor boundary', () => {
    expect(globalStyles).toContain('.meetily-summary-editor');
    expect(globalStyles).toContain('overflow-wrap: anywhere');
    expect(globalStyles).toMatch(/\.meetily-summary-editor[^}]*pre[\s\S]*?overflow-x:\s*auto/);
    expect(globalStyles).toMatch(/\.meetily-summary-editor[^}]*table[\s\S]*?overflow-x:\s*auto/);
  });

  test('does not force every BlockNote node to overflow its container', () => {
    expect(globalStyles).not.toMatch(/\[data-node-type\]\s*\{[^}]*overflow:\s*visible\s*!important/);
  });
});
