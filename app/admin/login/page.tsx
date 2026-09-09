import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getAdminCredentials } from "@/lib/admin-credentials";
import { LoginForm } from "@/app/admin/login/LoginForm";

export const metadata = { title: "Admin sign-in", robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");
  const configured = Boolean(await getAdminCredentials().catch(() => null));
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="ring-focus flex w-fit items-center gap-3 rounded-md">
        <img src="/brand/archviz-mark.png" alt="" width={40} height={40} />
        <span className="font-display text-xl font-bold">Archviz</span>
      </Link>
      <h1 className="font-display mt-10 text-3xl font-bold">Admin sign-in</h1>
      <p className="mt-3 text-sm text-[var(--color-muted)]">Menova Studio</p>
      <LoginForm configured={configured} />
      <Link href="/" className="ring-focus mt-7 w-fit rounded-md text-sm text-[var(--color-muted)]">Back to website</Link>
    </main>
  );
}