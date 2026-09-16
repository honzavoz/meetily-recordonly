import { describe, expect, test } from 'bun:test';
import * as trim from '@/lib/recording-trim';

describe('recording timeline', () => {
  test('keeps a movable boundary inside the recording without crossing the other boundary', () => {
    expect(trim.moveTrimBoundary([10, 20], 'start', 30, 60)).toEqual([19.95, 20]);
    expect(trim.moveTrimBoundary([10, 20], 'end', 0, 60)).toEqual([10, 10.05]);
    expect(trim.moveTrimBoundary([10, 20], 'start', -4, 60)).toEqual([0, 20]);
    expect(trim.moveTrimBoundary([10, 20], 'end', 90, 60)).toEqual([10, 60]);
  });

  test('keeps zoom windows on the recording, including the beginning and end', () => {
    expect(trim.getTimelineWindow(7200, 100, 60)).toEqual([70, 130]);
    expect(trim.getTimelineWindow(7200, 1, 60)).toEqual([0, 60]);
    expect(trim.getTimelineWindow(7200, 7199, 60)).toEqual([7140, 7200]);
    expect(trim.getTimelineWindow(4, 2, 60)).toEqual([0, 4]);
  });

  test('preserves short typed selections at recording edges', () => {
    expect(trim.moveTrimBoundary([0, 0.02], 'start', 0, 60)).toEqual([0, 0.02]);
    expect(trim.moveTrimBoundary([59.98, 60], 'end', 60, 60)).toEqual([59.98, 60]);
  });

});
