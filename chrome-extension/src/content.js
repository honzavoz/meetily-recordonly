import { classifyMeetPage, MeetLifecycle } from './detector.js';
import { createMeetEvent, MeetEvent } from './protocol.js';

const STABILITY_MS = 3_000;
const HEARTBEAT_MS = 60_000;
const RECONCILE_MS = 1_000;

let sessionId = null;
let sequence = 0;
let stableState = MeetLifecycle.NotJoined;
let candidateState = stableState;
let candidateSince = Date.now();

function emit(event) {
  if (!sessionId) return;

  sequence += 1;
  const payload = createMeetEvent(
    event,
    sessionId,
    sequence,
    chrome.runtime.getManifest().version,
  );
  chrome.runtime.sendMessage(payload).catch(() => {});
}

function readControlLabels() {
  return [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
    .map((node) => node.getAttribute('aria-label') ?? '');
}

function reconcile(now = Date.now()) {
  const next = classifyMeetPage(new URL(location.href), readControlLabels());

  if (next !== candidateState) {
    candidateState = next;
    candidateSince = now;
    return;
  }

  if (next === stableState || now - candidateSince < STABILITY_MS) return;

  stableState = next;
  if (next === MeetLifecycle.Joined) {
    sessionId = crypto.randomUUID();
    sequence = 0;
    emit(MeetEvent.Joined);
  } else {
    emit(MeetEvent.Left);
    sessionId = null;
  }
}

new MutationObserver(() => reconcile()).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['aria-label'],
});

setInterval(reconcile, RECONCILE_MS);
setInterval(() => emit(MeetEvent.Heartbeat), HEARTBEAT_MS);
reconcile();
