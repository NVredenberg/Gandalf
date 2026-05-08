export const ALLOWED_TAGS = Object.freeze(["AK", "IG", "MK"]);

export const TAG_COLORS = Object.freeze({
  AK: "3498DB",
  IG: "2ECC71",
  MK: "E67E22",
  NONE: "404040"
});

export function normalizeLearningDocument(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawSituations = Array.isArray(source.lernsituationen)
    ? source.lernsituationen
    : [];

  const lernsituationen = rawSituations.map((item, index) =>
    normalizeLearningSituation(item, index)
  );

  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};

  return {
    meta: {
      beruf: cleanText(meta.beruf),
      fach: cleanText(meta.fach),
      lernfeld: cleanText(meta.lernfeld),
      anzahl_ls: lernsituationen.length
    },
    lernsituationen
  };
}

export function normalizeAiDocument(original, aiCandidate) {
  const base = normalizeLearningDocument(original);
  const candidate = normalizeLearningDocument(aiCandidate);

  return {
    meta: base.meta,
    lernsituationen: base.lernsituationen.map((situation, index) => {
      const incoming = candidate.lernsituationen[index];
      if (!incoming) {
        return situation;
      }

      return {
        id: situation.id,
        einstieg: incoming.einstieg || situation.einstieg,
        handlungsprodukt: incoming.handlungsprodukt || situation.handlungsprodukt,
        kompetenzen: mergeCompetences(situation.kompetenzen, incoming.kompetenzen),
        inhalte: incoming.inhalte || situation.inhalte,
        methoden: incoming.methoden || situation.methoden
      };
    })
  };
}

export function normalizeTags(tags = []) {
  const values = Array.isArray(tags) ? tags : [];
  const normalized = [];

  for (const tag of values) {
    const clean = String(tag || "").trim().toUpperCase();
    if (ALLOWED_TAGS.includes(clean) && !normalized.includes(clean)) {
      normalized.push(clean);
    }
  }

  return normalized;
}

export function extractTagsFromText(value = "") {
  const tags = [];
  const text = String(value || "")
    .replace(/\[(AK|IG|MK)\]/gi, (_match, tag) => {
      const normalized = tag.toUpperCase();
      if (!tags.includes(normalized)) {
        tags.push(normalized);
      }
      return "";
    })
    .replace(/\b(AK|IG|MK)\s*[:\-–]\s*/gi, (_match, tag) => {
      const normalized = tag.toUpperCase();
      if (!tags.includes(normalized)) {
        tags.push(normalized);
      }
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();

  return { text, tags: tags.length ? tags : inferTagsFromText(text) };
}

export function competenceColor(competence) {
  const firstTag = normalizeTags(competence?.tags)[0];
  return TAG_COLORS[firstTag] || TAG_COLORS.NONE;
}

function normalizeLearningSituation(input = {}, index = 0) {
  const source = input && typeof input === "object" ? input : {};

  return {
    id: cleanText(source.id) || `LS ${index + 1}`,
    einstieg: cleanText(source.einstieg),
    handlungsprodukt: cleanText(source.handlungsprodukt),
    kompetenzen: normalizeCompetences(source.kompetenzen),
    inhalte: cleanText(source.inhalte),
    methoden: cleanText(source.methoden)
  };
}

function normalizeCompetences(input = []) {
  const values = Array.isArray(input) ? input : [];

  return values
    .map((item) => {
      if (typeof item === "string") {
        const extracted = extractTagsFromText(item);
        return {
          text: extracted.text,
          tags: extracted.tags
        };
      }

      const source = item && typeof item === "object" ? item : {};
      const extracted = extractTagsFromText(source.text);
      const tags = normalizeTags(source.tags).length
        ? normalizeTags(source.tags)
        : extracted.tags;

      return {
        text: extracted.text,
        tags
      };
    })
    .filter((item) => item.text.length > 0);
}

function mergeCompetences(original = [], incoming = []) {
  const optimized = Array.isArray(incoming) && incoming.length
    ? normalizeCompetences(incoming)
    : [];
  const fallback = normalizeCompetences(original);

  if (!optimized.length) {
    return fallback;
  }

  return optimized.map((competence, index) => {
    if (competence.tags.length) {
      return competence;
    }

    return {
      ...competence,
      tags: fallback[index]?.tags || inferTagsFromText(competence.text)
    };
  });
}

function inferTagsFromText(value = "") {
  const text = String(value || "").toLowerCase();
  const tags = [];

  if (/\banwendungskompetenz\b|\bak\b|anwenden|nutzen|einsetzen|umsetzen/.test(text)) {
    tags.push("AK");
  }

  if (/\binformatische\s+grundbildung\b|\big\b|algorithm|daten|modell|system/.test(text)) {
    tags.push("IG");
  }

  if (/\bmedienkompetenz\b|\bmk\b|medien|kommunikation|praesent|präsent|quelle|recherch/.test(text)) {
    tags.push("MK");
  }

  return tags;
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
