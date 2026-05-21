const frodoState = {
  sessionId: "",
  uploaded: false,
  analysis: null
};

const assistantModelSelect = document.querySelector("#assistantModelSelect");
const frodoStatus = document.querySelector("#frodoStatus");
const frodoUploadButton = document.querySelector("#frodoUploadButton");
const frodoStep1Next = document.querySelector("#frodoStep1Next");
const frodoBackToUpload = document.querySelector("#frodoBackToUpload");
const frodoPlanFile = document.querySelector("#frodoPlanFile");
const frodoCatalogFile = document.querySelector("#frodoCatalogFile");
const frodoUploadSummary = document.querySelector("#frodoUploadSummary");
const frodoFachrichtung = document.querySelector("#frodoFachrichtung");
const frodoLernfeld = document.querySelector("#frodoLernfeld");
const frodoAnalyzeButton = document.querySelector("#frodoAnalyzeButton");
const frodoSearchQuery = document.querySelector("#frodoSearchQuery");
const frodoSearchButton = document.querySelector("#frodoSearchButton");
const frodoSearchResults = document.querySelector("#frodoSearchResults");
const frodoAnalysisEditor = document.querySelector("#frodoAnalysisEditor");
const frodoLsCount = document.querySelector("#frodoLsCount");
const frodoOwnContent = document.querySelector("#frodoOwnContent");
const frodoAnotherLfButton = document.querySelector("#frodoAnotherLfButton");
const frodoToGandalfButton = document.querySelector("#frodoToGandalfButton");
const assistantPageKicker = document.querySelector("#assistantPageKicker");
const assistantPageTitle = document.querySelector("#assistantPageTitle");

syncAssistantView();
window.addEventListener("hashchange", syncAssistantView);
loadAssistantModels();

frodoUploadButton?.addEventListener("click", uploadFrodoDocuments);
frodoPlanFile?.addEventListener("change", resetFrodoUploadState);
frodoCatalogFile?.addEventListener("change", resetFrodoUploadState);
frodoStep1Next?.addEventListener("click", () => showFrodoStep(2));
frodoBackToUpload?.addEventListener("click", () => showFrodoStep(1));
frodoAnalyzeButton?.addEventListener("click", analyzeWithFrodo);
frodoSearchButton?.addEventListener("click", searchWithFrodo);
frodoAnotherLfButton?.addEventListener("click", () => showFrodoStep(2));
frodoToGandalfButton?.addEventListener("click", handoffToGandalf);
updateFrodoControls();

async function ensureFrodoSession({ fresh = false } = {}) {
  if (frodoState.sessionId && !fresh) return frodoState.sessionId;
  const response = await fetch("/api/frodo/session", { method: "POST" });
  const payload = await readJsonResponse(response);
  frodoState.sessionId = payload.sessionId;
  return frodoState.sessionId;
}

async function uploadFrodoDocuments() {
  const plan = frodoPlanFile.files?.[0];
  const catalog = frodoCatalogFile.files?.[0];
  if (!plan || !catalog) {
    setFrodoStatus("Bitte beide PDFs auswählen.");
    return;
  }

  clearFrodoUploadState();
  setFrodoBusy(true, "PDFs werden gelesen...");

  try {
    const sessionId = await ensureFrodoSession({ fresh: true });
    const formData = new FormData();
    formData.append("rahmenlehrplan", plan);
    formData.append("pruefungskatalog", catalog);

    const response = await fetch(`/api/frodo/upload/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: formData
    });
    const payload = await readJsonResponse(response);
    frodoState.uploaded = true;
    renderFrodoUploadSummary(payload);
    setFrodoStatus("Dokumente erkannt.");
  } catch (error) {
    setFrodoStatus(error.message);
  } finally {
    setFrodoBusy(false);
  }
}

async function analyzeWithFrodo() {
  if (!frodoState.uploaded) {
    setFrodoStatus("Bitte zuerst beide PDFs pruefen.");
    return;
  }

  const fachrichtung = frodoFachrichtung.value.trim();
  const lernfeld = frodoLernfeld.value.trim();
  if (!fachrichtung || !lernfeld) {
    setFrodoStatus("Fachrichtung und Lernfeld fehlen.");
    return;
  }

  frodoState.analysis = null;
  if (frodoAnalysisEditor) frodoAnalysisEditor.replaceChildren();
  setFrodoBusy(true, "Frodo analysiert...");
  const progress = openProgressStream(setFrodoStatus);

  try {
    const sessionId = await ensureFrodoSession();
    const response = await fetch(`/api/frodo/analyze/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fachrichtung,
        lernfeld,
        model: selectedAssistantModel(),
        progressId: progress.id
      })
    });
    const payload = await readJsonResponse(response);
    frodoState.analysis = payload.analysis;
    renderFrodoAnalysis(payload.analysis);
    showFrodoStep(3);
    setFrodoStatus("Analyse bereit.");
  } catch (error) {
    setFrodoStatus(error.message);
  } finally {
    progress.close();
    setFrodoBusy(false);
  }
}

async function searchWithFrodo() {
  const query = frodoSearchQuery.value.trim();
  if (!query) return;

  setFrodoBusy(true, "Suche läuft...");
  try {
    const sessionId = await ensureFrodoSession();
    const response = await fetch(`/api/frodo/search/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const payload = await readJsonResponse(response);
    renderSearchResults(frodoSearchResults, payload.results || []);
    setFrodoStatus(`${payload.results?.length || 0} Treffer gefunden.`);
  } catch (error) {
    setFrodoStatus(error.message);
  } finally {
    setFrodoBusy(false);
  }
}

function renderFrodoUploadSummary(payload) {
  const docs = payload.dokumente || {};
  const topics = payload.erkannteThemen || [];
  frodoUploadSummary.replaceChildren(
    infoItem(
      "Rahmenlehrplan",
      formatPdfSummary(docs.rahmenlehrplan)
    ),
    infoItem(
      "Prüfungskatalog",
      formatPdfSummary(docs.pruefungskatalog)
    ),
    infoItem("Erkannte Themen", topics.length ? topics.slice(0, 8).join("; ") : "Keine Überschriften erkannt")
  );
}

function formatPdfSummary(doc = {}) {
  const parts = [`${doc.pages || 0} Seiten`, `${doc.chars || 0} Zeichen`];
  if (doc.ocr?.used) {
    parts.push(`OCR: ${doc.ocr.pages || 0} Seiten`);
  } else if (doc.ocr?.source === "pdftotext") {
    parts.push("PDF-Textfallback");
  }
  return parts.join(", ");
}

function renderFrodoAnalysis(analysis) {
  frodoAnalysisEditor.replaceChildren(
    textareaField("Kurzprofil", "kurzprofil", analysis.kurzprofil, 4),
    textareaField("Prüfungsrelevanz", "pruefungsrelevanz", analysis.pruefungsrelevanz, 4),
    textareaField("AP Teil 1", "ap1", formatTopicItems(analysis.ap1), 7),
    textareaField("AP Teil 2", "ap2", formatTopicItems(analysis.ap2), 7),
    textareaField("Beide Prüfungsteile", "beide", formatTopicItems(analysis.beide), 5),
    textareaField("Prüfungskritisch", "pruefungskritisch", (analysis.pruefungskritisch || []).join("\n"), 4),
    textareaField("Empfehlungen", "empfehlungen", (analysis.empfehlungen || []).join("\n"), 5),
    textareaField("Querverbindungen", "querverbindungen", analysis.querverbindungen, 4)
  );
}

function handoffToGandalf() {
  const analysis = collectFrodoAnalysis();
  const payload = {
    frodoSessionId: frodoState.sessionId,
    grundlagen: {
      beruf: frodoFachrichtung.value.trim(),
      fach: "",
      lernfeld: frodoLernfeld.value.trim()
    },
    anzahl_ls: Number(frodoLsCount.value || 1),
    inhalte: {
      frodoAnalyse: analysis,
      eigene_inhalte: frodoOwnContent.value.trim()
    }
  };

  sessionStorage.setItem("frodoToGandalf", JSON.stringify(payload));
  window.location.href = "/assistants.html#gandalf";
}

function collectFrodoAnalysis() {
  const source = frodoState.analysis || {};
  const fields = frodoAnalysisEditor.querySelectorAll("[data-analysis-field]");
  const next = { ...source };

  for (const field of fields) {
    const key = field.dataset.analysisField;
    const value = field.value.trim();
    if (["ap1", "ap2", "beide"].includes(key)) {
      next[key] = parseTopicItems(value);
    } else if (["empfehlungen", "pruefungskritisch"].includes(key)) {
      next[key] = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    } else {
      next[key] = value;
    }
  }

  return next;
}

function textareaField(labelText, key, value, rows) {
  const label = document.createElement("label");
  label.className = "full-label";
  label.textContent = labelText;
  const textarea = document.createElement("textarea");
  textarea.rows = rows;
  textarea.value = value || "";
  textarea.dataset.analysisField = key;
  label.append(textarea);
  return label;
}

function formatTopicItems(items = []) {
  return items
    .map((item) =>
      [item.thema, item.behandlung, item.pruefungsrelevanz, item.querverweis]
        .filter(Boolean)
        .join(" | ")
    )
    .join("\n");
}

function parseTopicItems(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [thema, behandlung = "", pruefungsrelevanz = "", querverweis = ""] = line
        .split("|")
        .map((part) => part.trim());
      return { thema, behandlung, pruefungsrelevanz, querverweis };
    });
}

function showFrodoStep(step) {
  document.querySelectorAll("[data-frodo-step]").forEach((element) => {
    element.classList.toggle("hidden", element.dataset.frodoStep !== String(step));
  });
}

function syncAssistantView() {
  const active = window.location.hash === "#gandalf" ? "gandalf" : "frodo";
  if (assistantPageKicker) {
    assistantPageKicker.textContent = active === "gandalf"
      ? "Lernsituationsgenerator"
      : "Inhaltsermittler";
  }
  if (assistantPageTitle) {
    assistantPageTitle.textContent = active === "gandalf" ? "Gandalf" : "Frodo";
  }
  document.title = active === "gandalf" ? "Lernsituationsgenerator" : "Inhaltsermittler";
  document.querySelectorAll("[data-assistant-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.assistantPanel !== active);
  });
  document.querySelectorAll("[data-assistant-tab]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.assistantTab === active);
  });
}

async function loadAssistantModels() {
  if (!assistantModelSelect) return;

  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const payload = await response.json();
    const models = payload.ollamaStatus?.models || [];
    const configured = payload.ollamaStatus?.model || payload.model || "";
    const values = [...new Set([configured, ...models].filter(Boolean))];
    assistantModelSelect.replaceChildren();
    if (!values.length) {
      assistantModelSelect.append(new Option("Standardmodell", ""));
      return;
    }
    for (const value of values) {
      assistantModelSelect.append(new Option(value, value));
    }
    assistantModelSelect.value = configured || values[0];
  } catch {
    assistantModelSelect.replaceChildren(new Option("Standardmodell", ""));
  }
}

function renderSearchResults(container, results) {
  container.replaceChildren();
  if (!results.length) {
    container.append(infoItem("Suche", "Keine Treffer."));
    return;
  }

  for (const result of results) {
    const item = document.createElement("article");
    item.className = "result-item";
    const link = document.createElement("a");
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = result.title || result.url;
    const snippet = document.createElement("p");
    snippet.textContent = result.snippet || result.url;
    item.append(link, snippet);
    container.append(item);
  }
}

function infoItem(label, value) {
  const item = document.createElement("article");
  item.className = "result-item";
  const strong = document.createElement("strong");
  strong.textContent = label;
  const text = document.createElement("p");
  text.textContent = value || "-";
  item.append(strong, text);
  return item;
}

function selectedAssistantModel() {
  return assistantModelSelect?.value || undefined;
}

function setFrodoBusy(isBusy, message) {
  frodoState.busy = isBusy;
  updateFrodoControls();
  if (message) setFrodoStatus(message);
}

function resetFrodoUploadState() {
  clearFrodoUploadState();
  updateFrodoControls();
  if (frodoPlanFile?.files?.length || frodoCatalogFile?.files?.length) {
    setFrodoStatus("Neue PDFs ausgewaehlt. Bitte PDFs pruefen.");
  }
}

function clearFrodoUploadState() {
  frodoState.uploaded = false;
  frodoState.analysis = null;
  if (frodoUploadSummary) frodoUploadSummary.replaceChildren();
  if (frodoAnalysisEditor) frodoAnalysisEditor.replaceChildren();
}

function updateFrodoControls() {
  const isBusy = Boolean(frodoState.busy);
  if (frodoUploadButton) frodoUploadButton.disabled = isBusy;
  if (frodoSearchButton) frodoSearchButton.disabled = isBusy;
  if (frodoStep1Next) frodoStep1Next.disabled = isBusy || !frodoState.uploaded;
  if (frodoAnalyzeButton) frodoAnalyzeButton.disabled = isBusy || !frodoState.uploaded;
  if (frodoToGandalfButton) frodoToGandalfButton.disabled = isBusy || !frodoState.analysis;
}

function setFrodoStatus(message) {
  if (frodoStatus) frodoStatus.textContent = message;
}

async function readJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Anfrage fehlgeschlagen.");
  }
  return payload;
}

function openProgressStream(onMessage) {
  const id = createProgressId();
  if (!("EventSource" in window)) {
    return { id, close() {} };
  }

  const source = new EventSource(`/api/progress/${encodeURIComponent(id)}`);
  source.addEventListener("progress", (event) => {
    const payload = parseProgressPayload(event.data);
    if (payload?.message) {
      onMessage(formatProgressMessage(payload));
    }
    if (payload?.done) {
      source.close();
    }
  });
  source.addEventListener("error", () => source.close());

  return {
    id,
    close() {
      source.close();
    }
  };
}

function createProgressId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseProgressPayload(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatProgressMessage(payload) {
  if (payload.current && payload.total) {
    return `${payload.message} (${payload.current}/${payload.total})`;
  }
  return payload.message;
}
