import { describe, expect, test } from 'bun:test';
import { RESPONSIVE_MARKDOWN_SUMMARY_CLASSES } from '@/lib/responsive-markdown-summary';

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
});
