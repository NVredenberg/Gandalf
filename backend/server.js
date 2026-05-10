import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkOllamaStatus, getOllamaConfig } from "./ai/ollamaClient.js";
import {
  generateKiMappingsForTable,
  optimizeLearningDocument,
  runScenarioHarmonization
} from "./ai/contentOptimizer.js";
import {
  getRagStatus,
  indexDocumentSituations,
  indexSituation,
  resetRagStore
} from "./ai/ragStore.js";
import { parseUploadedFile } from "./parser/index.js";
import { normalizeLearningDocument } from "./parser/schema.js";
import {
  attachProgressStream,
  closeProgress,
  sendProgress
} from "./progressEvents.js";
import { renderLearningDocument } from "./renderer/docxRenderer.js";
import {
  cleanUploadsDir,
  cleanupUploadedFiles,
  scheduleUploadCleanup
} from "./uploadCleanup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadsDir = path.join(rootDir, "data", "uploads");
const frontendDir = path.join(rootDir, "frontend");

const allowedExtensions = new Set([".md", ".docx"]);
const port = Number(process.env.PORT || 3000);
const MAX_LERNSITUATIONEN = readPositiveInteger(process.env.MAX_LERNSITUATIONEN, 20);

// Lange KI-Routen duerfen mehrere Ollama-Aufrufe hintereinander ausfuehren.
// Standard: 45 Minuten, konfigurierbar per AI_TIMEOUT_MS.
const AI_TIMEOUT_MS = readPositiveInteger(process.env.AI_TIMEOUT_MS, 45 * 60 * 1000);

await fs.mkdir(uploadsDir, { recursive: true });
await cleanUploadsDir(uploadsDir);
scheduleUploadCleanup(uploadsDir);

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

app.get("/api/live", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/health", async (_req, res) => {
  const ollamaConfig = getOllamaConfig();
  const ollamaStatus = await checkOllamaStatus();

  res.json({
    ok: true,
    ollama: ollamaConfig.url,
    model: ollamaConfig.model,
    ollamaStatus
  });
});

app.get("/api/progress/:id", (req, res) => {
  attachProgressStream(req.params.id, res);
});

app.get("/api/rag/status", async (_req, res, next) => {
  try {
    res.json(await getRagStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/rag/examples", async (req, res, next) => {
  try {
    const document = normalizeLearningDocument(req.body?.document);
    const rawSituation = req.body?.situation;

    if (!rawSituation || typeof rawSituation !== "object") {
      res.status(400).json({ error: "Keine Lernsituation empfangen." });
      return;
    }

    const situation = normalizeLearningSituationInput(rawSituation);
    const result = await indexSituation(situation, {
      meta: document.meta,
      approved: true
    });

    res.json({
      ok: Boolean(result),
      result,
      status: await getRagStatus()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/rag/reindex", async (req, res, next) => {
  try {
    const document = normalizeLearningDocument(req.body?.document);
    validateLearningSituationCount(document);
    const indexed = await indexDocumentSituations(document);

    res.json({
      indexed: indexed.length,
      status: await getRagStatus()
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/rag/reset", async (_req, res, next) => {
  try {
    const result = await resetRagStore();
    res.json({
      ...result,
      status: await getRagStatus()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", upload.single("file"), async (req, res, next) => {
  const cleanupPaths = [];
  let parsedDocument = null;
  res.on("finish", () => {
    cleanupUploadedFiles(cleanupPaths);
    if (res.statusCode < 400 && parsedDocument) {
      indexUploadedDocument(parsedDocument);
    }
  });

  try {
    if (!req.file) {
      res.status(400).json({ error: "Keine Datei empfangen." });
      return;
    }

    cleanupPaths.push(req.file.path);
    const result = await parseUploadedFile(req.file.path);
    parsedDocument = result.document;
    const parsedPath = path.join(
      uploadsDir,
      `${path.basename(req.file.filename, path.extname(req.file.filename))}.json`
    );
    cleanupPaths.push(parsedPath);
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
  // Socket-Timeout erhoehen, damit die Verbindung nicht
  // durch Node / Docker / den Browser-Proxy unterbrochen wird
  req.socket.setTimeout(AI_TIMEOUT_MS);
  res.setTimeout(AI_TIMEOUT_MS);
  const progressId = selectedProgressId(req);

  (async () => {
    sendProgress(progressId, "Dokument wird vorbereitet.");
    const document = normalizeLearningDocument(req.body?.document);
    validateLearningSituationCount(document);
    sendProgress(progressId, "KI prueft Inhalte und Szenarien.");
    const optimized = await optimizeLearningDocument(document, {
      model: selectedModel(req),
      onProgress: createProgressReporter(progressId)
    });
    closeProgress(progressId, "KI-Pruefung abgeschlossen.");
    res.json({ document: optimized });
  })().catch((error) => {
    closeProgress(progressId, error.message || "KI-Pruefung fehlgeschlagen.");
    next(error);
  });
});

app.post("/api/scenarios", (req, res, next) => {
  req.socket.setTimeout(AI_TIMEOUT_MS);
  res.setTimeout(AI_TIMEOUT_MS);
  const progressId = selectedProgressId(req);

  (async () => {
    sendProgress(progressId, "Dokument wird vorbereitet.");
    const document = normalizeLearningDocument(req.body?.document);
    validateLearningSituationCount(document);
    sendProgress(progressId, "Szenario-Kontext wird generiert.");
    const harmonized = await runScenarioHarmonization(document, {
      model: selectedModel(req),
      onProgress: createProgressReporter(progressId)
    });
    closeProgress(progressId, "Szenarien generiert.");
    res.json({ document: harmonized });
  })().catch((error) => {
    closeProgress(progressId, error.message || "Szenarien konnten nicht generiert werden.");
    next(error);
  });
});

app.post("/api/render", (req, res, next) => {
  req.socket.setTimeout(AI_TIMEOUT_MS);
  res.setTimeout(AI_TIMEOUT_MS);
  const progressId = selectedProgressId(req);

  (async () => {
    sendProgress(progressId, "Dokument wird vorbereitet.");
    const document = normalizeLearningDocument(req.body?.document);
    validateLearningSituationCount(document);
    const settings = {
      model: selectedModel(req),
      onProgress: createProgressReporter(progressId)
    };
    sendProgress(progressId, "KI-Zuordnung wird vorbereitet.");
    const [kiMappings] = await Promise.all([
      generateKiMappingsForTable(document.lernsituationen, settings)
    ]);
    sendProgress(progressId, "DOCX wird aufgebaut.");
    const buffer = await renderLearningDocument(document, kiMappings, settings);
    const fileName = buildOutputFileName(document);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    closeProgress(progressId, "DOCX ist bereit.");
    res.send(buffer);
  })().catch((error) => {
    closeProgress(progressId, error.message || "DOCX konnte nicht erzeugt werden.");
    next(error);
  });
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

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function selectedModel(req) {
  const model = String(req.body?.model || "").trim();
  return model.length ? model : undefined;
}

function selectedProgressId(req) {
  return String(req.body?.progressId || "").trim();
}

function createProgressReporter(progressId) {
  return (message, data) => sendProgress(progressId, message, data);
}

function validateLearningSituationCount(document) {
  const count = document.lernsituationen.length;
  if (count <= MAX_LERNSITUATIONEN) return;

  throw new Error(
    `Zu viele Lernsituationen: ${count}. Maximal erlaubt sind ${MAX_LERNSITUATIONEN}.`
  );
}

function indexUploadedDocument(document) {
  indexDocumentSituations(document)
    .then((items) => {
      if (items.length) {
        console.log(`[RAG] ${items.length} Lernsituation(en) indexiert.`);
      }
    })
    .catch((error) => {
      console.warn("[RAG] Upload konnte nicht indexiert werden:", error.message);
    });
}

function normalizeLearningSituationInput(input) {
  const document = normalizeLearningDocument({
    lernsituationen: [input || {}]
  });

  return document.lernsituationen[0] || null;
}
