import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getAdminCredentials, MIN_NEW_ADMIN_PASSWORD_LENGTH } from "@/lib/admin-credentials";
import { PasswordForm } from "@/app/admin/PasswordForm";

export const metadata = { title: "Admin profile" };

export default async function AdminProfilePage() {
  if (!await isAdmin()) redirect("/admin/login");
  const credentials = await getAdminCredentials();
  return <>
    <header><p className="text-xs font-medium text-[var(--color-accent)]">ACCOUNT SECURITY</p><h1 className="font-display mt-2 text-3xl font-bold">Admin profile</h1></header>
    <section aria-labelledby="password-heading" className="mt-8 border-t border-[var(--color-line)] pt-7">
      <h2 id="password-heading" className="font-display text-xl font-semibold">Change password</h2>
      {credentials && <p className="mt-2 text-xs text-[var(--color-muted)]">Last changed: <time dateTime={new Date(credentials.updated_at).toISOString()}>{new Date(credentials.updated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time></p>}
      <PasswordForm minLength={MIN_NEW_ADMIN_PASSWORD_LENGTH} />
    </section>
  </>;
}