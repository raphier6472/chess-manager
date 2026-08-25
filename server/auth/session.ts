import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";

export const SESSION_COOKIE_NAME = "cm_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);
const TTL_MS = TTL_HOURS * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(): { token: string; cookieMaxAgeMs: number } {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (id, expires_at) VALUES (?, ?)").run(hashToken(token), expiresAt);
  return { token, cookieMaxAgeMs: TTL_MS };
}

export function touchSession(token: string): boolean {
  const id = hashToken(token);
  const row = db.prepare("SELECT id FROM sessions WHERE id = ? AND expires_at > datetime('now')").get(id);
  if (!row) return false;
  const newExpiry = new Date(Date.now() + TTL_MS).toISOString();
  db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(newExpiry, id);
  return true;
}

export function destroySession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
}
