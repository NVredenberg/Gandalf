export function mapGandalfToLearningSituation(input = {}, index = 0, sessionData = {}) {
  const ls = normalizeGandalfResponse(input, index + 1);
  const methodLines = [
    labeledLine("Lern- und Arbeitstechniken", sessionData.methoden),
    labeledLine("Individuelle Foerderung", ls.individuell),
    labeledLine("Selbstgesteuertes Lernen", ls.sol)
  ].filter(Boolean);

  return {
    id: ls.id || `LS ${index + 1}`,
    einstieg: ls.situation,
    handlungsprodukt: ls.produkt,
    kompetenzen: splitCompetenceText(ls.ziel),
    inhalte: ls.konInhalt,
    methoden: methodLines.join("\n")
  };
}

export function normalizeGandalfResponse(value = {}, fallbackIndex = 1) {
  const source = value?.ls && typeof value.ls === "object" ? value.ls : value;
  return {
    id: cleanShort(source.id || source.nr || source.ls || `LS ${fallbackIndex}`, 40),
    situation: stringifyField(source.situation || source.einstieg || source.einstiegsszenario),
    produkt: stringifyField(source.produkt || source.handlungsprodukt || source.lernergebnis),
    ziel: stringifyField(source.ziel || source.kompetenzen || source.kompetenz),
    konInhalt: stringifyField(source.konInhalt || source.inhalte || source.konkretisierteInhalte),
    individuell: stringifyField(source.individuell || source.individuelleFoerderung),
    sol: stringifyField(source.sol || source.selbstgesteuertesLernen)
  };
}

function splitCompetenceText(value) {
  const lines = stringifyField(value)
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);

  return lines.length ? lines : [stringifyField(value)].filter(Boolean);
}

function stringifyField(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyField(item))
      .filter(Boolean)
      .join("\n");
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${stringifyField(entry)}`)
      .filter((line) => !line.endsWith(": "))
      .join("\n");
  }

  return cleanText(value);
}

function labeledLine(label, value) {
  const text = stringifyField(value);
  return text ? `${label}: ${text}` : "";
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanShort(value, maxLength) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}
