import { sql } from "@vercel/postgres";
import { defaultSiteVideos, isSiteVideoSlot, type SiteVideo, type SiteVideos, type SiteVideoSlot } from "@/lib/site-media";

interface VideoRow {
  slot: SiteVideoSlot;
  url: string;
  filename: string;
  size_bytes: number | string;
  updated_at: Date | string;
}

let schemaPromise: Promise<void> | null = null;

export function ensureSiteMediaSchema(): Promise<void> {
  if (!process.env.POSTGRES_URL) throw new Error("Site media database is not configured.");
  schemaPromise ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS site_videos (
        slot TEXT PRIMARY KEY CHECK (slot IN ('home', 'devices')),
        url TEXT NOT NULL,
        filename VARCHAR(180) NOT NULL,
        size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
  })().catch((error: unknown) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

function mapVideo(row: VideoRow): SiteVideo {
  return {
    url: row.url,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function getSiteVideos(strict = false): Promise<SiteVideos> {
  const videos = defaultSiteVideos();
  if (!process.env.POSTGRES_URL && !strict) return videos;
  try {
    await ensureSiteMediaSchema();
    const { rows } = await sql<VideoRow>`SELECT slot, url, filename, size_bytes, updated_at FROM site_videos;`;
    for (const row of rows) {
      if (isSiteVideoSlot(row.slot)) videos[row.slot] = mapVideo(row);
    }
    return videos;
  } catch (error) {
    if (strict) throw error;
    console.error("Site videos could not be loaded; using the original videos.");
    return videos;
  }
}

export async function saveSiteVideo(slot: SiteVideoSlot, video: { url: string; filename: string; sizeBytes: number }): Promise<SiteVideo> {
  await ensureSiteMediaSchema();
  const { rows } = await sql<VideoRow>`
    INSERT INTO site_videos (slot, url, filename, size_bytes)
    VALUES (${slot}, ${video.url}, ${video.filename}, ${video.sizeBytes})
    ON CONFLICT (slot) DO UPDATE SET url = EXCLUDED.url, filename = EXCLUDED.filename,
      size_bytes = EXCLUDED.size_bytes, updated_at = NOW()
    RETURNING slot, url, filename, size_bytes, updated_at;
  `;
  return mapVideo(rows[0]);
}

export async function resetSiteVideo(slot: SiteVideoSlot): Promise<SiteVideo> {
  await ensureSiteMediaSchema();
  await sql`DELETE FROM site_videos WHERE slot = ${slot};`;
  return defaultSiteVideos()[slot];
}