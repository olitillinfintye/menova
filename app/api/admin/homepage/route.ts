import { head } from "@vercel/blob";
import { requireAdmin } from "@/lib/admin-auth";
import { invalidRequest } from "@/lib/errors";
import { validateThumbnailFile } from "@/lib/project-thumbnails";
import { assertSameOrigin, privateError, readJson } from "@/lib/request-security";
import { defaultHomeContent, parseContentRevision, parseHomeContent, parseHomeImagePathname } from "@/lib/site-content";
import { getHomeContent, saveHomeContent } from "@/lib/site-content-db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    return Response.json(await getHomeContent(true), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 65_536) as {
      content?: unknown; revision?: unknown; imageUpload?: { pathname?: unknown; filename?: unknown } | null;
    } | null;
    let content = parseHomeContent(body?.content);
    const revision = parseContentRevision(body?.revision);
    if (body?.imageUpload !== undefined) {
      const { pathname, contentType } = parseHomeImagePathname(body.imageUpload?.pathname);
      validateThumbnailFile(body.imageUpload?.filename, 1, contentType);
      const blob = await head(pathname);
      if (blob.pathname !== pathname || blob.contentType !== contentType) {
        throw invalidRequest("The uploaded image does not match this selection.");
      }
      validateThumbnailFile(body.imageUpload?.filename, blob.size, blob.contentType);
      content = parseHomeContent({ ...content, hero: { ...content.hero, imageUrl: blob.url } });
    }
    return Response.json(await saveHomeContent(content, revision), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 1024) as { revision?: unknown } | null;
    const revision = parseContentRevision(body?.revision);
    return Response.json(await saveHomeContent(defaultHomeContent(), revision), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}