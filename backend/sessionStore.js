import crypto from "node:crypto";

const sessions = new Map();
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export function createSession(type, data = {}) {
  const id = crypto.randomUUID();
  sessions.set(id, {
    id,
    type,
    created: Date.now(),
    updated: Date.now(),
    data: { ...data }
  });
  return id;
}

export function getSession(id, type) {
  const session = sessions.get(String(id || ""));
  if (!session) return null;
  if (type && session.type !== type) return null;
  return session;
}

export function updateSession(id, patch) {
  const session = sessions.get(String(id || ""));
  if (!session) return null;

  session.data = {
    ...session.data,
    ...(patch || {})
  };
  session.updated = Date.now();
  sessions.set(id, session);
  return session;
}

export function deleteSession(id) {
  return sessions.delete(String(id || ""));
}

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.created < cutoff) {
      sessions.delete(id);
    }
  }
}, 30 * 60 * 1000);

cleanupTimer.unref?.();
