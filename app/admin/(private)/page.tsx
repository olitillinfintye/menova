import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getAnalytics } from "@/lib/admin-data";
import { formatBytes } from "@/lib/constants";

export default async function AdminOverviewPage() {
  const { totals, months, formats, statuses } = await getAnalytics();
  const peak = Math.max(1, ...months.flatMap((month) => [Number(month.inquiries), Number(month.models)]));
  const totalEnquiries = Number(totals.inquiries);
  const totalModels = Number(totals.models);

  return <>
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="text-xs font-medium text-[var(--color-accent)]">MENOVA STUDIO</p><h1 className="font-display mt-2 text-3xl font-bold">Analytics</h1></div>
      <Link href="/admin/models" className="ring-focus inline-flex items-center gap-2 rounded-md border border-[var(--color-line-strong)] px-4 py-2.5 text-sm font-semibold">Upload model<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
    </header>
    <dl className="mt-8 grid grid-cols-2 border-y border-[var(--color-line)] md:grid-cols-5">
      {[
        { label: "Total enquiries", value: totals.inquiries, color: "text-[var(--color-ink)]" },
        { label: "Awaiting response", value: totals.new_inquiries, color: "text-[var(--color-lavender)]" },
        { label: "Unique emails", value: totals.clients, color: "text-[var(--color-accent)]" },
        { label: "Models", value: totals.models, color: "text-[var(--color-ink)]" },
        { label: "Model storage", value: formatBytes(Number(totals.bytes)), color: "text-[var(--color-lime)]" },
      ].map((item) => <div key={item.label} className="min-w-0 py-6 pr-4"><dt className="text-xs text-[var(--color-muted)]">{item.label}</dt><dd className={`font-display mt-2 break-words text-2xl font-bold tabular-nums ${item.color}`}>{item.value}</dd></div>)}
    </dl>
    <section aria-labelledby="activity-heading" className="py-9">
      <div className="flex flex-wrap items-center justify-between gap-4"><h2 id="activity-heading" className="font-display text-xl font-semibold">Monthly activity</h2><p className="text-xs text-[var(--color-muted)]">Last 6 months, UTC</p></div>
      <div className="mt-5 flex gap-5 text-xs text-[var(--color-muted)]"><span className="flex items-center gap-2"><span className="h-2 w-2 bg-[var(--color-accent)]" />Enquiries</span><span className="flex items-center gap-2"><span className="h-2 w-2 bg-[var(--color-lavender)]" />Models</span></div>
      <figure className="mt-6">
        <div className="grid h-52 grid-cols-6 gap-3 border-b border-[var(--color-line)] sm:gap-8" aria-hidden="true">
          {months.map((month) => <div key={month.month} className="flex h-full items-end justify-center gap-1.5 sm:gap-3">
            {(["inquiries", "models"] as const).map((key) => <div key={key} className="relative flex h-full min-w-0 max-w-12 flex-1 items-end">
              <div className={`relative w-full ${key === "inquiries" ? "bg-[var(--color-accent)]" : "bg-[var(--color-lavender)]"}`} style={{ height: `${Number(month[key]) / peak * 85}%`, minHeight: Number(month[key]) ? 3 : 0 }}>
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] tabular-nums">{month[key]}</span>
              </div>
            </div>)}
          </div>)}
        </div>
        <div aria-hidden="true" className="mt-3 grid grid-cols-6 gap-2 text-center text-[10px] text-[var(--color-muted)] sm:text-xs">{months.map((month) => <span key={month.month}>{month.month}</span>)}</div>
        <figcaption className="sr-only">Monthly enquiries and model uploads</figcaption>
        <table className="sr-only"><caption>Activity totals by month</caption><thead><tr><th>Month</th><th>Enquiries</th><th>Models</th></tr></thead><tbody>{months.map((month) => <tr key={month.month}><th>{month.month}</th><td>{month.inquiries}</td><td>{month.models}</td></tr>)}</tbody></table>
      </figure>
    </section>
    <div className="grid border-t border-[var(--color-line)] lg:grid-cols-2 lg:gap-12">
      <section aria-labelledby="pipeline-heading" className="py-8">
        <div className="flex items-center justify-between gap-3"><h2 id="pipeline-heading" className="font-display text-xl font-semibold">Enquiry status</h2><Link href="/admin/contacts" aria-label="Open enquiries" title="Open enquiries" className="ring-focus rounded-md p-2"><ArrowUpRight className="h-5 w-5" aria-hidden="true" /></Link></div>
        <dl className="mt-6 space-y-5">
          {[{ status: "new", label: "New", color: "bg-[var(--color-lavender)]" }, { status: "contacted", label: "Contacted", color: "bg-[var(--color-accent)]" }, { status: "closed", label: "Closed", color: "bg-[var(--color-muted)]" }].map((item) => {
            const count = Number(statuses.find((entry) => entry.status === item.status)?.count ?? 0);
            return <div key={item.status}><div className="flex justify-between text-sm"><dt>{item.label}</dt><dd className="tabular-nums">{count}</dd></div><div aria-hidden="true" className="mt-2 h-2 bg-[var(--color-surface-2)]"><div className={`h-full ${item.color}`} style={{ width: `${totalEnquiries ? count / totalEnquiries * 100 : 0}%` }} /></div></div>;
          })}
        </dl>
      </section>
      <section aria-labelledby="formats-heading" className="border-t border-[var(--color-line)] py-8 lg:border-t-0">
        <h2 id="formats-heading" className="font-display text-xl font-semibold">Model formats</h2>
        {formats.length === 0 && <p className="mt-6 text-sm text-[var(--color-muted)]">No models uploaded yet.</p>}
        <dl className="mt-6 space-y-5">{formats.map((format) => <div key={format.format}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><dt className="font-mono uppercase">{format.format || "Other"}</dt><dd className="text-xs tabular-nums text-[var(--color-muted)]">{format.count} models / {formatBytes(Number(format.bytes))}</dd></div>
          <div aria-hidden="true" className="mt-2 h-2 bg-[var(--color-surface-2)]"><div className="h-full bg-[var(--color-lime)]" style={{ width: `${totalModels ? Number(format.count) / totalModels * 100 : 0}%` }} /></div>
        </div>)}</dl>
      </section>
    </div>
  </>;
}