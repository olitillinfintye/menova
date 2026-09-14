"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { InquiryStatus as Status } from "@/lib/admin-data";

export function InquiryStatus({ id, status, name }: { id: string; status: Status; name: string }) {
  const router = useRouter();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<"PATCH" | "DELETE" | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = pending !== null || refreshing;
  function cancelDelete() {
    setConfirming(false);
    setError(null);
    deleteButton.current?.focus();
  }
  async function update(method: "PATCH" | "DELETE", value?: string) {
    if (busy) return;
    setPending(method);
    setError(null);
    const errorMessage = method === "DELETE" ? "Enquiry could not be deleted." : "Status could not be updated.";
    try {
      const response = await fetch("/api/admin/contacts", {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "DELETE" ? { id } : { id, status: value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || errorMessage);
      }
      if (method === "DELETE") setConfirming(false);
      startRefresh(() => router.refresh());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : errorMessage);
    } finally {
      setPending(null);
    }
  }
  return <div className="w-full min-w-0 md:w-52">
    <div className="flex items-center gap-2">
      <select aria-label={`Status for ${name}`} value={status} disabled={busy || confirming} onChange={(event) => void update("PATCH", event.target.value)}
        className="ring-focus min-h-11 min-w-0 flex-1 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm disabled:opacity-50">
        <option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option>
      </select>
      <button ref={deleteButton} type="button" aria-label={`Delete enquiry from ${name}`} title="Delete enquiry"
        aria-expanded={confirming} aria-controls={`delete-inquiry-${id}`} disabled={busy}
        onClick={() => { setConfirming(true); setError(null); }}
        className="ring-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--color-line-strong)] text-[var(--color-muted)] transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50">
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
    {confirming && <div id={`delete-inquiry-${id}`} role="group" aria-label={`Confirm deletion of enquiry from ${name}`} className="mt-3"
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) cancelDelete(); }}>
      <p className="text-sm">Permanently delete this enquiry?</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">This cannot be undone.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" autoFocus disabled={busy} onClick={cancelDelete}
          className="ring-focus min-h-11 rounded-md border border-[var(--color-line-strong)] px-3 py-2 text-sm disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={() => void update("DELETE")}
          className="ring-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50">
          <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />Delete
        </button>
      </div>
    </div>}
    {busy && <p role="status" className="mt-1 text-xs text-[var(--color-muted)]">{pending === "DELETE" ? "Deleting..." : refreshing ? "Refreshing..." : "Saving..."}</p>}
    {error && <p role="alert" className="mt-1 max-w-xs text-xs text-red-300">{error}</p>}
  </div>;
}