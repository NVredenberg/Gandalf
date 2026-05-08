# Deployment ins Homelab

Zielsystem laut Setup:

- KI-Rechner: ThinkCentre `192.168.178.68`
- Ollama läuft direkt auf dem Host
- Docker-Services liegen unter `/data/docker/...`
- Port `3000` ist bereits durch Open WebUI belegt

Dieses Projekt läuft deshalb auf:

```text
http://192.168.178.68:3010
```

## Zielpfad

Empfohlener Ordner auf dem KI-Rechner:

```bash
/data/docker/lernfeld-docx
```

## Variante A: Direkt per SCP von Windows kopieren

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

## Variante B: Per rsync kopieren

Auf dem Windows-Rechner, falls `rsync` verfügbar ist:

```bash
rsync -av --delete \
  --exclude node_modules \
  --exclude data/uploads \
  ./ USER@192.168.178.68:/data/docker/lernfeld-docx/
```

## Ollama prüfen

Auf dem KI-Rechner:

```bash
ollama pull llama3.1:8b
curl http://localhost:11434/api/tags
```

Wenn Ollama aus Docker-Containern noch nicht erreichbar ist:

```bash
sudo systemctl edit ollama
```

Eintragen:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Danach:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

## Container starten

Im Projektordner auf dem KI-Rechner:

```bash
docker compose up -d --build
```

Status prüfen:

```bash
docker compose ps
docker compose logs -f lernfeld-docx
```

## Öffnen

Im Browser:

```text
http://192.168.178.68:3010
```

## Empfohlen: Speichern-unter-Dialog auf dem Laptop

Ein echter Ordner-Auswahldialog ist im Browser nur auf `localhost` oder per HTTPS zuverlässig erlaubt. Wenn du die Datei direkt auf deinem Laptop in einen frei gewählten Ordner speichern möchtest, öffne die App über einen SSH-Tunnel.

Auf dem Laptop:

```bash
ssh -L 3010:localhost:3010 USER@192.168.178.68
```

Dann im Browser auf dem Laptop öffnen:

```text
http://localhost:3010
```

In Chrome oder Edge öffnet der Button `Speichern unter` dann den nativen Dateidialog. Bei direktem Zugriff über `http://192.168.178.68:3010` fällt der Browser je nach Sicherheitseinstellung auf den normalen Download-Ordner zurück.

## Ollama-Verbindung aus dem Container testen

```bash
docker compose exec lernfeld-docx wget -qO- http://host.docker.internal:11434/api/tags
```

Wenn hier Modelle als JSON erscheinen, ist die Verbindung sauber.

## Dateien

Die erzeugten DOCX-Dateien werden nicht auf dem ThinkCentre gespeichert. Beim Klick auf `Speichern unter` wählst du den Zielordner auf deinem Laptop im Browser aus.

Uploads bleiben für die Verarbeitung auf dem Host sichtbar:

```text
/data/docker/lernfeld-docx/data/uploads
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
