import { head } from "@vercel/blob";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidRequest } from "@/lib/errors";
import { assertSameOrigin, privateError, readJson } from "@/lib/request-security";
import { getSiteVideos, resetSiteVideo, saveSiteVideo } from "@/lib/site-media-db";
import { isSiteVideoSlot, parseVideoPathname, validateVideoFile } from "@/lib/site-media";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    return Response.json({ videos: await getSiteVideos(true) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 4096) as { slot?: unknown; pathname?: unknown; filename?: unknown } | null;
    if (!isSiteVideoSlot(body?.slot)) throw invalidRequest("Select the homepage or devices video.");
    const { slot, contentType } = parseVideoPathname(body.pathname);
    if (slot !== body.slot) throw invalidRequest("This video was uploaded for a different section.");
    if (typeof body.filename !== "string") throw invalidRequest("The video filename is required.");
    validateVideoFile(body.filename, 1);
    const blob = await head(body.pathname as string);
    if (blob.pathname !== body.pathname || blob.contentType !== contentType) {
      throw invalidRequest("The uploaded video does not match this selection.");
    }
    validateVideoFile(body.filename, blob.size, blob.contentType);
    const video = await saveSiteVideo(slot, { url: blob.url, filename: body.filename, sizeBytes: blob.size });
    return Response.json({ video }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 1024) as { slot?: unknown } | null;
    if (!isSiteVideoSlot(body?.slot)) throw invalidRequest("Select the homepage or devices video.");
    const video = await resetSiteVideo(body.slot);
    return Response.json({ video }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}