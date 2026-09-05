import { NextResponse } from "next/server";

import { type ApiError, errorBody } from "@/lib/errors";

/**
 * Origins allowed to call the API cross-site. Configure with
 * `ALLOWED_ORIGINS="https://a.com,https://b.com"` or `"*"`.
 * When unset, only same-origin requests are permitted (no ACAO header is sent,
 * which is what the browser enforces by default).
 */
function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Resolves the `Access-Control-Allow-Origin` value for a request origin. */
function resolveOrigin(origin: string | null): string | null {
  const allowed = allowedOrigins();
  if (allowed.length === 0) return null;
  if (allowed.includes("*")) return "*";
  if (origin && allowed.includes(origin)) return origin;
  return null;
}

/** CORS headers for a given request origin. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const resolved = resolveOrigin(origin);
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  if (resolved) {
    headers["Access-Control-Allow-Origin"] = resolved;
    // Credentials cannot be combined with a wildcard origin.
    if (resolved !== "*") headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

/** Standard preflight response. */
export function handlePreflight(request: Request): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

/** JSON success response with CORS headers applied. */
export function jsonResponse<T>(
  request: Request,
  data: T,
  status = 200,
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

/** JSON error response with CORS headers applied. */
export function errorResponse(
  request: Request,
  error: ApiError,
): NextResponse {
  return NextResponse.json(errorBody(error), {
    status: error.status,
    headers: corsHeaders(request.headers.get("origin")),
  });
}
