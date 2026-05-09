import http from "node:http";
import https from "node:https";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const OLLAMA_TAGS_URL = buildTagsUrl(OLLAMA_URL);
const OLLAMA_NUM_CTX = readPositiveInteger(process.env.OLLAMA_NUM_CTX, 16384);
const OLLAMA_TIMEOUT_MS = readPositiveInteger(
  process.env.OLLAMA_TIMEOUT_MS,
  30 * 60 * 1000
);

export function getOllamaConfig() {
  return {
    url: OLLAMA_URL,
    model: OLLAMA_MODEL,
    tagsUrl: OLLAMA_TAGS_URL,
    numCtx: OLLAMA_NUM_CTX,
    timeoutMs: OLLAMA_TIMEOUT_MS
  };
}

export async function checkOllamaStatus(timeoutMs = 5000) {
  try {
    const response = await requestJson(OLLAMA_TAGS_URL, { timeoutMs });

    if (!isHttpOk(response.statusCode)) {
      return {
        ok: false,
        url: OLLAMA_TAGS_URL,
        model: OLLAMA_MODEL,
        error: `Ollama-Fehler ${response.statusCode}: ${response.bodyText}`
      };
    }

    const models = Array.isArray(response.json?.models)
      ? response.json.models.map((item) => item.name).filter(Boolean)
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
  }
}

export async function generateWithOllama(prompt, settings = {}) {
  const model = settings.model || OLLAMA_MODEL;
  const startedAt = Date.now();
  const body = {
    model,
    prompt,
    stream: false,
    think: false,
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

  if (settings.system) {
    body.system = settings.system;
  }

  console.log(
    `[Ollama] Anfrage gestartet: model=${model}, prompt=${prompt.length} Zeichen, ctx=${body.options.num_ctx}`
  );

  let response;
  try {
    response = await requestJson(OLLAMA_URL, {
      method: "POST",
      body,
      timeoutMs: OLLAMA_TIMEOUT_MS
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(buildOllamaTimeoutMessage());
    }

    throw new Error(buildOllamaConnectionMessage(error));
  }

  if (!isHttpOk(response.statusCode)) {
    throw new Error(`Ollama-Fehler ${response.statusCode}: ${response.bodyText}`);
  }

  if (!response.json) {
    throw new Error(
      `Ollama hat keine gueltige JSON-Antwort zurueckgegeben: ${response.bodyText.slice(0, 500)}`
    );
  }

  console.log(
    `[Ollama] Antwort erhalten nach ${formatDuration(Date.now() - startedAt)}: ` +
      `${(response.json.response || "").length} Zeichen`
  );

  return response.json.response || "";
}

function requestJson(url, { method = "GET", body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const bodyText = body === undefined ? undefined : JSON.stringify(body);
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const request = transport.request(
      parsedUrl,
      {
        method,
        headers: bodyText
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(bodyText)
            }
          : undefined
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const responseText = chunks.join("");
          let json;

          if (responseText) {
            try {
              json = JSON.parse(responseText);
            } catch {
              json = undefined;
            }
          }

          resolve({
            statusCode: response.statusCode || 0,
            bodyText: responseText,
            json
          });
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      const error = new Error(`Timeout nach ${timeoutMs / 60000} Minuten`);
      error.name = "TimeoutError";
      request.destroy(error);
    });

    if (bodyText) {
      request.write(bodyText);
    }

    request.end();
  });
}

function buildOllamaConnectionMessage(error) {
  const parts = [
    `Ollama ist nicht erreichbar (${error.message}).`,
    `URL: ${OLLAMA_URL}`,
    `Modell: ${OLLAMA_MODEL}`,
    `Kontext: ${OLLAMA_NUM_CTX}`
  ];
  const cause = describeConnectionCause(error);

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

function buildOllamaTimeoutMessage() {
  return (
    `Ollama Timeout nach ${OLLAMA_TIMEOUT_MS / 60000} Minuten. ` +
    "Das Modell laeuft noch, laedt zu lange oder ist haengengeblieben. " +
    "Pruefe auf dem Homelab-Server: ollama ps und sudo systemctl status ollama"
  );
}

function describeConnectionCause(error) {
  const cause = error.cause;
  const details = [error.code, cause?.code, cause?.message].filter(Boolean);
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

function isHttpOk(statusCode) {
  return statusCode >= 200 && statusCode < 300;
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}
