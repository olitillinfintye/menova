"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import { CONTACT_LIMITS } from "@/lib/contact";

const inputClass = "ring-focus mt-2 w-full rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-3 text-base text-[var(--color-ink)]";

export function ContactForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submissionId = useRef<string | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    submissionId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, submissionId: submissionId.current }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Your enquiry could not be sent. Please try again.");
      }
      form.reset();
      setSent(true);
      submissionId.current = null;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Connection failed. Please try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (sent) return (
    <div role="status" className="border-y border-[var(--color-line)] py-12">
      <Check className="h-8 w-8 text-[var(--color-accent)]" aria-hidden="true" />
      <h2 className="font-display mt-5 text-2xl font-semibold">Enquiry received</h2>
      <p className="mt-3 text-[var(--color-muted)]">Thank you. Menova Studio will be in touch about your project.</p>
      <button type="button" onClick={() => setSent(false)} className="ring-focus mt-6 rounded-md text-sm font-semibold text-[var(--color-accent)]">Send another enquiry</button>
    </div>
  );

  return (
    <form onSubmit={submit} aria-label="Contact us" className="min-w-0">
      <fieldset disabled={pending} className="grid min-w-0 gap-6 sm:grid-cols-2">
        <label className="text-sm font-medium">Full name
          <input name="name" autoComplete="name" required maxLength={CONTACT_LIMITS.name} className={inputClass} />
        </label>
        <label className="text-sm font-medium">Email
          <input name="email" type="email" autoComplete="email" required maxLength={CONTACT_LIMITS.email} className={inputClass} />
        </label>
        <label className="text-sm font-medium">Phone <span className="text-[var(--color-muted)]">(optional)</span>
          <input name="phone" type="tel" autoComplete="tel" maxLength={CONTACT_LIMITS.phone} className={inputClass} />
        </label>
        <label className="text-sm font-medium">Company <span className="text-[var(--color-muted)]">(optional)</span>
          <input name="company" autoComplete="organization" maxLength={CONTACT_LIMITS.company} className={inputClass} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">What do you have in mind?
          <textarea name="message" rows={6} required minLength={10} maxLength={CONTACT_LIMITS.message} className={`${inputClass} resize-y`} />
        </label>
        <div hidden aria-hidden="true">
          <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        </div>
        <p className="text-xs leading-relaxed text-[var(--color-muted)] sm:col-span-2">Your details will be stored by Menova Studio to respond to your enquiry. They are not displayed publicly.</p>
        <button type="submit" className="ring-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-5 py-3 font-semibold text-[var(--color-navy)] disabled:opacity-60 sm:justify-self-start">
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
          {pending ? "Sending..." : "Send enquiry"}
        </button>
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    </form>
  );
}