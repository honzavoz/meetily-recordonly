export const MeetLifecycle = Object.freeze({
  Joined: 'joined',
  NotJoined: 'not_joined',
});

const CALL_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i;
const LEAVE_LABELS = new Set(['leave call', 'opustit hovor']);

function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function classifyMeetPage(url, controlLabels) {
  if (url.origin !== 'https://meet.google.com' || !CALL_PATH.test(url.pathname)) {
    return MeetLifecycle.NotJoined;
  }

  const hasLeaveControl = controlLabels.some((label) =>
    LEAVE_LABELS.has(normalizeLabel(label)),
  );

  return hasLeaveControl ? MeetLifecycle.Joined : MeetLifecycle.NotJoined;
}
