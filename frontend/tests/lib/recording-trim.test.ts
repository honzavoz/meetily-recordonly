import { describe, expect, test } from 'bun:test';
import { parseTrimTime, formatTrimTime, getTrimRange } from '@/lib/recording-trim';

describe('recording trim range', () => {
  test('parses hours without confusing them with minutes', () => {
    expect(parseTrimTime('02:25:00')).toBe(8700);
    expect(parseTrimTime('01:02:03.250')).toBe(3723.25);
    expect(parseTrimTime(' 00:00:00 ')).toBe(0);
  });

  test('rejects malformed or out of range clock fields', () => {
    for (const input of ['', '-01:00:00', '00:60:00', '00:00:60', '1:2', 'NaN', '1e2:00:00']) {
      expect(parseTrimTime(input)).toBeNull();
    }
  });

  test('keeps the complete fractional end when prefilling a recording', () => {
    expect(formatTrimTime(8700.125)).toBe('02:25:00.125');
    expect(parseTrimTime(formatTrimTime(59.9998))!).toBeLessThanOrEqual(59.9998);
  });

  test('computes the kept duration and rejects empty, reversed and oversized selections', () => {
    expect(getTrimRange('00:00:10', '00:01:10', 100)).toEqual({ startSeconds: 10, endSeconds: 70, durationSeconds: 60 });
    for (const [start, end] of [['00:00:10', '00:00:10'], ['00:00:20', '00:00:10'], ['00:00:00', '00:02:00']]) {
      expect(getTrimRange(start, end, 100)).toBeNull();
    }
    expect(getTrimRange('00:00:00', '00:00:10', null)).toBeNull();
  });
});
