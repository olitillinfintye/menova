import { createHash } from "node:crypto";
import { sql } from "@vercel/postgres";
import { ApiError, invalidRequest } from "@/lib/errors";

let schemaPromise: Promise<unknown> | null = null;

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || new URL(request.url).host;
  let originMatches = !origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      originMatches = ["http:", "https:"].includes(parsed.protocol) && parsed.host === host;
    } catch {
      originMatches = false;
    }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site" || !originMatches) {
    throw new ApiError("forbidden", "Submit this request from the Archviz website.");
  }
}

export async function readJson(request: Request, maxBytes = 32_768): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError("invalid_file_type", "The request must use JSON.");
  }
  if (Number(request.headers.get("content-length")) > maxBytes) {
    throw new ApiError("file_too_large", "The request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalidRequest("The request body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError("file_too_large", "The request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalidRequest("The request contains invalid JSON.");
  }
}

export async function consumeRateLimit(request: Request, scope: string, limit: number): Promise<boolean> {
  schemaPromise ??= sql`
    CREATE TABLE IF NOT EXISTS request_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
  `.catch((error: unknown) => { schemaPromise = null; throw error; });
  await schemaPromise;
  const address = process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "unknown"
    : "local";
  const key = createHash("sha256").update(`${scope}:${address}`).digest("hex");
  await sql`DELETE FROM request_limits WHERE expires_at < NOW() - INTERVAL '1 day';`;
  const { rows } = await sql<{ attempts: number }>`
    INSERT INTO request_limits (key, attempts, expires_at)
    VALUES (${key}, 1, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN request_limits.expires_at <= NOW() THEN 1 ELSE request_limits.attempts + 1 END,
      expires_at = CASE WHEN request_limits.expires_at <= NOW() THEN NOW() + INTERVAL '15 minutes' ELSE request_limits.expires_at END
    RETURNING attempts;
  `;
  return rows[0].attempts <= limit;
}

export function privateError(error: unknown): Response {
  if (error instanceof ApiError && error.status < 500) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("Request could not be completed by the storage service.");
  return Response.json({ error: "The service is temporarily unavailable. Please try again shortly." },
    { status: 503, headers: { "Cache-Control": "no-store" } });
}