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
  }));

  const prompt = `Du fasst KI-Kompetenzen von Lernsituationen für eine Übersichtstabelle zusammen.

Format pro Lernsituation: Nenne die 2–3 wichtigsten Tätigkeiten als kurze Verben/Nomen, jeweils mit Tag in Klammern.
Trenne mehrere Einträge mit Semikolon. Maximal 25 Wörter pro Zusammenfassung.

Beispiel-Eingabe:
{"id": "LS 5.1", "kompetenzen": ["[AK][IG] Kundenanfragen auswerten und fehlende Daten klären", "[MK] Kriterien für Angebotsvergleich festlegen"]}

Beispiel-Ausgabe:
{"id": "LS 5.1", "summary": "Kundenanfragen auswerten, Datenlücken klären (AK, IG); Vergleichskriterien festlegen (MK)"}

Regeln:
- Nenne konkrete Tätigkeiten, keine abstrakten Kategorienamen wie "Anwendungskompetenz".
- Tags (AK/IG/MK) am Ende der jeweiligen Gruppe in Klammern.
- Kein erklärender Text, nur die Zusammenfassung.

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
 * Kernregel: Das bestehende einstieg-Feld wird dem Modell NICHT übergeben.
 * Sieht das Modell den Originaltext, kürzt/editiert es ihn statt ihn neu
 * zu erfinden. Stattdessen bekommt es nur Handlungsprodukt + Inhalte als
 * inhaltlichen Anker und erfindet die Geschichte frei.
 * Temperature 0.4 für ausreichend kreative, aber kohärente Ausgabe.
 */
async function runScenarioHarmonization(document) {
  if (document.lernsituationen.length < 2) return document;

  const responseText = await generateWithOllama(
    buildScenarioPrompt(document),
    { format: "json", temperature: 0.4 }
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

  // WICHTIG: Kein einstieg-Feld übergeben – nur Handlungsprodukt + Inhalte.
  // Sobald das Modell den Originaltext sieht, editiert/kürzt es ihn statt
  // eine neue Geschichte zu erfinden.
  const situationList = document.lernsituationen
    .map((ls, i) => {
      return `${i + 1}. ${ls.id}
   Handlungsprodukt: ${ls.handlungsprodukt || "-"}
   Inhalte: ${ls.inhalte || "-"}`;
    })
    .join("\n\n");

  return `Du bist Autor von Unterrichtsszenarien für die Berufsschule.

AUFGABE: Erfinde eine zusammenhängende Fallgeschichte für ${lsCount} Lernsituationen.

BEISPIEL – so soll das Ergebnis aussehen (für einen anderen Beruf):
Betrieb: "DataFlow GmbH, Bochum" – IT-Dienstleister
LS 1: "Die DataFlow GmbH aus Bochum erhält den Auftrag, das Netzwerk der Stadtwerke Bochum zu modernisieren. Projektleiterin Sandra Keller beauftragt das Azubi-Team mit der Bestandsaufnahme. Die Auszubildenden dokumentieren die vorhandene Infrastruktur und erstellen einen ersten Statusbericht."
LS 2: "Auf Basis des Statusberichts aus LS 1 legt Sandra Keller ein Budget fest. Das Azubi-Team soll nun konkrete Angebote von drei Netzwerkhardware-Lieferanten einholen und vergleichen. Bis Freitag muss eine Empfehlung vorliegen."
LS 3: "Der Angebotsvergleich ist abgeschlossen. Sandra Keller hat Lieferant B ausgewählt. Jetzt konfiguriert das Team die ersten Switches und dokumentiert die neue Netzwerktopologie für das Stadtwerke-Projekthandbuch."

PFLICHTREGELN für deine Geschichte:
1. Erfinde einen passenden Betrieb mit konkretem Namen und Standort.
2. Erfinde 1–2 Personen (z.B. Ausbilder, Kundin), die in allen LS vorkommen.
3. LS 1 startet den Auftrag neu – kein Vorwissen nötig.
4. Jede folgende LS erwähnt konkret, was in der vorherigen passiert ist.
5. Der rote Faden ist dasselbe Projekt oder derselbe Kunde.
6. Jedes Szenario: 3–4 Sätze, Gegenwartsform, konkret und lebendig.
7. Passe den Betrieb zum Beruf an – kein branchenfremder Kontext.

Beruf: ${document.meta.beruf || "-"}
Lernfeld: ${document.meta.lernfeld || "-"}

Lernsituationen (Handlungsprodukte und Inhalte sind fest vorgegeben):
${situationList}

Antworte NUR mit diesem JSON, kein Markdown, kein erklärender Text:
{
  "scenarios": [
    {"id": "LS X.X", "einstieg": "3-4 Sätze der Geschichte..."},
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