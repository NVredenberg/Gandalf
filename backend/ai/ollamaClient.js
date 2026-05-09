const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

// Großzügiger Timeout für schwere Modelle auf CPU.
// qwen3:14b-q8_0 braucht beim ersten Aufruf 30–60 s nur zum Laden,
// danach mehrere Minuten für lange Prompts (Szenario-Harmonisierung).
// 20 Minuten decken auch den worst case ab.
const TIMEOUT_MS = 20 * 60 * 1000;

export async function generateWithOllama(prompt, settings = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body = {
    model: settings.model || OLLAMA_MODEL,
    prompt,
    stream: false,
    options: {
      temperature: settings.temperature ?? 0.1,
      top_p: settings.topP ?? 0.85,
      repeat_penalty: settings.repeatPenalty ?? 1.05
    }
  };

  if (settings.format) {
    body.format = settings.format;
  }

  let response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Ollama Timeout nach ${TIMEOUT_MS / 60000} Minuten. ` +
        "Modell läuft noch oder ist beim Laden hängengeblieben. " +
        "Prüfe: sudo systemctl status ollama"
      );
    }
    throw new Error(`Ollama ist nicht erreichbar: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama-Fehler ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.response || "";
}