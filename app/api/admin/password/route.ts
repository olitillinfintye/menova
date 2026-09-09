import { issueAdminSession, requireAdmin } from "@/lib/admin-auth";
import { changeAdminPassword } from "@/lib/admin-credentials";
import { invalidRequest } from "@/lib/errors";
import { assertSameOrigin, consumeRateLimit, privateError, readJson } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    assertSameOrigin(request);
    const body = await readJson(request) as { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown } | null;
    if (typeof body?.confirmPassword !== "string" || body.confirmPassword !== body.newPassword) {
      throw invalidRequest("The new passwords do not match.");
    }
    if (!await consumeRateLimit(request, "admin-password", 10)) {
      return Response.json({ error: "Too many attempts. Try again in 15 minutes." },
        { status: 429, headers: { "Retry-After": "900", "Cache-Control": "no-store" } });
    }
    const version = await changeAdminPassword(body?.currentPassword, body?.newPassword);
    await issueAdminSession(version);
    return Response.json({ changed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}