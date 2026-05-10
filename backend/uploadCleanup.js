import fs from "node:fs/promises";
import path from "node:path";

export const PROTECTED_UPLOAD_FILES = Object.freeze([
  ".gitkeep",
  "frontend-preview.err.log",
  "frontend-preview.out.log"
]);

const protectedUploadFiles = new Set(PROTECTED_UPLOAD_FILES);

export async function cleanUploadsDir(uploadDir) {
  await fs.mkdir(uploadDir, { recursive: true });
  const entries = await fs.readdir(uploadDir, { withFileTypes: true });
  const result = { deleted: [], skipped: [] };

  for (const entry of entries) {
    if (protectedUploadFiles.has(entry.name)) {
      result.skipped.push(entry.name);
      continue;
    }

    if (!entry.isFile()) {
      result.skipped.push(entry.name);
      continue;
    }

    const filePath = path.join(uploadDir, entry.name);
    await fs.rm(filePath, { force: true });
    result.deleted.push(entry.name);
  }

  return result;
}

export function scheduleUploadCleanup(uploadDir, intervalMs = 60 * 60 * 1000) {
  const timer = setInterval(() => {
    cleanUploadsDir(uploadDir).catch((error) => {
      console.warn("[Uploads] Cleanup fehlgeschlagen:", error.message);
    });
  }, intervalMs);

  timer.unref?.();
  return timer;
}

export function cleanupUploadedFiles(filePaths = []) {
  const uniquePaths = [...new Set(filePaths.filter(Boolean))];

  return Promise.all(
    uniquePaths.map((filePath) =>
      fs.rm(filePath, { force: true }).catch((error) => {
        console.warn(`[Uploads] Datei konnte nicht geloescht werden (${filePath}):`, error.message);
      })
    )
  );
}
