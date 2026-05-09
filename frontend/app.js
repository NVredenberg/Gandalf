const state = {
  document: null,
  fileName: "",
  selectedModel: ""
};

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
    refreshJsonPreview();
  });
}

modelSelect.addEventListener("change", () => {
  state.selectedModel = modelSelect.value;
  ollamaDetails.textContent = state.selectedModel || "Kein Modell";
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  await uploadFile(file);
});

scenariosButton.addEventListener("click", async () => {
  if (!state.document) {
    return;
  }

  setBusy(true, "Szenarien werden generiert...");

  try {
    const response = await fetch("/api/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload())
    });

    const payload = await readJsonResponse(response);
    state.document = payload.document;
    renderDocument();
    setStatus("Szenarien generiert.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
});

analyzeButton.addEventListener("click", async () => {
  if (!state.document) {
    return;
  }

  setBusy(true, "KI prüft Inhalte...");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload())
    });

    const payload = await readJsonResponse(response);
    state.document = payload.document;
    renderDocument();
    setStatus("KI-Prüfung abgeschlossen.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
});

renderButton.addEventListener("click", async () => {
  if (!state.document) {
    return;
  }

  setBusy(true, "DOCX wird vorbereitet...");

  try {
    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload())
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
    renderDocument();
    setStatus(`${payload.document.meta.anzahl_ls} Lernsituation(en) erkannt.`);
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
      refreshJsonPreview();
    }
  });
  header.append(idInput, renderTags(situation.kompetenzen));

  const details = document.createElement("dl");
  appendEditableDetail(details, "Einstieg", situation.einstieg, (value) => {
    if (state.document?.lernsituationen?.[index]) {
      state.document.lernsituationen[index].einstieg = value;
      refreshJsonPreview();
    }
  });
  appendEditableDetail(details, "Handlungsprodukt", situation.handlungsprodukt, (value) => {
    updateSituationField(index, "handlungsprodukt", value);
  });
  appendEditableDetail(details, "Kompetenzen", formatCompetenceLines(situation.kompetenzen), (value) => {
    if (state.document?.lernsituationen?.[index]) {
      state.document.lernsituationen[index].kompetenzen = parseCompetenceLines(value);
      refreshJsonPreview();
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

function requestPayload() {
  return {
    document: state.document,
    model: state.selectedModel || undefined
  };
}

function updateSituationField(index, key, value) {
  if (state.document?.lernsituationen?.[index]) {
    state.document.lernsituationen[index][key] = value;
    refreshJsonPreview();
  }
}

function refreshJsonPreview() {
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
renderDocument();
