import { describe, expect, test } from 'bun:test';

import { classifyMeetPage, MeetLifecycle } from '../src/detector.js';

describe('Google Meet detector', () => {
  test.each([
    ['Leave call', 'https://meet.google.com/abc-defg-hij'],
    ['Opustit hovor', 'https://meet.google.com/abc-defg-hij'],
    ['  Leave   call  ', 'https://meet.google.com/abc-defg-hij/'],
  ])('recognizes an active call from label %s', (label, url) => {
    expect(classifyMeetPage(new URL(url), [label])).toBe(MeetLifecycle.Joined);
  });

  test.each([
    ['https://meet.google.com/', ['Leave call']],
    ['https://meet.google.com/abc-defg-hij', ['Join now']],
    ['https://example.com/abc-defg-hij', ['Leave call']],
    ['https://meet.google.com/not-a-call', ['Leave call']],
  ])('does not classify non-call state at %s', (url, labels) => {
    expect(classifyMeetPage(new URL(url), labels)).toBe(MeetLifecycle.NotJoined);
  });
});
