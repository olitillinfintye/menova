import { del } from "@vercel/blob";

import { assertOwner, requireSession } from "@/lib/auth";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  formatBytes,
  isProjectId,
  isSupportedModelFilename,
} from "@/lib/constants";
import { errorResponse, handlePreflight, jsonResponse } from "@/lib/cors";
import { createProject, deleteProject, getProject, listProjects } from "@/lib/db";
import { ApiError, invalidRequest, notFound, toApiError } from "@/lib/errors";
import { generateProjectId } from "@/lib/ids";
import type { ProjectListResponse, ProjectResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/projects`
 *
 * Returns every project owned by the caller, newest first. Powers the
 * dashboard grid.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);
    const projects = await listProjects(session.userId);
    return jsonResponse<ProjectListResponse>(request, { projects });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) {
      console.error("[api/projects GET] ", apiError.message, error);
    }
    return errorResponse(request, apiError);
  }
}

/**
 * `POST /api/projects`
 *
 * Registers an upload that has already landed in Blob storage.
 *
 * `onUploadCompleted` in `/api/upload` is the primary write path, but that
 * webhook can only reach a publicly routable deployment — it never fires
 * against `localhost`. The browser therefore calls this route once `upload()`
 * resolves. Both paths share the same `uploadRef`, and the unique constraint
 * on that column makes the write idempotent, so exactly one row is created no
 * matter which arrives first.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw invalidRequest("Request body must be JSON.");
    }

    const { title, blobUrl, blobPathname, sizeBytes, uploadRef } =
      (raw ?? {}) as Record<string, unknown>;

    if (typeof blobUrl !== "string" || !URL.canParse(blobUrl)) {
      throw invalidRequest("blobUrl must be an absolute URL.");
    }
    if (typeof blobPathname !== "string" || !isSupportedModelFilename(blobPathname)) {
      throw invalidRequest(
        `blobPathname must reference a ${ALLOWED_EXTENSIONS.join(", ")} file.`,
      );
    }
    if (typeof uploadRef !== "string" || uploadRef.length < 8) {
      throw invalidRequest("uploadRef is required.");
    }
    if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw invalidRequest("sizeBytes must be a positive number.");
    }
    if (sizeBytes > MAX_FILE_BYTES) {
      throw new ApiError(
        "file_too_large",
        `Model is ${formatBytes(sizeBytes)}; the maximum is ${formatBytes(MAX_FILE_BYTES)}.`,
      );
    }

    const { project, created } = await createProject({
      id: generateProjectId(),
      title:
        typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : "Untitled space",
      blobUrl,
      blobPathname,
      sizeBytes,
      ownerId: session.userId,
      uploadRef,
    });

    // A row created by the webhook belongs to the same owner; still verify.
    assertOwner(session, project.ownerId);

    return jsonResponse<ProjectResponse>(request, { project }, created ? 201 : 200);
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) {
      console.error("[api/projects POST] ", apiError.message, error);
    }
    return errorResponse(request, apiError);
  }
}

/**
 * `DELETE /api/projects?id=proj_xxxxxxxx`
 *
 * Removes the model from Blob storage first, then drops the metadata row.
 * Ordering matters: if the row were deleted first and the blob deletion then
 * failed, the file would be orphaned with no record pointing at it.
 */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);

    const url = new URL(request.url);
    let id = url.searchParams.get("id");

    // Also accept `{ id }` in the body for clients that prefer it.
    if (!id && request.headers.get("content-type")?.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
      if (typeof body?.id === "string") id = body.id;
    }

    if (!id) throw invalidRequest("Missing project id. Use ?id=proj_xxxxxxxx.");
    if (!isProjectId(id)) throw invalidRequest(`"${id}" is not a valid project id.`);

    const project = await getProject(id);
    if (!project) throw notFound();
    assertOwner(session, project.ownerId);

    try {
      await del(project.blobUrl);
    } catch (blobError) {
      const message = blobError instanceof Error ? blobError.message : String(blobError);
      // A blob that is already gone should not block cleanup of the row.
      if (!/not\s*found|404/i.test(message)) {
        throw new ApiError(
          "internal_error",
          `Failed to delete the model from Blob storage: ${message}`,
        );
      }
      console.warn("[api/projects DELETE] blob already absent for", id);
    }

    await deleteProject(id, session.userId);

    return jsonResponse(request, { id, deleted: true });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) {
      console.error("[api/projects DELETE] ", apiError.message, error);
    }
    return errorResponse(request, apiError);
  }
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handlePreflight(request);
}
