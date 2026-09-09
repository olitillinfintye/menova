"use client";

export default function AdminError({ reset }: { reset: () => void }) {
  return <section role="alert" className="py-10"><h1 className="font-display text-2xl font-bold">Data unavailable</h1><p className="mt-3 text-[var(--color-muted)]">The admin data could not be loaded.</p><button onClick={reset} className="ring-focus mt-5 rounded-md border border-[var(--color-line-strong)] px-4 py-2">Try again</button></section>;
}