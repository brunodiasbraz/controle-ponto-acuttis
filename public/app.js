const $ = (selector) => document.querySelector(selector);
let state;
let selectedDate;
let authUsername = "";
let authMode = "login";
const names = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) =>
  `${n < 0 ? "−" : ""}${String(Math.floor(Math.abs(n) / 60)).padStart(2, "0")}:${String(Math.abs(n) % 60).padStart(2, "0")}`;
const dateLabel = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fullDate = (iso) => `${dateLabel(iso)}/${iso.slice(0, 4)}`;
const balanceClass = (n) => (n > 0 ? "positive" : n < 0 ? "negative" : "");
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
$("#month").value = today.slice(0, 7);

const appearanceKey = "controle-ponto.appearance";
const defaultAppearance = { theme: "system", primary: "#2267a5" };
function readAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(appearanceKey) || "{}");
    return {
      theme: ["system", "light", "dark"].includes(saved.theme)
        ? saved.theme
        : "system",
      primary: /^#[0-9a-f]{6}$/i.test(saved.primary || "")
        ? saved.primary
        : defaultAppearance.primary,
    };
  } catch {
    return { ...defaultAppearance };
  }
}
function applyAppearance() {
  const appearance = readAppearance();
  const resolvedTheme =
    appearance.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : appearance.theme;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.bsTheme = resolvedTheme;
  root.style.setProperty("--blue", appearance.primary);
  root.style.setProperty("--primary-color", appearance.primary);
  const rgb = appearance.primary
    .match(/[\da-f]{2}/gi)
    .map((part) => Number.parseInt(part, 16));
  root.style.setProperty("--bs-primary", appearance.primary);
  root.style.setProperty("--bs-primary-rgb", rgb.join(", "));
  $("#theme-choice").value = appearance.theme;
  $("#primary-color").value = appearance.primary;
  $("#primary-color-value").textContent = appearance.primary.toUpperCase();
  $("#welcome-theme").value = appearance.theme;
  $("#welcome-primary-color").value = appearance.primary;
  $("#welcome-primary-color-value").textContent = appearance.primary.toUpperCase();
}
function saveAppearance(changes) {
  const appearance = { ...readAppearance(), ...changes };
  localStorage.setItem(appearanceKey, JSON.stringify(appearance));
  applyAppearance();
}
applyAppearance();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (readAppearance().theme === "system") applyAppearance();
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const value = await response.json();
  if (response.status === 401 && value.unauthenticated) showAuth();
  if (!response.ok)
    throw new Error(value.error || "Não foi possível concluir a operação.");
  return value;
}
function message(text, type = "info") {
  const container = $("#toast-container");
  const toast = document.createElement("div");
  const kind =
    type === "danger" || type === "error"
      ? "error"
      : type === "success"
        ? "success"
        : "info";
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = kind === "success" ? "✓" : kind === "error" ? "!" : "i";
  const content = document.createElement("span");
  content.className = "toast-message";
  content.textContent = text;
  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "Fechar aviso");
  close.textContent = "×";
  toast.className = `app-toast toast-${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  toast.append(icon, content, close);
  container.append(toast);
  while (container.children.length > 4) container.firstElementChild.remove();
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    toast.classList.add("toast-leaving");
    setTimeout(() => toast.remove(), 220);
  };
  close.addEventListener("click", dismiss);
  timer = setTimeout(dismiss, 4500);
}
function metric(label, value, hint, css = "") {
  return `<div class="col-6 col-lg-3"><div class="card border-0 shadow-sm h-100"><div class="card-body p-3 p-lg-4"><div class="metric-label">${label}</div><div class="metric ${css} mt-2">${value}</div><div class="metric-hint mt-2">${hint}</div></div></div></div>`;
}
function projection(title, item, note, highlightFridayExit = false) {
  if (!item)
    return `<div class="col-12 col-lg-4"><div class="card border-0 shadow-sm h-100"><div class="card-body p-4"><div class="metric-label">${title}</div><p class="text-secondary mb-0 mt-3">Fechamento fora do mês selecionado.</p></div></div></div>`;
  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const nowMinutes = Number(nowParts.find((part) => part.type === "hour").value) * 60
    + Number(nowParts.find((part) => part.type === "minute").value);
  const exitParts = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(item.exit || "");
  const exitMinutes = exitParts ? Number(exitParts[1]) * 60 + Number(exitParts[2]) : null;
  const exitSoon = highlightFridayExit
    && item.date === today
    && new Date(`${today}T12:00:00Z`).getUTCDay() === 5
    && exitMinutes !== null
    && exitMinutes >= nowMinutes
    && exitMinutes - nowMinutes <= 10;
  const alert = item.missing.length
    ? `<div class="small negative mt-2">Faltam batimentos em ${item.missing.map(dateLabel).join(", ")}. Previsão suspensa.</div>`
    : "";
  const assumption = item.assumedDates.length
    ? `<div class="small text-secondary mt-2">${item.assumedDates.length} dia(s) útil(eis) futuros projetados pela jornada prevista, com compensação nas sextas.</div>`
    : "";
  const output = item.dayOff ? "Folga" : item.exit || "—";
  const detail = item.dayOff
    ? `Sem jornada neste dia · saldo anterior: <strong>${fmt(item.balanceBefore)}</strong>`
    : `${note} · Trabalho necessário: <strong>${fmt(item.requiredWork)}</strong>`;
  const exitMessage = exitSoon
    ? `<div class="small exit-soon-message mt-2"><span class="exit-info-icon" aria-hidden="true">i</span>Você poderá sair às <strong>${item.exit}</strong> se desejar.</div>`
    : "";
  return `<div class="col-12 col-lg-4"><div class="card border-0 shadow-sm h-100${exitSoon ? " projection-exit-soon" : ""}"><div class="card-body p-4"><div class="d-flex justify-content-between align-items-start"><div class="metric-label">${title}</div><span class="badge badge-soft">${dateLabel(item.date)}</span></div><div class="projection-value mt-2">${output}</div><div class="small text-secondary">${detail}</div>${exitMessage}${alert}${assumption}</div></div></div>`;
}
function todayProjection(item) {
  if (!item)
    return `<div class="col-12 col-lg-4"><div class="card border-0 shadow-sm h-100"><div class="card-body p-4"><div class="metric-label">Saída de hoje</div><p class="text-secondary mb-0 mt-3">Dia atual fora do mês selecionado.</p></div></div></div>`;
  const header = `<div class="d-flex justify-content-between align-items-start"><div class="metric-label">Saída de hoje</div><span class="badge badge-soft">${dateLabel(item.date)}</span></div>`;
  if (item.dayOff)
    return `<div class="col-12 col-lg-4"><div class="card border-0 shadow-sm h-100"><div class="card-body p-4">${header}<div class="projection-value mt-2">Folga</div><div class="small text-secondary">Não há jornada prevista para hoje.</div></div></div></div>`;
  const output = item.exit || "—";
  const status = item.complete ? "Saída registrada" : "Saída estimada";
  const overtime = item.maxExtraMinutes ? `Pode fazer até ${fmt(item.maxExtraMinutes)} hora(s) extra · limite ${item.latestExit}.` : `Sem hora extra prevista · limite ${item.latestExit}.`;
  const detail = `Jornada: ${fmt(item.target)} · trabalhadas: ${fmt(item.worked)}.`;
  return `<div class="col-12 col-lg-4"><div class="card border-0 shadow-sm h-100"><div class="card-body p-4">${header}<div class="projection-value mt-2">${output}</div><div class="small text-secondary">${status} · ${detail}</div><div class="small primary-note mt-2">${overtime}</div></div></div></div>`;
}
function render(data) {
  state = data;
  const s = data.summary;
  $("#summary").innerHTML =
    metric(
      "Jornada do mês",
      fmt(s.monthTarget),
      `Dias fechados até hoje: ${fmt(s.expected)}`,
    ) +
    metric(
      "Trabalhadas no mês",
      fmt(s.worked),
      `${s.markCount} batimentos importados`,
    ) +
    metric(
      "Saldo da semana",
      fmt(s.weekBalance),
      "Apenas dias fechados",
      balanceClass(s.weekBalance),
    ) +
    metric(
      "Saldo do mês",
      fmt(s.balance),
      s.missingDates.length
        ? `${s.missingDates.length} dia(s) com marcações incompletas`
        : "Apenas dias fechados",
      balanceClass(s.balance),
    );
  $("#projections").innerHTML =
    todayProjection(data.projections.today) +
    projection(
      "Saída na sexta-feira",
      data.projections.friday,
      "Zerar saldo da semana",
      true,
    ) +
    projection(
      "Saída no último dia útil do mês",
      data.projections.monthEnd,
      "Zerar saldo mensal",
    );
  $("#shifts-section").hidden = data.shifts.length === 0;
  $("#shifts").innerHTML = data.shifts.length
    ? data.shifts
        .map(
          (shift) =>
            `<div class="d-flex justify-content-between align-items-center gap-3 border-top py-3"><div><strong>Plantão ${fullDate(shift.duty_date)}</strong> <span class="badge badge-soft ms-1">${fmt(shift.duty_target_minutes)}</span><div class="small text-secondary">Folga prevista: ${fullDate(shift.day_off_date)}</div></div><button class="btn btn-sm btn-outline-danger remove-shift" data-id="${shift.id}" type="button">Excluir</button></div>`,
        )
        .join("")
    : "";
  $("#days").innerHTML = data.days
    .map((day) => {
      const dow = names[new Date(`${day.date}T12:00:00Z`).getUTCDay()];
      const isFuture = day.date > data.today;
      const partial =
        day.date === data.today && day.target > 0 && !day.complete;
      const badge =
        day.shiftKind === "duty"
          ? '<span class="badge  badge-soft mx-3">Plantão</span>'
          : partial
            ? '<span class="badge badge-soft-dark mx-3">Em aberto</span>'
            : "";
      return `<tr data-date="${day.date}" class="${day.date === data.today ? "today" : ""}"><td><strong>${dateLabel(day.date)}</strong> <span class="text-secondary">${dow}</span>${badge}</td><td>${fmt(day.target)}</td><td>${day.marks.length ? day.marks.map((time) => `<span class="punch">${time}</span>`).join("") : '<span class="text-secondary">—</span>'}</td><td>${isFuture ? "—" : fmt(day.worked)}</td><td class="${!isFuture && !partial ? balanceClass(day.balance) : ""}">${isFuture || partial || day.marks.length === 0 ? "—" : fmt(day.balance)}</td><td class="text-secondary">${escapeHtml(day.note)}</td></tr>`;
    })
    .join("");
  $("#sync-status").textContent = data.sync.lastError
    ? `Acuttis: ${data.sync.lastError}`
    : data.sync.connecting
      ? "Aguardando login no Chrome para sincronizar…"
      : data.sync.lastSync
        ? `Última sincronização: ${new Date(data.sync.lastSync).toLocaleString("pt-BR")} · automática a cada 5 min`
        : "Ainda não sincronizado com o Acuttis";
  if (!$("#settings-dialog").open) {
    $("#planned-start").value =
      `${String(Math.floor(data.settings.plannedStart / 60)).padStart(2, "0")}:${String(data.settings.plannedStart % 60).padStart(2, "0")}`;
    $("#break").value = data.settings.breakMinutes;
    $("#tolerance").value = data.settings.tolerance;
  }
}
async function refresh() {
  try {
    render(
      await api(
        `/api/dashboard?month=${encodeURIComponent($("#month").value)}`,
      ),
    );
  } catch (error) {
    message(error.message, "danger");
  }
}
async function action(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (error) {
    message(error.message, "danger");
  } finally {
    button.disabled = false;
  }
}
$("#month").addEventListener("change", refresh);
$("#open-settings").addEventListener("click", () => {
  applyAppearance();
  $("#account-username").textContent = authUsername;
  $("#settings-dialog").showModal();
  loadAcuttisCredentials();
});
function selectSettingsTab(tab) {
  for (const name of ["work", "appearance", "acuttis", "account"]) {
    const selected = name === tab;
    $(`#tab-${name}`).classList.toggle("active", selected);
    $(`#tab-${name}`).setAttribute("aria-selected", String(selected));
    $(`#panel-${name}`).hidden = !selected;
    $(`#panel-${name}`).classList.toggle("active", selected);
  }
}
$("#tab-work").addEventListener("click", () => selectSettingsTab("work"));
$("#tab-appearance").addEventListener("click", () =>
  selectSettingsTab("appearance"),
);
$("#tab-acuttis").addEventListener("click", () => selectSettingsTab("acuttis"));
$("#tab-account").addEventListener("click", () => selectSettingsTab("account"));
$(".settings-tabs").addEventListener("keydown", (event) => {
  const tabs = [$("#tab-work"), $("#tab-appearance"), $("#tab-acuttis"), $("#tab-account")];
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  const next =
    event.key === "ArrowRight"
      ? (current + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (current + tabs.length - 1) % tabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : -1;
  if (next < 0) return;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
});
$("#theme-choice").addEventListener("change", (event) =>
  saveAppearance({ theme: event.target.value }),
);
$("#primary-color").addEventListener("input", (event) =>
  saveAppearance({ primary: event.target.value }),
);
$("#welcome-theme").addEventListener("change", (event) =>
  saveAppearance({ theme: event.target.value }),
);
$("#welcome-primary-color").addEventListener("input", (event) =>
  saveAppearance({ primary: event.target.value }),
);
async function loadAcuttisCredentials() {
  try {
    const value = await api("/api/acuttis/credentials");
    $("#acuttis-username").value = value.username;
    $("#acuttis-password").value = "";
    $("#credentials-status").textContent = value.configured
      ? `Acesso salvo para ${value.username}. A senha permanece protegida no servidor.`
      : "Nenhum acesso salvo. Informe suas credenciais para habilitar o login automático.";
    $("#delete-acuttis-credentials").hidden = !value.configured;
  } catch (error) {
    $("#credentials-status").textContent = error.message;
  }
}
$("#save-acuttis-credentials").addEventListener("click", (event) =>
  action(event.currentTarget, async () => {
    const result = await api("/api/acuttis/credentials", {
      method: "PUT",
      body: JSON.stringify({ username: $("#acuttis-username").value, password: $("#acuttis-password").value }),
    });
    $("#acuttis-password").value = "";
    $("#credentials-status").textContent = `Acesso salvo para ${result.username}. A senha permanece protegida no servidor.`;
    $("#delete-acuttis-credentials").hidden = false;
    message("Credenciais do Acuttis salvas com criptografia.", "success");
  }),
);
$("#acuttis-username").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#acuttis-password").focus();
  }
});
$("#acuttis-password").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#save-acuttis-credentials").click();
  }
});
$("#delete-acuttis-credentials").addEventListener("click", (event) =>
  action(event.currentTarget, async () => {
    if (!confirm("Remover as credenciais do Acuttis salvas neste aplicativo?")) return;
    await api("/api/acuttis/credentials", { method: "DELETE" });
    $("#acuttis-username").value = "";
    $("#acuttis-password").value = "";
    $("#credentials-status").textContent = "Nenhum acesso salvo. Informe suas credenciais para habilitar o login automático.";
    $("#delete-acuttis-credentials").hidden = true;
    message("Credenciais do Acuttis removidas.", "success");
  }),
);
$("#open-acuttis").addEventListener("click", () =>
  $("#acuttis-dialog").showModal(),
);
document
  .querySelectorAll("[data-close-dialog]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      document.getElementById(button.dataset.closeDialog).close(),
    ),
  );
$("#start-connection").addEventListener("click", (event) =>
  action(event.currentTarget, async () => {
    await api("/api/acuttis/open", { method: "POST" });
    $("#connection-status").textContent =
      "Se houver credenciais salvas, o login será preenchido automaticamente. Conclua eventual MFA ou CAPTCHA na janela aberta; depois a sincronização começa.";
    await refresh();
  }),
);
$("#sync").addEventListener("click", (event) =>
  action(event.currentTarget, async () => {
    const result = await api("/api/acuttis/sync", { method: "POST" });
    message(
      result.pending
        ? "Aguardando login no Chrome. A sincronização continuará automaticamente."
        : `${result.added} marcação(ões) nova(s) em ${result.pages} página(s).`,
      result.pending ? "info" : "success",
    );
    await refresh();
  }),
);
$("#new-shift").addEventListener("click", () => {
  $("#duty-date").value = today;
  $("#day-off-date").value = "";
  $("#shift-preview").textContent = "Escolha a data da folga.";
  $("#shift-dialog").showModal();
});
function updateShiftPreview() {
  const date = $("#day-off-date").value;
  const duty = $("#duty-date").value;
  if (!date) {
    $("#shift-preview").textContent = "Escolha a data da folga.";
    return;
  }
  if (date === duty) {
    $("#shift-preview").textContent =
      "A folga e o plantão precisam ser em dias diferentes.";
    return;
  }
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  $("#shift-preview").textContent =
    day === 5
      ? "Folga na sexta: plantão de 08:00."
      : day === 0 || day === 6
        ? "A folga precisa cair entre segunda e sexta."
        : "Folga em dia útil: plantão de 09:00.";
}
$("#day-off-date").addEventListener("change", updateShiftPreview);
$("#duty-date").addEventListener("change", updateShiftPreview);
$("#save-shift").addEventListener("click", (event) =>
  action(event.currentTarget, async () => {
    const dutyDate = $("#duty-date").value;
    const dayOffDate = $("#day-off-date").value;
    if (!dutyDate || !dayOffDate) throw new Error("Informe as duas datas.");
    if (dutyDate === dayOffDate)
      throw new Error("A folga e o plantão precisam ser em dias diferentes.");
    const result = await api("/api/shifts", {
      method: "POST",
      body: JSON.stringify({ dutyDate, dayOffDate }),
    });
    $("#shift-dialog").close();
    message(`Plantão de ${fmt(result.targetMinutes)} provisionado.`, "success");
    await refresh();
  }),
);
$("#shifts").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-shift");
  if (!button) return;
  action(button, async () => {
    await api(`/api/shifts/${button.dataset.id}`, { method: "DELETE" });
    message("Plantão excluído.", "success");
    await refresh();
  });
});
$("#import-button").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const result = await api("/api/import", {
      method: "POST",
      body: await file.text(),
    });
    message(`${result.added} marcação(ões) importada(s).`, "success");
    await refresh();
  } catch (error) {
    message(error.message, "danger");
  }
  event.target.value = "";
});
$("#days").addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-date]");
  if (!row) return;
  selectedDate = row.dataset.date;
  const day = state.days.find((item) => item.date === selectedDate);
  $("#day-title").textContent = `Dia ${dateLabel(selectedDate)}`;
  $("#day-target").value =
    `${String(Math.floor(day.target / 60)).padStart(2, "0")}:${String(day.target % 60).padStart(2, "0")}`;
  $("#day-note").value = day.note;
  $("#day-target").disabled = !!day.shiftKind;
  $("#day-note").disabled = !!day.shiftKind;
  $("#save-day").disabled = !!day.shiftKind;
  $("#new-mark").value = "";
  $("#mark-list").innerHTML = day.marks
    .map(
      (time, i) =>
        `<div class="d-flex justify-content-between align-items-center border-bottom py-1"><span>${time}</span>${day.ids[i]?.startsWith("manual:") ? `<button type="button" class="btn btn-sm btn-link text-danger remove-mark" data-id="${escapeHtml(day.ids[i])}">Remover</button>` : '<span class="text-secondary">Acuttis</span>'}</div>`,
    )
    .join("");
  $("#day-dialog").showModal();
});
$("#save-day").addEventListener("click", (event) =>
  action(event.currentTarget, async () => {
    const [h, m] = $("#day-target").value.split(":").map(Number);
    await api("/api/day", {
      method: "PUT",
      body: JSON.stringify({
        date: selectedDate,
        targetMinutes: h * 60 + m,
        note: $("#day-note").value,
      }),
    });
    $("#day-dialog").close();
    message("Jornada do dia salva.", "success");
    await refresh();
  }),
);
$("#add-mark").addEventListener("click", (event) =>
  action(event.currentTarget, async () => {
    if (!$("#new-mark").value) throw new Error("Informe um horário.");
    await api("/api/mark", {
      method: "POST",
      body: JSON.stringify({ date: selectedDate, time: $("#new-mark").value }),
    });
    $("#day-dialog").close();
    message("Marcação local adicionada.", "success");
    await refresh();
  }),
);
$("#mark-list").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-mark");
  if (!button) return;
  action(button, async () => {
    await api(`/api/mark/${encodeURIComponent(button.dataset.id)}`, {
      method: "DELETE",
    });
    $("#day-dialog").close();
    message("Marcação local removida.", "success");
    await refresh();
  });
});
$("#settings").addEventListener("submit", (event) => {
  event.preventDefault();
  action(event.submitter, async () => {
    const [h, m] = $("#planned-start").value.split(":").map(Number);
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        plannedStart: h * 60 + m,
        breakMinutes: Number($("#break").value),
        toleranceMinutes: Number($("#tolerance").value),
      }),
    });
    $("#settings-dialog").close();
    message("Preferências salvas.", "success");
    await refresh();
  });
});
let onboardingStep = 1;
let onboardingConfiguredCredentials = false;
let onboardingWarning = "";

function showWelcome() {
  $("#startup-screen").hidden = true;
  $("#auth-screen").hidden = true;
  $("#dashboard-app").hidden = true;
  $("#welcome-screen").hidden = false;
}
function showAuth() {
  $("#startup-screen").hidden = true;
  $("#welcome-screen").hidden = true;
  $("#dashboard-app").hidden = true;
  $("#auth-screen").hidden = false;
}
function showDashboard() {
  $("#startup-screen").hidden = true;
  $("#auth-screen").hidden = true;
  $("#welcome-screen").hidden = true;
  $("#dashboard-app").hidden = false;
  $("#account-username").textContent = authUsername;
}
function setWelcomeStep(step) {
  onboardingStep = step;
  for (let index = 1; index <= 3; index += 1) {
    const panel = $(`#welcome-step-${index}`);
    const indicator = $(`[data-step-indicator="${index}"]`);
    panel.hidden = index !== step;
    indicator.classList.toggle("active", index === step);
    indicator.classList.toggle("done", index < step);
  }
  $("#welcome-step-count").textContent = `Etapa ${step} de 3`;
  $("#welcome-back").hidden = step === 1;
  $("#welcome-next").hidden = step === 3;
  $("#welcome-finish").hidden = step !== 3;
  $("#welcome-next").textContent = step === 1
    ? "Salvar acesso e continuar"
    : "Salvar jornada e continuar";
  $("#welcome-error").hidden = true;
}
function welcomeError(error) {
  const box = $("#welcome-error");
  box.textContent = error;
  box.hidden = false;
}

async function initializeApp() {
  try {
    const auth = await api("/api/auth/status");
    if (!auth.authenticated) {
      showAuth();
      return;
    }
    authUsername = auth.user.username;
    const [data, onboarding] = await Promise.all([
      api(`/api/dashboard?month=${encodeURIComponent(today.slice(0, 7))}`),
      api("/api/onboarding"),
    ]);
    render(data);
    if (onboarding.complete) {
      showDashboard();
      return;
    }
    const credentials = await api("/api/acuttis/credentials");
    onboardingConfiguredCredentials = credentials.configured;
    $("#welcome-acuttis-username").value = credentials.username;
    $("#welcome-acuttis-password").value = "";
    $("#welcome-planned-start").value = `${String(Math.floor(data.settings.plannedStart / 60)).padStart(2, "0")}:${String(data.settings.plannedStart % 60).padStart(2, "0")}`;
    $("#welcome-break").value = data.settings.breakMinutes;
    $("#welcome-tolerance").value = data.settings.tolerance;
    setWelcomeStep(1);
    showWelcome();
  } catch (error) {
    showWelcome();
    welcomeError(`Não foi possível preparar a configuração inicial: ${error.message}`);
  }
}

function updateAuthMode() {
  const registering = authMode === "register";
  $("#auth-submit").textContent = registering ? "Criar conta" : "Entrar";
  $("#auth-toggle-prompt").textContent = registering ? "Já tem conta?" : "Ainda não tem conta?";
  $("#auth-toggle").textContent = registering ? "Entrar" : "Criar conta";
  $("#auth-password").autocomplete = registering ? "new-password" : "current-password";
  $("#auth-password-help").hidden = !registering;
  $("#auth-error").hidden = true;
}
$("#auth-toggle").addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthMode();
});
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#auth-submit");
  const errorBox = $("#auth-error");
  button.disabled = true;
  errorBox.hidden = true;
  try {
    await api(`/api/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify({ username: $("#auth-username").value.trim(), password: $("#auth-password").value }),
    });
    $("#auth-password").value = "";
    $("#auth-screen").hidden = true;
    $("#startup-screen").hidden = false;
    await initializeApp();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
});
$("#logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    authUsername = "";
    $("#settings-dialog").close();
    showAuth();
  } catch (error) {
    message(error.message, "danger");
  }
});

$("#welcome-back").addEventListener("click", () => setWelcomeStep(Math.max(1, onboardingStep - 1)));
$("#welcome-next").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  $("#welcome-error").hidden = true;
  try {
    if (onboardingStep === 1) {
      const username = $("#welcome-acuttis-username").value.trim();
      const password = $("#welcome-acuttis-password").value;
      if (!username) throw new Error("Informe seu usuário do Acuttis.");
      if (!password && !onboardingConfiguredCredentials) throw new Error("Informe sua senha do Acuttis.");
      await api("/api/acuttis/credentials", {
        method: "PUT",
        body: JSON.stringify({ username, password }),
      });
      onboardingConfiguredCredentials = true;
      $("#welcome-acuttis-password").value = "";
      try {
        await api("/api/acuttis/open", { method: "POST" });
      } catch (error) {
        onboardingWarning = `As credenciais foram salvas, mas não foi possível abrir o Chromium: ${error.message}`;
      }
    } else if (onboardingStep === 2) {
      const [hours, minutes] = $("#welcome-planned-start").value.split(":").map(Number);
      const breakMinutes = Number($("#welcome-break").value);
      const toleranceMinutes = Number($("#welcome-tolerance").value);
      if (!$("#welcome-planned-start").value || !Number.isInteger(breakMinutes) || !Number.isInteger(toleranceMinutes)) {
        throw new Error("Preencha todos os campos da jornada.");
      }
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ plannedStart: hours * 60 + minutes, breakMinutes, toleranceMinutes }),
      });
    }
    setWelcomeStep(onboardingStep + 1);
  } catch (error) {
    welcomeError(error.message);
  } finally {
    button.disabled = false;
  }
});
$("#welcome-finish").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  $("#welcome-error").hidden = true;
  try {
    await api("/api/onboarding/complete", { method: "POST" });
    showDashboard();
    await refresh();
    if (onboardingWarning) message(onboardingWarning, "info");
    else message("Configuração concluída. Seu painel está pronto.", "success");
  } catch (error) {
    welcomeError(error.message);
  } finally {
    button.disabled = false;
  }
});

initializeApp();
setInterval(() => {
  if (
    !$("#dashboard-app").hidden &&
    document.visibilityState === "visible" &&
    $("#month").value === today.slice(0, 7)
  )
    refresh();
}, 5000);
