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
cp .env.example .env
ollama pull llama3.1:8b
ollama pull nomic-embed-text
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
- KI-Pruefung ueber Ollama auf dem Host (`host.docker.internal:11434` in Docker)
- schneller Button fuer reine Szenario-Generierung
- vollstaendige KI-Pruefung als separater, laengerer Schritt
- Metadaten und erkannte Lernsituationen vor der KI-Pruefung im Browser korrigierbar
- variable Modellauswahl direkt in der Homelab-KI-Leiste
- zweistufige Szenario-Generierung: Story-Kontext zuerst, Einstiegsszenarien danach
- optionale Einzelgenerierung pro Lernsituation ueber `SCENARIO_MODE=individual`
- persistenter RAG-Speicher in `data/rag.db` mit Ollama-Embeddings
- RAG-Statusanzeige, kuratierte Beispiele per `Als Beispiel merken` und Reset im Browser
- DOCX-Erzeugung ueber die `docx` Library
- Homelab-KI-Status direkt in der Web-Oberflaeche

## KI-Debugging

Wenn Einstiegsszenarien nicht sichtbar vereinheitlicht werden, in `.env` setzen:

```env
AI_DEBUG=1
```

Dann neu starten:

```bash
docker compose up -d --build
docker compose logs -f lernfeld-docx
```

In den Logs erscheint ein Vorher/Nachher-Vergleich fuer jedes Einstiegsszenario.

## Modellwechsel

Das Modell wird ueber `OLLAMA_MODEL` gesetzt:

```env
OLLAMA_MODEL=llama3.1:8b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

Auf deinem ThinkCentre mit i5-13400 und 32 GB RAM ist `llama3.1:8b` der stabile Startpunkt. Fuer bessere Schreib- und Story-Kohaerenz kannst du ein 12B/14B-Instruct-Modell testen, wenn du laengere Laufzeiten akzeptierst.

Die vollstaendige Homelab-Anleitung liegt in `docs/homelab-deployment.md`.

## API

- `POST /api/upload` mit Form-Feld `file`
- `POST /api/scenarios` mit `{ "document": ..., "model": "optional" }`
- `POST /api/analyze` mit `{ "document": ..., "model": "optional" }`
- `POST /api/render` mit `{ "document": ..., "model": "optional" }`
- `GET /api/rag/status`
- `POST /api/rag/examples` mit `{ "document": ..., "situation": ... }`
- `POST /api/rag/reindex` mit `{ "document": ... }`
- `DELETE /api/rag/reset`
- `GET /api/live`
- `GET /api/health`
