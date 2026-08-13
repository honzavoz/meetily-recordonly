import { NATIVE_HOST } from './protocol.js';

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

if (typeof chrome !== 'undefined') {
  chrome.runtime.onMessage.addListener((payload, _sender, sendResponse) => {
    sendToNative(chrome.runtime.sendNativeMessage.bind(chrome.runtime), payload)
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
}
