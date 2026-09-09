import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin-session";
import { getAdminCredentials, matchesAdminPassword } from "@/lib/admin-credentials";
import { issueAdminSession } from "@/lib/admin-auth";
import { assertSameOrigin, consumeRateLimit, privateError, readJson } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const credentials = await getAdminCredentials();
    if (!credentials) {
      return Response.json({ error: "Admin sign-in is not configured." }, { status: 503 });
    }
    const body = await readJson(request, 4096) as { password?: unknown } | null;
    if (!await consumeRateLimit(request, "admin-login", 10)) {
      return Response.json({ error: "Too many sign-in attempts. Try again in 15 minutes." },
        { status: 429, headers: { "Retry-After": "900" } });
    }
    if (!await matchesAdminPassword(body?.password, credentials.password_hash)) {
      return Response.json({ error: "Incorrect password." }, { status: 401 });
    }
    await issueAdminSession(credentials.version);
    return Response.json({ signedIn: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    (await cookies()).delete(ADMIN_COOKIE);
    return Response.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}