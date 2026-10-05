const CHANNEL = 'meu-ponto-acuttis-v1';

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'capture-marks') return;
  window.postMessage({ channel: CHANNEL, type: 'capture', requestId: message.requestId }, location.origin);
});

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data?.type !== 'result') return;
  chrome.runtime.sendMessage({
    type: 'acuttis-sync-result', requestId: event.data.requestId,
    marks: event.data.marks, error: event.data.error
  }).catch(() => {});
});

chrome.runtime.sendMessage({ type: 'install-acuttis-hook' }).catch(() => {});
