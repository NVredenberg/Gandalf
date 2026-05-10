import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesRoot = path.resolve(__dirname, "..", "..", "data", "examples");

export async function loadExampleContext(document, options = {}) {
  const beruf = String(document?.meta?.beruf || "").trim();
  if (!beruf) return "";

  const maxExamples = options.maxExamples ?? 2;
  const maxCharsPerExample = options.maxCharsPerExample ?? 1400;
  const files = await listMarkdownFiles(examplesRoot);
  if (!files.length) return "";

  const scored = [];
  for (const filePath of files) {
    const content = await readTextFile(filePath);
    if (!content) continue;

    const score = scoreExample(filePath, content, beruf);
    if (score <= 0) continue;

    scored.push({ filePath, content, score });
  }

  const examples = scored
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
    .slice(0, maxExamples)
    .map((item, index) => {
      const label = path.basename(item.filePath, path.extname(item.filePath));
      return `Beispiel ${index + 1} (${label}):\n${truncateExample(item.content, maxCharsPerExample)}`;
    });

  if (!examples.length) return "";

  return `Orientierungsbeispiele fuer gut formulierte Lernsituationen:\n\n${examples.join("\n\n---\n\n")}`;
}

async function listMarkdownFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listMarkdownFiles(entryPath);
        return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [entryPath] : [];
      })
    );

    return nested.flat();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function scoreExample(filePath, content, beruf) {
  const berufSlug = slugify(beruf);
  const normalizedPath = slugify(filePath);
  const normalizedContent = normalizeText(content);
  const normalizedBeruf = normalizeText(beruf);
  let score = 0;

  if (normalizedPath.includes(berufSlug)) score += 6;
  if (normalizedContent.includes(normalizedBeruf)) score += 4;

  for (const term of significantTerms(beruf)) {
    if (normalizedPath.includes(slugify(term))) score += 2;
    if (normalizedContent.includes(normalizeText(term))) score += 1;
  }

  return score;
}

function significantTerms(value) {
  return String(value || "")
    .split(/[^A-Za-zÄÖÜäöüß0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 5);
}

function truncateExample(value, maxChars) {
  const text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function slugify(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

export const __exampleLoaderInternals = Object.freeze({
  scoreExample,
  slugify
});
