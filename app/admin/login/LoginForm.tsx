"use client";

import { useState, type FormEvent } from "react";
import { LockKeyhole, LogIn } from "lucide-react";

export function LoginForm({ configured }: { configured: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const password = new FormData(event.currentTarget).get("password");
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Sign-in failed. Please try again.");
      }
      window.location.assign("/admin");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-in failed.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8">
      <label className="block text-sm font-medium" htmlFor="admin-password">Admin password</label>
      <div className="relative mt-2">
        <LockKeyhole className="pointer-events-none absolute top-3.5 left-3 h-5 w-5 text-[var(--color-muted)]" aria-hidden="true" />
        <input id="admin-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} disabled={pending || !configured}
          className="ring-focus min-h-12 w-full rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] py-3 pr-3 pl-11" />
      </div>
      {!configured && <p role="status" className="mt-4 text-sm text-[var(--color-lavender)]">Admin sign-in is not configured. Contact the site administrator.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      <button type="submit" disabled={pending || !configured} className="ring-focus mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-3 font-semibold text-[var(--color-navy)] disabled:opacity-50">
        <LogIn className="h-4 w-4" aria-hidden="true" />{pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}