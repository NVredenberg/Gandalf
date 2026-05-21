import fs from "node:fs/promises";

import pdfParse from "pdf-parse";

export async function parsePdfFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return parsePdfBuffer(buffer);
}

export async function parsePdfBuffer(buffer) {
  const data = await pdfParse(buffer);
  const text = normalizePdfText(data.text);

  return {
    text,
    pages: data.numpages || 0,
    info: data.info || {}
  };
}

function normalizePdfText(value = "") {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
