# Deployment ins Homelab

Zielsystem laut `homelab-ki-setup-2026-aktuell.md`:

- KI-Rechner: ThinkCentre `192.168.178.68`
- Ollama laeuft direkt auf dem Host, nicht in Docker
- Docker-Services liegen unter `/data/docker/...`
- Open WebUI nutzt bereits Port `3000`
- Diese App laeuft deshalb auf Port `3010`

Web-App:

```text
http://192.168.178.68:3010
```

## Zielpfad

Empfohlener Ordner auf dem KI-Rechner:

```bash
/data/docker/lernfeld-docx
```

## Dateien kopieren

Auf dem Windows-Rechner im Projektordner:

```powershell
scp -r . USER@192.168.178.68:/tmp/lernfeld-docx
```

Auf dem KI-Rechner:

```bash
sudo mkdir -p /data/docker/lernfeld-docx
sudo cp -a /tmp/lernfeld-docx/. /data/docker/lernfeld-docx/
sudo chown -R "$USER:$USER" /data/docker/lernfeld-docx
cd /data/docker/lernfeld-docx
```

`USER` durch deinen Linux-Benutzer auf dem ThinkCentre ersetzen.

## Konfiguration

Eine lokale `.env` aus der Vorlage anlegen:

```bash
cp .env.example .env
```

Standardwerte fuer dein Homelab:

```env
APP_PORT=3010
OLLAMA_URL=http://host.docker.internal:11434/api/generate
OLLAMA_MODEL=llama3.1:8b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_NUM_CTX=16384
OLLAMA_NUM_PREDICT=4096
OLLAMA_TIMEOUT_MS=1800000
AI_TIMEOUT_MS=2700000
SCENARIO_MODE=batch
AI_DEBUG=0
UPLOAD_MAX_MB=100
PDF_MIN_TEXT_CHARS=200
PDF_OCR_ENABLED=1
PDF_OCR_LANG=deu+eng
PDF_OCR_MAX_PAGES=60
PDF_OCR_DPI=180
PDF_OCR_TIMEOUT_MS=120000
```

`llama3.1:8b` ist der stabile Standard fuer komplexere Dokumentaufgaben auf dem ThinkCentre. `llama3.2:3b` ist schneller, aber bei langen didaktischen Texten schwaecher.

Fuer maximale Szenarioqualitaet kannst du optional `SCENARIO_MODE=individual` setzen. Dann wird jede Lernsituation einzeln generiert; das dauert laenger, liefert aber oft ausfuehrlichere und passgenauere Einstiegssituationen.

OCR ist fuer Frodo/Gandalf automatisch aktiv, wenn eine PDF keine brauchbare Textschicht enthaelt. Bei sehr langen gescannten Dokumenten kannst du `PDF_OCR_MAX_PAGES` erhoehen; das verlaengert den Upload-Schritt deutlich.

## Ollama auf dem Host vorbereiten

Auf dem KI-Rechner:

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
curl http://localhost:11434/api/tags
```

Da die App in Docker laeuft, muss Ollama fuer Container erreichbar sein:

```bash
sudo systemctl edit ollama
```

Eintragen:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_MODELS=/data/ollama/models"
```

Danach:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
curl http://192.168.178.68:11434/api/tags
```

Falls die Firewall aktiv ist:

```bash
sudo ufw allow 11434/tcp
```

Port `11434` nur im LAN/VPN freigeben, nicht oeffentlich ins Internet.

## Container starten

Im Projektordner auf dem KI-Rechner:

```bash
docker compose up -d --build
```

Status pruefen:

```bash
docker compose ps
docker compose logs -f lernfeld-docx
```

## Ollama-Verbindung aus dem Container testen

```bash
docker compose exec lernfeld-docx wget -qO- http://host.docker.internal:11434/api/tags
```

Wenn hier Modelle als JSON erscheinen und `llama3.1:8b` gelistet ist, ist die Verbindung sauber.

Die App zeigt denselben Zustand in der Oberflaeche als `Homelab-KI` Status an.

## Speichern-unter-Dialog auf dem Laptop

Ein echter Ordner-Auswahldialog ist im Browser nur auf `localhost` oder per HTTPS zuverlaessig erlaubt. Wenn du die Datei direkt auf deinem Laptop in einen frei gewaehlten Ordner speichern moechtest, oeffne die App ueber einen SSH-Tunnel.

Auf dem Laptop:

```bash
ssh -L 3010:localhost:3010 USER@192.168.178.68
```

Dann im Browser:

```text
http://localhost:3010
```

Bei direktem Zugriff ueber `http://192.168.178.68:3010` faellt der Browser je nach Sicherheitseinstellung auf den normalen Download-Ordner zurueck.

## Dateien

Die erzeugten DOCX-Dateien werden nicht im Container gespeichert. Beim Klick auf `Speichern unter` waehlst du den Zielordner im Browser aus.

Uploads bleiben fuer die Verarbeitung auf dem Host sichtbar:

```text
/data/docker/lernfeld-docx/data/uploads
```

Der lokale RAG-Speicher liegt dauerhaft hier:

```text
/data/docker/lernfeld-docx/data/rag.db
```

## Aktualisieren

Neue Version kopieren, dann:

```bash
cd /data/docker/lernfeld-docx
docker compose up -d --build
```

## Stoppen

```bash
cd /data/docker/lernfeld-docx
docker compose down
```

## Troubleshooting

Ollama lauscht nicht fuer Docker:

```bash
sudo ss -tlnp | grep 11434
```

Erwartet wird `0.0.0.0:11434`.

Container erreicht Ollama nicht:

```bash
docker compose exec lernfeld-docx wget -qO- http://host.docker.internal:11434/api/tags
```

Wenn `host.docker.internal` nicht aufloest, pruefe in `docker-compose.yml`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Modell fehlt:

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
ollama list
```
