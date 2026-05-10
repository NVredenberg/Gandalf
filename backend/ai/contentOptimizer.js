import { generateWithOllama } from "./ollamaClient.js";
import { loadExampleContext } from "./exampleLoader.js";
import { loadRagExampleContext } from "./ragStore.js";
import { normalizeAiDocument, normalizeLearningDocument } from "../parser/schema.js";

const CONTENT_SYSTEM_PROMPT =
  "Du bist ein didaktischer Fachassistent fuer berufliche Bildung. " +
  "Arbeite streng strukturiert, fachlich passend und gib nur valides JSON zurueck.";

const STORY_SYSTEM_PROMPT =
  "Du bist didaktischer Autor fuer berufliche Handlungssituationen. " +
  "Jede Situation muss fachlich zum Beruf, zu den Kompetenzen und zu den Inhalten passen. " +
  "Schreibe realistische Ausgangslagen mit Problem, Handlungsdruck und offenem Arbeitsauftrag.";

export async function optimizeLearningDocument(input, settings = {}) {
  const document = normalizeLearningDocument(input);
  reportProgress(settings, "Inhalte werden fachlich geprueft.");
  const optimized = await runContentOptimizationSafely(document, settings);
  reportProgress(settings, "Einstiegsszenarien werden harmonisiert.");
  const harmonized = await runScenarioHarmonization(optimized, settings);

  debugScenarioChanges(document, optimized, harmonized);

  return harmonized;
}

// ---------------------------------------------------------------------------
// KI-Zuordnungstabelle
// ---------------------------------------------------------------------------

export async function generateKiMappingsForTable(lernsituationen, settings = {}) {
  if (!lernsituationen?.length) return {};
  reportProgress(settings, "KI-Zuordnung wird generiert.");

  const input = lernsituationen.map((ls) => ({
    id: ls.id,
    einstieg: truncateText(ls.einstieg, 420),
    handlungsprodukt: truncateText(ls.handlungsprodukt, 240),
    inhalte: truncateText(ls.inhalte, 420),
    kompetenzen: ls.kompetenzen.map(formatCompetenceForPrompt)
  }));

  const prompt = `Erstelle die KI-Zuordnung fuer eine didaktische Jahresplanung.

Kategorien:
- grundlagen: KI-Grundlagen, Datenqualitaet, Algorithmen, Modelle, Prompting, Funktionsweise von KI-Systemen.
- anwendung: KI-Werkzeuge oder digitale Assistenz praktisch nutzen, KI-gestuetzt recherchieren, erzeugen, vergleichen, auswerten oder dokumentieren.
- entwicklung: KI-nahe Loesungen, Automatisierungen, Prototypen, Workflows, Datenpipelines oder Systeme entwerfen/entwickeln.
- gesellschaftRecht: Datenschutz, Urheberrecht, Bias, Transparenz, Verantwortung, gesellschaftliche Folgen, Quellenkritik.

Regeln:
- summary: 1 aussagekraeftiger Satz mit 22-38 Woertern.
- Summary beschreibt konkret, was die Lernenden mit KI, Daten, digitalen Werkzeugen oder Medienkompetenz fachlich leisten.
- Keine leeren Stichworte wie "Anwendung", "Grundlagen" oder "KI-Kompetenz".
- Nutze AK/IG/MK-Tags nur als Hinweis, nie als alleinigen Grund fuer ein x.
- Setze eine Kategorie nur true, wenn sie aus Kompetenzen, Inhalten, Handlungsprodukt oder Einstieg fachlich ableitbar ist.
- entwicklung ist nur true, wenn wirklich etwas entworfen, automatisiert, modelliert, prototypisiert oder implementiert wird.
- gesellschaftRecht ist nur true, wenn Datenschutz, Recht, Ethik, Bias, Verantwortung, Transparenz oder Quellenkritik sichtbar vorkommen.
- Wenn keine KI-nahe Kompetenz erkennbar ist: summary trotzdem fachlich beschreiben und alle Kategorien false.
- Keine Erklaerungen ausserhalb des JSON.

Eingabe:
${JSON.stringify(input, null, 2)}

Antworte ausschliesslich mit validem JSON:
{
  "mappings": [
    {
      "id": "LS X.X",
      "summary": "aussagekraeftiger Satz",
      "grundlagen": false,
      "anwendung": true,
      "entwicklung": false,
      "gesellschaftRecht": false
    }
  ]
}`;

  try {
    const raw = await generateWithOllama(prompt, {
      format: "json",
      model: settings.model,
      system: CONTENT_SYSTEM_PROMPT,
      temperature: 0.05,
      numCtx: 8192,
      numPredict: Math.min(1800, Math.max(900, lernsituationen.length * 260))
    });

    const parsed = parseJsonArray(raw);
    const byNormalizedId = new Map(
      lernsituationen.map((situation) => [normalizeId(situation.id), situation])
    );
    const result = {};
    for (const entry of parsed) {
      if (entry?.id) {
        const situation = byNormalizedId.get(normalizeId(entry.id));
        const key = situation?.id || String(entry.id).trim();
        result[key] = normalizeKiMapping(entry, situation);
      }
    }
    return result;
  } catch (error) {
    console.warn("[KI-Mapping] Fehler beim Generieren:", error.message);
    return {};
  }
}

export async function generateKiSummariesForTable(lernsituationen, settings = {}) {
  const mappings = await generateKiMappingsForTable(lernsituationen, settings);
  return Object.fromEntries(
    Object.entries(mappings).map(([id, mapping]) => [id, mapping.summary])
  );
}

// ---------------------------------------------------------------------------
// Interne Hilfsfunktionen
// ---------------------------------------------------------------------------

async function runContentOptimizationSafely(document, settings = {}) {
  try {
    return await runContentOptimization(document, settings);
  } catch (error) {
    console.warn("[Content] KI-Pruefung uebersprungen:", error.message);
    return document;
  }
}

async function runContentOptimization(document, settings = {}) {
  const responseText = await generateWithOllama(buildContentPrompt(document), {
    format: "json",
    model: settings.model,
    system: CONTENT_SYSTEM_PROMPT,
    temperature: 0.1,
    numPredict: 4096
  });
  const parsed = parseJsonResponse(responseText);
  return normalizeAiDocument(document, parsed);
}

export async function runScenarioHarmonization(document, settings = {}) {
  if (document.lernsituationen.length === 0) return document;

  reportProgress(settings, "Story-Kontext wird generiert.");
  const [storyContext, staticExampleContext, ragExampleContext] = await Promise.all([
    generateStoryContext(document, settings),
    loadExampleContext(document),
    loadRagExampleContext(document, settings)
  ]);
  const exampleContext = combineExampleContexts(staticExampleContext, ragExampleContext);
  debugStoryContext(storyContext);

  if (staticExampleContext || ragExampleContext) {
    reportProgress(settings, "Passende Beispiele wurden geladen.", {
      staticExamples: Boolean(staticExampleContext),
      ragExamples: Boolean(ragExampleContext)
    });
  }

  if (scenarioMode(settings) === "individual") {
    return generateScenariosIndividually(document, storyContext, exampleContext, settings);
  }

  reportProgress(settings, "Szenarien werden generiert.");
  const responseText = await generateWithOllama(
    buildScenarioPrompt(document, storyContext, exampleContext),
    {
      format: "json",
      model: settings.model,
      system: STORY_SYSTEM_PROMPT,
      temperature: 0.42,
      repeatPenalty: 1.08,
      numCtx: 8192,
      numPredict: scenarioPredictionBudget(document)
    }
  );

  reportProgress(settings, "Szenarien werden geprueft.");
  let parsed = parseScenarioResponse(responseText, document.lernsituationen.length);
  if (!parsed) return document;

  parsed = await repairScenarioSetIfNeeded(
    document,
    storyContext,
    exampleContext,
    parsed,
    settings
  );

  const byId = new Map(
    parsed
      .filter((entry) => entry?.id && entry?.einstieg)
      .map((entry) => [normalizeId(entry.id), entry])
  );

  const lernsituationen = document.lernsituationen.map((ls, index) => {
    const incoming = byId.get(normalizeId(ls.id)) || parsed[index];
    const newEinstieg = cleanScenarioText(incoming?.einstieg);
    reportProgress(settings, `${ls.id} verarbeitet.`, {
      current: index + 1,
      total: document.lernsituationen.length
    });
    return newEinstieg ? { ...ls, einstieg: newEinstieg } : ls;
  });

  return { ...document, lernsituationen };
}

async function generateStoryContext(document, settings = {}) {
  try {
    const responseText = await generateWithOllama(buildStoryContextPrompt(document), {
      format: "json",
      model: settings.model,
      system: STORY_SYSTEM_PROMPT,
      temperature: 0.35,
      repeatPenalty: 1.08,
      numCtx: 2048,
      numPredict: 220
    });

    return normalizeStoryContext(parseJsonResponse(responseText), document);
  } catch (error) {
    console.warn("[StoryContext] Fehler beim Generieren:", error.message);
    return fallbackStoryContext(document);
  }
}

async function generateScenariosIndividually(document, context, exampleContext, settings = {}) {
  const lernsituationen = [];
  let previousOutcome = "";

  for (const [index, situation] of document.lernsituationen.entries()) {
    let nextSituation = situation;
    reportProgress(settings, `${situation.id} wird generiert.`, {
      current: index + 1,
      total: document.lernsituationen.length
    });

    try {
      const responseText = await generateWithOllama(
        buildSingleScenarioPrompt(
          document,
          context,
          exampleContext,
          situation,
          index,
          previousOutcome
        ),
        {
          format: "json",
          model: settings.model,
          system: STORY_SYSTEM_PROMPT,
          temperature: 0.38,
          repeatPenalty: 1.08,
          numCtx: 4096,
          numPredict: 1100
        }
      );

      const parsed = parseJsonResponse(responseText);
      const einstieg = cleanScenarioText(parsed?.einstieg);
      nextSituation = einstieg ? { ...situation, einstieg } : situation;
    } catch (error) {
      console.warn(`[Scenario] ${situation.id} uebersprungen:`, error.message);
    }

    lernsituationen.push(nextSituation);
    previousOutcome = summarizeScenarioOutcome(nextSituation);
    reportProgress(settings, `${situation.id} verarbeitet.`, {
      current: index + 1,
      total: document.lernsituationen.length
    });
  }

  return { ...document, lernsituationen };
}

function buildSingleScenarioPrompt(
  document,
  context,
  exampleContext,
  situation,
  index,
  previousOutcome
) {
  const anchor = compactScenarioAnchor(situation);

  return `Schreibe genau eine didaktische Handlungssituation.

Kontext:
- Betrieb/Einrichtung: ${context.betrieb}, ${context.ort}
- Hauptperson: ${context.hauptperson} (${context.rolle})
- Adressat/Kunde: ${context.kundeOderAdressat}
- Leitauftrag: ${context.leitauftrag}
${previousOutcome ? `- Ergebnis der vorherigen LS: ${previousOutcome}` : "- Dies ist der Start des Auftrags."}

Lernsituation:
- ID: ${situation.id}
- Produkt: ${anchor.handlungsprodukt}
- Taetigkeit: ${anchor.kompetenz}
- Inhalte: ${anchor.inhalte}
${examplePromptBlock(exampleContext)}

Regeln:
- 6 - 8 Saetze, 250 -350 Woerter, Gegenwartsform.
- Berufliche Ausgangslage, konkretes Problem, Handlungsdruck, offene Entscheidung.
- Fuehre zum Produkt, greife Taetigkeit und Inhalte auf, nimm die Loesung nicht vorweg.
- ${index === 0 ? "Starte den Auftrag neu." : "Baue sichtbar auf dem Ergebnis der vorherigen LS auf."}
- Der letzte Satz ist ein konkreter Arbeitsauftrag an die Lernenden.

Antworte NUR mit JSON:
{"id": "${situation.id}", "einstieg": "..."}`;
}

function buildContentPrompt(document) {
  const compact = {
    meta: document.meta,
    lernsituationen: document.lernsituationen.map((ls) => ({
      id: ls.id,
      handlungsprodukt: ls.handlungsprodukt,
      kompetenzen: ls.kompetenzen.map(formatCompetenceForPrompt),
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

Digitale Schluesselkompetenzen stehen im Kompetenztext als <AK>...</AK>, <IG>...</IG> oder <MK>...</MK>.
Diese Inline-Markierungen muessen erhalten bleiben; nur der markierte Text gehoert zur digitalen Schluesselkompetenz.
Tags duerfen nur AK, IG oder MK sein.
Jede digitale Schluesselkompetenz muss als Inline-Markierung im Kompetenztext stehen.

Gib ausschliesslich valides JSON zurueck.
Kein Markdown, keine Kommentare.

Schluessel: meta, lernsituationen, id, handlungsprodukt, kompetenzen, inhalte.

JSON:
${JSON.stringify(compact)}`;
}

function buildStoryContextPrompt(document) {
  const situations = document.lernsituationen
    .map((ls, index) => {
      const anchor = compactSituationAnchor(ls);
      return `${index + 1}. ${ls.id}: ${anchor.handlungsprodukt}; ${anchor.inhalte}`;
    })
    .join("\n\n");

  return `Entwickle einen knappen realistischen Rahmen fuer eine zusammenhaengende Fallgeschichte.

Beruf: ${document.meta.beruf || "-"}
Fach: ${document.meta.fach || "-"}
Lernfeld: ${document.meta.lernfeld || "-"}

Pflicht:
- Betrieb/Einrichtung muss zum Beruf passen.
- Leitauftrag muss aus Handlungsprodukten, Kompetenzen und Inhalten ableitbar sein.
- Keine IT-Firma, Netzwerkmodernisierung oder Softwareentwicklung, ausser Beruf oder Inhalte verlangen das ausdruecklich.
- Der Rahmen muss fuer alle Lernsituationen funktionieren.
- Keine Einstiegsszenarien schreiben, nur den festen Kontext.
- Keine Arrays und keine verschachtelten Objekte verwenden.

Kurzfolge der Lernsituationen:
${situations}

Antworte NUR mit JSON:
{
  "betrieb": "Name des passenden Betriebs oder der Einrichtung",
  "ort": "konkreter Ort",
  "branche": "kurze Branchenbeschreibung",
  "hauptperson": "Vorname Nachname",
  "rolle": "Rolle im Betrieb oder beim Kunden",
  "kundeOderAdressat": "Kunde, Abteilung, Patient, Gast, Mandant oder anderer passender Adressat",
  "leitauftrag": "konkreter Auftrag, der durch alle Lernsituationen fuehrt",
  "roterFaden": "ein Satz, wie die Lernsituationen sachlogisch aufeinander aufbauen"
}`;
}

function buildScenarioPrompt(document, context, exampleContext = "") {
  const situationList = document.lernsituationen
    .map((ls, index) => {
      const anchor = compactScenarioAnchor(ls);
      return `${index + 1}. ${ls.id}
Produkt: ${anchor.handlungsprodukt}
Taetigkeit: ${anchor.kompetenz}
Inhalte: ${anchor.inhalte}`;
    })
    .join("\n\n");

  return `Schreibe passende Einstiegsszenarien fuer die Lernsituationen.

Kontext ist FEST und darf nicht ausgetauscht werden:
- Betrieb/Einrichtung: ${context.betrieb}
- Ort: ${context.ort}
- Branche: ${context.branche}
- Hauptperson: ${context.hauptperson} (${context.rolle})
- Adressat/Kunde: ${context.kundeOderAdressat}
- Leitauftrag: ${context.leitauftrag}
- Roter Faden: ${context.roterFaden}

Beruf: ${document.meta.beruf || "-"}
Fach: ${document.meta.fach || "-"}
Lernfeld: ${document.meta.lernfeld || "-"}
${examplePromptBlock(exampleContext)}

Regeln:
1. Schreibe pro LS 5-6 vollstaendige Saetze in der Gegenwartsform.
2. Jeder Einstieg hat 110-150 Woerter.
3. Jede Situation ist eine didaktische Handlungssituation: berufliche Ausgangslage, konkretes Problem, Handlungsdruck und offene Entscheidung.
4. Jeder Einstieg fuehrt konkret zum jeweiligen Handlungsprodukt, ohne die Loesung vorwegzunehmen.
5. Jeder Einstieg greift die angegebene Taetigkeit und mindestens einen Inhaltsbegriff der LS auf.
6. LS 1 startet den Auftrag. Jede weitere LS nennt ein konkretes Ergebnis aus der vorherigen LS.
7. Der letzte Satz ist ein konkreter Arbeitsauftrag an die Lernenden.
8. Keine branchenfremden Elemente einfuehren. Keine IT-Beispiele, wenn Beruf/Inhalte keine IT verlangen.
9. Keine Meta-Sprache wie "in dieser Lernsituation", keine Tabellen, keine Erklaerungen.
10. Behalte die IDs exakt bei.

Lernsituationen:
${situationList}

Antworte NUR mit diesem JSON, kein Markdown:
{
  "scenarios": [
    {"id": "LS X.X", "einstieg": "5-6 Saetze, 110-150 Woerter, letzter Satz ist ein Arbeitsauftrag..."}
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

function normalizeKiMapping(entry, situation) {
  return {
    summary:
      normalizeKiSummary(entry?.summary) ||
      fallbackKiMappingSummary(situation) ||
      "Der fachliche KI- oder Medienkompetenzbezug sollte anhand der Lernsituation geprueft und begruendet werden.",
    grundlagen: toCategoryBoolean(entry?.grundlagen),
    anwendung: toCategoryBoolean(entry?.anwendung),
    entwicklung: toCategoryBoolean(entry?.entwicklung),
    gesellschaftRecht: toCategoryBoolean(entry?.gesellschaftRecht)
  };
}

function normalizeKiSummary(value) {
  const text = cleanShortText(value, 280);
  if (!text || countWords(text) < 6) return "";
  return text;
}

function fallbackKiMappingSummary(situation) {
  if (!situation) return "";

  const competence = cleanShortText(situation.kompetenzen?.[0]?.text, 120);
  const product = cleanShortText(situation.handlungsprodukt, 90);
  const content = cleanShortText(situation.inhalte, 110);

  if (competence || product || content) {
    return cleanShortText(
      `Die Lernenden bearbeiten ${product || "ein fachliches Handlungsprodukt"} und nutzen dafuer ${competence || content || "passende Fachinhalte"} als Grundlage der Zuordnung.`,
      280
    );
  }

  return "";
}

function toCategoryBoolean(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "number") return value > 0;

  const text = String(value).trim().toLowerCase();
  if (!text) return false;
  if (["true", "ja", "yes", "x", "1", "zutreffend"].includes(text)) return true;
  if (["false", "nein", "no", "-", "0", "nicht zutreffend"].includes(text)) return false;

  return false;
}

async function repairScenarioSetIfNeeded(
  document,
  context,
  exampleContext,
  scenarios,
  settings = {}
) {
  const issues = scenarioQualityIssues(document, scenarios);
  if (!issues.length) return scenarios;

  console.warn(`[ScenarioQuality] Reparatur fuer ${issues.length} Szenario(s): ${issues.join("; ")}`);
  reportProgress(settings, "Szenarien werden nachgeschaerft.");

  try {
    const responseText = await generateWithOllama(
      buildScenarioRepairPrompt(document, context, exampleContext, scenarios, issues),
      {
        format: "json",
        model: settings.model,
        system: STORY_SYSTEM_PROMPT,
        temperature: 0.28,
        repeatPenalty: 1.08,
        numCtx: 8192,
        numPredict: scenarioPredictionBudget(document)
      }
    );

    const repaired = parseScenarioResponse(responseText, document.lernsituationen.length);
    return repaired || scenarios;
  } catch (error) {
    console.warn("[ScenarioQuality] Reparatur fehlgeschlagen:", error.message);
    return scenarios;
  }
}

function buildScenarioRepairPrompt(document, context, exampleContext, scenarios, issues) {
  const anchors = document.lernsituationen
    .map((ls, index) => {
      const anchor = compactScenarioAnchor(ls);
      const current = scenarios[index]?.einstieg || "";
      return `${index + 1}. ${ls.id}
Produkt: ${anchor.handlungsprodukt}
Taetigkeit: ${anchor.kompetenz}
Inhalte: ${anchor.inhalte}
Aktueller Einstieg: ${truncateText(current, 520)}`;
    })
    .join("\n\n");

  return `Ueberarbeite die Einstiegsszenarien didaktisch.

Kontext:
- Betrieb/Einrichtung: ${context.betrieb}, ${context.ort}
- Hauptperson: ${context.hauptperson} (${context.rolle})
- Adressat/Kunde: ${context.kundeOderAdressat}
- Leitauftrag: ${context.leitauftrag}
${examplePromptBlock(exampleContext)}

Festgestellte Maengel:
${issues.map((issue) => `- ${issue}`).join("\n")}

Qualitaetsziel:
- Jede LS: 5-6 Saetze, 110-150 Woerter.
- Berufliche Ausgangslage, konkretes Problem, Handlungsdruck, offene Entscheidung.
- Bezug zu Produkt, Taetigkeit und Inhalten.
- Keine Loesung vorwegnehmen.
- Letzter Satz ist ein konkreter Arbeitsauftrag an die Lernenden.
- IDs exakt beibehalten.

Material:
${anchors}

Antworte NUR mit JSON:
{
  "scenarios": [
    {"id": "LS X.X", "einstieg": "ueberarbeiteter Einstieg..."}
  ]
}`;
}

function examplePromptBlock(exampleContext = "") {
  const text = String(exampleContext || "").trim();
  return text ? `\n\n${text}\n` : "";
}

function combineExampleContexts(...contexts) {
  return contexts.map((context) => String(context || "").trim()).filter(Boolean).join("\n\n");
}

function scenarioQualityIssues(document, scenarios) {
  const issues = [];

  document.lernsituationen.forEach((ls, index) => {
    const scenario = scenarios[index]?.einstieg || "";
    const wordCount = countWords(scenario);
    const lower = scenario.toLowerCase();
    const anchor = compactScenarioAnchor(ls);

    if (wordCount < 95) {
      issues.push(`${ls.id}: zu kurz (${wordCount} Woerter)`);
    }

    if (!hasWorkAssignment(scenario)) {
      issues.push(`${ls.id}: kein klarer Arbeitsauftrag am Ende`);
    }

    if (!containsAnyTerm(lower, anchor.inhalte)) {
      issues.push(`${ls.id}: Inhaltsanker fehlt`);
    }

    if (!containsAnyTerm(lower, anchor.kompetenz)) {
      issues.push(`${ls.id}: Kompetenz-Taetigkeit fehlt`);
    }
  });

  return issues.slice(0, 10);
}

function normalizeStoryContext(value, document) {
  const fallback = fallbackStoryContext(document);
  const legacyPeople = Array.isArray(value?.hauptpersonen)
    ? value.hauptpersonen.map((person) => {
        if (typeof person === "string") return cleanShortText(person);
        const name = cleanShortText(person?.name);
        const role = cleanShortText(person?.rolle);
        return [name, role].filter(Boolean).join(" - ");
      })
    : [];
  const legacyPerson = legacyPeople.filter(Boolean)[0] || "";

  return {
    betrieb: cleanShortText(value?.betrieb) || fallback.betrieb,
    ort: cleanShortText(value?.ort) || fallback.ort,
    branche: cleanShortText(value?.branche) || fallback.branche,
    hauptperson:
      cleanShortText(value?.hauptperson) ||
      splitLegacyPerson(legacyPerson).name ||
      fallback.hauptperson,
    rolle:
      cleanShortText(value?.rolle) ||
      splitLegacyPerson(legacyPerson).role ||
      fallback.rolle,
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
    hauptperson: "Mara Schneider",
    rolle: "Ausbilderin",
    kundeOderAdressat: "interner Auftraggeber",
    leitauftrag: `Ein praxisnaher Auftrag zu ${lernfeld}`,
    roterFaden:
      "Die Lernsituationen bauen fachlich aufeinander auf und fuehren Schritt fuer Schritt zum Handlungsprodukt."
  };
}

function formatCompetences(ls) {
  if (!ls.kompetenzen?.length) return "-";
  return ls.kompetenzen
    .map((competence) => `- ${formatCompetenceForPrompt(competence)}`)
    .join("\n");
}

function formatCompetenceForPrompt(competence) {
  const segments = Array.isArray(competence?.segments) && competence.segments.length
    ? competence.segments
    : [{ text: competence?.text || "", tag: null }];
  const text = segments
    .map((segment) => {
      const tag = String(segment?.tag || "").toUpperCase();
      return ["AK", "IG", "MK"].includes(tag)
        ? `<${tag}>${segment.text}</${tag}>`
        : segment.text;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  if (text) return text;

  const tags = competence?.tags?.length ? `[${competence.tags.join("][")}] ` : "";
  return `${tags}${competence?.text || ""}`.trim();
}

function compactSituationAnchor(ls) {
  return {
    handlungsprodukt: truncateText(ls.handlungsprodukt || "Handlungsprodukt klaeren", 90),
    inhalte: truncateText(ls.inhalte || firstCompetenceText(ls) || "fachliche Grundlagen", 90)
  };
}

function compactScenarioAnchor(ls) {
  return {
    handlungsprodukt: truncateText(ls.handlungsprodukt || "Handlungsprodukt klaeren", 130),
    kompetenz: truncateText(firstCompetenceText(ls) || "fachliche Aufgabe bearbeiten", 120),
    inhalte: truncateText(extractContentKeywords(ls.inhalte), 150)
  };
}

function firstCompetenceText(ls) {
  return ls.kompetenzen?.find((competence) => competence?.text)?.text || "";
}

function extractContentKeywords(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "passende Fachinhalte";

  const parts = text
    .split(/[,;.\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 5);

  return parts.length ? parts.join(", ") : text;
}

function scenarioPredictionBudget(document) {
  return Math.min(6000, Math.max(2600, document.lernsituationen.length * 950));
}

function scenarioMode(settings = {}) {
  return String(settings.scenarioMode || process.env.SCENARIO_MODE || "batch")
    .trim()
    .toLowerCase();
}

function summarizeScenarioOutcome(situation) {
  const text = situation.einstieg || situation.handlungsprodukt || "";
  const firstSentence = String(text).split(/[.!?]/)[0]?.trim() || "";
  return truncateText(firstSentence || situation.handlungsprodukt || situation.id, 180);
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text || "-";
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function countWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hasWorkAssignment(value) {
  const sentences = String(value || "")
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter(Boolean);
  const last = sentences.at(-1) || "";

  return /\b(erstellen|entwickeln|pruefen|bewerten|analysieren|vergleichen|dokumentieren|planen|bearbeiten|formulieren|entscheiden|erarbeiten|recherchieren)\b/.test(last);
}

function containsAnyTerm(text, source) {
  const terms = String(source || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 5)
    .slice(0, 8);

  if (!terms.length) return true;
  return terms.some((term) => text.includes(term));
}

function splitLegacyPerson(value) {
  const [name = "", role = ""] = String(value || "").split(/\s+-\s+/, 2);
  return {
    name: cleanShortText(name),
    role: cleanShortText(role)
  };
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
  try {
    return extractJsonArray(parseJsonValue(raw, "any"));
  } catch {
    return [];
  }
}

function extractJsonArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.mappings)) return parsed.mappings;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.result)) return parsed.result;
  if (Array.isArray(parsed?.scenarios)) return parsed.scenarios;

  const firstArray = Object.values(parsed || {}).find((value) => Array.isArray(value));
  return firstArray || [];
}

function parseJsonResponse(value) {
  try {
    return parseJsonValue(value, "object");
  } catch (error) {
    throw new Error(
      `Ollama hat kein gueltiges JSON zurueckgegeben (${error.message}).`
    );
  }
}

function parseJsonValue(value, preferred = "object") {
  const cleaned = cleanJsonString(value);
  const candidates = uniqueJsonCandidates([
    cleaned,
    ...extractBalancedJsonCandidates(cleaned, preferred),
    ...extractBalancedJsonCandidates(cleaned, preferred === "array" ? "object" : "array")
  ]);

  for (const candidate of candidates) {
    for (const variant of uniqueJsonCandidates([candidate, repairJsonString(candidate)])) {
      try {
        return JSON.parse(variant);
      } catch (error) {
        // Die naechste Reparatur-/Extraktionsvariante wird versucht.
      }
    }
  }

  throw new Error(buildJsonParseHint(cleaned));
}

function extractBalancedJsonCandidates(value, preferred = "object") {
  const text = String(value || "");
  const openChars =
    preferred === "array" ? ["["] : preferred === "object" ? ["{"] : ["{", "["];
  const candidates = [];

  for (let index = 0; index < text.length; index += 1) {
    if (!openChars.includes(text[index])) continue;
    const slice = balancedJsonSlice(text, index);
    if (slice) candidates.push(slice);
  }

  return candidates;
}

function balancedJsonSlice(text, startIndex) {
  const open = text[startIndex];
  const close = open === "{" ? "}" : "]";
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char !== "}" && char !== "]") continue;

    const expectedOpen = char === "}" ? "{" : "[";
    if (stack.at(-1) !== expectedOpen) return "";
    stack.pop();

    if (!stack.length && char === close) {
      return text.slice(startIndex, index + 1);
    }
  }

  return "";
}

function uniqueJsonCandidates(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function repairJsonString(value) {
  return String(value || "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/}\s*(?={)/g, "},{")
    .replace(/]\s*(?=\[)/g, "],[")
    .replace(/("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?|[}\]])\s*(?="[^"]+"\s*:)/g, "$1,");
}

function buildJsonParseHint(value) {
  const preview = String(value || "").slice(0, 220).replace(/\s+/g, " ");
  return `Antwort beginnt mit: ${preview}`;
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

function reportProgress(settings = {}, message, data = {}) {
  if (typeof settings.onProgress !== "function") return;

  try {
    settings.onProgress(message, data);
  } catch (error) {
    console.warn("[Progress] Fortschritt konnte nicht gesendet werden:", error.message);
  }
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

export const __contentOptimizerInternals = Object.freeze({
  parseJsonArray,
  parseJsonResponse,
  repairJsonString,
  scenarioQualityIssues
});
