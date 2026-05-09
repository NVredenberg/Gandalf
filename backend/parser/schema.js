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
  const legacyTags = [];
  const withoutLegacyTags = String(value || "")
    .replace(/\[(AK|IG|MK)\]/gi, (_match, tag) => {
      const normalized = tag.toUpperCase();
      if (!legacyTags.includes(normalized)) {
        legacyTags.push(normalized);
      }
      return "";
    })
    .replace(/\b(AK|IG|MK)\s*[:\-\u2013]\s*/gi, (_match, tag) => {
      const normalized = tag.toUpperCase();
      if (!legacyTags.includes(normalized)) {
        legacyTags.push(normalized);
      }
      return "";
    });
  const segments = extractInlineSegments(withoutLegacyTags);
  const text = cleanInlineText(segments.map((segment) => segment.text).join(""));
  const inlineTags = uniqueTags(segments.map((segment) => segment.tag).filter(Boolean));
  const tags = uniqueTags([...legacyTags, ...inlineTags]);

  return {
    text,
    tags: tags.length ? tags : inferTagsFromText(text),
    segments: normalizeSegments(segments, text)
  };
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
          tags: extracted.tags,
          segments: extracted.segments
        };
      }

      const source = item && typeof item === "object" ? item : {};
      const extracted = extractTagsFromText(source.text);
      const explicitTags = normalizeTags(source.tags);
      const tags = explicitTags.length ? explicitTags : extracted.tags;
      const segments = normalizeInputSegments(source.segments, extracted.segments, extracted.text);

      return {
        text: extracted.text,
        tags,
        segments
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
    const fallbackCompetence = fallback[index];

    if (hasTaggedSegments(competence)) {
      return competence;
    }

    if (hasTaggedSegments(fallbackCompetence)) {
      return fallbackCompetence;
    }

    if (competence.tags.length) {
      return competence;
    }

    return {
      ...competence,
      tags: fallbackCompetence?.tags || inferTagsFromText(competence.text)
    };
  });
}

function extractInlineSegments(value = "") {
  const source = String(value || "");
  const tagPattern = /<\/?(AK|IG|MK)>/gi;
  const segments = [];
  let activeTag = null;
  let lastIndex = 0;
  let match;

  while ((match = tagPattern.exec(source)) !== null) {
    appendSegment(segments, source.slice(lastIndex, match.index), activeTag);

    const tag = match[1].toUpperCase();
    const isClosingTag = match[0].startsWith("</");
    activeTag = isClosingTag ? null : tag;
    lastIndex = tagPattern.lastIndex;
  }

  appendSegment(segments, source.slice(lastIndex), activeTag);
  return segments;
}

function appendSegment(segments, text, tag) {
  if (!text) return;
  const normalizedTag = normalizeTags([tag])[0] || null;
  const previous = segments.at(-1);

  if (previous && previous.tag === normalizedTag) {
    previous.text += text;
    return;
  }

  segments.push({ text, tag: normalizedTag });
}

function normalizeInputSegments(sourceSegments, fallbackSegments, fallbackText) {
  const normalized = Array.isArray(sourceSegments)
    ? sourceSegments
        .map((segment) => ({
          text: String(segment?.text || ""),
          tag: normalizeTags([segment?.tag])[0] || null
        }))
        .filter((segment) => segment.text)
    : [];

  return normalizeSegments(normalized.length ? normalized : fallbackSegments, fallbackText);
}

function normalizeSegments(segments = [], fallbackText = "") {
  const normalized = [];

  for (const segment of segments) {
    const text = String(segment?.text || "").replace(/\s+/g, " ");
    if (!text.trim()) continue;
    appendSegment(normalized, text, segment?.tag || null);
  }

  trimSegmentEdges(normalized);

  const text = cleanInlineText(normalized.map((segment) => segment.text).join(""));
  if (!text && fallbackText) {
    return [{ text: fallbackText, tag: null }];
  }

  return normalized.length ? normalized : [{ text, tag: null }].filter((segment) => segment.text);
}

function trimSegmentEdges(segments) {
  if (!segments.length) return;
  segments[0].text = segments[0].text.trimStart();
  segments[segments.length - 1].text = segments.at(-1).text.trimEnd();
}

function hasTaggedSegments(competence) {
  return Array.isArray(competence?.segments) && competence.segments.some((segment) => segment.tag);
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

  if (/\bmedienkompetenz\b|\bmk\b|medien|kommunikation|praesent|pr\u00e4sent|quelle|recherch/.test(text)) {
    tags.push("MK");
  }

  return tags;
}

function uniqueTags(tags = []) {
  return normalizeTags(tags);
}

function cleanInlineText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
