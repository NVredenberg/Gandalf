export function splitMethodSections(value = "") {
  const sections = { methoden: [], materialien: [], organisation: [] };
  let target = "methoden";

  for (const block of String(value || "").split(/\n+/)) {
    const line = block.trim();
    if (!line) continue;

    const techniquesMatch = line.match(/^Lern-\s*und\s*Arbeitstechniken\s*:\s*(.*)$/i);
    if (techniquesMatch) {
      target = "methoden";
      if (techniquesMatch[1]) sections[target].push(techniquesMatch[1]);
      continue;
    }

    const individualMatch = line.match(/^Individuelle\s+F(?:ö|oe)rderung\s*:\s*(.*)$/i);
    if (individualMatch) {
      target = "methoden";
      sections[target].push(`Individuelle Foerderung: ${individualMatch[1] || ""}`.trim());
      continue;
    }

    const solMatch = line.match(/^Selbstgesteuertes\s+Lernen\s*:\s*(.*)$/i);
    if (solMatch) {
      target = "methoden";
      sections[target].push(`Selbstgesteuertes Lernen: ${solMatch[1] || ""}`.trim());
      continue;
    }

    const materialMatch = line.match(/^Unterrichtsmaterialien\s*\/?\s*Fundstelle\s*:\s*(.*)$/i);
    if (materialMatch) {
      target = "materialien";
      if (materialMatch[1]) sections[target].push(materialMatch[1]);
      continue;
    }

    const organisationMatch = line.match(/^Organisatorische Hinweise\s*:\s*(.*)$/i);
    if (organisationMatch) {
      target = "organisation";
      if (organisationMatch[1]) sections[target].push(organisationMatch[1]);
      continue;
    }

    sections[target].push(line);
  }

  return {
    methoden: sections.methoden.join("\n"),
    materialien: sections.materialien.join("\n"),
    organisation: sections.organisation.join("\n")
  };
}

export function fallbackKiMapping(situation) {
  const text = situationText(situation);
  const explicitKi = hasExplicitKiSignal(text);

  return {
    summary: fallbackKiSummary(situation, text),
    grundlagen:
      explicitKi && hasAny(text, [
        "grundlage", "funktionsweise", "algorithm", "modell", "datenqualitaet",
        "datenqualit", "training", "prompt", "maschinelles lernen", "ki-system"
      ]),
    anwendung:
      (explicitKi && hasAny(text, [
        "nutzen", "anwenden", "einsetzen", "recherch", "generier",
        "auswert", "vergleich", "dokumentier", "assistenz"
      ])) ||
      hasAny(text, ["chatbot", "chatgpt", "ki-gestuetzt", "ollama", "llm"]),
    entwicklung:
      hasAny(text, ["ki-loesung", "ki-system", "ki-workflow"]) ||
      (explicitKi && hasAny(text, [
        "entwickl", "prototyp", "workflow", "automatisierung", "pipeline",
        "system entwerfen", "modellieren", "programmier", "implementier"
      ])),
    gesellschaftRecht: hasAny(text, [
      "datenschutz", "urheber", "recht", "bias", "diskrimin", "transparen",
      "verantwort", "ethik", "gesellschaft", "quelle", "quellenkritik"
    ])
  };
}

function fallbackKiSummary(situation, text) {
  const competence = situation.kompetenzen[0]?.text || "";
  const product = situation.handlungsprodukt || "";
  const content = situation.inhalte || "";

  if (hasExplicitKiSignal(text)) {
    return sentence(
      `Die Lernenden bearbeiten ${shortText(product || competence, 70)} und reflektieren dabei den KI- oder Datenbezug anhand von ${shortText(content || competence, 90)}.`
    );
  }

  if (competence || product) {
    return sentence(
      `Die Lernenden bearbeiten ${shortText(product || "ein berufliches Handlungsprodukt", 70)} und wenden dabei ${shortText(competence || content, 110)} fachbezogen an.`
    );
  }

  return "Die Lernsituation enthaelt keinen eindeutig erkennbaren KI-Bezug; die fachliche Zuordnung sollte manuell geprueft werden.";
}

function situationText(situation) {
  return [
    situation.einstieg,
    situation.handlungsprodukt,
    situation.inhalte,
    situation.methoden,
    ...(situation.kompetenzen || []).map((competence) => competence.text)
  ]
    .join(" ")
    .toLowerCase();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function hasExplicitKiSignal(text) {
  return /\b(ki|ai|llm)\b/.test(text) || hasAny(text, [
    "chatgpt", "ollama", "llama", "qwen", "prompt", "algorithmus",
    "maschinelles lernen", "kuenstliche intelligenz", "intelligenzmodell"
  ]);
}

function shortText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text || "-";
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function sentence(value) {
  const text = String(value || "").trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
