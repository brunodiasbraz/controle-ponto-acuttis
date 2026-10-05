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
  function monthStart() {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
    return `${parts}-01`;
  }
  async function collect(url, headers, credentials, firstRows) {
    const start = monthStart(), all = [], seen = new Set();
    let offset = 0, rows = firstRows;
    for (let page = 0; page < 100; page++) {
      if (!rows.length) break;
      for (const row of rows) if (row?._id && !seen.has(row._id)) { seen.add(row._id); all.push(row); }
      if (rows.length < 20 || rows.some(row => typeof row.mark_datetime === 'string' && row.mark_datetime.slice(0, 10) < start)) break;
      offset += 20;
      const next = new URL(url);
      next.searchParams.set('attributes', '_id,created_at,mark_datetime,timezone,origin,address,nsr,cpf');
      next.searchParams.set('order', 'mark_datetime,DESC');
      next.searchParams.set('quantityMarks', '20');
      next.searchParams.set('lastMarkRowSearched', String(offset));
      const response = await originalFetch(next.href, { method: 'GET', headers, credentials, cache: 'no-store' });
      if (!response.ok) throw new Error(`O Acuttis respondeu HTTP ${response.status}. Faça login novamente e tente de novo.`);
      rows = rowsFrom(await response.json());
    }
    return all.map(row => ({ _id: row._id, mark_datetime: row.mark_datetime, timezone: row.timezone, origin: row.origin }));
  }
  async function handleResponse(url, headers, credentials, response) {
    if (!activeRequest || handling || !url.startsWith(API)) return;
    handling = true;
    const requestId = activeRequest; activeRequest = null;
    try {
      if (!response.ok) throw new Error(`O Acuttis respondeu HTTP ${response.status}.`);
      const firstRows = rowsFrom(await response.clone().json());
      const marks = await collect(url, headers, credentials, firstRows);
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
      try { response = new Response(this.responseText, { status: this.status }); }
      catch { return; }
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
    const deadline = Date.now() + 20000;
    let clicked = false;
    while (Date.now() < deadline && activeRequest === requestId) {
      const controls = proofControls();
      if (controls.length) {
        const first = controls[0]; first.click(); clicked = true;
        await new Promise(resolve => setTimeout(resolve, 350));
        const refreshed = proofControls();
        const second = refreshed.at(-1);
        if (second) second.click();
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!clicked && activeRequest === requestId) {
      activeRequest = null;
      window.postMessage({ channel: CHANNEL, type: 'result', requestId, marks: [], error: 'Não encontrei “Comprovante de ponto” na aba do Acuttis. Faça login, abra essa seção e tente novamente.' }, location.origin);
      return;
    }
    setTimeout(() => {
      if (activeRequest === requestId) {
        activeRequest = null;
        window.postMessage({ channel: CHANNEL, type: 'result', requestId, marks: [], error: 'O Acuttis não carregou os batimentos. Confirme que está logado e tente sincronizar novamente.' }, location.origin);
      }
    }, 120000);
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data?.type !== 'capture') return;
    void requestProof(event.data.requestId);
  });
})();
