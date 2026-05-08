const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

export async function generateWithOllama(prompt, settings = {}) {
  let response;
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

  try {
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(`Ollama ist nicht erreichbar: ${error.message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama-Fehler ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.response || "";
}
