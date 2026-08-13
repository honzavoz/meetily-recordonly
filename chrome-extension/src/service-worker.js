import { createIntegrationPing, NATIVE_HOST } from './protocol.js';

const SESSION_KEY_PREFIX = 'meetilyMeetSession:';

export function createTabClosedEvent(lastPayload, occurredAt = new Date()) {
  return {
    ...lastPayload,
    event: 'meeting_left',
    sequence: lastPayload.sequence + 1,
    occurredAt: occurredAt.toISOString(),
  };
}

export async function sendToNative(sendNativeMessage, payload) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await sendNativeMessage(NATIVE_HOST, payload);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export async function performHandshake(sendNativeMessage, extensionVersion) {
  return sendToNative(sendNativeMessage, createIntegrationPing(extensionVersion));
}

if (typeof chrome !== 'undefined') {
  const handshake = () => performHandshake(
    chrome.runtime.sendNativeMessage.bind(chrome.runtime),
    chrome.runtime.getManifest().version,
  ).then((response) => chrome.action.setBadgeText({ text: response.accepted ? '' : '!' }))
    .catch(() => chrome.action.setBadgeText({ text: '!' }));

  chrome.runtime.onInstalled.addListener(handshake);
  chrome.runtime.onStartup.addListener(handshake);
  void handshake();

  chrome.runtime.onMessage.addListener((payload, sender, sendResponse) => {
    const sessionKey = sender.tab?.id === undefined
      ? null
      : `${SESSION_KEY_PREFIX}${sender.tab.id}`;
    const trackSession = !sessionKey
      ? Promise.resolve()
      : payload.event === 'meeting_left'
        ? chrome.storage.session.remove(sessionKey)
        : chrome.storage.session.set({ [sessionKey]: payload });

    trackSession
      .then(() => sendToNative(chrome.runtime.sendNativeMessage.bind(chrome.runtime), payload))
      .then(async (response) => {
        await chrome.action.setBadgeText({ text: response.accepted ? '' : '!' });
        sendResponse(response);
      })
      .catch(async (error) => {
        await chrome.action.setBadgeText({ text: '!' });
        sendResponse({
          accepted: false,
          errorCode: 'native_host_unavailable',
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const sessionKey = `${SESSION_KEY_PREFIX}${tabId}`;
    const stored = await chrome.storage.session.get(sessionKey);
    const lastPayload = stored[sessionKey];
    if (!lastPayload) return;

    await chrome.storage.session.remove(sessionKey);
    try {
      await sendToNative(
        chrome.runtime.sendNativeMessage.bind(chrome.runtime),
        createTabClosedEvent(lastPayload),
      );
    } catch {
      await chrome.action.setBadgeText({ text: '!' });
    }
  });
}
