import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { requireSession } from "@/lib/auth";
import {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_EXTENSIONS,
  BLOB_FOLDER,
  MAX_FILE_BYTES,
  formatBytes,
  isSupportedModelFilename,
} from "@/lib/constants";
import { errorResponse, handlePreflight, jsonResponse } from "@/lib/cors";
import { createProject } from "@/lib/db";
import { ApiError, toApiError } from "@/lib/errors";
import { generateProjectId } from "@/lib/ids";
import type { UploadClientPayload, UploadTokenPayload } from "@/lib/types";

// The Blob client-upload handshake needs the Node runtime (crypto + pg driver).
export const runtime = "nodejs";
// Never cache token generation.
export const dynamic = "force-dynamic";

/** Parses and validates the JSON payload the browser attached to `upload()`. */
function parseClientPayload(raw: string | null): UploadClientPayload {
  if (!raw) {
    throw new ApiError(
      "invalid_request",
      "Missing clientPayload. The browser must send { title, sizeBytes, uploadRef }.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("invalid_request", "clientPayload is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ApiError("invalid_request", "clientPayload must be an object.");
  }

  const { title, sizeBytes, uploadRef } = parsed as Record<string, unknown>;

  if (typeof uploadRef !== "string" || uploadRef.length < 8) {
    throw new ApiError("invalid_request", "clientPayload.uploadRef is required.");
  }

  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new ApiError(
      "invalid_request",
      "clientPayload.sizeBytes must be a positive number.",
    );
  }

  if (sizeBytes > MAX_FILE_BYTES) {
    throw new ApiError(
      "file_too_large",
      `Model is ${formatBytes(sizeBytes)}. The maximum upload size is ${formatBytes(MAX_FILE_BYTES)}.`,
    );
  }

  const safeTitle =
    typeof title === "string" && title.trim().length > 0
      ? title.trim().slice(0, 120)
      : "Untitled space";

  return { title: safeTitle, sizeBytes, uploadRef };
}

/**
 * `POST /api/upload`
 *
 * Implements the two-phase Vercel Blob client-upload protocol:
 *
 *  1. The browser asks for a short-lived client token. We authenticate the
 *     caller, enforce the format + 30MB rules and mint the project id.
 *  2. The browser streams the file straight to Blob storage (bypassing the
 *     4.5MB serverless request body limit), then Blob calls this same route
 *     back with `type: "blob.upload-completed"` so we can persist metadata.
 */
export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;

  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return errorResponse(
      request,
      new ApiError("invalid_request", "Request body must be JSON."),
    );
  }

  try {
    const result = await handleUpload({
      body,
      request,

      // ---- Phase 1: authorize the upload and mint the client token ---------
      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        // Blob calls this on a normal browser request, so the session cookie
        // is available here. Unauthenticated callers can never get a token.
        const session = await requireSession(request);

        if (!isSupportedModelFilename(pathname)) {
          throw new ApiError(
            "invalid_file_type",
            `Only ${ALLOWED_EXTENSIONS.join(", ")} files can be uploaded to Menova Studios.`,
          );
        }

        const payload = parseClientPayload(clientPayloadRaw);
        const projectId = generateProjectId();

        const tokenPayload: UploadTokenPayload = {
          ...payload,
          projectId,
          ownerId: session.userId,
        };

        return {
          allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
          // Server-side ceiling. Vercel Blob aborts the transfer once the
          // stream exceeds this, so an oversized file cannot slip past the
          // client-side check.
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          // Models are immutable once written; cache them for a year.
          cacheControlMaxAge: 60 * 60 * 24 * 365,
          validUntil: Date.now() + 60 * 60 * 1000, // token good for 1 hour
          tokenPayload: JSON.stringify(tokenPayload),
        };
      },

      // ---- Phase 2: Blob webhook once the bytes have landed ---------------
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // This runs as a server-to-server callback with no cookies, so the
        // owner comes from the signed token payload we created above.
        if (!tokenPayload) {
          throw new ApiError(
            "internal_error",
            "Upload completed without a token payload; cannot attribute the project.",
          );
        }

        const payload = JSON.parse(tokenPayload) as UploadTokenPayload;

        await createProject({
          id: payload.projectId,
          title: payload.title,
          blobUrl: blob.url,
          blobPathname: blob.pathname,
          sizeBytes: payload.sizeBytes,
          ownerId: payload.ownerId,
          uploadRef: payload.uploadRef,
        });
      },
    });

    return jsonResponse(request, result);
  } catch (error) {
    const apiError = toApiError(error);
    // Log server-side failures; client validation errors are expected noise.
    if (apiError.status >= 500) {
      console.error("[api/upload] ", apiError.code, apiError.message, error);
    }
    return errorResponse(request, apiError);
  }
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handlePreflight(request);
}

/**
 * `GET /api/upload`
 *
 * Readiness probe + upload rules. The Blob client collapses every handshake
 * failure into "Failed to retrieve the client token", so the dashboard calls
 * this to surface the real cause (auth, missing env vars) to the user.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession(request);

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new ApiError(
        "misconfigured",
        "BLOB_READ_WRITE_TOKEN is not set. Link a Vercel Blob store (`vercel blob store add`) and run `vercel env pull .env.local`.",
      );
    }
    if (!process.env.POSTGRES_URL) {
      throw new ApiError(
        "misconfigured",
        "POSTGRES_URL is not set. Link a Vercel Postgres store and run `vercel env pull .env.local`.",
      );
    }

    return jsonResponse(request, {
      ready: true,
      maxFileBytes: MAX_FILE_BYTES,
      allowedExtensions: ALLOWED_EXTENSIONS,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      folder: BLOB_FOLDER,
    });
  } catch (error) {
    return errorResponse(request, toApiError(error));
  }
}
