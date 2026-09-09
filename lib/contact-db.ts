import { sql } from "@vercel/postgres";
import type { ContactInput } from "@/lib/contact";

let schemaPromise: Promise<void> | null = null;

export function ensureContactSchema(): Promise<void> {
  if (!process.env.POSTGRES_URL) throw new Error("Contact database is not configured.");
  schemaPromise ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS contact_inquiries (
        id UUID PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(254) NOT NULL,
        phone VARCHAR(50) NOT NULL DEFAULT '',
        company VARCHAR(160) NOT NULL DEFAULT '',
        message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 5000),
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS contact_inquiries_created_idx ON contact_inquiries (created_at DESC);`;
  })().catch((error: unknown) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

export async function saveContact(input: ContactInput): Promise<void> {
  await ensureContactSchema();
  await sql`
    INSERT INTO contact_inquiries (id, name, email, phone, company, message)
    VALUES (${input.submissionId}, ${input.name}, ${input.email}, ${input.phone}, ${input.company}, ${input.message})
    ON CONFLICT (id) DO NOTHING;
  `;
}