import { parseContact } from "@/lib/contact";
import { saveContact } from "@/lib/contact-db";
import { assertSameOrigin, consumeRateLimit, privateError, readJson } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const input = parseContact(await readJson(request));
    if (input) {
      if (!await consumeRateLimit(request, "contact", 10)) {
        return Response.json({ error: "Too many enquiries. Please try again in 15 minutes." },
          { status: 429, headers: { "Retry-After": "900", "Cache-Control": "no-store" } });
      }
      await saveContact(input);
    }
    return Response.json({ received: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return privateError(error);
  }
}