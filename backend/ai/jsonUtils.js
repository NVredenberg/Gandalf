export function parseJsonResponse(value, preferred = "object") {
  try {
    return parseJsonValue(value, preferred);
  } catch (error) {
    throw new Error(`KI hat kein gueltiges JSON zurueckgegeben (${error.message}).`);
  }
}

export function parseJsonArray(value) {
  const parsed = parseJsonResponse(value, "any");
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.scenarios)) return parsed.scenarios;
  if (Array.isArray(parsed?.lernsituationen)) return parsed.lernsituationen;

  const firstArray = Object.values(parsed || {}).find((entry) => Array.isArray(entry));
  return firstArray || [];
}

function parseJsonValue(value, preferred = "object") {
  const cleaned = cleanJsonString(value);
  const candidates = uniqueCandidates([
    cleaned,
    ...extractBalancedJsonCandidates(cleaned, preferred),
    ...extractBalancedJsonCandidates(cleaned, preferred === "array" ? "object" : "array")
  ]);

  for (const candidate of candidates) {
    for (const variant of uniqueCandidates([candidate, repairJsonString(candidate)])) {
      try {
        return JSON.parse(variant);
      } catch {
        // Naechste Variante versuchen.
      }
    }
  }

  throw new Error(buildJsonParseHint(cleaned));
}

function extractBalancedJsonCandidates(value, preferred = "object") {
  const text = String(value || "");
  const openChars =
    preferred === "array" ? ["["] : preferred === "object" ? ["{"] : ["{", "["];
  const candidates = [];

  for (let index = 0; index < text.length; index += 1) {
    if (!openChars.includes(text[index])) continue;
    const slice = balancedJsonSlice(text, index);
    if (slice) candidates.push(slice);
  }

  return candidates;
}

function balancedJsonSlice(text, startIndex) {
  const open = text[startIndex];
  const close = open === "{" ? "}" : "]";
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char !== "}" && char !== "]") continue;

    const expectedOpen = char === "}" ? "{" : "[";
    if (stack.at(-1) !== expectedOpen) return "";
    stack.pop();

    if (!stack.length && char === close) {
      return text.slice(startIndex, index + 1);
    }
  }

  return "";
}

function repairJsonString(value) {
  return String(value || "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/}\s*(?={)/g, "},{")
    .replace(/]\s*(?=\[)/g, "],[")
    .replace(
      /("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?|[}\]])\s*(?="[^"]+"\s*:)/g,
      "$1,"
    );
}

function cleanJsonString(value) {
  return String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function uniqueCandidates(values) {
  return [...new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function buildJsonParseHint(value) {
  const preview = String(value || "").slice(0, 220).replace(/\s+/g, " ");
  return `Antwort beginnt mit: ${preview}`;
}
