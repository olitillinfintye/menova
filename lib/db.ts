import { sql } from "@vercel/postgres";

import { ApiError, notFound } from "@/lib/errors";
import type { Project } from "@/lib/types";

/** Shape of the `projects` table. */
interface ProjectRow {
  id: string;
  title: string;
  blob_url: string;
  blob_pathname: string;
  size_bytes: string | number;
  created_at: Date | string;
  owner_id: string;
  upload_ref: string;
}

function mapRow(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    blobUrl: row.blob_url,
    blobPathname: row.blob_pathname,
    // `bigint` columns come back as strings from the pg driver.
    sizeBytes: Number(row.size_bytes),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    ownerId: row.owner_id,
  };
}

let schemaPromise: Promise<void> | null = null;

/**
 * Creates the `projects` table on first use.
 *
 * Idempotent and memoised per serverless instance. For a larger deployment,
 * move this into a migration run at build time instead.
 */
export function ensureSchema(): Promise<void> {
  if (!process.env.POSTGRES_URL) {
    throw new ApiError(
      "misconfigured",
      "POSTGRES_URL is not set. Link a Vercel Postgres store and run `vercel env pull .env.local`.",
    );
  }

  schemaPromise ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        blob_url       TEXT NOT NULL,
        blob_pathname  TEXT NOT NULL,
        size_bytes     BIGINT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        owner_id       TEXT NOT NULL,
        upload_ref     TEXT NOT NULL UNIQUE
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS projects_owner_created_idx
        ON projects (owner_id, created_at DESC);
    `;
  })().catch((error) => {
    // Never cache a failed bootstrap: the next request must retry.
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

/** All projects owned by `ownerId`, newest first. */
export async function listProjects(ownerId: string): Promise<Project[]> {
  await ensureSchema();
  const { rows } = await sql<ProjectRow>`
    SELECT id, title, blob_url, blob_pathname, size_bytes, created_at, owner_id, upload_ref
    FROM projects
    WHERE owner_id = ${ownerId}
    ORDER BY created_at DESC
    LIMIT 500;
  `;
  return rows.map(mapRow);
}

/** A single project, or `null` when it does not exist. */
export async function getProject(id: string): Promise<Project | null> {
  await ensureSchema();
  const { rows } = await sql<ProjectRow>`
    SELECT id, title, blob_url, blob_pathname, size_bytes, created_at, owner_id, upload_ref
    FROM projects
    WHERE id = ${id}
    LIMIT 1;
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface CreateProjectInput {
  id: string;
  title: string;
  blobUrl: string;
  blobPathname: string;
  sizeBytes: number;
  ownerId: string;
  uploadRef: string;
}

/**
 * Inserts a project, or returns the existing row when `uploadRef` was already
 * registered.
 *
 * Both `onUploadCompleted` (the Blob webhook) and the browser fallback call
 * this, so the unique `upload_ref` constraint is what makes the write
 * idempotent — whichever path lands first wins and the other is a no-op.
 */
export async function createProject(
  input: CreateProjectInput,
): Promise<{ project: Project; created: boolean }> {
  await ensureSchema();

  const { rows } = await sql<ProjectRow>`
    INSERT INTO projects (id, title, blob_url, blob_pathname, size_bytes, owner_id, upload_ref)
    VALUES (
      ${input.id},
      ${input.title},
      ${input.blobUrl},
      ${input.blobPathname},
      ${input.sizeBytes},
      ${input.ownerId},
      ${input.uploadRef}
    )
    ON CONFLICT (upload_ref) DO NOTHING
    RETURNING id, title, blob_url, blob_pathname, size_bytes, created_at, owner_id, upload_ref;
  `;

  if (rows[0]) return { project: mapRow(rows[0]), created: true };

  const { rows: existing } = await sql<ProjectRow>`
    SELECT id, title, blob_url, blob_pathname, size_bytes, created_at, owner_id, upload_ref
    FROM projects
    WHERE upload_ref = ${input.uploadRef}
    LIMIT 1;
  `;

  if (!existing[0]) {
    // The insert was skipped but nothing matches the ref: the id collided.
    throw new ApiError("conflict", `Project id ${input.id} already exists.`);
  }

  return { project: mapRow(existing[0]), created: false };
}

/** Deletes a project row. Returns the deleted record. */
export async function deleteProject(
  id: string,
  ownerId: string,
): Promise<Project> {
  await ensureSchema();
  const { rows } = await sql<ProjectRow>`
    DELETE FROM projects
    WHERE id = ${id} AND owner_id = ${ownerId}
    RETURNING id, title, blob_url, blob_pathname, size_bytes, created_at, owner_id, upload_ref;
  `;
  if (!rows[0]) throw notFound();
  return mapRow(rows[0]);
}
