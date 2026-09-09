import { sql } from "@vercel/postgres";
import { requireAdmin } from "@/lib/admin-auth";
import { ensureContactSchema } from "@/lib/contact-db";
import { invalidRequest, notFound } from "@/lib/errors";
import { assertSameOrigin, privateError, readJson } from "@/lib/request-security";

export const runtime = "nodejs";

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request, 2048) as { id?: unknown; status?: unknown } | null;
    if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) ||
        typeof body.status !== "string" || !["new", "contacted", "closed"].includes(body.status)) {
      throw invalidRequest("Select a valid enquiry and status.");
    }
    await ensureContactSchema();
    const { rowCount } = await sql`UPDATE contact_inquiries SET status = ${body.status} WHERE id = ${body.id};`;
    if (!rowCount) throw notFound("Enquiry not found.");
    return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}