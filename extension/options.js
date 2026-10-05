const originInput = document.querySelector('#origin');
const status = document.querySelector('#status');
chrome.storage.local.get('appOrigin').then(({ appOrigin }) => { if (appOrigin) originInput.value = appOrigin; });
document.querySelector('#connect').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; status.textContent = '';
  try {
    const url = new URL(originInput.value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === 'null') throw new Error('Informe um endereço http ou https válido.');
    const origin = url.origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error('Permissão não concedida. A extensão precisa acessar o painel para receber a sincronização solicitada.');
    await chrome.scripting.unregisterContentScripts({ ids: ['meu-ponto-app-bridge'] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{ id: 'meu-ponto-app-bridge', matches: [`${origin}/*`], js: ['app-bridge.js'], runAt: 'document_start', persistAcrossSessions: true }]);
    await chrome.storage.local.set({ appOrigin: origin });
    status.textContent = `Extensão conectada a ${origin}. Recarregue o painel e a aba do Acuttis.`;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
