import fs from "node:fs/promises";
import path from "node:path";

import { parseDocxFile } from "./docxParser.js";
import { parseMarkdownText } from "./markdownParser.js";
import { parsePdfFile } from "./pdfParser.js";

export async function parseUploadedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".md") {
    const markdown = await fs.readFile(filePath, "utf8");
    return {
      document: parseMarkdownText(markdown),
      warnings: []
    };
  }

  if (ext === ".docx") {
    return parseDocxFile(filePath);
  }

  if (ext === ".pdf") {
    const pdf = await parsePdfFile(filePath);
    return {
      document: parseMarkdownText(pdf.text),
      warnings: [
        `PDF wurde als Fliesstext gelesen (${pdf.pages} Seite${pdf.pages === 1 ? "" : "n"}).`
      ]
    };
  }

  throw new Error("Nicht unterstütztes Dateiformat.");
}
