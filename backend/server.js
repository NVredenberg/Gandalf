import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearDoc,
  listDocs,
  loadAllDocsAsText,
  uploadDoc
} from "./admin/docsManager.js";
import { checkOllamaStatus, getOllamaConfig } from "./ai/ollamaClient.js";
import {
  generateKiMappingsForTable,
  optimizeLearningDocument,
  runScenarioHarmonization
} from "./ai/contentOptimizer.js";
import { analyzeWithFrodo, summarizeFrodoInputs } from "./ai/frodoAssistant.js";
import { finalizeGandalfDocument, generateSingleLS } from "./ai/gandalfAssistant.js";
import {
  getRagStatus,
  indexDocumentSituations,
  indexSituation,
  resetRagStore
} from "./ai/ragStore.js";
import {
  checkWebSearchStatus,
  fetchReadableUrl,
  getWebSearchConfig,
  searchQualIsNrw,
  searchWeb
} from "./ai/webSearch.js";
import { parseUploadedFile } from "./parser/index.js";
import { parsePdfFile } from "./parser/pdfParser.js";
import { normalizeLearningDocument } from "./parser/schema.js";
import {
  attachProgressStream,
  closeProgress,
  sendProgress
} from "./progressEvents.js";
import { renderLearningDocument } from "./renderer/docxRenderer.js";
import {
  createSession,
  deleteSession,
  getSession,
  updateSession
} from "./sessionStore.js";
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

const allowedExtensions = new Set([".md", ".docx", ".pdf"]);
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
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(ext)) {
      cb(new Error("Nur .md, .docx und .pdf Dateien werden unterstützt."));
      return;
    }
    cb(null, true);
  }
});

const app = express();

app.use(cors());
app.use(express.json({ limit: "8mb" }));
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

app.get("/api/admin/docs", async (_req, res, next) => {
  try {
    res.json(await listDocs());
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/docs/:slot", upload.single("file"), async (req, res, next) => {
  const cleanupPaths = req.file?.path ? [req.file.path] : [];

  try {
    const doc = await uploadDoc(req.params.slot, req.file);
    res.json({ doc, docs: (await listDocs()).docs });
  } catch (error) {
    next(error);
  } finally {
    cleanupUploadedFiles(cleanupPaths);
  }
});

app.delete("/api/admin/docs/:slot", async (req, res, next) => {
  try {
    const doc = await clearDoc(req.params.slot);
    res.json({ doc, docs: (await listDocs()).docs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/web-search/status", async (_req, res) => {
  try {
    res.json(await checkWebSearchStatus());
  } catch (error) {
    res.status(502).json({
      ok: false,
      ...getWebSearchConfig(),
      error: error.message
    });
  }
});

app.post("/api/frodo/session", (_req, res) => {
  res.json({ sessionId: createSession("frodo") });
});

app.post(
  "/api/frodo/upload/:sessionId",
  upload.fields([
    { name: "rahmenlehrplan", maxCount: 1 },
    { name: "plan", maxCount: 1 },
    { name: "pruefungskatalog", maxCount: 1 },
    { name: "prüfungskatalog", maxCount: 1 },
    { name: "catalog", maxCount: 1 }
  ]),
  async (req, res, next) => {
    const cleanupPaths = uploadedFiles(req).map((file) => file.path);

    try {
      const session = requireSession(req.params.sessionId, "frodo");
      const planFile = firstUploadedFile(req, ["rahmenlehrplan", "plan"]);
      const catalogFile = firstUploadedFile(req, ["pruefungskatalog", "prüfungskatalog", "catalog"]);

      if (!planFile || !catalogFile) {
        res.status(400).json({ error: "Rahmenlehrplan und Prüfungskatalog fehlen." });
        return;
      }

      const [rahmenlehrplan, pruefungskatalog] = await Promise.all([
        parsePdfFile(planFile.path),
        parsePdfFile(catalogFile.path)
      ]);
      const summary = summarizeFrodoInputs({ rahmenlehrplan, pruefungskatalog });
      updateSession(session.id, {
        rahmenlehrplanText: rahmenlehrplan.text,
        pruefungskatalogText: pruefungskatalog.text,
        uploadSummary: summary
      });

      res.json(summary);
    } catch (error) {
      next(error);
    } finally {
      cleanupUploadedFiles(cleanupPaths);
    }
  }
);

app.post("/api/frodo/analyze/:sessionId", (req, res, next) => {
  req.socket.setTimeout(AI_TIMEOUT_MS);
  res.setTimeout(AI_TIMEOUT_MS);
  const progressId = selectedProgressId(req);

  (async () => {
    const session = requireSession(req.params.sessionId, "frodo");
    const analysis = await analyzeWithFrodo(session, req.body || {}, {
      model: selectedModel(req),
      onProgress: createProgressReporter(progressId)
    });
    updateSession(session.id, { lastAnalysis: analysis });
    closeProgress(progressId, "Frodo-Analyse abgeschlossen.");
    res.json({ analysis });
  })().catch((error) => {
    closeProgress(progressId, error.message || "Frodo-Analyse fehlgeschlagen.");
    next(error);
  });
});

app.post("/api/frodo/search/:sessionId", async (req, res, next) => {
  try {
    requireSession(req.params.sessionId, "frodo");
    res.json({ results: await searchWeb(req.body?.query, { topK: 6 }) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/frodo/session/:sessionId", (req, res, next) => {
  try {
    requireSession(req.params.sessionId, "frodo");
    deleteSession(req.params.sessionId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/gandalf/session", async (req, res, next) => {
  try {
    const seed = req.body?.seed && typeof req.body.seed === "object" ? req.body.seed : {};
    const data = {
      grundlagen: normalizeGrundlagen(seed.grundlagen || seed),
      inhalte: seed.inhalte || {},
      totalLs: Number(seed.anzahl_ls || seed.totalLs || 1)
    };

    const frodoSession = req.body?.frodoSessionId
      ? getSession(req.body.frodoSessionId, "frodo")
      : null;

    if (frodoSession?.data?.rahmenlehrplanText) {
      data.plan = frodoSession.data.rahmenlehrplanText;
      data.frodoSessionId = frodoSession.id;
    }

    const sessionId = createSession("gandalf", data);
    const docsContext = await loadAllDocsAsText();
    res.json({
      sessionId,
      docsLoaded: Boolean(docsContext),
      planLoaded: Boolean(data.plan)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/gandalf/upload-plan/:sessionId", upload.single("file"), async (req, res, next) => {
  const cleanupPaths = req.file?.path ? [req.file.path] : [];

  try {
    const session = requireSession(req.params.sessionId, "gandalf");
    if (!req.file) {
      res.status(400).json({ error: "Keine PDF-Datei empfangen." });
      return;
    }

    const parsed = await parsePdfFile(req.file.path);
    updateSession(session.id, { plan: parsed.text, planSource: req.file.originalname });
    res.json({
      pages: parsed.pages,
      chars: parsed.text.length,
      kurzinfo: textPreview(parsed.text)
    });
  } catch (error) {
    next(error);
  } finally {
    cleanupUploadedFiles(cleanupPaths);
  }
});

app.post("/api/gandalf/search-plan/:sessionId", async (req, res, next) => {
  try {
    requireSession(req.params.sessionId, "gandalf");
    res.json({
      results: await searchQualIsNrw(req.body?.beruf, req.body?.lernfeld)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/gandalf/fetch-url/:sessionId", async (req, res, next) => {
  try {
    const session = requireSession(req.params.sessionId, "gandalf");
    const result = await fetchReadableUrl(req.body?.url);
    updateSession(session.id, {
      plan: result.text,
      planSource: result.source
    });
    res.json({
      source: result.source,
      type: result.type,
      pages: result.pages || 0,
      text: textPreview(result.text, 1200),
      chars: result.text.length
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/gandalf/generate/:sessionId", (req, res, next) => {
  req.socket.setTimeout(AI_TIMEOUT_MS);
  res.setTimeout(AI_TIMEOUT_MS);
  const progressId = selectedProgressId(req);

  (async () => {
    const session = requireSession(req.params.sessionId, "gandalf");
    const userInput = req.body?.userInput || {};
    const grundlagen = normalizeGrundlagen(userInput.grundlagen || session.data.grundlagen);
    updateSession(session.id, {
      grundlagen,
      inhalte: userInput.inhalte || session.data.inhalte || {},
      existingLs: userInput.existingLs ?? session.data.existingLs ?? "",
      methoden: userInput.methoden ?? session.data.methoden ?? "",
      nextHints: userInput.hints ?? session.data.nextHints ?? "",
      mode: req.body?.mode || session.data.mode || "create",
      totalLs: Number(req.body?.totalLs || session.data.totalLs || 1)
    });

    const updatedSession = requireSession(req.params.sessionId, "gandalf");
    const ls = await generateSingleLS(updatedSession, req.body || {}, {
      model: selectedModel(req),
      onProgress: createProgressReporter(progressId)
    });
    closeProgress(progressId, "Lernsituation generiert.");
    res.json({ ls });
  })().catch((error) => {
    closeProgress(progressId, error.message || "Gandalf-Generierung fehlgeschlagen.");
    next(error);
  });
});

app.post("/api/gandalf/approve/:sessionId", (req, res, next) => {
  try {
    const session = requireSession(req.params.sessionId, "gandalf");
    const approvedLS = Array.isArray(session.data.approvedLS)
      ? [...session.data.approvedLS]
      : [];
    const index = zeroBasedIndex(req.body?.lsIndex, approvedLS.length);

    approvedLS[index] = req.body?.ls || {};
    updateSession(session.id, {
      approvedLS,
      nextHints: String(req.body?.nextHints || "")
    });

    res.json({
      approved: approvedLS.filter(Boolean).length,
      total: Number(session.data.totalLs || approvedLS.length)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/gandalf/finalize/:sessionId", (req, res, next) => {
  try {
    const session = requireSession(req.params.sessionId, "gandalf");
    const document = finalizeGandalfDocument(session);
    validateLearningSituationCount(document);
    res.json({ document });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/gandalf/session/:sessionId", (req, res, next) => {
  try {
    requireSession(req.params.sessionId, "gandalf");
    deleteSession(req.params.sessionId);
    res.json({ ok: true });
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

function requireSession(id, type) {
  const session = getSession(id, type);
  if (!session) {
    throw new Error("Session wurde nicht gefunden oder ist abgelaufen.");
  }
  return session;
}

function uploadedFiles(req) {
  if (Array.isArray(req.files)) return req.files;
  return Object.values(req.files || {}).flat();
}

function firstUploadedFile(req, names) {
  for (const name of names) {
    const file = req.files?.[name]?.[0];
    if (file) return file;
  }
  return null;
}

function normalizeGrundlagen(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    anlage: cleanShort(source.anlage || source.beruf || source.bildungsgang || ""),
    beruf: cleanShort(source.beruf || source.anlage || source.bildungsgang || ""),
    fach: cleanShort(source.fach || ""),
    lernfeld: cleanShort(source.lernfeld || "")
  };
}

function zeroBasedIndex(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, fallback);
  return numeric <= 0 ? 0 : Math.max(0, numeric - 1);
}

function textPreview(value, maxLength = 700) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function cleanShort(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

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
