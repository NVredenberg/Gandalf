const gandalfState = {
  sessionId: "",
  initialized: false,
  planReady: false,
  currentIndex: 1,
  total: 1,
  currentLs: null,
  approved: [],
  seed: null
};

const gandalfStatus = document.querySelector("#gandalfStatus");
const gandalfBeruf = document.querySelector("#gandalfBeruf");
const gandalfFach = document.querySelector("#gandalfFach");
const gandalfLernfeld = document.querySelector("#gandalfLernfeld");
const gandalfStep1Next = document.querySelector("#gandalfStep1Next");
const gandalfPlanFile = document.querySelector("#gandalfPlanFile");
const gandalfPlanUploadButton = document.querySelector("#gandalfPlanUploadButton");
const gandalfPlanNext = document.querySelector("#gandalfPlanNext");
const gandalfPlanSummary = document.querySelector("#gandalfPlanSummary");
const gandalfSearchQuery = document.querySelector("#gandalfSearchQuery");
const gandalfSearchButton = document.querySelector("#gandalfSearchButton");
const gandalfSearchResults = document.querySelector("#gandalfSearchResults");
const gandalfBackToPlan = document.querySelector("#gandalfBackToPlan");
const gandalfStartButton = document.querySelector("#gandalfStartButton");
const gandalfContentInput = document.querySelector("#gandalfContentInput");
const gandalfExistingInput = document.querySelector("#gandalfExistingInput");
const gandalfExistingFile = document.querySelector("#gandalfExistingFile");
const gandalfLsCount = document.querySelector("#gandalfLsCount");
const gandalfMethodsInput = document.querySelector("#gandalfMethodsInput");
const gandalfLsProgress = document.querySelector("#gandalfLsProgress");
const gandalfLsEditor = document.querySelector("#gandalfLsEditor");
const gandalfNextHints = document.querySelector("#gandalfNextHints");
const gandalfRegenerateButton = document.querySelector("#gandalfRegenerateButton");
const gandalfApproveButton = document.querySelector("#gandalfApproveButton");
const gandalfFinalPreview = document.querySelector("#gandalfFinalPreview");
const gandalfBackToLast = document.querySelector("#gandalfBackToLast");
const gandalfFinalizeButton = document.querySelector("#gandalfFinalizeButton");

window.addEventListener("hashchange", initializeGandalfIfActive);
initializeGandalfIfActive();

gandalfStep1Next?.addEventListener("click", async () => {
  await ensureGandalfSession();
  showGandalfStep(2);
});
gandalfPlanUploadButton?.addEventListener("click", uploadGandalfPlan);
gandalfPlanNext?.addEventListener("click", () => showGandalfStep(3));
gandalfSearchButton?.addEventListener("click", searchGandalfPlan);
gandalfBackToPlan?.addEventListener("click", () => showGandalfStep(2));
gandalfExistingFile?.addEventListener("change", uploadExistingLsForGandalf);
gandalfStartButton?.addEventListener("click", startGandalfGeneration);
gandalfRegenerateButton?.addEventListener("click", () => generateCurrentLs());
gandalfApproveButton?.addEventListener("click", approveCurrentLs);
gandalfBackToLast?.addEventListener("click", () => {
  gandalfState.currentIndex = Math.max(1, gandalfState.approved.length);
  gandalfState.currentLs = gandalfState.approved[gandalfState.currentIndex - 1];
  renderGandalfLsEditor(gandalfState.currentLs);
  showGandalfStep(4);
});
gandalfFinalizeButton?.addEventListener("click", finalizeGandalf);

async function initializeGandalfIfActive() {
  if (window.location.hash !== "#gandalf" || gandalfState.initialized) return;
  gandalfState.initialized = true;
  const seed = readFrodoSeed();
  if (seed) {
    applyFrodoSeed(seed);
  }
  await ensureGandalfSession();
}

async function ensureGandalfSession() {
  if (gandalfState.sessionId) return gandalfState.sessionId;

  setGandalfStatus("Gandalf wird vorbereitet...");
  const body = {};
  if (gandalfState.seed) {
    body.seed = gandalfState.seed;
    body.frodoSessionId = gandalfState.seed.frodoSessionId;
  }

  const response = await fetch("/api/gandalf/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await readJsonResponse(response);
  gandalfState.sessionId = payload.sessionId;
  gandalfState.planReady = Boolean(payload.planLoaded);
  gandalfPlanNext.disabled = !gandalfState.planReady;

  if (payload.planLoaded) {
    renderPlanSummary("Rahmenlehrplan aus Frodo übernommen.");
  }
  setGandalfStatus(payload.docsLoaded ? "Bereit." : "Bereit, Hintergrunddokumente fehlen noch.");
  return gandalfState.sessionId;
}

async function uploadGandalfPlan() {
  const file = gandalfPlanFile.files?.[0];
  if (!file) {
    setGandalfStatus("Bitte ein PDF auswählen.");
    return;
  }

  setGandalfBusy(true, "Rahmenlehrplan wird gelesen...");

  try {
    const sessionId = await ensureGandalfSession();
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/gandalf/upload-plan/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: formData
    });
    const payload = await readJsonResponse(response);
    gandalfState.planReady = true;
    gandalfPlanNext.disabled = false;
    renderPlanSummary(`${payload.pages || 0} Seiten, ${payload.chars || 0} Zeichen. ${payload.kurzinfo || ""}`);
    setGandalfStatus("Plan übernommen.");
  } catch (error) {
    setGandalfStatus(error.message);
  } finally {
    setGandalfBusy(false);
  }
}

async function searchGandalfPlan() {
  setGandalfBusy(true, "Suche läuft...");

  try {
    const sessionId = await ensureGandalfSession();
    const query = gandalfSearchQuery.value.trim();
    const response = await fetch(`/api/gandalf/search-plan/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        beruf: query || gandalfBeruf.value.trim(),
        lernfeld: gandalfLernfeld.value.trim()
      })
    });
    const payload = await readJsonResponse(response);
    renderGandalfSearchResults(payload.results || []);
    setGandalfStatus(`${payload.results?.length || 0} Treffer gefunden.`);
  } catch (error) {
    setGandalfStatus(error.message);
  } finally {
    setGandalfBusy(false);
  }
}

async function uploadExistingLsForGandalf() {
  const file = gandalfExistingFile.files?.[0];
  if (!file) return;

  setGandalfBusy(true, "Vorhandene LS wird gelesen...");

  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });
    const payload = await readJsonResponse(response);
    gandalfExistingInput.value = JSON.stringify(payload.document, null, 2);
    setGandalfStatus(`${payload.document?.meta?.anzahl_ls || 0} Lernsituation(en) übernommen.`);
  } catch (error) {
    setGandalfStatus(error.message);
  } finally {
    gandalfExistingFile.value = "";
    setGandalfBusy(false);
  }
}

async function fetchPlanUrl(url) {
  setGandalfBusy(true, "Quelle wird gelesen...");

  try {
    const sessionId = await ensureGandalfSession();
    const response = await fetch(`/api/gandalf/fetch-url/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const payload = await readJsonResponse(response);
    gandalfState.planReady = true;
    gandalfPlanNext.disabled = false;
    renderPlanSummary(`${payload.source}\n${payload.chars || 0} Zeichen. ${payload.text || ""}`);
    setGandalfStatus("Online-Quelle übernommen.");
  } catch (error) {
    setGandalfStatus(error.message);
  } finally {
    setGandalfBusy(false);
  }
}

async function startGandalfGeneration() {
  gandalfState.currentIndex = 1;
  gandalfState.total = Number(gandalfLsCount.value || 1);
  gandalfState.approved = [];
  await generateCurrentLs();
}

async function generateCurrentLs() {
  setGandalfBusy(true, `LS ${gandalfState.currentIndex} wird generiert...`);
  showGandalfStep(4);
  const progress = openProgressStream(setGandalfStatus);

  try {
    const sessionId = await ensureGandalfSession();
    const response = await fetch(`/api/gandalf/generate/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lsIndex: gandalfState.currentIndex,
        totalLs: gandalfState.total,
        mode: selectedGandalfMode(),
        model: selectedAssistantModel(),
        progressId: progress.id,
        userInput: buildGandalfUserInput()
      })
    });
    const payload = await readJsonResponse(response);
    gandalfState.currentLs = payload.ls;
    renderGandalfLsEditor(payload.ls);
    setGandalfStatus(`LS ${gandalfState.currentIndex} bereit.`);
  } catch (error) {
    setGandalfStatus(error.message);
  } finally {
    progress.close();
    setGandalfBusy(false);
  }
}

async function approveCurrentLs() {
  const ls = collectGandalfLs();
  setGandalfBusy(true, "LS wird gespeichert...");

  try {
    const sessionId = await ensureGandalfSession();
    const response = await fetch(`/api/gandalf/approve/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lsIndex: gandalfState.currentIndex,
        ls,
        nextHints: gandalfNextHints.value.trim()
      })
    });
    await readJsonResponse(response);
    gandalfState.approved[gandalfState.currentIndex - 1] = ls;

    if (gandalfState.currentIndex >= gandalfState.total) {
      renderFinalPreview();
      showGandalfStep(5);
      setGandalfStatus("Alle Lernsituationen genehmigt.");
      return;
    }

    gandalfState.currentIndex += 1;
    await generateCurrentLs();
  } catch (error) {
    setGandalfStatus(error.message);
  } finally {
    setGandalfBusy(false);
  }
}

async function finalizeGandalf() {
  setGandalfBusy(true, "Dokument wird übernommen...");

  try {
    const sessionId = await ensureGandalfSession();
    const response = await fetch(`/api/gandalf/finalize/${encodeURIComponent(sessionId)}`, {
      method: "POST"
    });
    const payload = await readJsonResponse(response);
    sessionStorage.setItem("pendingDocument", JSON.stringify(payload.document));
    window.location.href = "/index.html";
  } catch (error) {
    setGandalfStatus(error.message);
  } finally {
    setGandalfBusy(false);
  }
}

function buildGandalfUserInput() {
  return {
    grundlagen: {
      beruf: gandalfBeruf.value.trim(),
      anlage: gandalfBeruf.value.trim(),
      fach: gandalfFach.value.trim(),
      lernfeld: gandalfLernfeld.value.trim()
    },
    inhalte: {
      text: gandalfContentInput.value.trim(),
      seed: gandalfState.seed?.inhalte || null
    },
    existingLs: gandalfExistingInput.value.trim(),
    methoden: gandalfMethodsInput.value.trim(),
    hints: gandalfNextHints.value.trim()
  };
}

function renderGandalfLsEditor(ls) {
  const fields = [
    ["situation", "Einstieg / Handlungssituation", 8],
    ["produkt", "Handlungsprodukt", 4],
    ["ziel", "Kompetenzen", 8],
    ["konInhalt", "Konkretisierte Inhalte", 5],
    ["individuell", "Individuelle Förderung", 4],
    ["sol", "Selbstgesteuertes Lernen", 4]
  ];

  gandalfLsProgress.textContent = `Lernsituation ${gandalfState.currentIndex} von ${gandalfState.total}`;
  gandalfNextHints.value = "";
  gandalfLsEditor.replaceChildren(
    ...fields.map(([key, label, rows]) => gandalfField(label, key, ls?.[key] || "", rows))
  );
}

function collectGandalfLs() {
  const next = {};
  gandalfLsEditor.querySelectorAll("[data-gandalf-field]").forEach((field) => {
    next[field.dataset.gandalfField] = field.value.trim();
  });
  next.id = gandalfState.currentLs?.id || `LS ${gandalfState.currentIndex}`;
  return next;
}

function gandalfField(labelText, key, value, rows) {
  const label = document.createElement("label");
  label.className = "full-label";
  label.textContent = labelText;
  const textarea = document.createElement("textarea");
  textarea.rows = rows;
  textarea.value = value || "";
  textarea.dataset.gandalfField = key;
  label.append(textarea);
  return label;
}

function renderFinalPreview() {
  gandalfFinalPreview.replaceChildren();
  for (const [index, ls] of gandalfState.approved.entries()) {
    const card = document.createElement("article");
    card.className = "situation-card";
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = ls.id || `LS ${index + 1}`;
    header.append(title);
    const details = document.createElement("dl");
    appendPreviewDetail(details, "Produkt", ls.produkt);
    appendPreviewDetail(details, "Inhalte", ls.konInhalt);
    card.append(header, details);
    gandalfFinalPreview.append(card);
  }
}

function appendPreviewDetail(parent, labelText, value) {
  const dt = document.createElement("dt");
  dt.textContent = labelText;
  const dd = document.createElement("dd");
  dd.textContent = value || "-";
  parent.append(dt, dd);
}

function renderGandalfSearchResults(results) {
  gandalfSearchResults.replaceChildren();
  if (!results.length) {
    gandalfSearchResults.append(infoItem("Suche", "Keine Treffer."));
    return;
  }

  for (const result of results) {
    const item = document.createElement("article");
    item.className = "result-item";
    const title = document.createElement("strong");
    title.textContent = result.title || result.url;
    const snippet = document.createElement("p");
    snippet.textContent = result.snippet || result.url;
    const actions = document.createElement("div");
    actions.className = "button-row";
    const open = document.createElement("a");
    open.className = "button secondary compact";
    open.href = result.url;
    open.target = "_blank";
    open.rel = "noreferrer";
    open.textContent = "Öffnen";
    const use = document.createElement("button");
    use.className = "button primary compact";
    use.type = "button";
    use.textContent = "Übernehmen";
    use.addEventListener("click", () => fetchPlanUrl(result.url));
    actions.append(open, use);
    item.append(title, snippet, actions);
    gandalfSearchResults.append(item);
  }
}

function renderPlanSummary(value) {
  gandalfPlanSummary.replaceChildren(infoItem("Plan", value));
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

function applyFrodoSeed(seed) {
  gandalfState.seed = seed;
  gandalfBeruf.value = seed.grundlagen?.beruf || "";
  gandalfFach.value = seed.grundlagen?.fach || "";
  gandalfLernfeld.value = seed.grundlagen?.lernfeld || "";
  gandalfLsCount.value = seed.anzahl_ls || 3;
  gandalfContentInput.value = stringifySeedContent(seed.inhalte);
  sessionStorage.removeItem("frodoToGandalf");
  setGandalfStatus("Frodo-Übergabe geladen.");
}

function readFrodoSeed() {
  const raw = sessionStorage.getItem("frodoToGandalf");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    sessionStorage.removeItem("frodoToGandalf");
    return null;
  }
}

function stringifySeedContent(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function selectedGandalfMode() {
  return document.querySelector("input[name='gandalfMode']:checked")?.value || "create";
}

function selectedAssistantModel() {
  return document.querySelector("#assistantModelSelect")?.value || undefined;
}

function showGandalfStep(step) {
  document.querySelectorAll("[data-gandalf-step]").forEach((element) => {
    element.classList.toggle("hidden", element.dataset.gandalfStep !== String(step));
  });
}

function setGandalfBusy(isBusy, message) {
  [
    gandalfStep1Next,
    gandalfPlanUploadButton,
    gandalfPlanNext,
    gandalfSearchButton,
    gandalfStartButton,
    gandalfRegenerateButton,
    gandalfApproveButton,
    gandalfFinalizeButton
  ].forEach((button) => {
    if (button) button.disabled = isBusy || (button === gandalfPlanNext && !gandalfState.planReady);
  });
  if (message) setGandalfStatus(message);
}

function setGandalfStatus(message) {
  if (gandalfStatus) gandalfStatus.textContent = message;
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
