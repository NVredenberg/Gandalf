import { generateWithOllama } from "./ollamaClient.js";
import { parseJsonResponse } from "./jsonUtils.js";
import { loadPromptAsset } from "./promptAssets.js";

const FRODO_APP_SYSTEM_RULES = [
  "Du bist Frodo, ein didaktischer Analyse-Assistent fuer berufliche Bildung.",
  "Du unterstuetzt Berufsschullehrkraefte dabei, Pruefungskatalog-Inhalte sinnvoll auf Lernfelder des Rahmenlehrplans zu verteilen.",
  "Du vergleichst Rahmenlehrplaene, Pruefungskataloge und Lernfelder.",
  "Die Pruefungsrelevanz AP1/AP2 darf ausschliesslich aus expliziten Kennzeichnungen im Pruefungskatalog stammen; leite sie nie aus Lernfeldnummern oder Vermutungen ab.",
  "Wenn Inhalte mehrfach vorkommen oder unklar zugeordnet sind, benenne die Unsicherheit und empfehle eine didaktisch sinnvolle Verteilung.",
  "Arbeite praezise und praxisorientiert fuer erfahrene Lehrkraefte.",
  "Die Web-App uebernimmt die Dialogschritte. Frage in API-Antworten nicht nach weiteren Eingaben, sondern verarbeite die gelieferten Daten.",
  "Gib ausschliesslich valides JSON zurueck."
].join(" ");

const MAX_PLAN_CHARS = readPositiveInteger(process.env.FRODO_PLAN_CHARS, 24000);
const MAX_CATALOG_CHARS = readPositiveInteger(process.env.FRODO_CATALOG_CHARS, 22000);

export function summarizeFrodoInputs({ rahmenlehrplan, pruefungskatalog }) {
  const planText = rahmenlehrplan?.text || "";
  const catalogText = pruefungskatalog?.text || "";

  return {
    dokumente: {
      rahmenlehrplan: summarizeParsedDocument(rahmenlehrplan),
      pruefungskatalog: summarizeParsedDocument(pruefungskatalog)
    },
    erkannteThemen: extractHeadings(`${planText}\n${catalogText}`).slice(0, 18),
    pruefungsaufteilung: detectExamStructure(catalogText)
  };
}

export async function analyzeWithFrodo(session, input = {}, settings = {}) {
  const rahmenlehrplanText = String(session?.data?.rahmenlehrplanText || "").trim();
  const pruefungskatalogText = String(session?.data?.pruefungskatalogText || "").trim();

  if (!rahmenlehrplanText || !pruefungskatalogText) {
    throw new Error("Rahmenlehrplan und Pruefungskatalog muessen zuerst hochgeladen werden.");
  }

  const fachrichtung = cleanShort(input.fachrichtung || input.beruf || "-", 180);
  const lernfeld = cleanShort(input.lernfeld || "-", 120);
  const systemPrompt = await buildFrodoSystemPrompt();

  reportProgress(settings, "Pruefungskatalog wird gegliedert.");
  const catalogAnalysis = await extractCatalogStructure(pruefungskatalogText, {
    ...settings,
    systemPrompt
  });

  reportProgress(settings, "Lernfeld wird analysiert.");
  const raw = await generateWithOllama(
    buildFrodoAnalysisPrompt({
      rahmenlehrplan: compactText(rahmenlehrplanText, MAX_PLAN_CHARS),
      katalog: compactText(pruefungskatalogText, MAX_CATALOG_CHARS),
      catalogAnalysis,
      fachrichtung,
      lernfeld
    }),
    {
      format: "json",
      model: settings.model,
      system: systemPrompt,
      temperature: 0.1,
      numCtx: readPositiveInteger(process.env.FRODO_NUM_CTX, 16384),
      numPredict: 3000
    }
  );

  return normalizeFrodoAnalysis(parseJsonResponse(raw), { fachrichtung, lernfeld });
}

async function extractCatalogStructure(katalogText, settings = {}) {
  const fallback = detectExamStructure(katalogText);
  const systemPrompt = settings.systemPrompt || await buildFrodoSystemPrompt();

  try {
    const raw = await generateWithOllama(
      `Analysiere den Pruefungskatalog in AP1, AP2 und gemeinsame Themen.

Regeln:
- Nutze nur Informationen aus dem Material.
- Wenn die Aufteilung nicht eindeutig ist, schreibe das in "hinweise".
- Antworte nur mit JSON.

Material:
${compactText(katalogText, MAX_CATALOG_CHARS)}

JSON-Format:
{
  "ap1": ["Thema"],
  "ap2": ["Thema"],
  "beide": ["Thema"],
  "hinweise": "kurze Unsicherheiten"
}`,
      {
        format: "json",
        model: settings.model,
        system: systemPrompt,
        temperature: 0.05,
        numCtx: 12000,
        numPredict: 1400
      }
    );

    return {
      ...fallback,
      ...normalizeCatalogStructure(parseJsonResponse(raw))
    };
  } catch (error) {
    console.warn("[Frodo] Katalog-Gliederung per KI uebersprungen:", error.message);
    return fallback;
  }
}

async function buildFrodoSystemPrompt() {
  const sourcePrompt = await loadPromptAsset("Fordo_v1.txt");
  return [sourcePrompt, `APP-UMSETZUNG UND VERBINDLICHE AUSGABEREGELN:\n${FRODO_APP_SYSTEM_RULES}`]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function buildFrodoAnalysisPrompt({
  rahmenlehrplan,
  katalog,
  catalogAnalysis,
  fachrichtung,
  lernfeld
}) {
  return `Analysiere ein Lernfeld fuer die didaktische Planung.

Ziel:
Finde Inhalte, die fuer ${lernfeld} in der Fachrichtung/dem Beruf "${fachrichtung}" relevant sind.
Trenne Inhalte nach AP1, AP2 und beiden Pruefungsteilen.
Leite Empfehlungen fuer Lehrkraefte ab.

Regeln:
- Kein Markdown, keine Erklaertexte ausserhalb des JSON.
- Jede Liste enthaelt konkrete fachliche Inhalte, keine allgemeinen Floskeln.
- Die AP-Zuordnung muss aus dem Pruefungskatalog stammen. Bei Unsicherheit "unklar" verwenden.
- "behandlung" ist eines von: "einfuehren", "vertiefen", "anwenden", "wiederholen", "pruefen".
- "pruefungsrelevanz" ist eines von: "AP1", "AP2", "AP1+AP2", "unklar".
- Markiere Unsicherheiten in "querverbindungen" oder "empfehlungen".
- Hebe in "pruefungskritisch" nur Inhalte hervor, die laut Katalog AP1-relevant sind.
- Nutze nur das gegebene Material.

Bereits erkannte Katalogstruktur:
${JSON.stringify(catalogAnalysis, null, 2)}

Rahmenlehrplan:
${rahmenlehrplan}

Pruefungskatalog:
${katalog}

Antworte exakt in diesem JSON-Format:
{
  "lernfeld": "${lernfeld}",
  "kurzprofil": "2-4 Saetze",
  "pruefungsrelevanz": "kurze Zusammenfassung der AP1/AP2-Verteilung laut Katalog",
  "ap1": [
    { "thema": "konkretes Thema", "pruefungsrelevanz": "AP1", "behandlung": "einfuehren", "querverweis": "auch relevant in LF Y oder leer" }
  ],
  "ap2": [
    { "thema": "konkretes Thema", "pruefungsrelevanz": "AP2", "behandlung": "vertiefen", "querverweis": "auch relevant in LF Y oder leer" }
  ],
  "beide": [
    { "thema": "konkretes Thema", "pruefungsrelevanz": "AP1+AP2", "behandlung": "anwenden", "querverweis": "auch relevant in LF Y oder leer" }
  ],
  "querverbindungen": "Bezug zu anderen Lernfeldern oder Pruefungsteilen",
  "empfehlungen": ["konkrete Empfehlung"],
  "pruefungskritisch": ["Thema"]
}`;
}

function normalizeFrodoAnalysis(value, fallback = {}) {
  return {
    lernfeld: cleanShort(value?.lernfeld || fallback.lernfeld || ""),
    fachrichtung: cleanShort(value?.fachrichtung || fallback.fachrichtung || ""),
    kurzprofil: cleanText(value?.kurzprofil),
    pruefungsrelevanz: cleanText(value?.pruefungsrelevanz),
    ap1: normalizeTopicItems(value?.ap1),
    ap2: normalizeTopicItems(value?.ap2),
    beide: normalizeTopicItems(value?.beide),
    querverbindungen: cleanText(value?.querverbindungen),
    empfehlungen: normalizeTextArray(value?.empfehlungen),
    pruefungskritisch: normalizeTextArray(value?.pruefungskritisch)
  };
}

function normalizeCatalogStructure(value = {}) {
  return {
    ap1: normalizeTextArray(value.ap1),
    ap2: normalizeTextArray(value.ap2),
    beide: normalizeTextArray(value.beide),
    hinweise: cleanText(value.hinweise)
  };
}

function normalizeTopicItems(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (typeof item === "string") {
        return { thema: cleanShort(item, 180), pruefungsrelevanz: "", behandlung: "", querverweis: "" };
      }

      return {
        thema: cleanShort(item?.thema || item?.title || item?.name || "", 180),
        pruefungsrelevanz: cleanShort(item?.pruefungsrelevanz || item?.prüfungsrelevanz || item?.ap || "", 30),
        behandlung: cleanShort(item?.behandlung || item?.typ || "", 60),
        querverweis: cleanShort(item?.querverweis || item?.auchRelevantIn || item?.andereLernfelder || "", 120)
      };
    })
    .filter((item) => item.thema);
}

function summarizeParsedDocument(parsed) {
  const text = parsed?.text || "";
  return {
    pages: Number(parsed?.pages || 0),
    chars: text.length,
    textPreview: compactText(text, 420)
  };
}

function detectExamStructure(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const result = { ap1: [], ap2: [], beide: [], hinweise: "" };
  let target = "beide";

  for (const line of lines) {
    if (/\b(AP\s*1|Teil\s*1|Abschlusspruefung\s*Teil\s*1)\b/i.test(line)) {
      target = "ap1";
      continue;
    }
    if (/\b(AP\s*2|Teil\s*2|Abschlusspruefung\s*Teil\s*2)\b/i.test(line)) {
      target = "ap2";
      continue;
    }

    const heading = cleanHeading(line);
    if (heading && result[target].length < 12) {
      result[target].push(heading);
    }
  }

  result.hinweise = result.ap1.length || result.ap2.length
    ? "Heuristische Vorstrukturierung aus Ueberschriften und AP-Markern."
    : "Keine eindeutige AP-Struktur im Text erkannt.";
  return result;
}

function extractHeadings(text) {
  return String(text || "")
    .split(/\n+/)
    .map(cleanHeading)
    .filter(Boolean)
    .filter(uniqueFilter());
}

function cleanHeading(value) {
  const text = String(value || "")
    .replace(/^\s*(\d+[\.)]|\d+\.\d+|[-*•])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 8 || text.length > 120) return "";
  if (/[.!?]$/.test(text) && text.split(/\s+/).length > 10) return "";
  if (/^(seite|page)\s+\d+$/i.test(text)) return "";
  return text;
}

function normalizeTextArray(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/\n|;/);
  return items
    .map((item) => cleanShort(typeof item === "string" ? item : item?.thema || item?.text || ""))
    .filter(Boolean)
    .filter(uniqueFilter());
}

function uniqueFilter() {
  const seen = new Set();
  return (value) => {
    const key = String(value || "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanShort(value, maxLength = 220) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}\n\n[Text gekuerzt]`;
}

function reportProgress(settings = {}, message, data = {}) {
  if (typeof settings.onProgress !== "function") return;
  settings.onProgress(message, data);
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
