"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, LoaderCircle } from "lucide-react";

const inputClass = "ring-focus mt-2 min-h-12 w-full rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-3 text-base";

export function PasswordForm({ minLength }: { minLength: number }) {
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setError(null);
    setSaved(false);
    if (values.get("newPassword") !== values.get("confirmPassword")) {
      setError("The new passwords do not match.");
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: values.get("currentPassword"), newPassword: values.get("newPassword") }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "The password could not be changed. Please try again.");
      }
      form.reset();
      setSaved(true);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The password could not be changed.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <form onSubmit={submit} aria-label="Change admin password" className="mt-7 max-w-lg">
    <fieldset disabled={pending} className="space-y-5">
      <label className="block text-sm font-medium">Current password
        <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={1024} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">New password <span className="font-normal text-[var(--color-muted)]">({minLength}+ characters)</span>
        <input name="newPassword" type="password" autoComplete="new-password" required minLength={minLength} maxLength={1024} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">Confirm new password
        <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={minLength} maxLength={1024} className={inputClass} />
      </label>
      <button type="submit" className="ring-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-[var(--color-navy)] disabled:opacity-50">
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
        {pending ? "Updating..." : "Update password"}
      </button>
    </fieldset>
    {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    {saved && <div role="status" className="mt-5 flex items-start gap-2 text-sm text-[var(--color-accent)]"><Check className="h-5 w-5 shrink-0" aria-hidden="true" /><p>Password changed. Other admin sessions have been signed out.</p></div>}
  </form>;
}