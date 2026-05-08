import { generateWithOllama } from "./ollamaClient.js";
import { normalizeAiDocument, normalizeLearningDocument } from "../parser/schema.js";

export async function optimizeLearningDocument(input) {
  const document = normalizeLearningDocument(input);
  const optimized = await runContentOptimization(document);
  const harmonized = await runScenarioHarmonization(optimized);

  debugScenarioChanges(document, optimized, harmonized);

  return harmonized;
}

// ---------------------------------------------------------------------------
// KI-Kurzzusammenfassungen für die KI-Zuordnungstabelle
// ---------------------------------------------------------------------------

/**
 * Erzeugt für jede Lernsituation eine kurze (≤ 15 Wörter) KI-Kompetenz-
 * zusammenfassung. Gibt ein Map von LS-ID → Zusammenfassungstext zurück.
 * Im Fehlerfall wird ein leeres Objekt zurückgegeben, damit der Renderer
 * auf den Fallback-Code ausweichen kann.
 */
export async function generateKiSummariesForTable(lernsituationen) {
  if (!lernsituationen?.length) return {};

  const input = lernsituationen.map((ls) => ({
    id: ls.id,
    kompetenzen: ls.kompetenzen
      .map((k) => (k.tags.length ? `[${k.tags.join("][")}] ${k.text}` : k.text))
      .slice(0, 6) // maximal 6 Kompetenzen pro LS an das Modell übergeben
  }));

  const prompt = `Du fasst KI-Kompetenzen von Lernsituationen zusammen.

Regeln:
- Maximal 12 Wörter pro Zusammenfassung.
- Nenne die dominante Kompetenzart (Anwendung/Grundlagen/Gesellschaft & Recht).
- Formuliere aktiv und präzise.
- Keine Einleitung, kein Erklärungstext.

Eingabe:
${JSON.stringify(input, null, 2)}

Antworte ausschließlich mit validem JSON, kein Markdown:
[{"id": "LS X.X", "summary": "..."}, ...]`;

  try {
    const raw = await generateWithOllama(prompt, {
      format: "json",
      temperature: 0.05
    });

    const parsed = parseJsonArray(raw);
    const result = {};
    for (const entry of parsed) {
      if (entry?.id && entry?.summary) {
        result[entry.id] = String(entry.summary).trim();
      }
    }
    return result;
  } catch (error) {
    console.warn("[KI-Summaries] Fehler beim Generieren:", error.message);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Interne Hilfsfunktionen
// ---------------------------------------------------------------------------

async function runContentOptimization(document) {
  const responseText = await generateWithOllama(buildContentPrompt(document), {
    format: "json",
    temperature: 0.1
  });
  const parsed = parseJsonResponse(responseText);
  return normalizeAiDocument(document, parsed);
}

/**
 * Zweiter Durchlauf: Szenarien zu einer gemeinsamen Fallgeschichte vereinen.
 *
 * Verbesserungen gegenüber der alten Version:
 * - Fordert nur das minimale Rückgabeformat { scenarios: [...] } an
 * - Höhere Temperature (0.2) damit das Modell wirklich umschreibt
 * - Explizite Vorgabe eines Firmennamens-Platzhalters verhindert Copy-Paste
 * - Validierung: Falls weniger Szenarien zurückkommen als erwartet, Fallback
 */
async function runScenarioHarmonization(document) {
  if (document.lernsituationen.length < 2) return document;

  const responseText = await generateWithOllama(
    buildScenarioPrompt(document),
    { format: "json", temperature: 0.2 }
  );

  const parsed = parseScenarioResponse(responseText, document.lernsituationen.length);
  if (!parsed) return document; // Fallback bei Parse-Fehler

  // Nur einstieg-Felder aus dem Szenario-Ergebnis übernehmen
  const lernsituationen = document.lernsituationen.map((ls, index) => {
    const incoming = parsed[index];
    const newEinstieg = incoming?.einstieg?.trim();
    return newEinstieg ? { ...ls, einstieg: newEinstieg } : ls;
  });

  return { ...document, lernsituationen };
}

function buildContentPrompt(document) {
  return `Du bist ein didaktischer Fachassistent.

Du erhältst ein standardisiertes JSON für Lernfelddokumente.

Du darfst:
- Inhalte fachlich und didaktisch prüfen
- Kompetenzen sinnvoll ergänzen
- Einstiegsszenarien sprachlich verbessern

Du darfst NICHT:
- Tabellen entwerfen oder Layout beschreiben
- Neue Felder hinzufügen
- Die Reihenfolge oder Anzahl der Lernsituationen verändern
- IDs der Lernsituationen verändern

Tags dürfen nur AK, IG oder MK sein.
Jede Kompetenz muss mindestens einen Tag behalten oder erhalten.

Gib ausschließlich valides JSON zurück.
Kein Markdown, keine Kommentare.

Schlüssel: meta, lernsituationen, id, einstieg, handlungsprodukt, kompetenzen, text, tags, inhalte, methoden.

JSON:
${JSON.stringify(document, null, 2)}`;
}

/**
 * Fokussierter Prompt – fordert AUSSCHLIESSLICH die neuen einstieg-Felder.
 * Kleineres Ausgabeformat → weniger Halluzinationen, zuverlässigeres Parsing.
 */
function buildScenarioPrompt(document) {
  const lsCount = document.lernsituationen.length;

  const situationList = document.lernsituationen
    .map((ls, i) => {
      return `${i + 1}. ${ls.id}
   Handlungsprodukt: ${ls.handlungsprodukt || "-"}
   Inhalte: ${ls.inhalte || "-"}
   Bisheriges Einstiegsszenario: ${ls.einstieg || "(leer)"}`;
    })
    .join("\n\n");

  return `Du bist Story-Editor für berufliche Lernfelddokumente.

Aufgabe: Schreibe für alle ${lsCount} Lernsituationen neue Einstiegsszenarien.

PFLICHTREGELN – keine Ausnahmen:
1. Erfinde EINEN Betrieb mit einem konkreten Namen (z.B. "Bürotec GmbH Dortmund").
2. Alle Szenarien spielen in DIESEM Betrieb mit denselben Personen.
3. LS 1 startet den Auftrag. Jede folgende LS ist der nächste Schritt desselben Projekts.
4. Verweise in LS 2+ ausdrücklich auf Ereignisse aus vorherigen LS.
5. Jedes Szenario: 2–4 Sätze, Präsens, konkret und lebendig.
6. Schreibe JEDES Szenario NEU – auch wenn es bereits ähnlich klingt.

Kontext:
Beruf: ${document.meta.beruf || "-"}
Lernfeld: ${document.meta.lernfeld || "-"}

Lernsituationen:
${situationList}

Gib NUR dieses JSON zurück, kein Markdown, kein Text davor oder danach:
{
  "scenarios": [
    {"id": "LS X.X", "einstieg": "..."},
    ...
  ]
}`;
}

/**
 * Parst das kompakte Szenario-Antwortformat { scenarios: [...] }
 * und gibt ein Array zurück – oder null bei Fehler.
 */
function parseScenarioResponse(raw, expectedCount) {
  try {
    const cleaned = String(raw || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first < 0 || last <= first) return null;

    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    const scenarios = parsed?.scenarios;

    if (!Array.isArray(scenarios) || scenarios.length === 0) return null;

    // Warnung wenn die Anzahl nicht stimmt, aber trotzdem weitermachen
    if (scenarios.length !== expectedCount) {
      console.warn(
        `[Scenario] Erwartet ${expectedCount} Szenarien, erhalten ${scenarios.length}`
      );
    }

    return scenarios;
  } catch (error) {
    console.warn("[Scenario] Parse-Fehler:", error.message);
    return null;
  }
}

function parseJsonArray(raw) {
  const cleaned = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const first = cleaned.indexOf("[");
    const last = cleaned.lastIndexOf("]");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return [];
      }
    }
    return [];
  }
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

  throw new Error("Ollama hat kein gültiges JSON zurückgegeben.");
}

function debugScenarioChanges(original, optimized, harmonized) {
  if (process.env.AI_DEBUG !== "1") return;

  const rows = original.lernsituationen.map((ls, index) => ({
    id: ls.id,
    original: ls.einstieg,
    afterContentOptimization: optimized.lernsituationen[index]?.einstieg || "",
    afterScenarioHarmonization: harmonized.lernsituationen[index]?.einstieg || "",
    changed: ls.einstieg !== (harmonized.lernsituationen[index]?.einstieg || "")
  }));

  console.log("[AI_DEBUG] Einstiegsszenario-Vergleich");
  console.log(JSON.stringify(rows, null, 2));
}