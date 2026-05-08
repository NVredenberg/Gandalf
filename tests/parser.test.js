import assert from "node:assert/strict";
import test from "node:test";

import { parseTemplateTablesFromXml } from "../backend/parser/docxTableParser.js";
import { parseMarkdownText } from "../backend/parser/markdownParser.js";
import { extractTagsFromText, normalizeAiDocument, TAG_COLORS } from "../backend/parser/schema.js";
import { structure } from "../backend/renderer/structure.js";

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
