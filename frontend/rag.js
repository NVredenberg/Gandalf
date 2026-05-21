const ragPageStatus = document.querySelector("#ragPageStatus");
const ragPageTotal = document.querySelector("#ragPageTotal");
const ragPageApproved = document.querySelector("#ragPageApproved");
const ragPageRecent = document.querySelector("#ragPageRecent");
const ragPageRefreshButton = document.querySelector("#ragPageRefreshButton");
const ragPageResetButton = document.querySelector("#ragPageResetButton");

ragPageRefreshButton?.addEventListener("click", () => loadRagStatus({ announce: true }));
ragPageResetButton?.addEventListener("click", resetRagStore);

loadRagStatus();

async function loadRagStatus(options = {}) {
  setRagBusy(true, options.announce ? "Aktualisiere..." : "Lade...");

  try {
    const response = await fetch("/api/rag/status", { cache: "no-store" });
    const payload = await readJsonResponse(response);
    renderRagStatus(payload);
    setRagStatus("Bereit");
  } catch (error) {
    setRagStatus(error.message);
    renderRagStatus({});
  } finally {
    setRagBusy(false);
  }
}

async function resetRagStore() {
  if (!window.confirm("RAG-Speicher wirklich leeren?")) return;
  setRagBusy(true, "Leere...");

  try {
    const response = await fetch("/api/rag/reset", { method: "DELETE" });
    const payload = await readJsonResponse(response);
    renderRagStatus(payload.status);
    setRagStatus(`${payload.deleted || 0} entfernt`);
  } catch (error) {
    setRagStatus(error.message);
  } finally {
    setRagBusy(false);
  }
}

function renderRagStatus(status = {}) {
  const total = Number(status.total || 0);
  const approved = Number(status.approved || 0);
  const recent = Array.isArray(status.recent) ? status.recent : [];

  ragPageTotal.textContent = total;
  ragPageApproved.textContent = approved;
  ragPageRecent.replaceChildren();

  if (!recent.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Noch keine gespeicherten Beispiele.";
    ragPageRecent.append(empty);
    return;
  }

  for (const item of recent) {
    ragPageRecent.append(renderRagEntry(item));
  }
}

function renderRagEntry(item = {}) {
  const entry = document.createElement("article");
  entry.className = "rag-entry";

  const title = document.createElement("strong");
  title.textContent = [item.beruf, item.situation_id].filter(Boolean).join(" - ") || "Ohne Titel";

  const meta = document.createElement("span");
  meta.textContent = item.approved ? "Kuratierte LS" : "Index";

  const detail = document.createElement("p");
  detail.textContent = [item.fach, item.lernfeld].filter(Boolean).join(" / ") || "-";

  entry.append(meta, title, detail);
  return entry;
}

function setRagBusy(isBusy, message) {
  if (ragPageRefreshButton) ragPageRefreshButton.disabled = isBusy;
  if (ragPageResetButton) ragPageResetButton.disabled = isBusy;
  if (message) setRagStatus(message);
}

function setRagStatus(message) {
  if (ragPageStatus) ragPageStatus.textContent = message;
}

async function readJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Anfrage fehlgeschlagen.");
  }
  return payload;
}
