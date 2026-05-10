import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { generateEmbedding, getOllamaConfig } from "./ollamaClient.js";
import { normalizeLearningDocument } from "../parser/schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDbPath = process.env.RAG_DB_PATH || path.resolve(__dirname, "..", "..", "data", "rag.db");
const defaultTopK = 2;

export function createRagStore(options = {}) {
  const dbPath = options.dbPath || defaultDbPath;
  const embeddingProvider = options.embeddingProvider || generateEmbedding;
  let db = null;

  async function getDb() {
    if (db) return db;

    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS situations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        beruf TEXT NOT NULL,
        beruf_normalized TEXT NOT NULL,
        situation_id TEXT NOT NULL,
        text TEXT NOT NULL,
        situation_json TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_situations_beruf
        ON situations (beruf_normalized);
    `);

    return db;
  }

  async function indexSituation(situation, options = {}) {
    const meta = options.meta || {};
    const text = buildSituationText(situation, meta);
    if (!text) return null;

    const embeddingModel =
      options.embeddingModel || getOllamaConfig().embeddingModel || "nomic-embed-text";
    const embedding = normalizeEmbedding(
      options.embedding || await embeddingProvider(text, { model: embeddingModel })
    );

    if (!embedding.length) return null;

    const database = await getDb();
    const hash = situationHash(situation, meta, text);
    const beruf = cleanShortText(meta.beruf || "");
    const situationId = cleanShortText(situation?.id || "");
    const approved = options.approved ? 1 : 0;

    database
      .prepare(`
        INSERT INTO situations (
          hash,
          beruf,
          beruf_normalized,
          situation_id,
          text,
          situation_json,
          embedding_json,
          embedding_model,
          approved,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(hash) DO UPDATE SET
          beruf = excluded.beruf,
          beruf_normalized = excluded.beruf_normalized,
          situation_id = excluded.situation_id,
          text = excluded.text,
          situation_json = excluded.situation_json,
          embedding_json = excluded.embedding_json,
          embedding_model = excluded.embedding_model,
          approved = CASE
            WHEN excluded.approved = 1 THEN 1
            ELSE situations.approved
          END,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        hash,
        beruf,
        normalizeForMatch(beruf),
        situationId,
        text,
        JSON.stringify(situation || {}),
        JSON.stringify(embedding),
        embeddingModel,
        approved
      );

    return { hash, situationId, beruf, embeddingModel, approved: Boolean(approved) };
  }

  async function indexDocumentSituations(input, options = {}) {
    const document = normalizeLearningDocument(input);
    const indexed = [];

    for (const situation of document.lernsituationen) {
      try {
        const result = await indexSituation(situation, {
          ...options,
          meta: document.meta
        });
        if (result) indexed.push(result);
      } catch (error) {
        console.warn(`[RAG] ${situation.id} konnte nicht indexiert werden:`, error.message);
      }
    }

    return indexed;
  }

  async function retrieveSimilar(queryEmbedding, topK = defaultTopK, options = {}) {
    const embedding = normalizeEmbedding(queryEmbedding);
    if (!embedding.length) return [];

    const database = await getDb();
    const rows = database
      .prepare(`
        SELECT id, hash, beruf, beruf_normalized, situation_id, text,
               situation_json, embedding_json, embedding_model, approved, updated_at
        FROM situations
      `)
      .all();
    const beruf = normalizeForMatch(options.beruf || "");

    return rows
      .map((row) => {
        const rowEmbedding = parseEmbedding(row.embedding_json);
        const similarity = cosineSimilarity(embedding, rowEmbedding);
        const berufBoost = beruf && row.beruf_normalized === beruf ? 0.05 : 0;
        const approvedBoost = row.approved ? 0.03 : 0;
        return {
          ...row,
          situation: parseJson(row.situation_json),
          similarity,
          score: similarity + berufBoost + approvedBoost
        };
      })
      .filter((row) => Number.isFinite(row.similarity) && row.similarity > 0)
      .sort((left, right) => right.score - left.score || right.updated_at.localeCompare(left.updated_at))
      .slice(0, topK);
  }

  async function retrieveSimilarForDocument(input, options = {}) {
    const document = normalizeLearningDocument(input);
    const queryText = buildDocumentQueryText(document);
    if (!queryText) return [];

    const embeddingModel =
      options.embeddingModel || getOllamaConfig().embeddingModel || "nomic-embed-text";
    const embedding = normalizeEmbedding(
      options.embedding || await embeddingProvider(queryText, { model: embeddingModel })
    );

    return retrieveSimilar(embedding, options.topK || defaultTopK, {
      beruf: document.meta.beruf
    });
  }

  async function loadRagExampleContext(input, options = {}) {
    try {
      const entries = await retrieveSimilarForDocument(input, options);
      if (!entries.length) return "";

      return formatRagExamples(entries);
    } catch (error) {
      console.warn("[RAG] Abruf aehnlicher Beispiele uebersprungen:", error.message);
      return "";
    }
  }

  async function getStatus(options = {}) {
    const database = await getDb();
    const limit = Math.max(1, Math.min(50, Number(options.limit) || 8));
    const totals = database
      .prepare(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(approved), 0) AS approved
        FROM situations
      `)
      .get();
    const recent = database
      .prepare(`
        SELECT id, beruf, situation_id, approved, embedding_model, updated_at,
               substr(text, 1, 220) AS preview
        FROM situations
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(limit);

    return {
      total: Number(totals?.total || 0),
      approved: Number(totals?.approved || 0),
      recent: recent.map((row) => ({
        ...row,
        approved: Boolean(row.approved)
      }))
    };
  }

  async function reset() {
    const database = await getDb();
    const before = database.prepare("SELECT COUNT(*) AS total FROM situations").get();
    database.exec("DELETE FROM situations; VACUUM;");

    return {
      deleted: Number(before?.total || 0)
    };
  }

  function close() {
    db?.close();
    db = null;
  }

  return {
    close,
    getStatus,
    indexDocumentSituations,
    indexSituation,
    loadRagExampleContext,
    reset,
    retrieveSimilar,
    retrieveSimilarForDocument
  };
}

const defaultStore = createRagStore();

export const indexDocumentSituations = defaultStore.indexDocumentSituations;
export const indexSituation = defaultStore.indexSituation;
export const loadRagExampleContext = defaultStore.loadRagExampleContext;
export const retrieveSimilar = defaultStore.retrieveSimilar;
export const getRagStatus = defaultStore.getStatus;
export const resetRagStore = defaultStore.reset;

export function buildSituationText(situation, meta = {}) {
  const competences = Array.isArray(situation?.kompetenzen)
    ? situation.kompetenzen.map((competence) => competence?.text).filter(Boolean)
    : [];

  return [
    `Beruf: ${meta.beruf || "-"}`,
    `Fach: ${meta.fach || "-"}`,
    `Lernfeld: ${meta.lernfeld || "-"}`,
    `Lernsituation: ${situation?.id || "-"}`,
    `Einstieg: ${situation?.einstieg || "-"}`,
    `Handlungsprodukt: ${situation?.handlungsprodukt || "-"}`,
    `Kompetenzen: ${competences.join(" | ") || "-"}`,
    `Inhalte: ${situation?.inhalte || "-"}`,
    `Methoden: ${situation?.methoden || "-"}`
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function buildDocumentQueryText(document) {
  const situations = document.lernsituationen
    .map((situation) => buildSituationText(situation, document.meta))
    .join("\n\n---\n\n");

  return situations || [
    `Beruf: ${document.meta.beruf || "-"}`,
    `Fach: ${document.meta.fach || "-"}`,
    `Lernfeld: ${document.meta.lernfeld || "-"}`
  ].join("\n");
}

function formatRagExamples(entries) {
  const examples = entries.map((entry, index) => {
    const situation = entry.situation || {};
    const title = [entry.beruf, entry.situation_id].filter(Boolean).join(" - ");
    return `Gespeichertes Beispiel ${index + 1}${title ? ` (${title})` : ""}:
${truncateText(buildSituationText(situation, { beruf: entry.beruf }), 1400)}`;
  });

  return `Aehnliche gespeicherte Lernsituationen:\n\n${examples.join("\n\n---\n\n")}`;
}

function situationHash(situation, meta, text) {
  return createHash("sha256")
    .update(JSON.stringify({
      beruf: normalizeForMatch(meta.beruf || ""),
      id: situation?.id || "",
      text
    }))
    .digest("hex");
}

function parseEmbedding(value) {
  try {
    return normalizeEmbedding(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeEmbedding(values) {
  return Array.isArray(values)
    ? values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
}

function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanShortText(value, maxLength = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}
