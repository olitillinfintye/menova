import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin } from "@/lib/admin-auth";
import { ApiError, invalidRequest } from "@/lib/errors";
import { assertSameOrigin, privateError, readJson } from "@/lib/request-security";
import { ensureSiteMediaSchema } from "@/lib/site-media-db";
import { MAX_VIDEO_BYTES, parseVideoPathname, validateVideoFile } from "@/lib/site-media";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 8192) as HandleUploadBody | null;
    if (body?.type !== "blob.generate-client-token" || !body.payload) {
      throw invalidRequest("Request a video upload token.");
    }
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, rawPayload) => {
        const { slot, contentType } = parseVideoPathname(pathname);
        let payload: { slot?: unknown; filename?: unknown; sizeBytes?: unknown } | null;
        try {
          payload = JSON.parse(rawPayload || "null");
        } catch {
          throw invalidRequest("The video upload details are invalid.");
        }
        if (payload?.slot !== slot) throw invalidRequest("Choose a video for this section.");
        validateVideoFile(payload.filename, payload.sizeBytes, contentType);
        if (!process.env.BLOB_READ_WRITE_TOKEN) throw new ApiError("misconfigured", "Video storage is not configured.");
        await ensureSiteMediaSchema();
        return {
          allowedContentTypes: [contentType],
          maximumSizeInBytes: MAX_VIDEO_BYTES,
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