const state = {
  document: null,
  fileName: ""
};

const fileInput = document.querySelector("#fileInput");
const fileName = document.querySelector("#fileName");
const statusText = document.querySelector("#statusText");
const serviceStatus = document.querySelector("#serviceStatus");
const ollamaStatus = document.querySelector("#ollamaStatus");
const ollamaDetails = document.querySelector("#ollamaDetails");
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

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  await uploadFile(file);
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
      body: JSON.stringify({ document: state.document })
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
      body: JSON.stringify({ document: state.document })
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

  analyzeButton.disabled = !doc;
  renderButton.disabled = !doc;

  metaFields.beruf.textContent = doc?.meta?.beruf || "-";
  metaFields.fach.textContent = doc?.meta?.fach || "-";
  metaFields.lernfeld.textContent = doc?.meta?.lernfeld || "-";
  metaFields.count.textContent = doc?.meta?.anzahl_ls ?? 0;

  jsonPreview.textContent = doc ? JSON.stringify(doc, null, 2) : "{}";
  situationList.replaceChildren();

  if (!doc?.lernsituationen?.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Noch keine Lernsituationen erkannt.";
    situationList.append(empty);
    return;
  }

  for (const situation of doc.lernsituationen) {
    situationList.append(renderSituationCard(situation));
  }
}

function renderSituationCard(situation) {
  const card = document.createElement("article");
  card.className = "situation-card";

  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = situation.id;
  header.append(title, renderTags(situation.kompetenzen));

  const details = document.createElement("dl");
  appendDetail(details, "Einstieg", situation.einstieg);
  appendDetail(details, "Handlungsprodukt", situation.handlungsprodukt);
  appendDetail(details, "Kompetenzen", situation.kompetenzen.map((item) => item.text).join("\n"));
  appendDetail(details, "Inhalte", situation.inhalte);
  appendDetail(details, "Methoden", situation.methoden);

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

function outputFileName() {
  const base = state.document?.meta?.lernfeld || "lernfeld-dokument";
  return `${base.toLowerCase().replace(/[^a-z0-9_-]+/gi, "-")}.docx`;
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
    const model = status?.model || payload.model || "-";

    if (status?.ok && status.modelAvailable) {
      setServiceStatus("ready", "KI bereit", model);
      return;
    }

    if (status?.ok) {
      setServiceStatus("warning", "Modell fehlt", `${model} laden`);
      return;
    }

    setServiceStatus("error", "Ollama nicht erreichbar", model);
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

checkSystemStatus();
renderDocument();
