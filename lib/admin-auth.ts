import { cookies } from "next/headers";
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, createAdminSession, getAdminSessionVersion } from "@/lib/admin-session";
import { getAdminCredentials } from "@/lib/admin-credentials";
import { unauthorized } from "@/lib/errors";

export async function isAdminSession(value: string | undefined): Promise<boolean> {
  const version = getAdminSessionVersion(value);
  if (!version) return false;
  const credentials = await getAdminCredentials();
  return credentials?.version === version;
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return isAdminSession(store.get(ADMIN_COOKIE)?.value);
}

export async function requireAdmin(): Promise<void> {
  if (!await isAdmin()) throw unauthorized("Admin sign-in required.");
}

export async function issueAdminSession(version: string): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, createAdminSession(version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });
}