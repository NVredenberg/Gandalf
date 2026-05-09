import { extractTagsFromText, normalizeLearningDocument } from "./schema.js";

const metaPatterns = [
  ["beruf", /^\s*beruf\s*[:\-–]\s*(.+)$/i],
  ["fach", /^\s*fach\s*[:\-–]\s*(.+)$/i],
  ["lernfeld", /^\s*(?:lernfeld|lf)\s*[:\-–]\s*(.+)$/i]
];

const sectionAliases = [
  { key: "einstieg", aliases: ["einstiegsszenario", "einstieg", "einstiegsszenarion", "einstiegssituation", "ausgangssituation", "szenario", "problemstellung"] },
  { key: "handlungsprodukt", aliases: ["handlungsprodukt", "handlungsergebnis", "lernergebnis", "lernprodukt", "produkt", "ergebnis"] },
  { key: "kompetenzen", aliases: ["kompetenzen", "kompetenz", "wesentlichekompetenzen", "kompetenzerwartungen", "lernkompetenzen"] },
  { key: "inhalte", aliases: ["inhalte", "inhalt", "konkretisierungderinhalte", "lerninhalt", "lerninhalte", "fachinhalte"] },
  { key: "methoden", aliases: ["methoden", "methode", "methodik", "lernundarbeitstechniken", "lernmethoden", "sozialformen"] }
];

export function parseMarkdownText(markdown) {
  const lines = normalizeInput(markdown).split("\n");
  const meta = extractMeta(lines);
  const situations = [];
  let current = null;
  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const lsMatch = detectLearningSituation(line);

    if (lsMatch) {
      if (current) {
        situations.push(current);
      }

      current = createSituation(lsMatch.id);
      currentSection = null;
      continue;
    }

    if (!current) {
      const firstSection = detectSectionLine(line);
      if (firstSection) {
        current = createSituation("LS 1");
        currentSection = firstSection.key;
        appendSectionContent(current, currentSection, firstSection.content);
      }
      continue;
    }

    const sectionMatch = detectSectionLine(line);
    if (sectionMatch) {
      currentSection = sectionMatch.key;
      appendSectionContent(current, currentSection, sectionMatch.content);
      continue;
    }

    if (currentSection) {
      current.sections[currentSection].push(line);
    }
  }

  if (current) {
    situations.push(current);
  }

  return normalizeLearningDocument({
    meta,
    lernsituationen: situations.map(toJsonSituation)
  });
}

function extractMeta(lines) {
  const meta = { beruf: "", fach: "", lernfeld: "", anzahl_ls: 0 };

  for (const line of lines) {
    if (detectLearningSituation(line)) {
      break;
    }

    const clean = stripMarkdownDecorators(line);
    for (const [key, pattern] of metaPatterns) {
      const match = clean.match(pattern);
      if (match && !meta[key]) {
        meta[key] = match[1].trim();
      }
    }

    const headingMatch = clean.match(/^(lernfeld\s+.+)$/i);
    if (headingMatch && !meta.lernfeld) {
      meta.lernfeld = headingMatch[1].trim();
    }
  }

  return meta;
}

function normalizeInput(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, "  ");
}

function detectLearningSituation(line) {
  const clean = stripMarkdownDecorators(line);
  if (!clean) {
    return null;
  }

  const explicitMatch = clean.match(/^(?:lern(?:situation)?|ls)\s*[:.]?\s*(\d+(?:\.\d+)?)(?:\s*[-–:]\s*(.+))?$/i);
  if (explicitMatch) {
    return { id: `LS ${explicitMatch[1]}` };
  }

  const numberedMatch = clean.match(/^(\d+(?:\.\d+)?)\s+(?:lern(?:situation)?|ls)\b(?:\s*[-–:]\s*(.+))?$/i);
  if (numberedMatch) {
    return { id: `LS ${numberedMatch[1]}` };
  }

  const headingNumberMatch = clean.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (headingNumberMatch && !detectSectionLine(clean)) {
    const title = headingNumberMatch[2].trim();
    if (/lern|situation|auftrag/i.test(title) && title.length <= 90) {
      return { id: `LS ${headingNumberMatch[1]}` };
    }
  }

  return null;
}

function detectSectionLine(line) {
  const clean = stripMarkdownDecorators(line);
  if (!clean) {
    return null;
  }

  const exactSection = canonicalSection(clean.replace(/[:\-–]\s*$/, ""));
  if (exactSection) {
    return { key: exactSection, content: "" };
  }

  const labelMatch = clean.match(/^(?:[a-z][\.)]\s*|\d+[\.)]?\s*)?([a-zäöüß /]+?)\s*(?:[:：]|[-–])\s*(.*)$/i);
  if (!labelMatch) {
    return null;
  }

  const section = canonicalSection(labelMatch[1]);
  return section ? { key: section, content: labelMatch[2].trim() } : null;
}

function createSituation(rawId) {
  return {
    id: rawId.toUpperCase().replace(/^LS\s*/i, "LS ").replace(/\s+/g, " ").trim(),
    sections: {
      einstieg: [],
      handlungsprodukt: [],
      kompetenzen: [],
      inhalte: [],
      methoden: []
    }
  };
}

function canonicalSection(title) {
  const normalized = stripMarkdownDecorators(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^([a-z])(?=einstieg|handlungs|kompetenz|inhalt|method)/, "")
    .replace(/[^a-z]/g, "");

  for (const group of sectionAliases) {
    if (group.aliases.includes(normalized)) {
      return group.key;
    }

    if (group.aliases.some((alias) => normalized.endsWith(alias) && normalized.length <= alias.length + 2)) {
      return group.key;
    }
  }

  return null;
}

function toJsonSituation(situation) {
  return {
    id: situation.id,
    einstieg: cleanBlock(situation.sections.einstieg),
    handlungsprodukt: cleanBlock(situation.sections.handlungsprodukt),
    kompetenzen: parseCompetences(situation.sections.kompetenzen),
    inhalte: cleanBlock(situation.sections.inhalte),
    methoden: cleanBlock(situation.sections.methoden)
  };
}

function parseCompetences(lines) {
  const items = [];
  let current = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      current = null;
      continue;
    }

    const startsNewItem = /^\s*[-*+•]\s+/.test(rawLine) || /^\s*\[(AK|IG|MK)\]/i.test(trimmed) || !current;
    const text = trimmed.replace(/^\s*[-*+•]\s*/, "").trim();

    if (startsNewItem) {
      current = text;
      items.push(current);
      continue;
    }

    current = `${current} ${text}`.replace(/\s+/g, " ").trim();
    items[items.length - 1] = current;
  }

  return items
    .filter(Boolean)
    .map((item) => {
      const extracted = extractTagsFromText(item);
      return { text: extracted.text, tags: extracted.tags, segments: extracted.segments };
    })
    .filter((item) => item.text.length > 0);
}

function cleanBlock(lines) {
  return lines.join("\n").replace(/^\s+|\s+$/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function appendSectionContent(situation, section, content) {
  if (content) {
    situation.sections[section].push(content);
  }
}

function stripMarkdownDecorators(line) {
  return String(line || "")
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*>+\s*/, "")
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .trim();
}
