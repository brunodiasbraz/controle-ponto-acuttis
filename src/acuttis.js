import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { importMarks } from "./db.js";

const SIGNIN = "https://app.acuttis.com.br/signin";
const API = "https://app-back.acuttis.com.br/v1/marks/list";
const monthStart = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .slice(0, 7) + "-01";
let context;
let page;
let requestHeaders;
let lastSync;
let lastError;
let autoTimer;
let connectTask;
let fetchTask;

function watch(tab) {
  tab.on("request", async (request) => {
    if (!request.url().startsWith(API)) return;
    try {
      const all = await request.allHeaders();
      requestHeaders = Object.fromEntries(
        Object.entries(all).filter(([key]) =>
          [
            "authorization",
            "x-access-token",
            "x-auth-token",
            "x-api-key",
          ].includes(key),
        ),
      );
      lastError = null;
      setImmediate(() =>
        fetchMarks(monthStart()).catch((error) => {
          lastError = error.message;
        }),
      );
    } catch (error) {
      lastError = error.message;
    }
  });
}

async function tryOpenReceipts() {
  for (let i = 0; i < 2 && !requestHeaders; i++) {
    const control =
      i === 0
        ? page.getByText(/comprovante de ponto/i).first()
        : page.getByText(/comprovante de ponto/i).last();
    if (
      !(await control
        .waitFor({ state: "visible", timeout: i === 0 ? 120000 : 5000 })
        .then(() => true)
        .catch(() => false))
    )
      break;
    await control.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
}

function startConnection() {
  if (connectTask || requestHeaders || !page) return;
  connectTask = (async () => {
    await tryOpenReceipts();
    if (!requestHeaders)
      throw new Error(
        "Não encontrei o comprovante de ponto. Conclua o login no Chrome e clique em Conectar Acuttis novamente.",
      );
  })()
    .catch((error) => {
      lastError = error.message;
    })
    .finally(() => {
      connectTask = null;
    });
}

export async function openBrowser() {
  if (context) {
    if (!page || page.isClosed()) {
      page = context.pages()[0] || (await context.newPage());
      await page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
    }
    startConnection();
    return { opened: true, connecting: !!connectTask };
  }
  context = await chromium.launchPersistentContext(
    resolve("data/chrome-profile"),
    {
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      headless: false,
      viewport: { width: 1200, height: 800 },
      args: ["--no-first-run"],
    },
  );
  context.on("close", () => {
    context = null;
    page = null;
    requestHeaders = null;
  });
  context.on("page", watch);
  for (const tab of context.pages()) watch(tab);
  page = context.pages()[0] || (await context.newPage());
  await page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
  startConnection();
  return { opened: true, connecting: !!connectTask };
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body;
  for (const value of [
    body?.data?.marks,
    body?.data?.rows,
    body?.data,
    body?.marks,
    body?.rows,
    body?.results,
  ]) {
    if (Array.isArray(value)) return value;
  }
  throw new Error("O Acuttis retornou um formato de resposta desconhecido.");
}

async function fetchMarks(start) {
  if (fetchTask) return fetchTask;
  fetchTask = (async () => {
    if (!requestHeaders) return { pending: true };
    let added = 0;
    let received = 0;
    let pages = 0;
    const seen = new Set();
    for (let offset = 0; offset < 2000; offset += 20) {
      const url = new URL(API);
      url.searchParams.set(
        "attributes",
        "_id,created_at,mark_datetime,timezone,origin,address,nsr,cpf",
      );
      url.searchParams.set("order", "mark_datetime,DESC");
      url.searchParams.set("quantityMarks", "20");
      url.searchParams.set("lastMarkRowSearched", String(offset));
      const response = await context.request.get(url.href, {
        headers: requestHeaders,
        timeout: 15000,
      });
      if (!response.ok()) {
        if ([401, 403].includes(response.status())) {
          requestHeaders = null;
          await page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
          startConnection();
          throw new Error(
            "Sessão do Acuttis expirada. Faça login novamente na janela aberta.",
          );
        }
        throw new Error(`O Acuttis respondeu HTTP ${response.status()}.`);
      }
      const rows = rowsFromResponse(await response.json());
      if (!rows.length) break;
      const freshRows = rows.filter((row) => row._id && !seen.has(row._id));
      if (!freshRows.length) break;
      for (const row of freshRows) seen.add(row._id);
      const result = importMarks(freshRows);
      added += result.added;
      received += result.received;
      pages++;
      if (
        rows.length < 20 ||
        rows.some(
          (row) =>
            typeof row.mark_datetime === "string" &&
            row.mark_datetime.slice(0, 10) < start,
        )
      )
        break;
    }
    lastSync = new Date().toISOString();
    lastError = null;
    if (!autoTimer)
      autoTimer = setInterval(
        () =>
          fetchMarks(monthStart()).catch((error) => {
            lastError = error.message;
          }),
        5 * 60 * 1000,
      );
    return { added, received, pages, lastSync };
  })();
  try {
    return await fetchTask;
  } finally {
    fetchTask = null;
  }
}

export async function syncMarks(start = monthStart()) {
  await openBrowser();
  return requestHeaders ? fetchMarks(start) : { pending: true };
}

export function syncStatus() {
  return {
    browserOpen: !!context,
    connecting: !!connectTask,
    capturedRequest: !!requestHeaders,
    lastSync: lastSync || null,
    lastError: lastError || null,
  };
}
