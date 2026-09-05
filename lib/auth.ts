import { cookies } from "next/headers";

import { forbidden, unauthorized } from "@/lib/errors";

export const SESSION_COOKIE = "menova_session";

/** Owner id used when `ALLOW_ANONYMOUS=true` (local development only). */
export const ANONYMOUS_OWNER_ID = "public";

export interface Session {
  /** Stable owner identifier stored on every project row. */
  userId: string;
  /** How the caller proved their identity. */
  source: "cookie" | "bearer" | "anonymous";
}

const encoder = new TextEncoder();

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Generate one with `openssl rand -hex 32`.",
    );
  }
  return secret;
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Buffer.from(signature).toString("base64url");
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Builds a signed session cookie value: `<userId>.<hmac>`.
 * Wire this up to whichever identity provider you adopt (Auth.js, Clerk, ...).
 */
export async function createSessionValue(userId: string): Promise<string> {
  if (!userId || userId.includes(".")) {
    throw new Error("userId must be a non-empty string without dots.");
  }
  return `${userId}.${await hmac(userId)}`;
}

async function verifySessionValue(value: string): Promise<string | null> {
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const userId = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  try {
    return safeEqual(signature, await hmac(userId)) ? userId : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the caller's session, or `null` when the request is anonymous.
 *
 * Resolution order:
 *  1. Signed `menova_session` cookie.
 *  2. `Authorization: Bearer <MENOVA_API_TOKEN>` for server-to-server calls.
 *  3. `ALLOW_ANONYMOUS=true` development escape hatch.
 */
export async function getSession(request?: Request): Promise<Session | null> {
  const header = request?.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    const expected = process.env.MENOVA_API_TOKEN;
    if (expected && token && safeEqual(token, expected)) {
      return { userId: ANONYMOUS_OWNER_ID, source: "bearer" };
    }
    // A malformed or stale bearer token is an explicit failure, not a fallback.
    if (expected) return null;
  }

  try {
    const store = await cookies();
    const raw = store.get(SESSION_COOKIE)?.value;
    if (raw) {
      const userId = await verifySessionValue(raw);
      if (userId) return { userId, source: "cookie" };
    }
  } catch {
    // `cookies()` throws outside a request scope (e.g. blob upload webhooks).
  }

  if (process.env.ALLOW_ANONYMOUS === "true") {
    return { userId: ANONYMOUS_OWNER_ID, source: "anonymous" };
  }

  return null;
}

/** Same as `getSession` but throws a 401 `ApiError` when unauthenticated. */
export async function requireSession(request?: Request): Promise<Session> {
  const session = await getSession(request);
  if (!session) throw unauthorized();
  return session;
}

/** Throws a 403 unless `ownerId` matches the session user. */
export function assertOwner(session: Session, ownerId: string): void {
  if (session.userId !== ownerId) throw forbidden();
}
