(() => {
  const CHANNEL = 'meu-ponto-acuttis-v1';
  const API = 'https://app-back.acuttis.com.br/v1/marks/list';
  if (window.__meuPontoHookInstalled) return;
  window.__meuPontoHookInstalled = true;
  let activeRequest = null;
  let handling = false;

  function rowsFrom(body) {
    if (Array.isArray(body)) return body;
    for (const value of [body?.data?.marks, body?.data?.rows, body?.data, body?.marks, body?.rows, body?.results])
      if (Array.isArray(value)) return value;
    throw new Error('Resposta do Acuttis em formato não reconhecido.');
  }
  function collect(rows) {
    const seen = new Set();
    return rows
      .filter(row => {
        if (!row?._id || seen.has(row._id)) return false;
        seen.add(row._id);
        return true;
      })
      .map(row => ({ _id: row._id, mark_datetime: row.mark_datetime, timezone: row.timezone, origin: row.origin }));
  }
  async function handleResponse(url, headers, credentials, response) {
    if (!activeRequest || handling || !url.startsWith(API)) return;
    handling = true;
    const requestId = activeRequest; activeRequest = null;
    try {
      if (!response.ok) throw new Error(`O Acuttis respondeu HTTP ${response.status}.`);
      const firstRows = rowsFrom(await response.clone().json());
      // O Acuttis disponibiliza somente as 20 marcações mais recentes; não tente paginar.
      const marks = collect(firstRows);
      window.postMessage({ channel: CHANNEL, type: 'result', requestId, marks }, location.origin);
    } catch (error) {
      window.postMessage({ channel: CHANNEL, type: 'result', requestId, error: error.message, marks: [] }, location.origin);
    } finally { handling = false; }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await originalFetch(input, init);
    void handleResponse(request.url, request.headers, request.credentials, response);
    return response;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrHeaders = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__meuPontoRequest = { method, url: new URL(url, location.href).href, headers: new Headers() };
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    try { this.__meuPontoRequest?.headers.set(name, value); } catch {}
    return xhrHeaders.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', () => {
      const request = this.__meuPontoRequest;
      if (!request || !activeRequest || !request.url.startsWith(API)) return;
      let response;
      try {
        const body = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
        response = new Response(body, { status: this.status || 200 });
      } catch (error) {
        const requestId = activeRequest;
        activeRequest = null;
        window.postMessage({ channel: CHANNEL, type: 'result', requestId, marks: [], error: `Não consegui ler a resposta de batimentos do Acuttis: ${error.message}` }, location.origin);
        return;
      }
      void handleResponse(request.url, request.headers, 'include', response);
    }, { once: true });
    return xhrSend.apply(this, args);
  };

  function proofControls() {
    const candidates = [...document.querySelectorAll('button,a,[role="button"],div,span')]
      .filter(node => node.children.length === 0 && /comprovante de ponto/i.test(node.textContent || '') && node.getClientRects().length);
    return candidates;
  }
  async function requestProof(requestId) {
    activeRequest = requestId;
    const deadline = Date.now() + 15000;
    let clickedFirst = false;
    while (Date.now() < deadline && activeRequest === requestId) {
      const controls = proofControls();
      if (controls.length) {
        const first = controls[0];
        first.click();
        clickedFirst = true;
        const secondDeadline = Date.now() + 8000;
        let clickedSecond = false;
        while (Date.now() < secondDeadline && activeRequest === requestId) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const second = proofControls().find(node => node !== first);
          if (second) { second.click(); clickedSecond = true; break; }
        }
        if (!clickedSecond && activeRequest === requestId) {
          activeRequest = null;
          window.postMessage({ channel: CHANNEL, type: 'result', requestId, marks: [], error: 'Encontrei o primeiro “Comprovante de ponto”, mas não apareceu a confirmação. Abra manualmente essa seção no Acuttis e tente sincronizar novamente.' }, location.origin);
          return;
        }
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!clickedFirst && activeRequest === requestId) {
      activeRequest = null;
      window.postMessage({ channel: CHANNEL, type: 'result', requestId, marks: [], error: 'Não encontrei “Comprovante de ponto” na aba do Acuttis. Faça login, abra essa seção e tente novamente.' }, location.origin);
      return;
    }
    setTimeout(() => {
      if (activeRequest === requestId) {
        activeRequest = null;
        window.postMessage({ channel: CHANNEL, type: 'result', requestId, marks: [], error: 'Os botões do comprovante foram acionados, mas a requisição de batimentos não apareceu em 25 segundos. Confirme que está logado, abra “Comprovante de ponto” manualmente e tente sincronizar novamente.' }, location.origin);
      }
    }, 25000);
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data?.type !== 'capture') return;
    void requestProof(event.data.requestId);
  });
})();
