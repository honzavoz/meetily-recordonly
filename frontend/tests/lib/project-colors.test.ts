import { expect, test } from 'bun:test';
import { PROJECT_COLOR_KEYS, getProjectColor } from '@/lib/project-colors';

test('defines eight distinct project color styles', () => {
  expect(PROJECT_COLOR_KEYS).toHaveLength(8);
  expect(new Set(PROJECT_COLOR_KEYS).size).toBe(8);

  for (const key of PROJECT_COLOR_KEYS) {
    const color = getProjectColor(key);
    expect(color.key).toBe(key);
    expect(color.chipClass).toContain('bg-');
    expect(color.dotClass).toContain('bg-');
  }
});

test('falls back to blue for missing and unknown project colors', () => {
  expect(getProjectColor(undefined).key).toBe('blue');
  expect(getProjectColor('neon').key).toBe('blue');
});
