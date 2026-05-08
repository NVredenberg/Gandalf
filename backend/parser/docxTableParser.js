import fs from "node:fs/promises";

import { extractTagsFromText, normalizeLearningDocument } from "./schema.js";

const templateLabels = {
  einstieg: ["Einstiegsszenario", "Einstiegsszenarion"],
  handlungsprodukt: ["Handlungsprodukt/Lernergebnis", "Handlungsprodukt", "Lernergebnis"],
  kompetenzen: ["Wesentliche Kompetenzen", "Kompetenzen"],
  inhalte: ["Konkretisierung der Inhalte", "Inhalte"],
  methoden: ["Lern- und Arbeitstechniken", "Methoden"],
  materialien: ["Unterrichtsmaterialien/Fundstelle", "Unterrichtsmaterialien"],
  organisation: ["Organisatorische Hinweise"]
};

const instructionalPatterns = [
  /^ggf\.?\s+hinweise/i,
  /^kompetenz\s+\d+/i,
  /^kompetenz\s+n/i,
  /^fächerkürzel$/i,
  /^titel(?:\s*\(.*?\))?$/i,
  /^[.…]+$/
];

export async function parseDocxTemplateTables(filePath) {
  const { default: JSZip } = await import("jszip");
  const bytes = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await readZipText(zip, "word/document.xml");
  const headerXmls = await readHeaderXmls(zip);

  return parseTemplateTablesFromXml(documentXml, headerXmls);
}

export function parseTemplateTablesFromXml(documentXml, headerXmls = []) {
  const tables = extractTagBlocks(documentXml, "w:tbl");
  const lernsituationen = [];
  const meta = {
    beruf: extractBerufFromHeaders(headerXmls),
    fach: "",
    lernfeld: "",
    anzahl_ls: 0
  };

  for (const tableXml of tables) {
    const rows = extractTableRows(tableXml);
    if (!isLearningSituationTemplate(rows)) {
      continue;
    }

    lernsituationen.push(tableToLearningSituation(rows, lernsituationen.length));

    if (!meta.fach) {
      meta.fach = extractHeaderValue(rows[0]?.[0] || [], "Bündelungsfach");
    }
    if (!meta.lernfeld) {
      meta.lernfeld = extractHeaderValue(rows[0]?.[0] || [], "Lernfeld Nr.");
    }
  }

  return normalizeLearningDocument({ meta, lernsituationen });
}

function tableToLearningSituation(rows, index) {
  const headerParagraphs = rows[0]?.[0] || [];
  const situationHeader = extractHeaderValue(headerParagraphs, "Lernsituation Nr.");
  const situationNumber = extractFirstNumber(situationHeader);
  const methodParts = [];
  const methods = extractCellContent(rows[3]?.[0] || [], templateLabels.methoden);
  const materials = extractCellContent(rows[4]?.[0] || [], templateLabels.materialien);
  const organisation = extractCellContent(rows[5]?.[0] || [], templateLabels.organisation);

  if (methods) {
    methodParts.push(methods);
  }
  if (materials) {
    methodParts.push(`Unterrichtsmaterialien/Fundstelle: ${materials}`);
  }
  if (organisation) {
    methodParts.push(`Organisatorische Hinweise: ${organisation}`);
  }

  return {
    id: situationNumber ? `LS ${situationNumber}` : `LS ${index + 1}`,
    einstieg: extractCellContent(rows[1]?.[0] || [], templateLabels.einstieg),
    handlungsprodukt: extractCellContent(rows[1]?.[1] || [], templateLabels.handlungsprodukt),
    kompetenzen: parseCompetences(extractCellContent(rows[2]?.[0] || [], templateLabels.kompetenzen)),
    inhalte: extractCellContent(rows[2]?.[1] || [], templateLabels.inhalte),
    methoden: methodParts.join("\n\n")
  };
}

function isLearningSituationTemplate(rows) {
  return (
    rows.length >= 6 &&
    hasLabel(rows[1]?.[0], templateLabels.einstieg) &&
    hasLabel(rows[1]?.[1], templateLabels.handlungsprodukt) &&
    hasLabel(rows[2]?.[0], templateLabels.kompetenzen) &&
    hasLabel(rows[2]?.[1], templateLabels.inhalte) &&
    hasLabel(rows[3]?.[0], templateLabels.methoden) &&
    hasLabel(rows[4]?.[0], templateLabels.materialien) &&
    hasLabel(rows[5]?.[0], templateLabels.organisation)
  );
}

function extractTableRows(tableXml) {
  return extractTagBlocks(tableXml, "w:tr").map((rowXml) =>
    extractTagBlocks(rowXml, "w:tc").map(extractParagraphTexts)
  );
}

function extractParagraphTexts(xml) {
  return extractTagBlocks(xml, "w:p")
    .map(extractTextFromXml)
    .map(cleanText)
    .filter(Boolean);
}

function extractTextFromXml(xml) {
  const tokens = xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g);
  const parts = [];

  for (const token of tokens) {
    if (token[1] !== undefined) {
      parts.push(decodeXml(token[1]));
    } else if (token[0].startsWith("<w:tab")) {
      parts.push("\t");
    } else {
      parts.push("\n");
    }
  }

  return parts.join("");
}

function extractCellContent(paragraphs, labels) {
  return cleanText(
    paragraphs
      .map((paragraph) => removeLeadingLabel(paragraph, labels))
      .filter((paragraph) => paragraph && !isInstructionalText(paragraph))
      .join("\n")
  );
}

function hasLabel(paragraphs = [], labels = []) {
  return paragraphs.some((paragraph) => labels.some((label) => startsWithLooseLabel(paragraph, label)));
}

function removeLeadingLabel(paragraph, labels) {
  let value = paragraph;
  for (const label of labels) {
    value = value.replace(new RegExp(`^\\s*${labelPattern(label)}\\s*(?:[:：]|[-–])?\\s*`, "i"), "");
  }
  return cleanText(value);
}

function startsWithLooseLabel(value, label) {
  return new RegExp(`^\\s*${labelPattern(label)}\\b`, "i").test(value);
}

function labelPattern(label) {
  return escapeRegExp(label).replace(/\\\//g, "\\s*\\/\\s*").replace(/\\ /g, "\\s+").replace(/\\-/g, "\\s*-\\s*");
}

function parseCompetences(value) {
  return value
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*+•]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const extracted = extractTagsFromText(line);
      return { text: extracted.text, tags: extracted.tags };
    });
}

function extractHeaderValue(paragraphs, label) {
  const pattern = new RegExp(`^\\s*${labelPattern(label)}\\s*(?:[:：]|[-–])?\\s*(.+)$`, "i");
  for (const paragraph of paragraphs) {
    const match = paragraph.match(pattern);
    const value = match ? cleanText(match[1]) : "";
    if (value && !isInstructionalText(value)) {
      return value;
    }
  }
  return "";
}

function extractFirstNumber(value) {
  return String(value || "").match(/\b(\d+(?:\.\d+)?)\b/)?.[1] || "";
}

async function readHeaderXmls(zip) {
  const headerFiles = Object.keys(zip.files).filter((name) => /^word\/header\d+\.xml$/i.test(name));
  return Promise.all(headerFiles.map((name) => readZipText(zip, name)));
}

async function readZipText(zip, name) {
  const file = zip.file(name);
  return file ? file.async("text") : "";
}

function extractBerufFromHeaders(headerXmls) {
  const text = headerXmls
    .flatMap((xml) => extractParagraphTexts(xml))
    .join("\n")
    .replace(/Quelle\s*:.*$/gim, "")
    .replace(/\bSeite\b.*$/gim, "");

  return text.split("\n").map(cleanText).find((line) => line.length > 3 && !/^von$/i.test(line)) || "";
}

function extractTagBlocks(xml, tagName) {
  const escaped = escapeRegExp(tagName);
  return [...String(xml || "").matchAll(new RegExp(`<${escaped}\\b[\\s\\S]*?<\\/${escaped}>`, "g"))].map((match) => match[0]);
}

function isInstructionalText(value) {
  const clean = cleanText(value);
  return instructionalPatterns.some((pattern) => pattern.test(clean));
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
