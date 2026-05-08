import fs from "node:fs/promises";
import path from "node:path";

import { parseDocxFile } from "./docxParser.js";
import { parseMarkdownText } from "./markdownParser.js";

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

  throw new Error("Nicht unterstütztes Dateiformat.");
}
