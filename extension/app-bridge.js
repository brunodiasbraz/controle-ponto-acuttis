const CHANNEL = 'meu-ponto-extension-v1';

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data?.type !== 'sync') return;
  const requestId = event.data.requestId;
  chrome.runtime.sendMessage({ type: 'app-sync-request', requestId }, result => {
    window.postMessage({ channel: CHANNEL, type: 'ack', requestId, ...(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : result) }, location.origin);
  });
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'sync-result') return;
  window.postMessage({ channel: CHANNEL, type: 'result', ...message }, location.origin);
});
