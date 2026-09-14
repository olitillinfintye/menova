import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin } from "@/lib/admin-auth";
import { ANONYMOUS_OWNER_ID } from "@/lib/auth";
import { getProject } from "@/lib/db";
import { ApiError, invalidRequest, notFound } from "@/lib/errors";
import { MAX_THUMBNAIL_BYTES, parseThumbnailPathname, validateThumbnailFile } from "@/lib/project-thumbnails";
import { assertSameOrigin, privateError, readJson } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 8192) as HandleUploadBody | null;
    if (body?.type !== "blob.generate-client-token" || !body.payload) throw invalidRequest("Request a thumbnail upload token.");
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, rawPayload) => {
        const { projectId, contentType } = parseThumbnailPathname(pathname);
        let payload: { projectId?: unknown; filename?: unknown; sizeBytes?: unknown } | null;
        try {
          payload = JSON.parse(rawPayload || "null");
        } catch {
          throw invalidRequest("The thumbnail upload details are invalid.");
        }
        if (payload?.projectId !== projectId) throw invalidRequest("Choose a thumbnail for this project.");
        validateThumbnailFile(payload.filename, payload.sizeBytes, contentType);
        const project = await getProject(projectId, true);
        if (!project || project.ownerId !== ANONYMOUS_OWNER_ID) throw notFound();
        if (!process.env.BLOB_READ_WRITE_TOKEN) throw new ApiError("misconfigured", "Image storage is not configured.");
        return {
          allowedContentTypes: [contentType],
          maximumSizeInBytes: MAX_THUMBNAIL_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
          cacheControlMaxAge: 60 * 60 * 24 * 365,
          validUntil: Date.now() + 60 * 60 * 1000,
        };
      },
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}