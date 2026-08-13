import { expect, test } from 'bun:test';

import { sendToNative } from '../src/service-worker.js';

test('returns the accepted native response without retrying', async () => {
  const calls: unknown[] = [];
  const response = await sendToNative(async (_host: string, payload: unknown) => {
    calls.push(payload);
    return { accepted: true, recording: false, appVersion: '0.4.13' };
  }, { event: 'meeting_joined' });

  expect(response.accepted).toBe(true);
  expect(calls).toHaveLength(1);
});

test('retries a missing native host once', async () => {
  let calls = 0;

  await expect(sendToNative(async () => {
    calls += 1;
    throw new Error('Specified native messaging host not found.');
  }, { event: 'meeting_joined' })).rejects.toThrow('native messaging host');

  expect(calls).toBe(2);
});

test('does not retry a response rejected by Meetily', async () => {
  let calls = 0;
  const response = await sendToNative(async () => {
    calls += 1;
    return { accepted: false, errorCode: 'invalid_event' };
  }, { event: 'meeting_joined' });

  expect(response.accepted).toBe(false);
  expect(calls).toBe(1);
});
