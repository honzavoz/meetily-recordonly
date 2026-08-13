export const PROTOCOL_VERSION = 1;
export const NATIVE_HOST = 'cz.honzavoz.meetily.recordonly.google_meet';

export const MeetEvent = Object.freeze({
  Joined: 'meeting_joined',
  Left: 'meeting_left',
  Heartbeat: 'heartbeat',
});

export function createMeetEvent(
  event,
  sessionId,
  sequence,
  extensionVersion,
  occurredAt = new Date(),
) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    extensionVersion,
    event,
    sessionId,
    sequence,
    occurredAt: occurredAt.toISOString(),
  };
}
