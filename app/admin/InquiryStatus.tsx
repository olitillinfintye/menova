"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryStatus as Status } from "@/lib/admin-data";

export function InquiryStatus({ id, status, name }: { id: string; status: Status; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function update(value: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/contacts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Status could not be updated.");
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Status could not be updated.");
    } finally {
      setPending(false);
    }
  }
  return <div>
    <select aria-label={`Status for ${name}`} value={status} disabled={pending} onChange={(event) => void update(event.target.value)}
      className="ring-focus min-h-10 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm disabled:opacity-50">
      <option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option>
    </select>
    {pending && <p role="status" className="mt-1 text-xs text-[var(--color-muted)]">Saving...</p>}
    {error && <p role="alert" className="mt-1 max-w-xs text-xs text-red-300">{error}</p>}
  </div>;
}