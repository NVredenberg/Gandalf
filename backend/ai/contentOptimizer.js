import { generateWithOllama } from "./ollamaClient.js";
import { normalizeAiDocument, normalizeLearningDocument } from "../parser/schema.js";

const CONTENT_SYSTEM_PROMPT =
  "Du bist ein didaktischer Fachassistent fuer berufliche Bildung. " +
  "Arbeite streng strukturiert, fachlich passend und gib nur valides JSON zurueck.";

const STORY_SYSTEM_PROMPT =
  "Du bist Autor fuer realistische Unterrichtsszenarien in der Berufsschule. " +
  "Jede Szene muss fachlich zum Beruf, zu den Kompetenzen und zu den Inhalten passen. " +
  "Erfinde keine branchenfremden Fachthemen.";

export async function optimizeLearningDocument(input) {
  const document = normalizeLearningDocument(input);
  const optimized = await runContentOptimization(document);
  const harmonized = await runScenarioHarmonization(optimized);

  debugScenarioChanges(document, optimized, harmonized);

  return harmonized;
}

// ---------------------------------------------------------------------------
// KI-Kurzzusammenfassungen fuer die KI-Zuordnungstabelle
// ---------------------------------------------------------------------------

export async function generateKiSummariesForTable(lernsituationen) {
  if (!lernsituationen?.length) return {};

  const input = lernsituationen.map((ls) => ({
    id: ls.id,
    kompetenzen: ls.kompetenzen.map((k) =>
      k.tags.length ? `[${k.tags.join("][")}] ${k.text}` : k.text
    )
  }));

  const prompt = `Du fasst KI-Kompetenzen von Lernsituationen fuer eine Uebersichtstabelle zusammen.

Format pro Lernsituation: Nenne die 2-3 wichtigsten Taetigkeiten als kurze Verben/Nomen, jeweils mit Tag in Klammern.
Trenne mehrere Eintraege mit Semikolon. Maximal 25 Woerter pro Zusammenfassung.

Beispiel-Eingabe:
{"id": "LS 5.1", "kompetenzen": ["[AK][IG] Kundenanfragen auswerten und fehlende Daten klaeren", "[MK] Kriterien fuer Angebotsvergleich festlegen"]}

Beispiel-Ausgabe:
{"id": "LS 5.1", "summary": "Kundenanfragen auswerten, Datenluecken klaeren (AK, IG); Vergleichskriterien festlegen (MK)"}

Regeln:
- Nenne konkrete Taetigkeiten, keine abstrakten Kategorienamen wie "Anwendungskompetenz".
- Tags (AK/IG/MK) am Ende der jeweiligen Gruppe in Klammern.
- Kein erklaerender Text, nur die Zusammenfassung.

Eingabe:
${JSON.stringify(input, null, 2)}

Antworte ausschliesslich mit validem JSON, kein Markdown:
[{"id": "LS X.X", "summary": "..."}, ...]`;

  try {
    const raw = await generateWithOllama(prompt, {
      format: "json",
      system: CONTENT_SYSTEM_PROMPT,
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
    system: CONTENT_SYSTEM_PROMPT,
    temperature: 0.1
  });
  const parsed = parseJsonResponse(responseText);
  return normalizeAiDocument(document, parsed);
}

async function runScenarioHarmonization(document) {
  if (document.lernsituationen.length === 0) return document;

  const storyContext = await generateStoryContext(document);
  debugStoryContext(storyContext);

  const responseText = await generateWithOllama(
    buildScenarioPrompt(document, storyContext),
    {
      format: "json",
      system: STORY_SYSTEM_PROMPT,
      temperature: 0.32,
      repeatPenalty: 1.08
    }
  );

  const parsed = parseScenarioResponse(responseText, document.lernsituationen.length);
  if (!parsed) return document;

  const byId = new Map(
    parsed
      .filter((entry) => entry?.id && entry?.einstieg)
      .map((entry) => [normalizeId(entry.id), entry])
  );

  const lernsituationen = document.lernsituationen.map((ls, index) => {
    const incoming = byId.get(normalizeId(ls.id)) || parsed[index];
    const newEinstieg = cleanScenarioText(incoming?.einstieg);
    return newEinstieg ? { ...ls, einstieg: newEinstieg } : ls;
  });

  return { ...document, lernsituationen };
}

async function generateStoryContext(document) {
  try {
    const responseText = await generateWithOllama(buildStoryContextPrompt(document), {
      format: "json",
      system: STORY_SYSTEM_PROMPT,
      temperature: 0.25,
      repeatPenalty: 1.08
    });

    return normalizeStoryContext(parseJsonResponse(responseText), document);
  } catch (error) {
    console.warn("[StoryContext] Fehler beim Generieren:", error.message);
    return fallbackStoryContext(document);
  }
}

function buildContentPrompt(document) {
  const compact = {
    meta: document.meta,
    lernsituationen: document.lernsituationen.map((ls) => ({
      id: ls.id,
      handlungsprodukt: ls.handlungsprodukt,
      kompetenzen: ls.kompetenzen,
      inhalte: ls.inhalte
    }))
  };

  return `Du erhaeltst ein standardisiertes JSON fuer Lernfelddokumente.

Du darfst:
- Inhalte fachlich und didaktisch pruefen
- Kompetenzen sinnvoll ergaenzen
- Handlungsprodukte fachlich praezisieren, wenn sie zu unklar sind

Du darfst NICHT:
- Einstiegsszenarien schreiben oder veraendern
- Tabellen entwerfen oder Layout beschreiben
- Neue Felder hinzufuegen
- Die Reihenfolge oder Anzahl der Lernsituationen veraendern
- IDs der Lernsituationen veraendern
- Inhalte erfinden, die nicht zum Beruf, Lernfeld oder den vorhandenen Kompetenzen passen

Tags duerfen nur AK, IG oder MK sein.
Jede Kompetenz muss mindestens einen Tag behalten oder erhalten.

Gib ausschliesslich valides JSON zurueck.
Kein Markdown, keine Kommentare.

Schluessel: meta, lernsituationen, id, handlungsprodukt, kompetenzen, text, tags, inhalte.

JSON:
${JSON.stringify(compact)}`;
}

function buildStoryContextPrompt(document) {
  const situations = document.lernsituationen
    .map((ls, index) => `${index + 1}. ${ls.id}
Handlungsprodukt: ${ls.handlungsprodukt || "-"}
Kompetenzen:
${formatCompetences(ls)}
Inhalte: ${ls.inhalte || "-"}`)
    .join("\n\n");

  return `Entwickle einen realistischen Rahmen fuer eine zusammenhaengende Fallgeschichte.

Beruf: ${document.meta.beruf || "-"}
Fach: ${document.meta.fach || "-"}
Lernfeld: ${document.meta.lernfeld || "-"}

Pflicht:
- Betrieb/Einrichtung muss zum Beruf passen.
- Leitauftrag muss aus Handlungsprodukten, Kompetenzen und Inhalten ableitbar sein.
- Keine IT-Firma, Netzwerkmodernisierung oder Softwareentwicklung, ausser Beruf oder Inhalte verlangen das ausdruecklich.
- Der Rahmen muss fuer alle Lernsituationen funktionieren.
- Keine Einstiegsszenarien schreiben, nur den festen Kontext.

Lernsituationen:
${situations}

Antworte NUR mit JSON:
{
  "betrieb": "Name des passenden Betriebs oder der Einrichtung",
  "ort": "konkreter Ort",
  "branche": "kurze Branchenbeschreibung",
  "hauptpersonen": [
    {"name": "Vorname Nachname", "rolle": "Rolle im Betrieb oder beim Kunden"}
  ],
  "kundeOderAdressat": "Kunde, Abteilung, Patient, Gast, Mandant oder anderer passender Adressat",
  "leitauftrag": "konkreter Auftrag, der durch alle Lernsituationen fuehrt",
  "roterFaden": "ein Satz, wie die Lernsituationen sachlogisch aufeinander aufbauen"
}`;
}

function buildScenarioPrompt(document, context) {
  const situationList = document.lernsituationen
    .map((ls, index) => `${index + 1}. ${ls.id}
Handlungsprodukt: ${ls.handlungsprodukt || "-"}
Kompetenzen:
${formatCompetences(ls)}
Inhalte: ${ls.inhalte || "-"}
Methoden: ${ls.methoden || "-"}`)
    .join("\n\n");

  return `Schreibe passende Einstiegsszenarien fuer die Lernsituationen.

Kontext ist FEST und darf nicht ausgetauscht werden:
- Betrieb/Einrichtung: ${context.betrieb}
- Ort: ${context.ort}
- Branche: ${context.branche}
- Hauptpersonen: ${context.hauptpersonen.join("; ")}
- Adressat/Kunde: ${context.kundeOderAdressat}
- Leitauftrag: ${context.leitauftrag}
- Roter Faden: ${context.roterFaden}

Beruf: ${document.meta.beruf || "-"}
Fach: ${document.meta.fach || "-"}
Lernfeld: ${document.meta.lernfeld || "-"}

Regeln:
1. Schreibe pro LS genau 3 Saetze in der Gegenwartsform.
2. Jeder Einstieg muss konkret zum jeweiligen Handlungsprodukt fuehren.
3. Jeder Einstieg muss mindestens eine konkrete Kompetenz-Taetigkeit und einen Inhaltsbegriff der LS aufgreifen.
4. LS 1 startet den Auftrag. Jede weitere LS nennt ein konkretes Ergebnis aus der vorherigen LS.
5. Keine branchenfremden Elemente einfuehren. Keine IT-Beispiele, wenn Beruf/Inhalte keine IT verlangen.
6. Keine Meta-Sprache wie "in dieser Lernsituation", keine Tabellen, keine Erklaerungen.
7. Behalte die IDs exakt bei.

Lernsituationen:
${situationList}

Antworte NUR mit diesem JSON, kein Markdown:
{
  "scenarios": [
    {"id": "LS X.X", "einstieg": "Genau 3 Saetze..."}
  ]
}`;
}

function parseScenarioResponse(raw, expectedCount) {
  try {
    const parsed = parseJsonResponse(raw);
    const scenarios = parsed?.scenarios;

    if (!Array.isArray(scenarios) || scenarios.length === 0) return null;

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

function normalizeStoryContext(value, document) {
  const fallback = fallbackStoryContext(document);
  const people = Array.isArray(value?.hauptpersonen)
    ? value.hauptpersonen
        .map((person) => {
          if (typeof person === "string") return cleanShortText(person);
          const name = cleanShortText(person?.name);
          const role = cleanShortText(person?.rolle);
          return [name, role].filter(Boolean).join(" - ");
        })
        .filter(Boolean)
    : [];

  return {
    betrieb: cleanShortText(value?.betrieb) || fallback.betrieb,
    ort: cleanShortText(value?.ort) || fallback.ort,
    branche: cleanShortText(value?.branche) || fallback.branche,
    hauptpersonen: people.length ? people.slice(0, 2) : fallback.hauptpersonen,
    kundeOderAdressat:
      cleanShortText(value?.kundeOderAdressat) || fallback.kundeOderAdressat,
    leitauftrag: cleanShortText(value?.leitauftrag, 260) || fallback.leitauftrag,
    roterFaden: cleanShortText(value?.roterFaden, 260) || fallback.roterFaden
  };
}

function fallbackStoryContext(document) {
  const beruf = document.meta.beruf || "Ausbildungsbetrieb";
  const lernfeld = document.meta.lernfeld || "das Lernfeld";

  return {
    betrieb: `Ausbildungsbetrieb ${beruf}`,
    ort: "Dortmund",
    branche: beruf,
    hauptpersonen: ["Mara Schneider - Ausbilderin"],
    kundeOderAdressat: "interner Auftraggeber",
    leitauftrag: `Ein praxisnaher Auftrag zu ${lernfeld}`,
    roterFaden:
      "Die Lernsituationen bauen fachlich aufeinander auf und fuehren Schritt fuer Schritt zum Handlungsprodukt."
  };
}

function formatCompetences(ls) {
  if (!ls.kompetenzen?.length) return "-";
  return ls.kompetenzen
    .map((competence) => {
      const tags = competence.tags?.length ? `[${competence.tags.join("][")}] ` : "";
      return `- ${tags}${competence.text}`;
    })
    .join("\n");
}

function cleanScenarioText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function cleanShortText(value, maxLength = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseJsonArray(raw) {
  const cleaned = cleanJsonString(raw);

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
  const cleaned = cleanJsonString(value);

  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
  }

  throw new Error("Ollama hat kein gueltiges JSON zurueckgegeben.");
}

function cleanJsonString(value) {
  return String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function debugStoryContext(context) {
  if (process.env.AI_DEBUG !== "1") return;

  console.log("[AI_DEBUG] Story-Kontext");
  console.log(JSON.stringify(context, null, 2));
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
