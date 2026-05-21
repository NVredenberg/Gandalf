import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptDir = path.join(__dirname, "prompts");
const cache = new Map();

export async function loadPromptAsset(fileName) {
  const safeName = path.basename(String(fileName || ""));
  if (!safeName) return "";
  if (cache.has(safeName)) return cache.get(safeName);

  try {
    const text = await fs.readFile(path.join(promptDir, safeName), "utf8");
    cache.set(safeName, text.trim());
    return cache.get(safeName);
  } catch (error) {
    console.warn(`[Prompt] ${safeName} konnte nicht geladen werden:`, error.message);
    cache.set(safeName, "");
    return "";
  }
}
