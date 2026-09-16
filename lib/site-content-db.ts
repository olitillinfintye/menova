import { sql } from "@vercel/postgres";
import { ApiError } from "@/lib/errors";
import { defaultHomeContent, HOME_SECTION_KEYS, parseContentRevision, parseHomeContent, type HomeContent, type HomeContentState } from "@/lib/site-content";

interface ContentRow {
  content: HomeContent;
  revision: number;
  updated_at: Date | string;
}

let schemaPromise: Promise<void> | null = null;

export function ensureSiteContentSchema(): Promise<void> {
  if (!process.env.POSTGRES_URL) throw new Error("Homepage content database is not configured.");
  schemaPromise ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS site_content (
        page TEXT PRIMARY KEY CHECK (page = 'home'),
        content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
  })().catch((error: unknown) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

function mapContent(row: ContentRow): HomeContentState {
  const defaults = defaultHomeContent();
  const content = parseHomeContent(Object.fromEntries(HOME_SECTION_KEYS.map((section) => [section,
    { ...defaults[section], ...row.content[section] },
  ])));
  return { content, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function getHomeContent(strict = false): Promise<HomeContentState> {
  const fallback = { content: defaultHomeContent(), revision: 0, updatedAt: null };
  if (!process.env.POSTGRES_URL && !strict) return fallback;
  try {
    await ensureSiteContentSchema();
    const { rows } = await sql<ContentRow>`SELECT content, revision, updated_at FROM site_content WHERE page = 'home';`;
    return rows[0] ? mapContent(rows[0]) : fallback;
  } catch (error) {
    if (strict) throw error;
    console.error("Homepage content could not be loaded; using the original content.");
    return fallback;
  }
}

export async function saveHomeContent(content: HomeContent, expectedRevision: number): Promise<HomeContentState> {
  const revision = parseContentRevision(expectedRevision);
  const serialized = JSON.stringify(parseHomeContent(content));
  await ensureSiteContentSchema();
  const result = revision === 0 ? await sql<ContentRow>`
    INSERT INTO site_content (page, content) VALUES ('home', ${serialized}::jsonb)
    ON CONFLICT (page) DO NOTHING
    RETURNING content, revision, updated_at;
  ` : await sql<ContentRow>`
    UPDATE site_content SET content = ${serialized}::jsonb, revision = revision + 1, updated_at = NOW()
    WHERE page = 'home' AND revision = ${revision}
    RETURNING content, revision, updated_at;
  `;
  if (!result.rows[0]) {
    throw new ApiError("conflict", "The homepage changed in another session. Reload the latest content before saving.");
  }
  return mapContent(result.rows[0]);
}