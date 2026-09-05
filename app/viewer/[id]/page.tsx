import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ViewerClient from "@/app/viewer/[id]/ViewerClient";
import { isProjectId } from "@/lib/constants";
import { getProject } from "@/lib/db";
import type { Project } from "@/lib/types";

// Metadata rows change whenever a client re-uploads, so never cache the page.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ViewerPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ViewerPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isProjectId(id)) return { title: "Space not found · Menova Studio" };

  try {
    const project = await getProject(id);
    if (!project) return { title: "Space not found · Menova Studio" };
    return {
      title: `${project.title} · Menova Studio`,
      description: `Walk through ${project.title} on desktop, mobile or Meta Quest.`,
    };
  } catch {
    // A database outage must not break the page shell.
    return { title: "Menova Studio" };
  }
}

/**
 * Public viewer route.
 *
 * Rendered on the server so the Blob URL is resolved before any JavaScript
 * ships — a shared client link opens straight into the download, with no
 * round-trip to `/api/projects` first.
 */
export default async function ViewerPage({ params }: ViewerPageProps) {
  const { id } = await params;

  if (!isProjectId(id)) notFound();

  let project: Project | null = null;
  try {
    project = await getProject(id);
  } catch (error) {
    console.error("[viewer] Failed to read project", id, error);
    throw new Error(
      "The project database is unavailable. Check POSTGRES_URL and try again.",
    );
  }

  if (project === null) notFound();

  return (
    <ViewerClient
      project={{
        id: project.id,
        title: project.title,
        blobUrl: project.blobUrl,
        blobPathname: project.blobPathname,
      }}
    />
  );
}
