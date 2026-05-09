import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";

import { normalizeLearningDocument, TAG_COLORS } from "../parser/schema.js";
import { generateKiMappingsForTable } from "../ai/contentOptimizer.js";

const COLORS = Object.freeze({
  blue: "1F3864",
  blueDark: "17365D",
  text: "2C2C2C",
  border: "B7C9E2",
  muted: "666666",
  white: "FFFFFF"
});

const TABLE_WIDTH = 100;
const LEFT_WIDTH = 50;
const RIGHT_WIDTH = 50;
const KI_MAPPING_WIDTHS = [12, 38, 12, 12, 13, 13];

export async function renderLearningDocument(input, settings = {}) {
  const document = normalizeLearningDocument(input);

  // KI-Zusammenfassungen für die Zuordnungstabelle vorab generieren
  const kiMappings = await generateKiMappingsForTable(document.lernsituationen, settings);

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "competence-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 360, hanging: 180 }
                }
              }
            }
          ]
        }
      ]
    },
    styles: {
      default: {
        document: {
          run: {
            font: "Aptos",
            size: 21,
            color: COLORS.text
          },
          paragraph: {
            spacing: { after: 100 }
          }
        }
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: 34,
            bold: true,
            color: COLORS.blue
          },
          paragraph: {
            spacing: { before: 160, after: 100 }
          }
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: 28,
            bold: true,
            color: COLORS.blue
          },
          paragraph: {
            spacing: { before: 260, after: 120 }
          }
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: 24,
            bold: true,
            color: COLORS.blue
          },
          paragraph: {
            spacing: { before: 220, after: 80 }
          }
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 900,
              right: 900,
              bottom: 900,
              left: 900
            }
          }
        },
        children: [
          new Paragraph({
            text: `Didaktische Jahresplanung - ${document.meta.lernfeld || "Lernfeld"}`,
            heading: HeadingLevel.HEADING_1
          }),
          renderMetaLine(document),
          spacer(80),
          ...document.lernsituationen.flatMap((situation, index) => [
            new Paragraph({
              text: formatSituationHeading(situation, index),
              heading: HeadingLevel.HEADING_3
            }),
            renderLearningSituationTable(document, situation, index),
            spacer(120)
          ]),
          new Paragraph({
            text: "KI-Zuordnung",
            heading: HeadingLevel.HEADING_2
          }),
          renderKiMappingTable(document, kiMappings)
        ]
      }
    ]
  });

  return Packer.toBuffer(doc);
}

function renderMetaLine(document) {
  return new Paragraph({
    spacing: { after: 180 },
    children: [
      labelRun("Beruf: "),
      valueRun(document.meta.beruf || "-"),
      valueRun("    "),
      labelRun("Fach: "),
      valueRun(document.meta.fach || "-"),
      valueRun("    "),
      labelRun("LF: "),
      valueRun(document.meta.lernfeld || "-"),
      valueRun("    "),
      labelRun("Ausbildungsjahr: "),
      valueRun(extractTrainingYear(document.meta.lernfeld) || "-")
    ]
  });
}

function renderLearningSituationTable(document, situation, index) {
  const sections = splitMethodSections(situation.methoden);

  return new Table({
    width: {
      size: TABLE_WIDTH,
      type: WidthType.PERCENTAGE
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            shading: cellShading(COLORS.blue),
            margins: cellMargins(),
            borders: tableBorders(),
            children: [
              new Paragraph({
                children: [
                  headerRun("Beruf: "),
                  headerValueRun(document.meta.beruf || "-"),
                  headerValueRun(" | "),
                  headerRun("Fach: "),
                  headerValueRun(document.meta.fach || "-"),
                  headerValueRun(" | "),
                  headerRun("Lernfeld: "),
                  headerValueRun(document.meta.lernfeld || "-")
                ]
              }),
              new Paragraph({
                children: [
                  headerRun(`${situation.id}: `),
                  headerValueRun(deriveSituationTitle(situation)),
                  headerValueRun(formatBlockInfo(index))
                ]
              })
            ]
          })
        ]
      }),
      new TableRow({
        children: [
          contentCell([
            headingParagraph("Einstiegsszenario"),
            ...textParagraphs(situation.einstieg)
          ]),
          contentCell([
            headingParagraph("Handlungsprodukt / Lernergebnis"),
            ...textParagraphs(situation.handlungsprodukt, { bold: true })
          ])
        ]
      }),
      new TableRow({
        children: [
          contentCell([
            headingParagraph("Wesentliche Kompetenzen"),
            ...renderCompetences(situation.kompetenzen)
          ]),
          contentCell([
            headingParagraph("Konkretisierung der Inhalte"),
            ...textParagraphs(situation.inhalte)
          ])
        ]
      }),
      fullWidthRow([
        headingParagraph("Lern- und Arbeitstechniken / Individuelle Foerderung / Selbstgesteuertes Lernen"),
        ...textParagraphs(sections.methoden)
      ]),
      fullWidthRow([
        headingParagraph("Unterrichtsmaterialien / Fundstelle"),
        ...textParagraphs(sections.materialien)
      ]),
      fullWidthRow([
        headingParagraph("Organisatorische Hinweise"),
        ...textParagraphs(sections.organisation)
      ])
    ]
  });
}

/**
 * KI-Zuordnungstabelle.
 * @param {object} document
 * @param {Record<string, object>} kiMappings Map von LS-ID zu KI-Zuordnung
 */
function renderKiMappingTable(document, kiMappings = {}) {
  const rows = [
    tableHeaderRow([
      "Lernsituation",
      "KI-Kompetenz (Kurzfassung)",
      "KI-Grundlagen",
      "KI-Anwendung",
      "KI-Entwicklung",
      "Gesellschaft & Recht"
    ], KI_MAPPING_WIDTHS)
  ];

  for (const situation of document.lernsituationen) {
    const mapping = {
      ...fallbackKiMapping(situation),
      ...(kiMappings[situation.id] || {})
    };

    rows.push(
      new TableRow({
        children: [
          smallCell(situation.id, KI_MAPPING_WIDTHS[0]),
          smallCell(mapping.summary, KI_MAPPING_WIDTHS[1]),
          smallCell(mapping.grundlagen ? "x" : "-", KI_MAPPING_WIDTHS[2]),
          smallCell(mapping.anwendung ? "x" : "-", KI_MAPPING_WIDTHS[3]),
          smallCell(mapping.entwicklung ? "x" : "-", KI_MAPPING_WIDTHS[4]),
          smallCell(mapping.gesellschaftRecht ? "x" : "-", KI_MAPPING_WIDTHS[5])
        ]
      })
    );
  }

  if (rows.length === 1) {
    rows.push(
      new TableRow({
        children: [
          smallCell("-", KI_MAPPING_WIDTHS[0]),
          smallCell("Keine Kompetenzen erkannt.", KI_MAPPING_WIDTHS[1]),
          smallCell("-", KI_MAPPING_WIDTHS[2]),
          smallCell("-", KI_MAPPING_WIDTHS[3]),
          smallCell("-", KI_MAPPING_WIDTHS[4]),
          smallCell("-", KI_MAPPING_WIDTHS[5])
        ]
      })
    );
  }

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.PERCENTAGE },
    rows
  });
}

/** Code-Fallback falls Ollama-Aufruf fehlschlägt */
function fallbackKiMapping(situation) {
  const text = situationText(situation);
  const explicitKi = hasExplicitKiSignal(text);

  return {
    summary: fallbackKiSummary(situation, text),
    grundlagen:
      explicitKi && hasAny(text, [
        "grundlage", "funktionsweise", "algorithm", "modell", "datenqualitaet",
        "datenqualit", "training", "prompt", "maschinelles lernen", "ki-system"
      ]),
    anwendung:
      (explicitKi && hasAny(text, [
        "nutzen", "anwenden", "einsetzen", "recherch", "generier",
        "auswert", "vergleich", "dokumentier", "assistenz"
      ])) ||
      hasAny(text, ["chatbot", "chatgpt", "ki-gestuetzt", "ollama", "llm"]),
    entwicklung:
      hasAny(text, ["ki-loesung", "ki-system", "ki-workflow"]) ||
      (explicitKi && hasAny(text, [
        "entwickl", "prototyp", "workflow", "automatisierung", "pipeline",
        "system entwerfen", "modellieren", "programmier", "implementier"
      ])),
    gesellschaftRecht: hasAny(text, [
      "datenschutz", "urheber", "recht", "bias", "diskrimin", "transparen",
      "verantwort", "ethik", "gesellschaft", "quelle", "quellenkritik"
    ])
  };
}

function fallbackKiSummary(situation, text) {
  const competence = situation.kompetenzen[0]?.text || "";
  const product = situation.handlungsprodukt || "";
  const content = situation.inhalte || "";

  if (hasExplicitKiSignal(text)) {
    return sentence(
      `Die Lernenden bearbeiten ${shortText(product || competence, 70)} und reflektieren dabei den KI- oder Datenbezug anhand von ${shortText(content || competence, 90)}.`
    );
  }

  if (competence || product) {
    return sentence(
      `Die Lernenden bearbeiten ${shortText(product || "ein berufliches Handlungsprodukt", 70)} und wenden dabei ${shortText(competence || content, 110)} fachbezogen an.`
    );
  }

  return "Die Lernsituation enthaelt keinen eindeutig erkennbaren KI-Bezug; die fachliche Zuordnung sollte manuell geprueft werden.";
}

function renderCompetences(competences = []) {
  if (!competences.length) return [emptyParagraph()];

  return competences.map((competence) => {
    return new Paragraph({
      numbering: { reference: "competence-bullets", level: 0 },
      spacing: { after: 70 },
      children: competenceTextRuns(competence)
    });
  });
}

function competenceTextRuns(competence) {
  const segments = Array.isArray(competence?.segments) && competence.segments.length
    ? competence.segments
    : [{ text: competence?.text || "", tag: null }];

  return segments.map((segment) =>
    new TextRun({
      text: segment.text,
      color: TAG_COLORS[segment.tag] || COLORS.text
    })
  );
}

function contentCell(children) {
  return new TableCell({
    width: { size: LEFT_WIDTH, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    margins: cellMargins(),
    borders: tableBorders(),
    children: ensureChildren(children)
  });
}

function fullWidthRow(children) {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 2,
        verticalAlign: VerticalAlign.TOP,
        margins: cellMargins(),
        borders: tableBorders(),
        children: ensureChildren(children)
      })
    ]
  });
}

function tableHeaderRow(labels, widths = []) {
  return new TableRow({
    tableHeader: true,
    children: labels.map((label, index) =>
      new TableCell({
        ...(widths[index]
          ? { width: { size: widths[index], type: WidthType.PERCENTAGE } }
          : {}),
        shading: cellShading(COLORS.blue),
        margins: smallCellMargins(),
        borders: tableBorders(),
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: label, bold: true, color: COLORS.white })
            ]
          })
        ]
      })
    )
  });
}

function smallCell(value, width) {
  return new TableCell({
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    verticalAlign: VerticalAlign.TOP,
    margins: smallCellMargins(),
    borders: tableBorders(),
    children: textParagraphs(value)
  });
}

function headingParagraph(text) {
  return new Paragraph({
    spacing: { after: 70 },
    children: [new TextRun({ text, bold: true, color: COLORS.blue })]
  });
}

function textParagraphs(value, options = {}) {
  const lines = String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [emptyParagraph()];

  return lines.map(
    (line) =>
      new Paragraph({
        spacing: { after: 70 },
        children: [
          new TextRun({ text: line, bold: options.bold || false, color: COLORS.text })
        ]
      })
  );
}

function emptyParagraph() {
  return new Paragraph("");
}

function ensureChildren(children) {
  return children.length ? children : [emptyParagraph()];
}

function spacer(after = 120) {
  return new Paragraph({ spacing: { after }, children: [] });
}

function labelRun(text) {
  return new TextRun({ text, bold: true, color: COLORS.blue });
}

function valueRun(text) {
  return new TextRun({ text, color: COLORS.text });
}

function headerRun(text) {
  return new TextRun({ text, bold: true, color: COLORS.white });
}

function headerValueRun(text) {
  return new TextRun({ text, color: COLORS.white });
}

function splitMethodSections(value = "") {
  const sections = { methoden: [], materialien: [], organisation: [] };
  let target = "methoden";

  for (const block of String(value || "").split(/\n+/)) {
    const line = block.trim();
    if (!line) continue;

    const materialMatch = line.match(/^Unterrichtsmaterialien\s*\/?\s*Fundstelle\s*:\s*(.*)$/i);
    if (materialMatch) {
      target = "materialien";
      if (materialMatch[1]) sections[target].push(materialMatch[1]);
      continue;
    }

    const organisationMatch = line.match(/^Organisatorische Hinweise\s*:\s*(.*)$/i);
    if (organisationMatch) {
      target = "organisation";
      if (organisationMatch[1]) sections[target].push(organisationMatch[1]);
      continue;
    }

    sections[target].push(line);
  }

  return {
    methoden: sections.methoden.join("\n"),
    materialien: sections.materialien.join("\n"),
    organisation: sections.organisation.join("\n")
  };
}

function formatSituationHeading(situation, index) {
  return `${situation.id} - ${deriveSituationTitle(situation)}${formatBlockInfo(index)}`;
}

function deriveSituationTitle(situation) {
  const source =
    situation.handlungsprodukt || situation.einstieg || situation.inhalte || "Lernsituation";
  return source.replace(/\s+/g, " ").replace(/[.!?].*$/, "").trim().slice(0, 90) || "Lernsituation";
}

function formatBlockInfo(index) {
  return ` (Block ${index + 1})`;
}

function extractTrainingYear(value = "") {
  return String(value).match(/(\d+)\.?\s*Ausbildungsjahr/i)?.[1] || "";
}

function situationText(situation) {
  return [
    situation.einstieg,
    situation.handlungsprodukt,
    situation.inhalte,
    situation.methoden,
    ...(situation.kompetenzen || []).map((competence) => competence.text)
  ]
    .join(" ")
    .toLowerCase();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function hasExplicitKiSignal(text) {
  return /\b(ki|ai|llm)\b/.test(text) || hasAny(text, [
    "chatgpt", "ollama", "llama", "qwen", "prompt", "algorithmus",
    "maschinelles lernen", "kuenstliche intelligenz", "intelligenzmodell"
  ]);
}

function shortText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text || "-";
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function sentence(value) {
  const text = String(value || "").trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function cellMargins() {
  return { top: 130, right: 160, bottom: 130, left: 160 };
}

function smallCellMargins() {
  return { top: 90, right: 100, bottom: 90, left: 100 };
}

function tableBorders() {
  const border = { style: BorderStyle.SINGLE, size: 1, color: COLORS.border };
  return { top: border, right: border, bottom: border, left: border };
}

function cellShading(fill) {
  return { type: ShadingType.CLEAR, color: "auto", fill };
}
