const adminStatus = document.querySelector("#adminStatus");
const adminDocsList = document.querySelector("#adminDocsList");
const adminRefreshButton = document.querySelector("#adminRefreshButton");
const searchStatusButton = document.querySelector("#searchStatusButton");
const searchStatus = document.querySelector("#searchStatus");

adminRefreshButton?.addEventListener("click", loadDocs);
searchStatusButton?.addEventListener("click", checkSearchStatus);

loadDocs();

async function loadDocs() {
  setAdminBusy(true, "Dokumente werden geladen...");

  try {
    const response = await fetch("/api/admin/docs", { cache: "no-store" });
    const payload = await readJsonResponse(response);
    renderDocs(payload.docs || []);
    setAdminStatus("Bereit.");
  } catch (error) {
    setAdminStatus(error.message);
  } finally {
    setAdminBusy(false);
  }
}

async function uploadDoc(slot, input) {
  const file = input.files?.[0];
  if (!file) return;

  setAdminBusy(true, `Slot ${slot} wird gespeichert...`);

  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/admin/docs/${encodeURIComponent(slot)}`, {
      method: "POST",
      body: formData
    });
    const payload = await readJsonResponse(response);
    renderDocs(payload.docs || []);
    setAdminStatus("Dokument gespeichert.");
  } catch (error) {
    setAdminStatus(error.message);
  } finally {
    input.value = "";
    setAdminBusy(false);
  }
}

async function clearDoc(slot) {
  if (!window.confirm(`Slot ${slot} leeren?`)) return;

  setAdminBusy(true, `Slot ${slot} wird geleert...`);

  try {
    const response = await fetch(`/api/admin/docs/${encodeURIComponent(slot)}`, {
      method: "DELETE"
    });
    const payload = await readJsonResponse(response);
    renderDocs(payload.docs || []);
    setAdminStatus("Slot geleert.");
  } catch (error) {
    setAdminStatus(error.message);
  } finally {
    setAdminBusy(false);
  }
}

async function checkSearchStatus() {
  setAdminBusy(true, "Web-Suche wird geprüft...");

  try {
    const response = await fetch("/api/admin/web-search/status", { cache: "no-store" });
    const payload = await readJsonResponse(response);
    searchStatus.replaceChildren(
      infoItem("SearXNG", `${payload.url} - ${payload.latencyMs || 0} ms - ${payload.results || 0} Treffer`)
    );
    setAdminStatus("Web-Suche erreichbar.");
  } catch (error) {
    searchStatus.replaceChildren(infoItem("SearXNG", error.message));
    setAdminStatus(error.message);
  } finally {
    setAdminBusy(false);
  }
}

function renderDocs(docs) {
  adminDocsList.replaceChildren();
  for (const doc of docs) {
    const card = document.createElement("article");
    card.className = "admin-doc-card";

    const header = document.createElement("header");
    const title = document.createElement("div");
    const slot = document.createElement("span");
    slot.className = "eyebrow";
    slot.textContent = `Slot ${doc.slot}`;
    const heading = document.createElement("h2");
    heading.textContent = doc.label;
    title.append(slot, heading);

    const badge = document.createElement("strong");
    badge.className = doc.exists ? "doc-badge ready" : "doc-badge empty";
    badge.textContent = doc.exists ? "Hochgeladen" : "Leer";
    header.append(title, badge);

    const meta = document.createElement("p");
    meta.textContent = doc.exists
      ? `${doc.file} - ${formatBytes(doc.size)} - ${doc.pages || 0} Seiten`
      : "Keine Datei hinterlegt.";

    const preview = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Vorschau";
    const text = document.createElement("p");
    text.textContent = doc.preview || "Keine Vorschau.";
    preview.append(summary, text);

    const actions = document.createElement("div");
    actions.className = "button-row";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf";
    input.id = `slot-${doc.slot}-file`;
    input.addEventListener("change", () => uploadDoc(doc.slot, input));
    const label = document.createElement("label");
    label.className = "file-picker compact-picker";
    label.htmlFor = input.id;
    const labelText = document.createElement("span");
    labelText.textContent = doc.exists ? "Ersetzen" : "Hochladen";
    label.append(input, labelText);

    const clear = document.createElement("button");
    clear.className = "button danger";
    clear.type = "button";
    clear.textContent = "Leeren";
    clear.disabled = !doc.exists;
    clear.addEventListener("click", () => clearDoc(doc.slot));
    actions.append(label, clear);

    card.append(header, meta, preview, actions);
    adminDocsList.append(card);
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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setAdminBusy(isBusy, message) {
  [adminRefreshButton, searchStatusButton].forEach((button) => {
    if (button) button.disabled = isBusy;
  });
  if (message) setAdminStatus(message);
}

function setAdminStatus(message) {
  if (adminStatus) adminStatus.textContent = message;
}

async function readJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Anfrage fehlgeschlagen.");
  }
  return payload;
}
