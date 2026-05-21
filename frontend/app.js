const state = {
  document: null,
  fileName: "",
  selectedModel: "",
  ragDirty: false
};

let jsonPreviewTimer = null;

const fileInput = document.querySelector("#fileInput");
const fileName = document.querySelector("#fileName");
const statusText = document.querySelector("#statusText");
const serviceStatus = document.querySelector("#serviceStatus");
const ollamaStatus = document.querySelector("#ollamaStatus");
const ollamaDetails = document.querySelector("#ollamaDetails");
const modelSelect = document.querySelector("#modelSelect");
const scenariosButton = document.querySelector("#scenariosButton");
const analyzeButton = document.querySelector("#analyzeButton");
const renderButton = document.querySelector("#renderButton");
const situationList = document.querySelector("#situationList");
const jsonPreview = document.querySelector("#jsonPreview");
const ragCount = document.querySelector("#ragCount");
const ragDetails = document.querySelector("#ragDetails");
const ragRecent = document.querySelector("#ragRecent");
const ragRefreshButton = document.querySelector("#ragRefreshButton");
const ragReindexButton = document.querySelector("#ragReindexButton");
const ragResetButton = document.querySelector("#ragResetButton");
const uploadWorkflowButton = document.querySelector("#uploadWorkflowButton");

const metaFields = {
  beruf: document.querySelector("#metaBeruf"),
  fach: document.querySelector("#metaFach"),
  lernfeld: document.querySelector("#metaLernfeld"),
  count: document.querySelector("#metaCount")
};

for (const [key, input] of Object.entries(metaFields)) {
  if (key === "count") continue;
  input.addEventListener("input", () => {
    if (!state.document) return;
    state.document.meta[key] = input.value;
    setRagDirty(true);
    scheduleJsonPreviewRefresh();
  });
}

modelSelect.addEventListener("change", () => {
  state.selectedModel = modelSelect.value;
  ollamaDetails.textContent = state.selectedModel || "Kein Modell";
});

ragRefreshButton.addEventListener("click", async () => {
  await loadRagStatus({ announce: true });
});

ragReindexButton.addEventListener("click", async () => {
  if (!state.document) return;

  setBusy(true, "Aktuelles Dokument wird indexiert...");
  try {
    const response = await fetch("/api/rag/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: state.document })
    });
    const payload = await readJsonResponse(response);
    renderRagStatus(payload.status);
    setRagDirty(false);
    setStatus(`${payload.indexed} Lernsituation(en) indexiert.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
});

ragResetButton.addEventListener("click", async () => {
  if (!window.confirm("RAG-Speicher wirklich leeren?")) return;

  setBusy(true, "RAG-Speicher wird geleert...");
  try {
    const response = await fetch("/api/rag/reset", { method: "DELETE" });
    const payload = await readJsonResponse(response);
    renderRagStatus(payload.status);
    setStatus(`${payload.deleted} Beispiel(e) entfernt.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  await uploadFile(file);
});

uploadWorkflowButton?.addEventListener("click", () => {
  fileInput.focus();
  fileInput.click();
});

scenariosButton.addEventListener("click", async () => {
  if (!state.document) {
    return;
  }

  const progress = openProgressStream();
  setBusy(true, "Szenarien werden generiert...");

  try {
    const response = await fetch("/api/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload({ progressId: progress.id }))
    });

    const payload = await readJsonResponse(response);
    state.document = payload.document;
    setRagDirty(true);
    renderDocument();
    setStatus("Szenarien generiert.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    progress.close();
    setBusy(false);
  }
});

analyzeButton.addEventListener("click", async () => {
  if (!state.document) {
    return;
  }

  const progress = openProgressStream();
  setBusy(true, "KI prüft Inhalte...");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload({ progressId: progress.id }))
    });

    const payload = await readJsonResponse(response);
    state.document = payload.document;
    setRagDirty(true);
    renderDocument();
    setStatus("KI-Prüfung abgeschlossen.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    progress.close();
    setBusy(false);
  }
});

renderButton.addEventListener("click", async () => {
  if (!state.document) {
    return;
  }

  const progress = openProgressStream();
  setBusy(true, "DOCX wird vorbereitet...");

  try {
    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload({ progressId: progress.id }))
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "DOCX konnte nicht erzeugt werden.");
    }

    const blob = await response.blob();
    await saveBlobAs(blob, outputFileName());
    setStatus("DOCX gespeichert.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    progress.close();
    setBusy(false);
  }
});

async function uploadFile(file) {
  setBusy(true, "Datei wird analysiert...");
  state.fileName = file.name;
  fileName.textContent = file.name;

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const payload = await readJsonResponse(response);
    state.document = payload.document;
    setRagDirty(false);
    renderDocument();
    setStatus(`${payload.document.meta.anzahl_ls} Lernsituation(en) erkannt.`);
    window.setTimeout(loadRagStatus, 1200);
  } catch (error) {
    state.document = null;
    renderDocument();
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function readJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Anfrage fehlgeschlagen.");
  }
  return payload;
}

function renderDocument() {
  const doc = state.document;

  scenariosButton.disabled = !doc;
  analyzeButton.disabled = !doc;
  renderButton.disabled = !doc;
  updateRagControls();

  metaFields.beruf.value = doc?.meta?.beruf || "";
  metaFields.fach.value = doc?.meta?.fach || "";
  metaFields.lernfeld.value = doc?.meta?.lernfeld || "";
  metaFields.count.textContent = doc?.meta?.anzahl_ls ?? 0;

  refreshJsonPreview();
  situationList.replaceChildren();

  if (!doc?.lernsituationen?.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Noch keine Lernsituationen erkannt.";
    situationList.append(empty);
    return;
  }

  for (const [index, situation] of doc.lernsituationen.entries()) {
    situationList.append(renderSituationCard(situation, index));
  }
}

function loadPendingDocument() {
  const raw = sessionStorage.getItem("pendingDocument");
  if (!raw) return;

  try {
    const document = JSON.parse(raw);
    state.document = document;
    state.fileName = "Gandalf-Ergebnis";
    fileName.textContent = "Gandalf-Ergebnis";
    setRagDirty(true);
    setStatus(`${document.meta?.anzahl_ls || 0} Lernsituation(en) von Gandalf übernommen.`);
  } catch (error) {
    setStatus(`Gandalf-Ergebnis konnte nicht geladen werden: ${error.message}`);
  } finally {
    sessionStorage.removeItem("pendingDocument");
  }
}

function renderSituationCard(situation, index) {
  const card = document.createElement("article");
  card.className = "situation-card";

  const header = document.createElement("header");
  const idInput = document.createElement("input");
  idInput.className = "situation-id-input";
  idInput.value = situation.id;
  idInput.addEventListener("input", () => {
    if (state.document?.lernsituationen?.[index]) {
      state.document.lernsituationen[index].id = idInput.value;
      setRagDirty(true);
      scheduleJsonPreviewRefresh();
    }
  });
  const rememberButton = document.createElement("button");
  rememberButton.className = "button secondary compact";
  rememberButton.type = "button";
  rememberButton.textContent = "Als Beispiel merken";
  rememberButton.addEventListener("click", () => {
    markSituationAsExample(index, rememberButton);
  });

  header.append(idInput, renderTags(situation.kompetenzen), rememberButton);

  const details = document.createElement("dl");
  appendEditableDetail(details, "Einstieg", situation.einstieg, (value) => {
    if (state.document?.lernsituationen?.[index]) {
      state.document.lernsituationen[index].einstieg = value;
      setRagDirty(true);
      scheduleJsonPreviewRefresh();
    }
  });
  appendEditableDetail(details, "Handlungsprodukt", situation.handlungsprodukt, (value) => {
    updateSituationField(index, "handlungsprodukt", value);
  });
  appendEditableDetail(details, "Kompetenzen", formatCompetenceLines(situation.kompetenzen), (value) => {
    if (state.document?.lernsituationen?.[index]) {
      state.document.lernsituationen[index].kompetenzen = parseCompetenceLines(value);
      setRagDirty(true);
      scheduleJsonPreviewRefresh();
    }
  });
  appendEditableDetail(details, "Inhalte", situation.inhalte, (value) => {
    updateSituationField(index, "inhalte", value);
  });
  appendEditableDetail(details, "Methoden", situation.methoden, (value) => {
    updateSituationField(index, "methoden", value);
  });

  card.append(header, details);
  return card;
}

function renderTags(competences = []) {
  const row = document.createElement("div");
  row.className = "tag-row";
  const uniqueTags = [...new Set(competences.flatMap((item) => item.tags || []))];

  for (const tag of uniqueTags) {
    const pill = document.createElement("span");
    pill.className = `tag ${tag.toLowerCase()}`;
    pill.textContent = tag;
    row.append(pill);
  }

  return row;
}

function appendDetail(parent, label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;

  const dd = document.createElement("dd");
  dd.textContent = value || "-";

  parent.append(dt, dd);
}

function appendEditableDetail(parent, label, value, onChange) {
  const dt = document.createElement("dt");
  dt.textContent = label;

  const dd = document.createElement("dd");
  const textarea = document.createElement("textarea");
  textarea.className = "scenario-editor";
  textarea.value = value || "";
  textarea.rows = 5;
  textarea.addEventListener("input", () => onChange(textarea.value));
  dd.append(textarea);

  parent.append(dt, dd);
}

function outputFileName() {
  const base = state.document?.meta?.lernfeld || "lernfeld-dokument";
  return `${base.toLowerCase().replace(/[^a-z0-9_-]+/gi, "-")}.docx`;
}

function requestPayload(extra = {}) {
  return {
    document: state.document,
    model: state.selectedModel || undefined,
    ...extra
  };
}

async function markSituationAsExample(index, button) {
  const situation = state.document?.lernsituationen?.[index];
  if (!situation) return;

  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Merke...";
  setStatus(`${situation.id} wird als Beispiel gespeichert...`);

  try {
    const response = await fetch("/api/rag/examples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document: state.document,
        situation
      })
    });
    const payload = await readJsonResponse(response);
    renderRagStatus(payload.status);
    button.textContent = "Gemerkte LS";
    setStatus(`${situation.id} ist als Beispiel gespeichert.`);
  } catch (error) {
    button.textContent = previousLabel;
    button.disabled = false;
    setStatus(error.message);
  }
}

async function loadRagStatus(options = {}) {
  try {
    const response = await fetch("/api/rag/status", { cache: "no-store" });
    const payload = await readJsonResponse(response);
    renderRagStatus(payload);
    if (options.announce) {
      setStatus(
        state.document && state.ragDirty
          ? "RAG-Status aktualisiert. Aenderungen am Dokument sind noch nicht uebernommen."
          : "RAG-Status aktualisiert."
      );
    }
  } catch (error) {
    ragCount.textContent = "RAG nicht verfuegbar";
    ragDetails.textContent = error.message;
    ragRecent.textContent = "";
    if (options.announce) {
      setStatus(error.message);
    }
  }
}

function renderRagStatus(status = {}) {
  const total = Number(status.total || 0);
  const approved = Number(status.approved || 0);
  const recent = Array.isArray(status.recent) ? status.recent : [];

  ragCount.textContent = `${total} Beispiel${total === 1 ? "" : "e"}`;
  ragDetails.textContent = `${approved} kuratiert`;
  ragRecent.replaceChildren();

  if (!recent.length) {
    ragRecent.textContent = "Noch keine gespeicherten Beispiele.";
    return;
  }

  const list = document.createElement("ul");
  for (const item of recent.slice(0, 4)) {
    const entry = document.createElement("li");
    const label = [item.beruf, item.situation_id].filter(Boolean).join(" - ");
    entry.textContent = `${item.approved ? "Gemerkte LS" : "Index"}: ${label || "Ohne Titel"}`;
    list.append(entry);
  }
  ragRecent.append(list);
}

function openProgressStream() {
  const id = createProgressId();
  if (!("EventSource" in window)) {
    return { id, close() {} };
  }

  const source = new EventSource(`/api/progress/${encodeURIComponent(id)}`);

  source.addEventListener("progress", (event) => {
    const payload = parseProgressPayload(event.data);
    if (payload?.message) {
      setStatus(formatProgressMessage(payload));
    }
    if (payload?.done) {
      source.close();
    }
  });

  source.addEventListener("error", () => {
    source.close();
  });

  return {
    id,
    close() {
      source.close();
    }
  };
}

function createProgressId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function updateSituationField(index, key, value) {
  if (state.document?.lernsituationen?.[index]) {
    state.document.lernsituationen[index][key] = value;
    setRagDirty(true);
    scheduleJsonPreviewRefresh();
  }
}

function setRagDirty(isDirty) {
  state.ragDirty = Boolean(isDirty);
  updateRagControls();
}

function updateRagControls() {
  const hasDocument = Boolean(state.document);
  ragReindexButton.disabled = !hasDocument;
  ragReindexButton.textContent = state.ragDirty
    ? "Aenderungen in RAG uebernehmen"
    : "Aktuelles Dokument indexieren";
  ragReindexButton.title = state.ragDirty
    ? "Die sichtbaren Dokumentaenderungen sind noch nicht im RAG gespeichert."
    : "";
}

function scheduleJsonPreviewRefresh() {
  window.clearTimeout(jsonPreviewTimer);
  jsonPreviewTimer = window.setTimeout(refreshJsonPreview, 350);
}

function refreshJsonPreview() {
  window.clearTimeout(jsonPreviewTimer);
  jsonPreviewTimer = null;
  jsonPreview.textContent = state.document ? JSON.stringify(state.document, null, 2) : "{}";
}

function formatCompetenceLines(competences = []) {
  return competences
    .map(formatCompetenceLine)
    .join("\n");
}

function parseCompetenceLines(value = "") {
  return String(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCompetenceLine)
    .filter((item) => item.text);
}

function formatCompetenceLine(item) {
  const segments = Array.isArray(item?.segments) && item.segments.length
    ? item.segments
    : [{ text: item?.text || "", tag: null }];
  const hasInlineTags = segments.some((segment) => normalizeTag(segment.tag));
  const legacyTagPrefix = !hasInlineTags && item?.tags?.length
    ? `[${item.tags.join("][")}] `
    : "";

  const text = segments
    .map((segment) => {
      const tag = normalizeTag(segment.tag);
      return tag ? `<${tag}>${segment.text}</${tag}>` : segment.text;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  return `${legacyTagPrefix}${text}`.trim();
}

function parseCompetenceLine(line) {
  const legacyTags = [];
  const withoutLegacyTags = String(line || "")
    .replace(/\[(AK|IG|MK)\]/gi, (_match, tag) => {
      const normalized = tag.toUpperCase();
      if (!legacyTags.includes(normalized)) legacyTags.push(normalized);
      return "";
    })
    .replace(/\b(AK|IG|MK)\s*[:\-]\s*/gi, (_match, tag) => {
      const normalized = tag.toUpperCase();
      if (!legacyTags.includes(normalized)) legacyTags.push(normalized);
      return "";
    });
  const segments = parseInlineCompetenceSegments(withoutLegacyTags);
  const text = cleanCompetenceText(segments.map((segment) => segment.text).join(""));
  const inlineTags = [...new Set(segments.map((segment) => segment.tag).filter(Boolean))];
  const tags = [...new Set([...legacyTags, ...inlineTags])];

  return {
    text,
    tags,
    segments: normalizeCompetenceSegments(segments, text)
  };
}

function parseInlineCompetenceSegments(value = "") {
  const source = String(value || "");
  const pattern = /<\/?(AK|IG|MK)>/gi;
  const segments = [];
  let activeTag = null;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    appendCompetenceSegment(segments, source.slice(lastIndex, match.index), activeTag);
    activeTag = match[0].startsWith("</") ? null : match[1].toUpperCase();
    lastIndex = pattern.lastIndex;
  }

  appendCompetenceSegment(segments, source.slice(lastIndex), activeTag);
  return segments;
}

function appendCompetenceSegment(segments, text, tag) {
  if (!text) return;
  const normalizedTag = normalizeTag(tag);
  const previous = segments.at(-1);

  if (previous && previous.tag === normalizedTag) {
    previous.text += text;
    return;
  }

  segments.push({ text, tag: normalizedTag });
}

function normalizeCompetenceSegments(segments = [], fallbackText = "") {
  const normalized = segments
    .map((segment) => ({
      text: String(segment.text || "").replace(/\s+/g, " "),
      tag: normalizeTag(segment.tag)
    }))
    .filter((segment) => segment.text.trim());

  if (normalized.length) {
    normalized[0].text = normalized[0].text.trimStart();
    normalized[normalized.length - 1].text = normalized.at(-1).text.trimEnd();
  }

  return normalized.length ? normalized : [{ text: fallbackText, tag: null }].filter((item) => item.text);
}

function normalizeTag(tag) {
  const normalized = String(tag || "").trim().toUpperCase();
  return ["AK", "IG", "MK"].includes(normalized) ? normalized : null;
}

function cleanCompetenceText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

async function saveBlobAs(blob, suggestedName) {
  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "Word-Dokument",
          accept: {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
              ".docx"
            ]
          }
        }
      ]
    });

    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  URL.revokeObjectURL(url);
}

function setBusy(isBusy, message = "") {
  fileInput.disabled = isBusy;
  modelSelect.disabled = isBusy;
  scenariosButton.disabled = isBusy || !state.document;
  analyzeButton.disabled = isBusy || !state.document;
  renderButton.disabled = isBusy || !state.document;
  ragRefreshButton.disabled = isBusy;
  ragReindexButton.disabled = isBusy || !state.document;
  ragResetButton.disabled = isBusy;

  if (message) {
    setStatus(message);
  }
}

function setStatus(message) {
  statusText.textContent = message;
}

async function checkSystemStatus() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const payload = await response.json();
    const status = payload.ollamaStatus;
    const configuredModel = status?.model || payload.model || "";
    const models = Array.isArray(status?.models) ? status.models : [];
    populateModelSelect(models, configuredModel);
    const selected = state.selectedModel || configuredModel || "-";

    if (status?.ok && (!models.length || models.includes(selected))) {
      setServiceStatus("ready", "KI bereit", selected);
      return;
    }

    if (status?.ok) {
      setServiceStatus("warning", "Modell fehlt", `${selected} laden`);
      return;
    }

    setServiceStatus("error", "Ollama nicht erreichbar", selected);
    serviceStatus.title = status?.error || "Ollama ist nicht erreichbar.";
  } catch (error) {
    setServiceStatus("error", "Status nicht verfügbar", "Backend prüfen");
    serviceStatus.title = error.message;
  }
}

function setServiceStatus(kind, label, detail) {
  serviceStatus.className = `service-status ${kind}`;
  serviceStatus.title = detail;
  ollamaStatus.textContent = label;
  ollamaDetails.textContent = detail;
}

function populateModelSelect(models, configuredModel) {
  const current = state.selectedModel || configuredModel;
  const values = [...new Set([configuredModel, ...models].filter(Boolean))];

  modelSelect.replaceChildren();
  if (!values.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Kein Modell gefunden";
    modelSelect.append(option);
    state.selectedModel = "";
    return;
  }

  for (const model of values) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.append(option);
  }

  state.selectedModel = values.includes(current) ? current : values[0];
  modelSelect.value = state.selectedModel;
}

checkSystemStatus();
loadRagStatus();
loadPendingDocument();
renderDocument();
