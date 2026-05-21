import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import pdfParse from "pdf-parse";

const execFileAsync = promisify(execFile);
const COMMAND_MAX_BUFFER = 64 * 1024 * 1024;

export async function parsePdfFile(filePath, options = {}) {
  const buffer = await fs.readFile(filePath);
  const parsed = await parsePdfBuffer(buffer);
  return enhancePdfText(filePath, parsed, options);
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

async function enhancePdfText(filePath, parsed, options = {}) {
  const ocr = normalizeOcrOptions(options.ocr);
  if (!ocr.enabled || countTextChars(parsed.text) >= ocr.minTextChars) {
    return parsed;
  }

  const pageLimit = getPageLimit(parsed.pages, ocr.maxPages);
  let pdftotextError = "";

  try {
    const text = await extractTextWithPdftotext(filePath, pageLimit, ocr);
    if (countTextChars(text) >= ocr.minTextChars) {
      return {
        ...parsed,
        text,
        ocr: {
          attempted: true,
          used: false,
          source: "pdftotext",
          pages: pageLimit,
          chars: text.length
        }
      };
    }
  } catch (error) {
    pdftotextError = formatCommandError(error);
  }

  try {
    const result = await extractTextWithTesseract(filePath, pageLimit, ocr);
    const text = chooseBestText(parsed.text, result.text);
    return {
      ...parsed,
      text,
      ocr: {
        attempted: true,
        used: true,
        source: "tesseract",
        pages: result.pages,
        chars: text.length
      }
    };
  } catch (error) {
    return {
      ...parsed,
      ocr: {
        attempted: true,
        used: false,
        source: "tesseract",
        pages: pageLimit,
        chars: countTextChars(parsed.text),
        error: formatOcrError(error, pdftotextError)
      }
    };
  }
}

async function extractTextWithPdftotext(filePath, pageLimit, ocr) {
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-layout", "-enc", "UTF-8", "-f", "1", "-l", String(pageLimit), filePath, "-"],
    {
      encoding: "utf8",
      timeout: ocr.timeoutMs,
      maxBuffer: COMMAND_MAX_BUFFER
    }
  );
  return normalizePdfText(stdout);
}

async function extractTextWithTesseract(filePath, pageLimit, ocr) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gandalf-ocr-"));
  const prefix = path.join(tmpDir, "page");

  try {
    await execFileAsync(
      "pdftoppm",
      ["-r", String(ocr.dpi), "-f", "1", "-l", String(pageLimit), "-png", filePath, prefix],
      {
        encoding: "utf8",
        timeout: ocr.timeoutMs,
        maxBuffer: COMMAND_MAX_BUFFER
      }
    );

    const imageFiles = (await fs.readdir(tmpDir))
      .filter((file) => file.toLowerCase().endsWith(".png"))
      .sort(comparePageImageNames);
    const parts = [];

    for (const imageFile of imageFiles) {
      const imagePath = path.join(tmpDir, imageFile);
      const { stdout } = await execFileAsync(
        "tesseract",
        [imagePath, "stdout", "-l", ocr.lang, "--psm", "1"],
        {
          encoding: "utf8",
          timeout: ocr.timeoutMs,
          maxBuffer: COMMAND_MAX_BUFFER
        }
      );
      const text = normalizePdfText(stdout);
      if (text) parts.push(text);
    }

    return {
      pages: imageFiles.length,
      text: normalizePdfText(parts.join("\n\n"))
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function normalizeOcrOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  return {
    enabled: Boolean(source.enabled),
    minTextChars: readPositiveInteger(source.minTextChars, 200),
    maxPages: readPositiveInteger(source.maxPages, 60),
    dpi: readPositiveInteger(source.dpi, 180),
    lang: String(source.lang || "deu+eng").trim() || "deu+eng",
    timeoutMs: readPositiveInteger(source.timeoutMs, 120000)
  };
}

function chooseBestText(originalText, fallbackText) {
  const original = normalizePdfText(originalText);
  const fallback = normalizePdfText(fallbackText);
  return countTextChars(fallback) > countTextChars(original) ? fallback : original;
}

function getPageLimit(pages, maxPages) {
  const total = Number(pages || 0);
  if (!Number.isFinite(total) || total <= 0) return maxPages;
  return Math.max(1, Math.min(total, maxPages));
}

function comparePageImageNames(left, right) {
  return pageNumber(left) - pageNumber(right);
}

function pageNumber(fileName) {
  const match = String(fileName || "").match(/-(\d+)\.png$/i);
  return Number(match?.[1] || 0);
}

function countTextChars(value) {
  return String(value || "").replace(/\s+/g, "").length;
}

function formatOcrError(error, pdftotextError) {
  const tesseractError = formatCommandError(error);
  return [pdftotextError && `pdftotext: ${pdftotextError}`, `OCR: ${tesseractError}`]
    .filter(Boolean)
    .join(" | ");
}

function formatCommandError(error) {
  const message = error?.code === "ENOENT"
    ? "Werkzeug ist im Container nicht installiert."
    : String(error?.message || "unbekannter Fehler");
  const stderr = String(error?.stderr || "").replace(/\s+/g, " ").trim();
  return cleanShort([message, stderr].filter(Boolean).join(" "), 500);
}

function cleanShort(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
