import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "@vercel/postgres";
import { ApiError, invalidRequest, unauthorized } from "@/lib/errors";

const deriveKey = promisify(scrypt);
export const MIN_NEW_ADMIN_PASSWORD_LENGTH = 16;

export interface AdminCredentials {
  password_hash: string;
  version: string;
  updated_at: Date | string;
}

let schemaPromise: Promise<unknown> | null = null;

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function matchesAdminPassword(password: unknown, encoded: string): Promise<boolean> {
  if (typeof password !== "string" || password.length > 1024) return false;
  const match = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/.exec(encoded);
  if (!match) return false;
  const key = await deriveKey(password, match[1], 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(match[2], "hex"));
}

export async function getAdminCredentials(): Promise<AdminCredentials | null> {
  if ((process.env.AUTH_SECRET?.length ?? 0) < 32) return null;
  if (!process.env.POSTGRES_URL) throw new Error("Admin database is not configured.");
  schemaPromise ??= sql`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      version UUID NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.catch((error: unknown) => { schemaPromise = null; throw error; });
  await schemaPromise;
  const { rows } = await sql<AdminCredentials>`SELECT password_hash, version, updated_at FROM admin_credentials WHERE id = 1;`;
  if (rows[0]) return rows[0];
  const bootstrap = process.env.ADMIN_PASSWORD;
  if (!bootstrap || bootstrap.length < 8 || bootstrap.length > 1024) return null;
  const hash = await hashAdminPassword(bootstrap);
  const version = randomUUID();
  await sql`
    INSERT INTO admin_credentials (id, password_hash, version)
    VALUES (1, ${hash}, ${version}) ON CONFLICT (id) DO NOTHING;
  `;
  const { rows: created } = await sql<AdminCredentials>`SELECT password_hash, version, updated_at FROM admin_credentials WHERE id = 1;`;
  return created[0] ?? null;
}

export async function changeAdminPassword(current: unknown, next: unknown): Promise<string> {
  if (typeof next !== "string" || next.length < MIN_NEW_ADMIN_PASSWORD_LENGTH || next.length > 1024) {
    throw invalidRequest(`New passwords must be ${MIN_NEW_ADMIN_PASSWORD_LENGTH} to 1024 characters long.`);
  }
  const credentials = await getAdminCredentials();
  if (!credentials || !await matchesAdminPassword(current, credentials.password_hash)) {
    throw unauthorized("The current password is incorrect.");
  }
  if (current === next) throw invalidRequest("Choose a different password.");
  const hash = await hashAdminPassword(next);
  const version = randomUUID();
  const { rowCount } = await sql`
    UPDATE admin_credentials SET password_hash = ${hash}, version = ${version}, updated_at = NOW()
    WHERE id = 1 AND version = ${credentials.version};
  `;
  if (!rowCount) throw new ApiError("conflict", "The password changed in another session. Sign in again.");
  return version;
}