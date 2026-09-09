import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { AdminNav } from "@/app/admin/AdminNav";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!await isAdmin()) redirect("/admin/login");
  return <div className="min-h-svh"><AdminNav /><main className="mx-auto max-w-7xl px-5 py-9 sm:px-8">{children}</main></div>;
}