const progressStreams = new Map();

export function attachProgressStream(progressId, res) {
  if (!progressId) {
    res.status(400).json({ error: "Keine Fortschritts-ID empfangen." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive"
  });
  res.flushHeaders?.();
  res.write(": connected\n\n");

  if (!progressStreams.has(progressId)) {
    progressStreams.set(progressId, new Set());
  }

  const streams = progressStreams.get(progressId);
  streams.add(res);

  res.on("close", () => {
    streams.delete(res);
    if (streams.size === 0) {
      progressStreams.delete(progressId);
    }
  });
}

export function sendProgress(progressId, message, data = {}) {
  if (!progressId || !message) return;

  const streams = progressStreams.get(progressId);
  if (!streams?.size) return;

  const payload = JSON.stringify({
    message,
    ...data,
    timestamp: new Date().toISOString()
  });

  for (const res of streams) {
    res.write(`event: progress\n`);
    res.write(`data: ${payload}\n\n`);
  }
}

export function closeProgress(progressId, message = "Fertig.") {
  if (!progressId) return;

  sendProgress(progressId, message, { done: true });

  const streams = progressStreams.get(progressId);
  if (!streams?.size) return;

  for (const res of streams) {
    res.end();
  }

  progressStreams.delete(progressId);
}
