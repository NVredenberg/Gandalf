import mammoth from "mammoth";

import { parseDocxTemplateTables } from "./docxTableParser.js";
import { parseMarkdownText } from "./markdownParser.js";

const mammothOptions = {
  includeDefaultStyleMap: true,
  styleMap: [
    "p[style-name='Title'] => h1:fresh",
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='Überschrift 1'] => h1:fresh",
    "p[style-name='Überschrift 2'] => h2:fresh",
    "p[style-name='Überschrift 3'] => h3:fresh"
  ]
};

export async function parseDocxFile(filePath) {
  const tableDocument = await parseDocxTemplateTables(filePath);
  const markdownResult = await mammoth.convertToMarkdown({ path: filePath }, mammothOptions);
  const rawResult = await mammoth.extractRawText({ path: filePath });

  const markdownDocument = parseMarkdownText(markdownResult.value);
  const rawDocument = parseMarkdownText(rawResult.value);
  const document = chooseBestDocument(tableDocument, markdownDocument, rawDocument);

  return {
    document,
    warnings: [
      ...messages(markdownResult),
      ...messages(rawResult),
      ...selectionWarning(tableDocument, markdownDocument, rawDocument, document)
    ]
  };
}

function chooseBestDocument(tableDocument, markdownDocument, rawDocument) {
  if (tableDocument.meta.anzahl_ls > 0) {
    return tableDocument;
  }

  return scoreDocument(rawDocument) > scoreDocument(markdownDocument)
    ? rawDocument
    : markdownDocument;
}

function scoreDocument(document) {
  return (
    document.meta.anzahl_ls * 20 +
    document.lernsituationen.reduce((score, situation) => {
      return (
        score +
        filled(situation.einstieg) +
        filled(situation.handlungsprodukt) +
        filled(situation.inhalte) +
        filled(situation.methoden) +
        situation.kompetenzen.length
      );
    }, 0)
  );
}

function filled(value) {
  return String(value || "").trim() ? 1 : 0;
}

function messages(result) {
  return (result.messages || []).map((message) => message.message);
}

function selectionWarning(tableDocument, markdownDocument, rawDocument, selected) {
  if (selected === tableDocument && tableDocument.meta.anzahl_ls > 0) {
    return ["DOCX wurde über die Word-Tabellenstruktur verarbeitet."];
  }

  if (selected === rawDocument && scoreDocument(rawDocument) > scoreDocument(markdownDocument)) {
    return ["DOCX wurde über Rohtext verarbeitet, weil dort mehr Lernsituations-Struktur erkannt wurde."];
  }

  return [];
}
