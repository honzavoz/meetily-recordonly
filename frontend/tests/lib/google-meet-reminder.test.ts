import { expect, test } from 'bun:test';

import {
  GoogleMeetIntegrationStatus,
  ReminderOperationGate,
  integrationStatusLabel,
  isGoogleMeetReminderRoute,
  reduceReminderState,
} from '../../src/lib/google-meet-reminder';

test('isolates only the dedicated reminder route from the main application shell', () => {
  expect(isGoogleMeetReminderRoute('/google-meet-reminder')).toBe(true);
  expect(isGoogleMeetReminderRoute('/google-meet-reminder/')).toBe(true);
  expect(isGoogleMeetReminderRoute('/settings')).toBe(false);
});

test('operation gate blocks concurrent reminder actions', async () => {
  const gate = new ReminderOperationGate();
  let resolve!: () => void;
  const pending = gate.run(() => new Promise<void>((done) => { resolve = done; }));
  expect(gate.run(async () => undefined)).toBeNull();
  resolve();
  await pending;
  expect(gate.run(async () => undefined)).not.toBeNull();
});

test('failed action preserves a retryable start prompt', () => {
  const state = reduceReminderState(
    { kind: 'start', phase: 'running', sessionId: 'x', attempt: 1 },
    { type: 'failed', message: 'Microphone unavailable' },
  );
  expect(state).toEqual({
    kind: 'start',
    phase: 'error',
    sessionId: 'x',
    attempt: 1,
    message: 'Microphone unavailable',
  });
});

test.each([
  [{ enabled: false, extensionPath: null, nativeHostRegistered: false, lastSeenAt: null }, 'Not installed'],
  [{ enabled: true, extensionPath: '/extension', nativeHostRegistered: true, lastSeenAt: null }, 'Connected'],
  [{ enabled: true, extensionPath: '/extension', nativeHostRegistered: false, lastSeenAt: null }, 'Needs attention'],
] satisfies [GoogleMeetIntegrationStatus, string][])('maps integration status to %s', (status, label) => {
  expect(integrationStatusLabel(status)).toBe(label);
});
