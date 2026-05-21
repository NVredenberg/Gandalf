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

SearXNG wird nicht von dieser Compose-Datei gestartet. Die App nutzt einen bereits vorhandenen SearXNG-Dienst ueber `SEARXNG_URL`, standardmaessig `http://host.docker.internal:8080`. Wenn dein bestehender SearXNG auf einem anderen Host oder Port laeuft, passe `SEARXNG_URL` in `.env` an.

Groessere PDFs fuer Frodo oder Gandalf werden ueber `UPLOAD_MAX_MB` begrenzt. Standard sind `100` MB. Wenn ein Rahmenlehrplan oder Pruefungskatalog groesser ist, kann der Wert in `.env` erhoeht werden.

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
- PDF-Parsing fuer Rahmenlehrplaene, Pruefungskataloge und Gandalf-Hintergrunddokumente
- Frodo-Wizard fuer Lernfeldanalyse aus Rahmenlehrplan und Pruefungskatalog
- Gandalf-Wizard fuer sequentielle LS-Erstellung oder Optimierung mit Nutzerfreigabe pro LS
- originale Assistenten-Prompts unter `backend/ai/prompts/Fordo_v1.txt` und `backend/ai/prompts/Gandalf_v3.txt`
- Admin-Panel fuer die fuenf festen Gandalf-Hintergrunddokumente unter `data/assistant-docs`
- optionale Websuche ueber einen lokalen SearXNG-Service
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
OLLAMA_NUM_CTX=32768
```

Auf deinem ThinkCentre mit i5-13400 und 32 GB RAM ist `llama3.1:8b` der stabile Startpunkt. Fuer bessere Schreib- und Story-Kohaerenz kannst du ein 12B/14B-Instruct-Modell testen, wenn du laengere Laufzeiten akzeptierst.

Die vollstaendige Homelab-Anleitung liegt in `docs/homelab-deployment.md`.

## API

- `POST /api/upload` mit Form-Feld `file`
- `GET /api/admin/docs`
- `POST /api/admin/docs/:slot` mit PDF-Form-Feld `file`
- `DELETE /api/admin/docs/:slot`
- `GET /api/admin/web-search/status`
- `POST /api/frodo/session`
- `POST /api/frodo/upload/:sessionId` mit PDF-Feldern `rahmenlehrplan` und `pruefungskatalog`
- `POST /api/frodo/analyze/:sessionId`
- `POST /api/frodo/search/:sessionId`
- `POST /api/gandalf/session`
- `POST /api/gandalf/upload-plan/:sessionId` mit PDF-Form-Feld `file`
- `POST /api/gandalf/search-plan/:sessionId`
- `POST /api/gandalf/fetch-url/:sessionId`
- `POST /api/gandalf/generate/:sessionId`
- `POST /api/gandalf/approve/:sessionId`
- `POST /api/gandalf/finalize/:sessionId`
- `POST /api/scenarios` mit `{ "document": ..., "model": "optional" }`
- `POST /api/analyze` mit `{ "document": ..., "model": "optional" }`
- `POST /api/render` mit `{ "document": ..., "model": "optional" }`
- `GET /api/rag/status`
- `POST /api/rag/examples` mit `{ "document": ..., "situation": ... }`
- `POST /api/rag/reindex` mit `{ "document": ... }`
- `DELETE /api/rag/reset`
- `GET /api/live`
- `GET /api/health`
