import { generateWithOllama } from "./ollamaClient.js";
import { normalizeAiDocument, normalizeLearningDocument } from "../parser/schema.js";

export async function optimizeLearningDocument(input) {
  const document = normalizeLearningDocument(input);
  const optimized = await runContentOptimization(document);
  const harmonized = await runScenarioHarmonization(optimized);

  debugScenarioChanges(document, optimized, harmonized);

  return harmonized;
}

async function runContentOptimization(document) {
  const responseText = await generateWithOllama(buildPrompt(document), {
    format: "json",
    temperature: 0.1
  });
  const parsed = parseJsonResponse(responseText);

  return normalizeAiDocument(document, parsed);
}

async function runScenarioHarmonization(document) {
  if (document.lernsituationen.length < 2) {
    return document;
  }

  const responseText = await generateWithOllama(buildScenarioPrompt(document), {
    format: "json",
    temperature: 0.05
  });
  const parsed = parseJsonResponse(responseText);

  return normalizeAiDocument(document, parsed);
}

function buildPrompt(document) {
  return `Du bist ein didaktischer Fachassistent.

Du erhaeltst ein bereits standardisiertes JSON fuer Lernfelddokumente.

Du darfst:
- Inhalte fachlich und didaktisch pruefen
- Kompetenzen sinnvoll ergaenzen
- Einstiegsszenarien sprachlich verbessern

Wichtig:
- Die eigentliche Story-Kohärenz wird danach in einem zweiten Schritt bearbeitet.
- Du darfst hier Einstiegsszenarien verbessern, aber keine Tabellen, kein Layout und keine neuen Felder erzeugen.

Du darfst NICHT:
- Tabellen entwerfen
- Layout beschreiben
- Formatierungen ausgeben
- neue Felder hinzufuegen
- die Reihenfolge oder Anzahl der Lernsituationen veraendern
- IDs der Lernsituationen veraendern

Gib ausschliesslich valides JSON zurueck.
Keine Markdown-Codebloecke, keine Kommentare, keine Erklaerung.

Das JSON muss exakt diese Schluessel verwenden:
meta, lernsituationen, id, einstieg, handlungsprodukt, kompetenzen, text, tags, inhalte, methoden.

Tags duerfen nur AK, IG oder MK sein.
Jede Kompetenz muss mindestens einen passenden Tag behalten oder erhalten.
Vorhandene Tags duerfen nicht entfernt werden, wenn die Kompetenz inhaltlich gleich bleibt.

JSON:
${JSON.stringify(document, null, 2)}`;
}

function buildScenarioPrompt(document) {
  const scenarioList = document.lernsituationen
    .map((situation, index) => {
      return `${index + 1}. ${situation.id}
Einstieg: ${situation.einstieg || "-"}
Handlungsprodukt: ${situation.handlungsprodukt || "-"}
Inhalte: ${situation.inhalte || "-"}`;
    })
    .join("\n\n");

  return `Du bist ein Story-Editor fuer didaktische Lernsituationen.

Deine einzige Aufgabe:
Alle Einstiegsszenarien muessen zu EINER gemeinsamen Fallgeschichte gehoeren.

Verbindliche Regeln:
- Waehle genau einen gemeinsamen Betrieb oder eine gemeinsame Institution.
- Waehle genau einen roten Faden: gleicher Kunde, gleicher Auftrag oder dasselbe Projekt.
- Formuliere JEDES Feld "einstieg" neu, auch wenn es bereits passend wirkt.
- Jede Lernsituation muss als naechster Schritt derselben Unterrichtsreihe erkennbar sein.
- LS 1 startet den Fall.
- Spaetere LS greifen sichtbar auf vorherige Ereignisse zurueck.
- Unterschiedliche Firmen, Kunden, Orte oder unverbundene Auftraege muessen ersetzt werden.
- IDs, Reihenfolge, Anzahl der Lernsituationen, Kompetenzen, Inhalte, Methoden und Handlungsprodukte bleiben erhalten.
- Erzeuge kein Layout und keine Tabellenbeschreibung.

Kontext:
Beruf: ${document.meta.beruf || "-"}
Fach: ${document.meta.fach || "-"}
Lernfeld: ${document.meta.lernfeld || "-"}

Aktuelle Einstiegsszenarien:
${scenarioList}

Gib das komplette JSON zurueck.
Erlaubte Schluessel:
meta, lernsituationen, id, einstieg, handlungsprodukt, kompetenzen, text, tags, inhalte, methoden.

Gib ausschliesslich valides JSON zurueck.

JSON:
${JSON.stringify(document, null, 2)}`;
}

function parseJsonResponse(value) {
  const raw = String(value || "").trim();
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const first = withoutFence.indexOf("{");
    const last = withoutFence.lastIndexOf("}");

    if (first >= 0 && last > first) {
      return JSON.parse(withoutFence.slice(first, last + 1));
    }
  }

  throw new Error("Ollama hat kein gueltiges JSON zurueckgegeben.");
}

function debugScenarioChanges(original, optimized, harmonized) {
  if (process.env.AI_DEBUG !== "1") {
    return;
  }

  const rows = original.lernsituationen.map((situation, index) => ({
    id: situation.id,
    original: situation.einstieg,
    afterContentOptimization: optimized.lernsituationen[index]?.einstieg || "",
    afterScenarioHarmonization: harmonized.lernsituationen[index]?.einstieg || "",
    changed:
      situation.einstieg !== (harmonized.lernsituationen[index]?.einstieg || "")
  }));

  console.log("[AI_DEBUG] Einstiegsszenario-Vergleich");
  console.log(JSON.stringify(rows, null, 2));
}
