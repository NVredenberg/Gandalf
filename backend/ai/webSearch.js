import { parsePdfBuffer } from "../parser/pdfParser.js";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8080";
const DEFAULT_ENGINES = process.env.SEARXNG_ENGINES || "google,duckduckgo,bing";

export function getWebSearchConfig() {
  return {
    url: SEARXNG_URL,
    engines: DEFAULT_ENGINES
  };
}

export async function searchWeb(query, options = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) {
    throw new Error("Keine Suchanfrage angegeben.");
  }

  const params = new URLSearchParams({
    q: cleanQuery,
    format: "json",
    language: options.language || "de",
    engines: options.engines || DEFAULT_ENGINES,
    pageno: String(options.page || 1)
  });

  const response = await fetchWithTimeout(`${SEARXNG_URL}/search?${params}`, {
    timeoutMs: options.timeoutMs || 15000
  });

  if (!response.ok) {
    throw new Error(`SearXNG-Fehler ${response.status}: ${await safeResponseText(response)}`);
  }

  const data = await response.json();
  return (data.results || []).slice(0, options.topK || 5).map((result) => ({
    title: cleanText(result.title, 180),
    url: result.url,
    snippet: cleanText(result.content || result.snippet || "", 360)
  }));
}

export function searchQualIsNrw(beruf, lernfeld) {
  const query = `site:qua-lis.nrw.de ${beruf || ""} ${lernfeld || ""} Rahmenlehrplan`;
  return searchWeb(query, { engines: "google", topK: 6 });
}

export async function fetchReadableUrl(url, options = {}) {
  const parsedUrl = parseSafeUrl(url);
  const response = await fetchWithTimeout(parsedUrl.toString(), {
    timeoutMs: options.timeoutMs || 20000,
    headers: {
      "User-Agent": "Lernfeld-DOCX-Generator/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Seite konnte nicht geladen werden (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/pdf") || parsedUrl.pathname.toLowerCase().endsWith(".pdf")) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const pdf = await parsePdfBuffer(buffer);
    return {
      text: compactText(pdf.text, options.maxChars || 50000),
      source: parsedUrl.toString(),
      type: "pdf",
      pages: pdf.pages
    };
  }

  const html = await response.text();
  return {
    text: compactText(htmlToReadableText(html), options.maxChars || 50000),
    source: parsedUrl.toString(),
    type: "html"
  };
}

export async function checkWebSearchStatus() {
  const startedAt = Date.now();
  const results = await searchWeb("Rahmenlehrplan NRW", { topK: 1, timeoutMs: 8000 });
  return {
    ok: true,
    url: SEARXNG_URL,
    latencyMs: Date.now() - startedAt,
    results: results.length
  };
}

function parseSafeUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Ungueltige URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Nur http- und https-URLs werden unterstuetzt.");
  }

  return url;
}

function htmlToReadableText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, num) => String.fromCodePoint(Number.parseInt(num, 10)));
}

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
}

async function safeResponseText(response) {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "";
  }
}

function cleanText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}\n\n[Text gekuerzt]`;
}
