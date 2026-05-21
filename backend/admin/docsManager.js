import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePdfFile } from "../parser/pdfParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const docsDir = path.join(rootDir, "data", "assistant-docs");
const indexPath = path.join(docsDir, "index.json");
const CACHE_TTL_MS = 10 * 60 * 1000;
const DOC_MAX_CHARS = readPositiveInteger(process.env.ASSISTANT_DOC_MAX_CHARS, 12000);

const defaultDocs = Object.freeze([
  { slot: 1, label: "Bildungsplaene NRW", file: "01_bildungsplaene.pdf" },
  { slot: 2, label: "DQR-Niveaus", file: "02_dqr-niveaus.pdf" },
  {
    slot: 3,
    label: "Digitale Schluesselkompetenzen",
    file: "03_digitale-schluesselkompetenzen.pdf"
  },
  {
    slot: 4,
    label: "KI-Zertifikat-Anforderungen",
    file: "04_ki-zertifikat-anforderungen.pdf"
  },
  {
    slot: 5,
    label: "Lern- und Arbeitstechniken",
    file: "05_lern-und-arbeitstechniken.pdf"
  }
]);

let docsTextCache = null;

export async function listDocs() {
  const docs = await readIndex();
  const items = await Promise.all(docs.map(enrichDocMeta));
  return { docs: items };
}

export async function uploadDoc(slot, file) {
  if (!file?.path) {
    throw new Error("Keine PDF-Datei empfangen.");
  }

  const doc = await findDoc(slot);
  const ext = path.extname(file.originalname || file.path).toLowerCase();
  if (ext !== ".pdf") {
    throw new Error("Hintergrunddokumente muessen PDF-Dateien sein.");
  }

  await fs.mkdir(docsDir, { recursive: true });
  await fs.copyFile(file.path, path.join(docsDir, doc.file));
  docsTextCache = null;
  return enrichDocMeta(doc);
}

export async function clearDoc(slot) {
  const doc = await findDoc(slot);
  await fs.rm(path.join(docsDir, doc.file), { force: true });
  docsTextCache = null;
  return enrichDocMeta(doc);
}

export async function loadAllDocsAsText() {
  const now = Date.now();
  if (docsTextCache && now - docsTextCache.created < CACHE_TTL_MS) {
    return docsTextCache.text;
  }

  const docs = await readIndex();
  const parts = [];

  for (const doc of docs) {
    const filePath = path.join(docsDir, doc.file);
    if (!(await exists(filePath))) continue;

    try {
      const parsed = await parsePdfFile(filePath);
      if (!parsed.text) continue;
      parts.push(
        `# ${doc.label}\nQuelle: ${doc.file}\n\n${compactText(parsed.text, DOC_MAX_CHARS)}`
      );
    } catch (error) {
      console.warn(`[AdminDocs] ${doc.file} konnte nicht gelesen werden:`, error.message);
    }
  }

  docsTextCache = {
    created: now,
    text: parts.join("\n\n---\n\n")
  };
  return docsTextCache.text;
}

async function readIndex() {
  await ensureIndex();
  const raw = await fs.readFile(indexPath, "utf8");
  const parsed = JSON.parse(raw);
  const docs = Array.isArray(parsed) ? parsed : defaultDocs;
  return docs.map((doc, index) => ({
    slot: Number(doc.slot) || index + 1,
    label: String(doc.label || defaultDocs[index]?.label || `Slot ${index + 1}`),
    file: sanitizePdfFileName(doc.file || defaultDocs[index]?.file || `slot-${index + 1}.pdf`)
  }));
}

async function ensureIndex() {
  await fs.mkdir(docsDir, { recursive: true });
  if (await exists(indexPath)) return;
  await fs.writeFile(indexPath, `${JSON.stringify(defaultDocs, null, 2)}\n`, "utf8");
}

async function enrichDocMeta(doc) {
  const filePath = path.join(docsDir, doc.file);
  const existsOnDisk = await exists(filePath);
  const result = {
    ...doc,
    exists: existsOnDisk,
    size: 0,
    updatedAt: null,
    pages: 0,
    preview: ""
  };

  if (!existsOnDisk) return result;

  const stat = await fs.stat(filePath);
  result.size = stat.size;
  result.updatedAt = stat.mtime.toISOString();

  try {
    const parsed = await parsePdfFile(filePath);
    result.pages = parsed.pages;
    result.preview = compactText(parsed.text, 700);
  } catch (error) {
    result.preview = `PDF konnte nicht gelesen werden: ${error.message}`;
  }

  return result;
}

async function findDoc(slot) {
  const cleanSlot = Number(slot);
  const doc = (await readIndex()).find((item) => item.slot === cleanSlot);
  if (!doc) {
    throw new Error(`Unbekannter Dokument-Slot: ${slot}`);
  }
  return doc;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizePdfFileName(value) {
  const base = path.basename(String(value || "")).replace(/[^a-z0-9_.-]+/gi, "-");
  return base.toLowerCase().endsWith(".pdf") ? base : `${base || "document"}.pdf`;
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}\n\n[Text gekuerzt]`;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
