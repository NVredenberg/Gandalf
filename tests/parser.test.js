import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { cleanUploadsDir } from "../backend/uploadCleanup.js";
import { loadExampleContext, __exampleLoaderInternals } from "../backend/ai/exampleLoader.js";
import {
  buildSituationText,
  cosineSimilarity,
  createRagStore
} from "../backend/ai/ragStore.js";
import { parseTemplateTablesFromXml } from "../backend/parser/docxTableParser.js";
import { parseMarkdownText } from "../backend/parser/markdownParser.js";
import { extractTagsFromText, normalizeAiDocument, TAG_COLORS } from "../backend/parser/schema.js";
import { structure } from "../backend/renderer/structure.js";
import { fallbackKiMapping, splitMethodSections } from "../backend/renderer/rendererHeuristics.js";
import { __contentOptimizerInternals } from "../backend/ai/contentOptimizer.js";

test("Markdown wird in das verbindliche JSON normalisiert", () => {
  const document = parseMarkdownText(`
Beruf: Fachinformatiker/in
Fach: Anwendungsentwicklung
Lernfeld: LF 5

## LS 5.1
### Einstiegsszenario
Eine Kundin benötigt eine lokale Anwendung.
### Handlungsprodukt
Prototyp
### Kompetenzen
- [AK][IG] Anforderungen auswerten
- [MK] Vorgehen dokumentieren
### Inhalte
Lastenheft
### Methoden
Gruppenarbeit
`);

  assert.equal(document.meta.beruf, "Fachinformatiker/in");
  assert.equal(document.meta.anzahl_ls, 1);
  assert.equal(document.lernsituationen[0].id, "LS 5.1");
  assert.deepEqual(document.lernsituationen[0].kompetenzen[0].tags, ["AK", "IG"]);
});

test("Parser erkennt Word-aehnliche Absaetze ohne Markdown-Hashes", () => {
  const document = parseMarkdownText(`
Beruf: Kaufmann/Kauffrau fuer Bueromanagement
Fach: Geschaeftsprozesse
Lernfeld: LF 5 Kundenauftraege bearbeiten

Lernsituation 5.1 - Anfrage bearbeiten

Einstiegsszenario:
Die BueroTec GmbH erhaelt eine Kundenanfrage.

Handlungsprodukt
Angebotsvergleich

Kompetenzen
[AK][IG] Kundenanfrage auswerten
[MK] Kriterien fuer den Angebotsvergleich festlegen

Inhalte - Anfrage, Lieferbedingungen, Bezugskalkulation

Methoden
Partnerarbeit

LS 5.2
Einstieg: Der Kunde bestellt die ausgewaehlten Produkte.
Handlungsprodukt: Auftragsbestaetigung
Kompetenzen:
- [AK] Auftrag pruefen
Inhalte: Kaufvertrag
Methoden: Fallarbeit
`);

  assert.equal(document.meta.anzahl_ls, 2);
  assert.equal(document.lernsituationen[0].id, "LS 5.1");
  assert.equal(document.lernsituationen[0].einstieg, "Die BueroTec GmbH erhaelt eine Kundenanfrage.");
  assert.equal(document.lernsituationen[0].handlungsprodukt, "Angebotsvergleich");
  assert.equal(document.lernsituationen[0].inhalte, "Anfrage, Lieferbedingungen, Bezugskalkulation");
  assert.equal(document.lernsituationen[1].einstieg, "Der Kunde bestellt die ausgewaehlten Produkte.");
  assert.equal(document.lernsituationen[1].kompetenzen[0].text, "Auftrag pruefen");
});

test("DOCX-Tabellenparser mappt das 6-Zeilen-Template auf das interne JSON", () => {
  const xml = `
<w:document><w:body><w:tbl>
  <w:tr><w:tc>
    <w:p><w:r><w:t>Nr. Ausbildungsjahr</w:t></w:r></w:p>
    <w:p><w:r><w:t>Buendelungsfach: Geschaeftsprozesse</w:t></w:r></w:p>
    <w:p><w:r><w:t>Lernfeld Nr.: LF 5 Kundenauftraege bearbeiten (80 UStd.)</w:t></w:r></w:p>
    <w:p><w:r><w:t>Lernsituation Nr.: 5.1 Anfrage bearbeiten (10 UStd.)</w:t></w:r></w:p>
  </w:tc></w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>Einstiegsszenario</w:t></w:r></w:p><w:p><w:r><w:t>Die BueroTec GmbH erhaelt eine Anfrage.</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>Handlungsprodukt/Lernergebnis</w:t></w:r></w:p><w:p><w:r><w:t>Angebotsvergleich</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>Wesentliche Kompetenzen</w:t></w:r></w:p><w:p><w:r><w:t>[AK][IG] Kundenanfrage auswerten</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>Konkretisierung der Inhalte</w:t></w:r></w:p><w:p><w:r><w:t>Anfrage, Lieferbedingungen</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>Lern- und Arbeitstechniken</w:t></w:r></w:p><w:p><w:r><w:t>Partnerarbeit</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>Unterrichtsmaterialien/Fundstelle</w:t></w:r></w:p><w:p><w:r><w:t>Arbeitsblatt A1</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>Organisatorische Hinweise</w:t></w:r></w:p><w:p><w:r><w:t>PC-Raum buchen</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl></w:body></w:document>`;
  const headers = ["<w:hdr><w:p><w:r><w:t>Kaufmann/Kauffrau fuer Bueromanagement</w:t></w:r></w:p></w:hdr>"];
  const document = parseTemplateTablesFromXml(xml, headers);

  assert.equal(document.meta.beruf, "Kaufmann/Kauffrau fuer Bueromanagement");
  assert.equal(document.meta.anzahl_ls, 1);
  assert.equal(document.lernsituationen[0].id, "LS 5.1");
  assert.equal(document.lernsituationen[0].handlungsprodukt, "Angebotsvergleich");
  assert.deepEqual(document.lernsituationen[0].kompetenzen[0].tags, ["AK", "IG"]);
  assert.match(document.lernsituationen[0].methoden, /Arbeitsblatt A1/);
});

test("Renderer-Struktur bleibt exakt festgelegt", () => {
  assert.deepEqual(structure, [
    "Kopfbereich",
    "Einstiegsszenario / Handlungsprodukt",
    "Wesentliche Kompetenzen / Konkretisierung der Inhalte",
    "Lern- und Arbeitstechniken",
    "Unterrichtsmaterialien / Fundstelle",
    "Organisatorische Hinweise"
  ]);
});

test("Kompetenzfarben entsprechen der Vorgabe", () => {
  assert.equal(TAG_COLORS.AK, "3498DB");
  assert.equal(TAG_COLORS.IG, "2ECC71");
  assert.equal(TAG_COLORS.MK, "E67E22");
  assert.equal(TAG_COLORS.NONE, "404040");
});

test("Inline-Tags markieren nur digitale Schluesselkompetenz-Segmente", () => {
  const extracted = extractTagsFromText(
    "Ermitteln Anforderungen und nutzen <MK>seriöse Online-quellen</MK> zur Validierung."
  );

  assert.equal(
    extracted.text,
    "Ermitteln Anforderungen und nutzen seriöse Online-quellen zur Validierung."
  );
  assert.deepEqual(extracted.tags, ["MK"]);
  assert.deepEqual(extracted.segments, [
    { text: "Ermitteln Anforderungen und nutzen ", tag: null },
    { text: "seriöse Online-quellen", tag: "MK" },
    { text: " zur Validierung.", tag: null }
  ]);
});

test("KI-Normalisierung darf LS-Anzahl und IDs nicht verändern", () => {
  const original = parseMarkdownText(`
Lernfeld: LF 5

## LS 5.1
### Einstiegsszenario
Alt
### Kompetenzen
- [AK] Altkompetenz
`);

  const aiCandidate = {
    meta: { lernfeld: "Von KI geändert" },
    lernsituationen: [
      {
        id: "LS 9.9",
        einstieg: "Optimiert",
        kompetenzen: [{ text: "Neue Kompetenz", tags: ["MK"] }],
        inhalte: "",
        methoden: ""
      },
      {
        id: "LS 9.10",
        einstieg: "Darf nicht ergänzt werden"
      }
    ]
  };

  const normalized = normalizeAiDocument(original, aiCandidate);

  assert.equal(normalized.meta.lernfeld, "LF 5");
  assert.equal(normalized.lernsituationen.length, 1);
  assert.equal(normalized.lernsituationen[0].id, "LS 5.1");
  assert.equal(normalized.lernsituationen[0].einstieg, "Optimiert");
});

test("Kompetenz-Tags werden aus Text erkannt und nach KI-Pruefung erhalten", () => {
  const extracted = extractTagsFromText("AK: Anwendungskompetenz beim Einsatz digitaler Werkzeuge");
  assert.deepEqual(extracted.tags, ["AK"]);

  const original = {
    meta: { lernfeld: "LF 5" },
    lernsituationen: [
      {
        id: "LS 5.1",
        kompetenzen: [{ text: "Daten modellieren", tags: ["IG"] }]
      },
      {
        id: "LS 5.2",
        kompetenzen: [{ text: "Mediengestuetzt praesentieren", tags: ["MK"] }]
      }
    ]
  };
  const aiCandidate = {
    meta: { lernfeld: "LF 5" },
    lernsituationen: [
      {
        id: "LS 5.1",
        kompetenzen: [{ text: "Daten modellieren", tags: [] }]
      },
      {
        id: "LS 5.2",
        kompetenzen: [{ text: "Mediengestuetzt praesentieren", tags: [] }]
      }
    ]
  };

  const normalized = normalizeAiDocument(original, aiCandidate);
  assert.deepEqual(normalized.lernsituationen[0].kompetenzen[0].tags, ["IG"]);
  assert.deepEqual(normalized.lernsituationen[1].kompetenzen[0].tags, ["MK"]);
});

test("Inline-Markierungen bleiben erhalten, wenn die KI sie nicht zurueckgibt", () => {
  const original = {
    meta: { lernfeld: "LF 5" },
    lernsituationen: [
      {
        id: "LS 5.1",
        kompetenzen: [
          "Anforderungen dokumentieren und <MK>Informationen mit Online-quellen validieren</MK>."
        ]
      }
    ]
  };
  const aiCandidate = {
    meta: { lernfeld: "LF 5" },
    lernsituationen: [
      {
        id: "LS 5.1",
        kompetenzen: [{ text: "Anforderungen dokumentieren und Informationen validieren.", tags: [] }]
      }
    ]
  };

  const normalized = normalizeAiDocument(original, aiCandidate);
  assert.deepEqual(normalized.lernsituationen[0].kompetenzen[0].segments, [
    { text: "Anforderungen dokumentieren und ", tag: null },
    { text: "Informationen mit Online-quellen validieren", tag: "MK" },
    { text: ".", tag: null }
  ]);
});

test("KI-JSON-Parser repariert fehlende Kommas in Modellantworten", () => {
  const mappings = __contentOptimizerInternals.parseJsonArray(`{
    "mappings": [
      {
        "id": "LS 5.1",
        "summary": "Die Lernenden pruefen KI-gestuetzte Rechercheergebnisse und begruenden passende Kriterien fuer das Handlungsprodukt."
        "grundlagen": false,
        "anwendung": true,
        "entwicklung": false,
        "gesellschaftRecht": true
      }
    ]
  }`);

  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].id, "LS 5.1");
  assert.equal(mappings[0].anwendung, true);
  assert.equal(mappings[0].gesellschaftRecht, true);
});

test("KI-JSON-Parser extrahiert JSON trotz Zusatztext", () => {
  const parsed = __contentOptimizerInternals.parseJsonResponse(`
Hier ist das Ergebnis:
{
  "scenarios": [
    {
      "id": "LS 5.1",
      "einstieg": "Die Auszubildenden erhalten einen Auftrag."
    }
  ]
}
`);

  assert.equal(parsed.scenarios[0].id, "LS 5.1");
});

test("Scenario-Qualitaetspruefung erkennt fehlende Anker und Arbeitsauftrag", () => {
  const issues = __contentOptimizerInternals.scenarioQualityIssues(
    {
      lernsituationen: [
        {
          id: "LS 5.1",
          handlungsprodukt: "Beschwerdeantwort",
          kompetenzen: [{ text: "Kundenanliegen analysieren und bewerten" }],
          inhalte: "Reklamation, Gewaehrleistung, Fristen",
          methoden: "",
          einstieg: ""
        }
      ]
    },
    [{ id: "LS 5.1", einstieg: "Ein Kunde ruft im Betrieb an." }]
  );

  assert.ok(issues.some((issue) => issue.includes("zu kurz")));
  assert.ok(issues.some((issue) => issue.includes("kein klarer Arbeitsauftrag")));
  assert.ok(issues.some((issue) => issue.includes("Inhaltsanker fehlt")));
  assert.ok(issues.some((issue) => issue.includes("Kompetenz-Taetigkeit fehlt")));
});

test("Renderer trennt Methoden, Materialien und organisatorische Hinweise", () => {
  const sections = splitMethodSections(`
Partnerarbeit
Unterrichtsmaterialien / Fundstelle: Arbeitsblatt A1
Online-Quelle
Organisatorische Hinweise: PC-Raum buchen
Gruppen vorher einteilen
`);

  assert.equal(sections.methoden, "Partnerarbeit");
  assert.equal(sections.materialien, "Arbeitsblatt A1\nOnline-Quelle");
  assert.equal(sections.organisation, "PC-Raum buchen\nGruppen vorher einteilen");
});

test("Renderer-Fallback fuer KI-Zuordnung erkennt KI-Anwendung und Recht", () => {
  const mapping = fallbackKiMapping({
    id: "LS 5.1",
    einstieg: "Die Lernenden pruefen ChatGPT-Antworten zu Kundendaten.",
    handlungsprodukt: "Datenschutzbewertung",
    kompetenzen: [{ text: "KI-Werkzeuge nutzen und Ergebnisse bewerten" }],
    inhalte: "Datenschutz, Quellenkritik",
    methoden: ""
  });

  assert.equal(mapping.anwendung, true);
  assert.equal(mapping.gesellschaftRecht, true);
  assert.match(mapping.summary, /Lernenden/);
});

test("Upload-Cleanup loescht nur ungeschuetzte Upload-Dateien", async () => {
  const uploadDir = path.join(process.cwd(), "data", `uploads-cleanup-test-${Date.now()}`);

  await fs.mkdir(uploadDir, { recursive: true });
  try {
    await Promise.all([
      fs.writeFile(path.join(uploadDir, ".gitkeep"), "", "utf8"),
      fs.writeFile(path.join(uploadDir, "frontend-preview.err.log"), "err", "utf8"),
      fs.writeFile(path.join(uploadDir, "frontend-preview.out.log"), "out", "utf8"),
      fs.writeFile(path.join(uploadDir, "upload.docx"), "docx", "utf8"),
      fs.writeFile(path.join(uploadDir, "parsed.json"), "{}", "utf8")
    ]);

    const result = await cleanUploadsDir(uploadDir);
    const entries = (await fs.readdir(uploadDir)).sort();

    assert.deepEqual(entries, [
      ".gitkeep",
      "frontend-preview.err.log",
      "frontend-preview.out.log"
    ]);
    assert.deepEqual(result.deleted.sort(), ["parsed.json", "upload.docx"]);
  } finally {
    await fs.rm(uploadDir, { recursive: true, force: true });
  }
});

test("Beispiel-Loader findet beruflich passende Markdown-Beispiele", async () => {
  const context = await loadExampleContext({
    meta: { beruf: "Kaufmann/Kauffrau fuer Bueromanagement" },
    lernsituationen: []
  });

  assert.match(context, /Orientierungsbeispiele/);
  assert.match(context, /Kundenauftraege bearbeiten/);
  assert.match(context, /Bueromanagement/);
});

test("Beispiel-Loader normalisiert Berufsbezeichnungen fuer Pfad-Matching", () => {
  assert.equal(
    __exampleLoaderInternals.slugify("Kaufmann/Kauffrau fuer Bueromanagement"),
    "kaufmann-kauffrau-fuer-bueromanagement"
  );
});

test("RAG-Store speichert und findet aehnliche Lernsituationen", async () => {
  const dbPath = path.join(process.cwd(), "data", `rag-test-${Date.now()}.db`);
  const store = createRagStore({ dbPath });

  try {
    await store.indexSituation(
      {
        id: "LS 5.1",
        einstieg: "Eine Kundin fragt ein Angebot an.",
        handlungsprodukt: "Angebotsvergleich",
        kompetenzen: [{ text: "Kundenanfragen auswerten" }],
        inhalte: "Anfrage, Angebot, Lieferbedingungen",
        methoden: "Partnerarbeit"
      },
      {
        meta: { beruf: "Kaufmann/Kauffrau fuer Bueromanagement" },
        embedding: [1, 0, 0],
        approved: true
      }
    );

    await store.indexSituation(
      {
        id: "LS 9.1",
        einstieg: "Ein Netzwerk wird geplant.",
        handlungsprodukt: "Netzwerkplan",
        kompetenzen: [{ text: "Netzwerke modellieren" }],
        inhalte: "Subnetting, Router",
        methoden: "Gruppenarbeit"
      },
      {
        meta: { beruf: "Fachinformatiker/in" },
        embedding: [0, 1, 0]
      }
    );

    const matches = await store.retrieveSimilar([0.9, 0.1, 0], 1, {
      beruf: "Kaufmann/Kauffrau fuer Bueromanagement"
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0].situation_id, "LS 5.1");
    assert.equal(matches[0].approved, 1);
    assert.equal(matches[0].situation.handlungsprodukt, "Angebotsvergleich");

    const status = await store.getStatus();
    assert.equal(status.total, 2);
    assert.equal(status.approved, 1);
    assert.equal(status.recent.length, 2);

    const reset = await store.reset();
    assert.equal(reset.deleted, 2);
    assert.equal((await store.getStatus()).total, 0);
  } finally {
    store.close();
    await fs.rm(dbPath, { force: true });
  }
});

test("RAG-Hilfsfunktionen berechnen Situationstext und Kosinus-Aehnlichkeit", () => {
  const text = buildSituationText(
    {
      id: "LS 1",
      handlungsprodukt: "Produkt",
      kompetenzen: [{ text: "Kompetenz" }],
      inhalte: "Inhalt"
    },
    { beruf: "Beruf", fach: "Fach", lernfeld: "LF 1" }
  );

  assert.match(text, /Beruf: Beruf/);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});
