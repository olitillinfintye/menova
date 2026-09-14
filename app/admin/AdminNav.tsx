"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, Box, Inbox, LogOut, ArrowUpRight, UserRound, Video } from "lucide-react";

const links = [
  { href: "/admin", label: "Analytics", icon: BarChart3 },
  { href: "/admin/models", label: "Models", icon: Box },
  { href: "/admin/videos", label: "Videos", icon: Video },
  { href: "/admin/contacts", label: "Enquiries", icon: Inbox },
];

export function AdminNav() {
  const pathname = usePathname();
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    setError(false);
    try {
      const response = await fetch("/api/admin/session", { method: "DELETE" });
      if (!response.ok) throw new Error();
      window.location.assign("/admin/login");
    } catch {
      setError(true);
      setPending(false);
    }
  }
  return (
    <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-5 py-5 sm:px-8">
        <Link href="/admin" className="ring-focus flex items-center gap-3 rounded-md">
          <img src="/brand/archviz-mark.png" alt="" width={32} height={32} />
          <span className="font-display text-lg font-bold">Archviz <span className="ml-1 text-xs font-medium text-[var(--color-muted)]">ADMIN</span></span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/" className="ring-focus inline-flex items-center gap-1 rounded-md text-xs text-[var(--color-muted)]">Website <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
          <Link href="/admin/profile" title="Admin profile" aria-label="Admin profile" aria-current={pathname === "/admin/profile" ? "page" : undefined}
            className={`ring-focus flex h-10 w-10 items-center justify-center rounded-md border ${pathname === "/admin/profile" ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-line-strong)]"}`}><UserRound className="h-4 w-4" aria-hidden="true" /></Link>
          <button onClick={() => void logout()} disabled={pending} type="button" title="Sign out" aria-label="Sign out" className="ring-focus flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-line-strong)] disabled:opacity-50"><LogOut className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
      <nav aria-label="Admin navigation" className="mx-auto grid max-w-7xl grid-cols-2 gap-1 px-5 min-[400px]:grid-cols-4 sm:flex sm:gap-2 sm:px-8">
        {links.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}
            className={`ring-focus inline-flex items-center justify-center gap-1 border-b-2 px-1.5 py-3 text-xs font-medium sm:gap-2 sm:px-3 sm:text-sm ${pathname === href ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />{label}
          </Link>
        ))}
      </nav>
      {error && <p role="alert" className="px-5 py-2 text-sm text-red-300">Sign-out failed. Please try again.</p>}
    </header>
  );
}