# Lernfeld-DOCX-Generator

Lokales Node.js-System zur Erstellung, Analyse und Generierung didaktischer Lernfelddokumente.

## Zentrales Prinzip

Die KI verarbeitet ausschliesslich Inhalte. Layout, Tabellenstruktur und Reihenfolge werden ausschliesslich durch Code erzeugt.

Die Zielstruktur der LS-Tabelle steht in `backend/renderer/structure.js` und wird durch `backend/renderer/docxRenderer.js` deterministisch erzeugt:

```js
const structure = [
  "Kopfbereich",
  "Einstiegsszenario / Handlungsprodukt",
  "Wesentliche Kompetenzen / Konkretisierung der Inhalte",
  "Lern- und Arbeitstechniken",
  "Unterrichtsmaterialien / Fundstelle",
  "Organisatorische Hinweise"
];
```

Jede Lernsituation wird als 6-Zeilen-Tabelle mit 2 Spalten erzeugt. Zeile 1, 4, 5 und 6 nutzen verbundene Zellen.

## Docker-Start

```bash
ollama pull llama3.1:8b
docker compose up -d --build
```

Web-App:

```text
http://localhost:3010
```

Die generierten DOCX-Dateien werden nicht im Container gespeichert. Der Browser oeffnet einen Speichern-unter-Dialog oder nutzt den normalen Download-Ordner.

## Funktionen

- Upload von `.md` und `.docx`
- DOCX-Templates mit wiederholten 6-Zeilen-Tabellen werden direkt aus der Word-Tabellenstruktur gelesen
- DOCX-Fallback ueber Mammoth-Markdown und Mammoth-Rohtext
- KI-Pruefung ueber `http://localhost:11434/api/generate`
- zweistufige KI-Optimierung: Inhalte zuerst, Einstiegsszenarien danach in einem separaten Story-Durchlauf
- DOCX-Erzeugung ueber die `docx` Library

## KI-Debugging

Wenn Einstiegsszenarien nicht sichtbar vereinheitlicht werden, in `docker-compose.yml` setzen:

```yaml
AI_DEBUG: "1"
```

Dann neu starten:

```bash
docker compose up -d --build
docker compose logs -f lernfeld-docx
```

In den Logs erscheint ein Vorher/Nachher-Vergleich fuer jedes Einstiegsszenario.

## Modellwechsel

Das Modell wird ueber `OLLAMA_MODEL` gesetzt:

```yaml
OLLAMA_MODEL: "llama3.1:8b"
```

Auf deinem ThinkCentre mit i5-13400 und 32 GB RAM ist `llama3.1:8b` der stabile Startpunkt. Fuer bessere Schreib- und Story-Kohaerenz kannst du ein 12B/14B-Instruct-Modell testen, wenn du laengere Laufzeiten akzeptierst.

## API

- `POST /api/upload` mit Form-Feld `file`
- `POST /api/analyze` mit `{ "document": ... }`
- `POST /api/render` mit `{ "document": ... }`
- `GET /api/health`
