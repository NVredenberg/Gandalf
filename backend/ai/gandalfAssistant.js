import { loadAllDocsAsText } from "../admin/docsManager.js";
import { normalizeLearningDocument } from "../parser/schema.js";
import {
  mapGandalfToLearningSituation,
  normalizeGandalfResponse
} from "./gandalfMapping.js";
import { generateWithOllama } from "./ollamaClient.js";
import { parseJsonResponse } from "./jsonUtils.js";
import { loadPromptAsset } from "./promptAssets.js";

const GANDALF_APP_SYSTEM_RULES = [
  "Du bist Gandalf, ein Assistent fuer Lernsituationen in der beruflichen Bildung.",
  "Du arbeitest fuer Unterrichtsentwicklung an Berufskollegs in NRW.",
  "Du erzeugst oder ueberarbeitest genau eine Lernsituation pro Anfrage.",
  "Jede Lernsituation muss alle sechs Kompetenzdimensionen enthalten: Fachkompetenz, Selbstkompetenz, Sozialkompetenz, Methodenkompetenz, Kommunikative Kompetenz und Lernkompetenz.",
  "Digitale Schluesselkompetenzen werden nur direkt im Kompetenztext markiert: <MK>...</MK> fuer Medienkompetenz, <AK>...</AK> fuer Anwendungs-Know-how und <IG>...</IG> fuer informatische Grundkenntnisse.",
  "Wenn fachlich passend, ergaenze mindestens eine KI-Zertifikats-Kompetenz und kennzeichne sie am Satzende mit (KI).",
  "Deine Ausgabe ist ausschliesslich valides JSON.",
  "Keine Chat-Begruessung, keine Markdown-Trenner, keine Emojis und keine Erklaertexte ausserhalb des JSON."
].join(" ");

const MAX_PLAN_CHARS = readPositiveInteger(process.env.GANDALF_PLAN_CHARS, 22000);
const MAX_CONTEXT_CHARS = readPositiveInteger(process.env.GANDALF_CONTEXT_CHARS, 32000);
const MAX_USER_CHARS = readPositiveInteger(process.env.GANDALF_USER_CHARS, 16000);

export async function generateSingleLS(session, input = {}, settings = {}) {
  const sessionData = session?.data || {};
  const lsIndex = Math.max(1, Number(input.lsIndex || 1));
  const totalLs = Math.max(1, Number(input.totalLs || sessionData.totalLs || 1));
  const mode = normalizeMode(input.mode || sessionData.mode || "create");
  const userInput = input.userInput || {};

  reportProgress(settings, `Gandalf bereitet LS ${lsIndex} vor.`, {
    current: lsIndex,
    total: totalLs
  });

  const context = await loadAllDocsAsText();
  const previousLS = Array.isArray(sessionData.approvedLS) ? sessionData.approvedLS : [];
  const prompt = buildGandalfPrompt({
    grundlagen: userInput.grundlagen || sessionData.grundlagen || {},
    plan: sessionData.plan || "",
    context,
    mode,
    lsIndex,
    totalLs,
    previousLS,
    inhalte: userInput.inhalte || sessionData.inhalte || {},
    existingLs: userInput.existingLs || sessionData.existingLs || "",
    hints: userInput.hints || sessionData.nextHints || "",
    nextHints: userInput.nextHints || "",
    ownMethods: userInput.methoden || sessionData.methoden || ""
  });

  reportProgress(settings, `Gandalf schreibt LS ${lsIndex}.`, {
    current: lsIndex,
    total: totalLs
  });

  const systemPrompt = await buildGandalfSystemPrompt(context);
  const raw = await generateWithOllama(prompt, {
    format: "json",
    model: settings.model,
    system: systemPrompt,
    temperature: 0.35,
    repeatPenalty: 1.08,
    numCtx: readPositiveInteger(process.env.GANDALF_NUM_CTX, 16384),
    numPredict: 2600
  });

  return normalizeGandalfResponse(parseJsonResponse(raw), lsIndex);
}

export function finalizeGandalfDocument(session) {
  const data = session?.data || {};
  const approvedLS = Array.isArray(data.approvedLS) ? data.approvedLS.filter(Boolean) : [];

  if (!approvedLS.length) {
    throw new Error("Es wurden noch keine Lernsituationen genehmigt.");
  }

  const meta = data.grundlagen || {};
  return normalizeLearningDocument({
    meta: {
      beruf: meta.beruf || meta.anlage || "",
      fach: meta.fach || "",
      lernfeld: meta.lernfeld || ""
    },
    lernsituationen: approvedLS.map((ls, index) =>
      mapGandalfToLearningSituation(ls, index, data)
    )
  });
}

async function buildGandalfSystemPrompt(context) {
  const contextHint = context
    ? "Nutze die bereitgestellten Hintergrunddokumente als fachlichen Rahmen."
    : "Wenn keine Hintergrunddokumente vorliegen, arbeite transparent mit dem gelieferten Plan und Nutzerinput.";
  const sourcePrompt = await loadPromptAsset("Gandalf_v3.txt");
  return [
    sourcePrompt,
    `APP-UMSETZUNG UND VERBINDLICHE AUSGABEREGELN:\n${GANDALF_APP_SYSTEM_RULES}`,
    contextHint
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function buildGandalfPrompt({
  grundlagen,
  plan,
  context,
  mode,
  lsIndex,
  totalLs,
  previousLS,
  inhalte,
  existingLs,
  hints,
  nextHints,
  ownMethods
}) {
  return `Erstelle genau eine Lernsituation.

Grunddaten:
${JSON.stringify(grundlagen || {}, null, 2)}

Modus:
${modeDescription(mode)}

Aktuelle LS:
- Nummer: ${lsIndex} von ${totalLs}
- Wenn mehrere LS entstehen, soll diese LS fachlich an die genehmigten vorherigen LS anschliessen.

Bisher genehmigte LS:
${compactText(JSON.stringify(previousLS || [], null, 2), 9000) || "-"}

Rahmenlehrplan / Plan:
${compactText(plan, MAX_PLAN_CHARS) || "-"}

Gandalf-Hintergrunddokumente:
${compactText(context, MAX_CONTEXT_CHARS) || "-"}

Inhalte und Empfehlungen:
${compactText(JSON.stringify(inhalte || {}, null, 2), MAX_USER_CHARS) || "-"}

Vorhandene oder unvollstaendige LS:
${compactText(existingLs, MAX_USER_CHARS) || "-"}

Zusatzhinweise der Lehrkraft:
${compactText([hints, nextHints].filter(Boolean).join("\n"), 4000) || "-"}

Lern- und Arbeitstechniken aus Nutzereingabe:
${compactText(ownMethods, 2500) || "-"}

Regeln:
- Schreibe praxisnah, konkret und beruflich glaubwuerdig.
- Kein Layout, keine Word-Tabellen, kein Markdown.
- "situation" ist ein Einstiegsszenario mit beruflicher Ausgangslage, Problem, Handlungsdruck und Arbeitsauftrag.
- "produkt" ist ein konkretes Handlungsprodukt oder Lernergebnis.
- "ziel" enthaelt die sechs Kompetenzdimensionen zwingend als Kompetenzsaetze.
- Fachkompetenz muss mindestens zwei Kompetenzsaetze enthalten; jede andere Dimension mindestens einen.
- Jeder Kompetenzsatz beginnt mit der Dimension, z. B. "Fachkompetenz: ...".
- Markiere digitale Schluesselkompetenzen nur im Kompetenztext mit <MK>, <AK> oder <IG>; liste sie nicht separat auf.
- Pro konkretisiertem Inhalt sollen ein bis zwei Kompetenzen digitale Schluesselkompetenzen enthalten, wenn es fachlich passt.
- Ergaenze KI-Zertifikats-Kompetenzen, wenn sie fachlich passen, und markiere diese mit (KI).
- "konInhalt" enthaelt konkretisierte fachliche Inhalte.
- "individuell" beschreibt Differenzierung, Foerderung oder Wahlaufgaben.
- "sol" beschreibt selbstgesteuertes Lernen, Reflexion oder Lernwege.
- Bei Modus "extend" bestehende LS nicht ersetzen, sondern digitale Schluesselkompetenzen sinnvoll ergaenzen.
- Bei Modus "revise" unvollstaendige LS vervollstaendigen und in sich schluessig machen.

Antworte exakt in diesem JSON-Format:
{
  "id": "LS ${lsIndex}",
  "situation": "...",
  "produkt": "...",
  "ziel": [
    "Fachkompetenz: ...",
    "Fachkompetenz: ...",
    "Selbstkompetenz: ...",
    "Sozialkompetenz: ...",
    "Methodenkompetenz: ...",
    "Kommunikative Kompetenz: ...",
    "Lernkompetenz: ..."
  ],
  "konInhalt": "...",
  "individuell": "...",
  "sol": "..."
}`;
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (["a", "extend", "erweitern"].includes(mode)) return "extend";
  if (["b", "revise", "optimieren", "ueberarbeiten"].includes(mode)) return "revise";
  return "create";
}

function modeDescription(mode) {
  if (mode === "extend") {
    return "extend: Vorhandene Lernsituation mit digitalen Schluesselkompetenzen erweitern.";
  }
  if (mode === "revise") {
    return "revise: Unvollstaendige oder vorhandene Lernsituation didaktisch ueberarbeiten.";
  }
  return "create: Neue Lernsituation aus Plan, Frodo-Analyse und Nutzereingabe erstellen.";
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanShort(value, maxLength) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function compactText(value, maxLength) {
  const text = cleanText(value);
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
