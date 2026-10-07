const CHANNEL = 'meu-ponto-extension-v1';

function postToPage(message) {
  try { window.postMessage({ channel: CHANNEL, ...message }, location.origin); }
  catch { /* A navegação da página pode encerrar o contexto entre eventos. */ }
}

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data?.type !== 'sync') return;
  const requestId = event.data.requestId;
  try {
    chrome.runtime.sendMessage({ type: 'app-sync-request', requestId }, result => {
      try {
        const error = chrome.runtime.lastError?.message;
        postToPage({ type: 'ack', requestId, ...(error ? { error } : result || { error: 'A extensão não respondeu à solicitação.' }) });
      } catch { /* O Chrome pode invalidar o contexto ao atualizar a extensão. */ }
    });
  } catch (error) {
    postToPage({ type: 'ack', requestId, error: error?.message || 'O contexto da extensão foi reiniciado. Recarregue esta aba.' });
  }
});

try {
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'sync-result') postToPage({ ...message, type: 'result' });
  });
} catch { /* O painel será conectado novamente quando a aba for recarregada. */ }
