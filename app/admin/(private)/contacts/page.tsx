import Link from "next/link";
import { Mail, Phone, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { getInquiries } from "@/lib/admin-data";
import { InquiryStatus } from "@/app/admin/InquiryStatus";
import { CopyButton } from "@/app/dashboard/CopyButton";

export default async function AdminContactsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.slice(0, 160) : "";
  const status = typeof params.status === "string" ? params.status : "";
  const requestedPage = Number(params.page);
  const data = await getInquiries(search, status, Number.isSafeInteger(requestedPage) ? requestedPage : 1);
  const pageLink = (page: number) => `/admin/contacts?${new URLSearchParams({ q: search, status, page: String(page) })}`;

  return <>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-medium text-[var(--color-accent)]">CLIENT CONTACTS</p><h1 className="font-display mt-2 text-3xl font-bold">Enquiries</h1></div>
      <p className="text-sm tabular-nums text-[var(--color-muted)]">{data.total} {data.total === 1 ? "enquiry" : "enquiries"}</p>
    </header>
    <form key={`${search}:${status}`} className="mt-8 flex flex-wrap items-end gap-3" action="/admin/contacts">
      <label className="min-w-0 basis-full text-xs font-medium sm:flex-1 sm:basis-auto">Search
        <input name="q" type="search" defaultValue={search} maxLength={160} placeholder="Name, email, company or project" className="ring-focus mt-2 block min-h-11 w-full min-w-0 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base" />
      </label>
      <label className="text-xs font-medium">Status
        <select name="status" defaultValue={status} className="ring-focus mt-2 block min-h-11 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-sm">
          <option value="">All statuses</option><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option>
        </select>
      </label>
      <button type="submit" aria-label="Search enquiries" title="Search enquiries" className="ring-focus flex h-11 w-11 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-navy)]"><Search className="h-5 w-5" aria-hidden="true" /></button>
      {(search || status) && <Link href="/admin/contacts" className="ring-focus rounded-md px-3 py-3 text-sm text-[var(--color-muted)]">Clear</Link>}
    </form>
    <section aria-label="Enquiry results" className="mt-7 border-t border-[var(--color-line)]">
      {data.inquiries.length === 0 && <p className="py-16 text-center text-[var(--color-muted)]">{search || status ? "No enquiries match these filters." : "No enquiries yet."}</p>}
      {data.inquiries.map((inquiry) => <article key={inquiry.id} className="border-b border-[var(--color-line)] py-6">
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
          <div className="min-w-0"><h2 className="font-display break-words text-lg font-semibold">{inquiry.name}</h2>
            {inquiry.company && <p className="mt-1 break-words text-sm text-[var(--color-muted)]">{inquiry.company}</p>}
            <time className="mt-2 block text-xs text-[var(--color-muted)]" dateTime={new Date(inquiry.created_at).toISOString()}>{new Date(inquiry.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time>
          </div>
          <div className="min-w-0 space-y-2 text-sm">
            <a href={`mailto:${inquiry.email}`} className="ring-focus flex items-start gap-2 rounded-md text-[var(--color-accent)]"><Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="break-all">{inquiry.email}</span></a>
            {inquiry.phone && <a href={`tel:${inquiry.phone.replace(/[^+\d]/g, "")}`} className="ring-focus flex items-start gap-2 rounded-md text-[var(--color-muted)]"><Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="break-words">{inquiry.phone}</span></a>}
            <CopyButton value={inquiry.email} label="Copy email" />
          </div>
          <InquiryStatus id={inquiry.id} status={inquiry.status} name={inquiry.name} />
        </div>
        <details className="mt-4">
          <summary className="ring-focus w-fit cursor-pointer rounded-md text-sm font-medium">Project details</summary>
          <p className="mt-3 max-w-4xl whitespace-pre-wrap break-words border-l-2 border-[var(--color-accent)] pl-4 text-sm leading-relaxed text-[var(--color-muted)]">{inquiry.message}</p>
        </details>
      </article>)}
    </section>
    <nav aria-label="Enquiry pages" className="mt-6 flex items-center justify-between gap-4 text-sm">
      <span className="text-[var(--color-muted)]">Page {data.page} of {data.pages}</span>
      <div className="flex gap-3">
        {data.page > 1 && <Link href={pageLink(data.page - 1)} className="ring-focus inline-flex items-center gap-1 rounded-md border border-[var(--color-line-strong)] px-3 py-2"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Previous</Link>}
        {data.page < data.pages && <Link href={pageLink(data.page + 1)} className="ring-focus inline-flex items-center gap-1 rounded-md border border-[var(--color-line-strong)] px-3 py-2">Next<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>}
      </div>
    </nav>
  </>;
}