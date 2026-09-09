import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "menova_admin";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

export function adminSigningConfigured(): boolean {
  return (process.env.AUTH_SECRET?.length ?? 0) >= 32;
}

function signature(payload: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Admin authentication is not configured.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function equalSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function createAdminSession(version: string, now = Date.now()): string {
  if (!adminSigningConfigured()) throw new Error("Admin authentication is not configured.");
  if (!/^[0-9a-f-]{36}$/i.test(version)) throw new Error("Invalid credential version.");
  const payload = `${Math.floor(now / 1000) + ADMIN_SESSION_SECONDS}.${version}.${randomUUID()}`;
  return `${payload}.${signature(payload)}`;
}

export function getAdminSessionVersion(value: string | undefined, now = Date.now()): string | null {
  if (!adminSigningConfigured() || !value || value.length > 200) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [expires, version, nonce, signed] = parts;
  const deadline = Number(expires);
  const current = Math.floor(now / 1000);
  if (!Number.isInteger(deadline) || deadline <= current || deadline > current + ADMIN_SESSION_SECONDS) return null;
  return equalSecret(signed, signature(`${expires}.${version}.${nonce}`)) ? version : null;
}

export function verifyAdminSession(value: string | undefined, version: string, now = Date.now()): boolean {
  return getAdminSessionVersion(value, now) === version;
}