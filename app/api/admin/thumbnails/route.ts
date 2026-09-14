import { head } from "@vercel/blob";
import { requireAdmin } from "@/lib/admin-auth";
import { ANONYMOUS_OWNER_ID } from "@/lib/auth";
import { isProjectId } from "@/lib/constants";
import { getProject, updateProjectThumbnail } from "@/lib/db";
import { invalidRequest, notFound } from "@/lib/errors";
import { parseThumbnailPathname, validateThumbnailFile } from "@/lib/project-thumbnails";
import { assertSameOrigin, privateError, readJson } from "@/lib/request-security";

export const runtime = "nodejs";

export async function PUT(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 4096) as { id?: unknown; pathname?: unknown; filename?: unknown } | null;
    if (typeof body?.id !== "string" || !isProjectId(body.id)) throw invalidRequest("Select a valid project.");
    const { projectId, contentType } = parseThumbnailPathname(body.pathname);
    if (projectId !== body.id) throw invalidRequest("This thumbnail was uploaded for a different project.");
    validateThumbnailFile(body.filename, 1, contentType);
    const existing = await getProject(body.id, true);
    if (!existing || existing.ownerId !== ANONYMOUS_OWNER_ID) throw notFound();
    const blob = await head(body.pathname as string);
    if (blob.pathname !== body.pathname || blob.contentType !== contentType) throw invalidRequest("The uploaded image does not match this selection.");
    validateThumbnailFile(body.filename, blob.size, blob.contentType);
    const project = await updateProjectThumbnail(body.id, ANONYMOUS_OWNER_ID, blob.url);
    return Response.json({ project }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 1024) as { id?: unknown } | null;
    if (typeof body?.id !== "string" || !isProjectId(body.id)) throw invalidRequest("Select a valid project.");
    const project = await updateProjectThumbnail(body.id, ANONYMOUS_OWNER_ID, null);
    return Response.json({ project }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}