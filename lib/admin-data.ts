import { sql } from "@vercel/postgres";
import { requireAdmin } from "@/lib/admin-auth";
import { ensureContactSchema } from "@/lib/contact-db";
import { ensureSchema } from "@/lib/db";

export type InquiryStatus = "new" | "contacted" | "closed";

export interface Inquiry {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
  status: InquiryStatus;
  created_at: Date;
}

export async function getInquiries(search: string, status: string, page: number) {
  await requireAdmin();
  await ensureContactSchema();
  const term = `%${search.slice(0, 160)}%`;
  const filter = ["new", "contacted", "closed"].includes(status) ? status : "";
  const { rows: totals } = await sql<{ total: string }>`
    SELECT COUNT(*)::text AS total FROM contact_inquiries
    WHERE (${filter} = '' OR status = ${filter})
      AND (name ILIKE ${term} OR email ILIKE ${term} OR company ILIKE ${term} OR message ILIKE ${term} OR phone ILIKE ${term});
  `;
  const total = Number(totals[0].total);
  const pages = Math.max(1, Math.ceil(total / 25));
  const currentPage = Math.min(Math.max(1, page), pages);
  const { rows } = await sql<Inquiry>`
    SELECT id, name, email, phone, company, message, status, created_at FROM contact_inquiries
    WHERE (${filter} = '' OR status = ${filter})
      AND (name ILIKE ${term} OR email ILIKE ${term} OR company ILIKE ${term} OR message ILIKE ${term} OR phone ILIKE ${term})
    ORDER BY created_at DESC, id DESC LIMIT 25 OFFSET ${(currentPage - 1) * 25};
  `;
  return { inquiries: rows, total, page: currentPage, pages };
}

export async function getAnalytics() {
  await requireAdmin();
  await ensureContactSchema();
  await ensureSchema();
  const { rows: totals } = await sql<{
    inquiries: string; new_inquiries: string; clients: string; models: string; bytes: string;
  }>`
    SELECT
      (SELECT COUNT(*) FROM contact_inquiries)::text AS inquiries,
      (SELECT COUNT(*) FROM contact_inquiries WHERE status = 'new')::text AS new_inquiries,
      (SELECT COUNT(DISTINCT email) FROM contact_inquiries)::text AS clients,
      (SELECT COUNT(*) FROM projects WHERE owner_id = 'public')::text AS models,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM projects WHERE owner_id = 'public')::text AS bytes;
  `;
  const { rows: months } = await sql<{ month: string; inquiries: string; models: string }>`
    WITH months AS (
      SELECT generate_series(date_trunc('month', NOW() AT TIME ZONE 'UTC') - INTERVAL '5 months',
        date_trunc('month', NOW() AT TIME ZONE 'UTC'), INTERVAL '1 month') AS month
    ), enquiries AS (
      SELECT date_trunc('month', created_at AT TIME ZONE 'UTC') AS month, COUNT(*) AS count
      FROM contact_inquiries WHERE created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') - INTERVAL '5 months' GROUP BY 1
    ), models AS (
      SELECT date_trunc('month', created_at AT TIME ZONE 'UTC') AS month, COUNT(*) AS count
      FROM projects WHERE owner_id = 'public' AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') - INTERVAL '5 months' GROUP BY 1
    )
    SELECT to_char(months.month, 'Mon YYYY') AS month,
      COALESCE(enquiries.count, 0)::text AS inquiries, COALESCE(models.count, 0)::text AS models
    FROM months LEFT JOIN enquiries USING (month) LEFT JOIN models USING (month) ORDER BY months.month;
  `;
  const { rows: formats } = await sql<{ format: string; count: string; bytes: string }>`
    SELECT lower(substring(blob_pathname FROM '\.([^.]+)$')) AS format,
      COUNT(*)::text AS count, SUM(size_bytes)::text AS bytes
    FROM projects WHERE owner_id = 'public' GROUP BY 1 ORDER BY COUNT(*) DESC;
  `;
  const { rows: statuses } = await sql<{ status: InquiryStatus; count: string }>`
    SELECT status, COUNT(*)::text AS count FROM contact_inquiries GROUP BY status;
  `;
  return { totals: totals[0], months, formats, statuses };
}