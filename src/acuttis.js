import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { importMarks } from "./db.js";
import { getAcuttisCredentials } from "./acuttis-credentials.js";

const SIGNIN = "https://app.acuttis.com.br/signin";
const API = "https://app-back.acuttis.com.br/v1/marks/list";
const states = new Map();
const monthStart = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7) + "-01";
function session(userId) {
  if (!states.has(userId)) states.set(userId, { context: null, page: null, requestHeaders: null, lastSync: null, lastError: null, autoTimer: null, connectTask: null, loginTask: null, fetchTask: null });
  return states.get(userId);
}

function watch(userId, state, tab) {
  tab.on("request", async request => {
    if (!request.url().startsWith(API)) return;
    try {
      const all = await request.allHeaders();
      state.requestHeaders = Object.fromEntries(Object.entries(all).filter(([key]) => ["authorization", "x-access-token", "x-auth-token", "x-api-key"].includes(key)));
      state.lastError = null;
      setImmediate(() => fetchMarks(userId, state, monthStart()).catch(error => { state.lastError = error.message; }));
    } catch (error) { state.lastError = error.message; }
  });
}

async function loginWithSavedCredentials(userId, state) {
  let credentials;
  try { credentials = getAcuttisCredentials(userId); }
  catch (error) { state.lastError = error.message; return false; }
  if (!credentials || !state.page || state.page.isClosed()) return false;
  try {
    const currentUrl = new URL(state.page.url());
    if (currentUrl.origin !== new URL(SIGNIN).origin || !/^\/signin(?:\/|$)/i.test(currentUrl.pathname)) return false;
    const password = state.page.locator('input[type="password"]:visible').first();
    await password.waitFor({ state: "visible", timeout: 8000 });
    const username = state.page.locator('input:visible:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="submit"]):not([type="button"])').first();
    await username.waitFor({ state: "visible", timeout: 3000 });
    await username.fill(credentials.username);
    await password.fill(credentials.password);
    const submit = state.page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first();
    const namedSubmit = state.page.getByRole("button", { name: /entrar|login|acessar|continuar/i }).first();
    if (await submit.count()) await submit.click({ timeout: 5000 });
    else if (await namedSubmit.count()) await namedSubmit.click({ timeout: 5000 });
    else await password.press("Enter");
    state.lastError = null;
    return true;
  } catch { return false; }
}

function attemptSavedCredentialsLogin(userId, state) {
  if (!state.loginTask) state.loginTask = loginWithSavedCredentials(userId, state).finally(() => { state.loginTask = null; });
  return state.loginTask;
}

function startConnection(userId, state) {
  if (state.connectTask || state.requestHeaders || !state.page) return;
  state.connectTask = (async () => {
    await attemptSavedCredentialsLogin(userId, state);
    for (let i = 0; i < 2 && !state.requestHeaders; i++) {
      const control = i === 0 ? state.page.getByText(/comprovante de ponto/i).first() : state.page.getByText(/comprovante de ponto/i).last();
      if (!(await control.waitFor({ state: "visible", timeout: i === 0 ? 120000 : 5000 }).then(() => true).catch(() => false))) break;
      await control.click({ timeout: 5000 }).catch(() => {});
      await state.page.waitForTimeout(700);
    }
    if (!state.requestHeaders) throw new Error("Não encontrei o comprovante de ponto. Conclua o login na janela aberta e conecte novamente.");
  })().catch(error => { state.lastError = error.message; }).finally(() => { state.connectTask = null; });
}

export async function openBrowser(userId) {
  const state = session(userId);
  if (state.context) {
    if (!state.page || state.page.isClosed()) {
      state.page = state.context.pages()[0] || await state.context.newPage();
      await state.page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
    }
    void attemptSavedCredentialsLogin(userId, state);
    startConnection(userId, state);
    return { opened: true, connecting: !!state.connectTask };
  }
  const profile = resolve("data/chrome-profiles", userId);
  const headlessSetting = (process.env.CHROME_HEADLESS || "auto").toLowerCase();
  if (!["auto", "true", "false"].includes(headlessSetting))
    throw new Error("CHROME_HEADLESS deve ser 'auto', 'true' ou 'false'.");
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (headlessSetting === "false" && !hasDisplay)
    throw new Error("CHROME_HEADLESS=false exige um ambiente gráfico (DISPLAY/WAYLAND_DISPLAY). Na VM sem desktop, use CHROME_HEADLESS=true ou auto.");
  const headless = headlessSetting === "true" || (headlessSetting === "auto" && !hasDisplay);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless,
    viewport: { width: 1200, height: 800 },
    args: ["--no-first-run"],
  });
  state.context = context;
  context.on("close", () => {
    state.context = null;
    state.page = null;
    state.requestHeaders = null;
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  });
  context.on("page", tab => watch(userId, state, tab));
  for (const tab of context.pages()) watch(userId, state, tab);
  state.page = context.pages()[0] || await context.newPage();
  await state.page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
  startConnection(userId, state);
  return { opened: true, connecting: !!state.connectTask };
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body;
  for (const value of [body?.data?.marks, body?.data?.rows, body?.data, body?.marks, body?.rows, body?.results]) if (Array.isArray(value)) return value;
  throw new Error("O Acuttis retornou um formato de resposta desconhecido.");
}

async function fetchMarks(userId, state, start) {
  if (state.fetchTask) return state.fetchTask;
  state.fetchTask = (async () => {
    if (!state.requestHeaders || !state.context) return { pending: true };
    let added = 0, received = 0, pages = 0;
    const seen = new Set();
    for (let offset = 0; offset < 2000; offset += 20) {
      const url = new URL(API);
      url.searchParams.set("attributes", "_id,created_at,mark_datetime,timezone,origin,address,nsr,cpf");
      url.searchParams.set("order", "mark_datetime,DESC");
      url.searchParams.set("quantityMarks", "20");
      url.searchParams.set("lastMarkRowSearched", String(offset));
      const response = await state.context.request.get(url.href, { headers: state.requestHeaders, timeout: 15000 });
      if (!response.ok()) {
        if ([401, 403].includes(response.status())) {
          state.requestHeaders = null;
          await state.page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
          startConnection(userId, state);
          throw new Error("Sessão do Acuttis expirada. Faça login novamente na janela aberta.");
        }
        throw new Error(`O Acuttis respondeu HTTP ${response.status()}.`);
      }
      const rows = rowsFromResponse(await response.json());
      if (!rows.length) break;
      const freshRows = rows.filter(row => row._id && !seen.has(row._id));
      if (!freshRows.length) break;
      for (const row of freshRows) seen.add(row._id);
      const result = importMarks(freshRows, userId);
      added += result.added;
      received += result.received;
      pages++;
      if (rows.length < 20 || rows.some(row => typeof row.mark_datetime === "string" && row.mark_datetime.slice(0, 10) < start)) break;
    }
    state.lastSync = new Date().toISOString();
    state.lastError = null;
    if (!state.autoTimer) state.autoTimer = setInterval(() => fetchMarks(userId, state, monthStart()).catch(error => { state.lastError = error.message; }), 5 * 60 * 1000);
    return { added, received, pages, lastSync: state.lastSync };
  })();
  try { return await state.fetchTask; }
  finally { state.fetchTask = null; }
}

export async function syncMarks(userId, start = monthStart()) {
  await openBrowser(userId);
  const state = session(userId);
  return state.requestHeaders ? fetchMarks(userId, state, start) : { pending: true };
}

export function syncStatus(userId) {
  const state = session(userId);
  return { browserOpen: !!state.context, connecting: !!state.connectTask, capturedRequest: !!state.requestHeaders, lastSync: state.lastSync || null, lastError: state.lastError || null };
}
