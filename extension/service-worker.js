const APP_ORIGIN_KEY = 'appOrigin';
const pendingKey = id => `pending:${id}`;

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'app-sync-request') {
    handleSyncRequest(message, sender).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'acuttis-sync-result') {
    chrome.storage.session.get(pendingKey(message.requestId)).then(async value => {
      const request = value[pendingKey(message.requestId)];
      if (!request || request.acuttisTabId !== sender.tab?.id) { sendResponse({ ok: false }); return; }
      await chrome.storage.session.remove(pendingKey(message.requestId));
      await chrome.tabs.sendMessage(request.appTabId, {
        type: 'sync-result', requestId: message.requestId,
        marks: Array.isArray(message.marks) ? message.marks : [], error: message.error || null
      }).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function handleSyncRequest(message, sender) {
  const settings = await chrome.storage.local.get(APP_ORIGIN_KEY);
  let appOrigin;
  try { appOrigin = new URL(sender.url).origin; } catch { throw new Error('Origem do painel inválida.'); }
  if (!settings.appOrigin || appOrigin !== settings.appOrigin)
    throw new Error('Configure a extensão para este endereço do Meu Ponto.');
  const tabs = await chrome.tabs.query({ url: 'https://app.acuttis.com.br/*' });
  if (tabs.length > 1) throw new Error('Deixe apenas uma aba do Acuttis aberta para evitar importar batimentos da conta errada.');
  const acuttisTab = tabs[0];
  if (!acuttisTab) {
    await chrome.tabs.create({ url: 'https://app.acuttis.com.br/signin' });
    return { ok: true, status: 'opened-acuttis' };
  }
  if (sender.tab?.id === acuttisTab.id) throw new Error('Abra o Meu Ponto em uma aba separada do Acuttis.');
  await chrome.storage.session.set({ [pendingKey(message.requestId)]: { appTabId: sender.tab.id, acuttisTabId: acuttisTab.id } });
  try {
    await chrome.tabs.sendMessage(acuttisTab.id, { type: 'capture-marks', requestId: message.requestId });
  } catch {
    await chrome.storage.session.remove(pendingKey(message.requestId));
    throw new Error('Recarregue a aba do Acuttis e tente sincronizar novamente.');
  }
  return { ok: true, status: 'started' };
}
