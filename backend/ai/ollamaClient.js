const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const OLLAMA_TAGS_URL = buildTagsUrl(OLLAMA_URL);
const OLLAMA_NUM_CTX = readPositiveInteger(process.env.OLLAMA_NUM_CTX, 16384);

// Großzügiger Timeout für schwere Modelle auf CPU.
// qwen3:14b-q8_0 braucht beim ersten Aufruf 30–60 s nur zum Laden,
// danach mehrere Minuten für lange Prompts (Szenario-Harmonisierung).
// 20 Minuten decken auch den worst case ab.
const TIMEOUT_MS = 20 * 60 * 1000;

export function getOllamaConfig() {
  return {
    url: OLLAMA_URL,
    model: OLLAMA_MODEL,
    tagsUrl: OLLAMA_TAGS_URL,
    numCtx: OLLAMA_NUM_CTX
  };
}

export async function checkOllamaStatus(timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OLLAMA_TAGS_URL, {
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        url: OLLAMA_TAGS_URL,
        model: OLLAMA_MODEL,
        error: `Ollama-Fehler ${response.status}: ${await response.text()}`
      };
    }

    const data = await response.json();
    const models = Array.isArray(data.models)
      ? data.models.map((item) => item.name).filter(Boolean)
      : [];

    return {
      ok: true,
      url: OLLAMA_TAGS_URL,
      model: OLLAMA_MODEL,
      modelAvailable: models.includes(OLLAMA_MODEL),
      models
    };
  } catch (error) {
    return {
      ok: false,
      url: OLLAMA_TAGS_URL,
      model: OLLAMA_MODEL,
      error: buildOllamaConnectionMessage(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateWithOllama(prompt, settings = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body = {
    model: settings.model || OLLAMA_MODEL,
    prompt,
    stream: false,
    think: false,   // Qwen3 Thinking-Modus deaktivieren — für JSON-Aufgaben
                    // unnötig und sprengt den 4096-Token-Standardkontext
    options: {
      temperature: settings.temperature ?? 0.1,
      top_p: settings.topP ?? 0.85,
      repeat_penalty: settings.repeatPenalty ?? 1.05,
      num_ctx: settings.numCtx ?? OLLAMA_NUM_CTX
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
    throw new Error(buildOllamaConnectionMessage(error));
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

function buildOllamaConnectionMessage(error) {
  const parts = [
    `Ollama ist nicht erreichbar (${error.message}).`,
    `URL: ${OLLAMA_URL}`,
    `Modell: ${OLLAMA_MODEL}`,
    `Kontext: ${OLLAMA_NUM_CTX}`
  ];
  const cause = describeFetchCause(error);

  if (cause) {
    parts.push(`Ursache: ${cause}`);
  }

  parts.push(`Pruefe zuerst, ob Ollama laeuft und ${OLLAMA_TAGS_URL} antwortet.`);

  if (OLLAMA_URL.includes("host.docker.internal")) {
    parts.push(
      "Wenn die App in Docker laeuft: Ollama auf dem Host fuer Docker freigeben " +
      "(OLLAMA_HOST=0.0.0.0:11434) und Ollama neu starten."
    );
  }

  return parts.join(" ");
}

function describeFetchCause(error) {
  const cause = error.cause;
  const details = [cause?.code, cause?.message].filter(Boolean);
  return [...new Set(details)].join(" - ");
}

function buildTagsUrl(generateUrl) {
  try {
    const url = new URL(generateUrl);
    url.pathname = "/api/tags";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://localhost:11434/api/tags";
  }
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
