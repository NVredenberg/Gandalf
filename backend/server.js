import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { optimizeLearningDocument } from "./ai/contentOptimizer.js";
import { parseUploadedFile } from "./parser/index.js";
import { normalizeLearningDocument } from "./parser/schema.js";
import { renderLearningDocument } from "./renderer/docxRenderer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadsDir = path.join(rootDir, "data", "uploads");
const frontendDir = path.join(rootDir, "frontend");

const allowedExtensions = new Set([".md", ".docx"]);
const port = Number(process.env.PORT || 3000);

// Timeout für KI-Routen: 25 Minuten.
// qwen3:14b-q8_0 auf CPU braucht beim ersten Aufruf lange zum Laden
// und mehrere Minuten pro Prompt. Drei Prompts hintereinander (Content,
// Szenario, KI-Summaries) können zusammen 15–20 Minuten dauern.
const AI_TIMEOUT_MS = 25 * 60 * 1000;

await fs.mkdir(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    cb(null, `${Date.now()}-${base || "upload"}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(ext)) {
      cb(new Error("Nur .md und .docx Dateien werden unterstützt."));
      return;
    }
    cb(null, true);
  }
});

const app = express();

app.use(cors());
app.use(express.json({ limit: "4mb" }));
app.use(express.static(frontendDir));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ollama: process.env.OLLAMA_URL || "http://localhost:11434/api/generate",
    model: process.env.OLLAMA_MODEL || "llama3.1:8b"
  });
});

app.post("/api/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Keine Datei empfangen." });
      return;
    }

    const result = await parseUploadedFile(req.file.path);
    const parsedPath = path.join(
      uploadsDir,
      `${path.basename(req.file.filename, path.extname(req.file.filename))}.json`
    );
    await fs.writeFile(parsedPath, JSON.stringify(result.document, null, 2), "utf8");

    res.json({
      file: {
        originalName: req.file.originalname,
        storedName: req.file.filename
      },
      document: result.document,
      warnings: result.warnings
    });
  } catch (error) {
    next(error);
  }
});

// KI-Routen mit verlängertem Timeout
app.post("/api/analyze", (req, res, next) => {
  // Socket-Timeout auf 25 Minuten setzen damit die Verbindung nicht
  // durch Node / Docker / den Browser-Proxy unterbrochen wird
  req.socket.setTimeout(AI_TIMEOUT_MS);
  res.setTimeout(AI_TIMEOUT_MS);

  (async () => {
    const document = normalizeLearningDocument(req.body?.document);
    const optimized = await optimizeLearningDocument(document);
    res.json({ document: optimized });
  })().catch(next);
});

app.post("/api/render", (req, res, next) => {
  req.socket.setTimeout(AI_TIMEOUT_MS);
  res.setTimeout(AI_TIMEOUT_MS);

  (async () => {
    const document = normalizeLearningDocument(req.body?.document);
    const buffer = await renderLearningDocument(document);
    const fileName = buildOutputFileName(document);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  })().catch(next);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = error.message?.includes("Ollama") ? 502 : 400;
  res.status(status).json({
    error: error.message || "Unerwarteter Fehler."
  });
});

app.listen(port, () => {
  console.log(`Lernfeld-DOCX-Generator läuft auf http://localhost:${port}`);
});

function buildOutputFileName(document) {
  const lernfeld = document.meta.lernfeld || "lernfeld";
  const fach = document.meta.fach || "fach";
  const safeBase = `${lernfeld}-${fach}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return `${safeBase || "lernfeld-dokument"}.docx`;
}