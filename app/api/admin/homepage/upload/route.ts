import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin } from "@/lib/admin-auth";
import { ApiError, invalidRequest } from "@/lib/errors";
import { MAX_THUMBNAIL_BYTES, validateThumbnailFile } from "@/lib/project-thumbnails";
import { assertSameOrigin, privateError, readJson } from "@/lib/request-security";
import { parseHomeImagePathname } from "@/lib/site-content";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 8192) as HandleUploadBody | null;
    if (body?.type !== "blob.generate-client-token" || !body.payload) throw invalidRequest("Request a homepage image upload token.");
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, rawPayload) => {
        const { contentType } = parseHomeImagePathname(pathname);
        let payload: { filename?: unknown; sizeBytes?: unknown } | null;
        try {
          payload = JSON.parse(rawPayload || "null");
        } catch {
          throw invalidRequest("The image upload details are invalid.");
        }
        validateThumbnailFile(payload?.filename, payload?.sizeBytes, contentType);
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