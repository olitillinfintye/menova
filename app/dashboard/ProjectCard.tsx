"use client";

import Link from "next/link";
import { useState } from "react";

import { FormatBadge } from "@/app/components/FormatBadge";
import { CopyButton } from "@/app/dashboard/CopyButton";
import { MODEL_FORMATS, buildViewerUrl, formatBytes, getModelFormat } from "@/lib/constants";
import type { Project } from "@/lib/types";

interface ProjectCardProps {
  project: Project;
  onDelete: (project: Project) => Promise<void>;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** Stable hue pair per project so covers stay consistent across reloads. */
function coverHues(id: string): [number, number] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  const base = Math.abs(hash) % 360;
  return [base, (base + 40) % 360];
}

/** Generated cover: gradient wash plus a wireframe massing that varies per project. */
function Cover({ id }: { id: string }) {
  const [hueA, hueB] = coverHues(id);
  const seed = Number.parseInt(id.slice(-4), 36) || 0;
  const h1 = 40 + (seed % 50);
  const h2 = 30 + ((seed >> 3) % 60);
  const h3 = 50 + ((seed >> 6) % 40);

  return (
    <div
      aria-hidden="true"
      className="relative h-36 overflow-hidden"
      style={{
        background: `linear-gradient(135deg, hsl(${hueA} 60% 18%), hsl(${hueB} 55% 10%))`,
      }}
    >
      <div className="bg-grid absolute inset-0 opacity-60" />
      <svg viewBox="0 0 320 144" className="absolute inset-0 h-full w-full" fill="none">
        <defs>
          <linearGradient id={`cover-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#ffffff" stopOpacity=".6" />
            <stop offset="1" stopColor="#ffffff" stopOpacity=".05" />
          </linearGradient>
        </defs>
        <g stroke={`url(#cover-${id})`} strokeWidth="1.1">
          <path d={`M60 ${140 - h1}l70-35 70 35v${h1}l-70 35-70-35Z`} />
          <path d={`M130 ${140 - h1 + 35}v${h1}M60 ${140 - h1}l70 35 70-35`} />
          <path d={`M200 ${140 - h2}l50-25 50 25v${h2}l-50 25-50-25Z`} />
          <path d={`M250 ${140 - h2 + 25}v${h2}M200 ${140 - h2}l50 25 50-25`} />
          <path d={`M20 ${140 - h3}l40-20 40 20v${h3}l-40 20-40-20Z`} />
          <path d={`M60 ${140 - h3 + 20}v${h3}M20 ${140 - h3}l40 20 40-20`} />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-surface)] to-transparent" />
    </div>
  );
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const viewerUrl = buildViewerUrl(project.id);
  const format = getModelFormat(project.blobPathname) ?? "glb";
  const interactive = MODEL_FORMATS[format].walkthrough;

  async function handleDelete() {
    setBusy(true);
    try {
      await onDelete(project);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <article className="card group flex flex-col overflow-hidden rounded-3xl transition duration-300 hover:-translate-y-0.5 hover:border-[var(--color-line-strong)]">
      <Link href={`/viewer/${project.id}`} className="ring-focus relative block" aria-label={`Open ${project.title}`}>
        <Cover id={project.id} />
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <FormatBadge format={format} className="glass" />
          {!interactive && (
            <span className="glass rounded-md px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              Download only
            </span>
          )}
        </div>
        <span className="glass absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink)] opacity-0 transition group-hover:opacity-100">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M6 3h7v7M13 3 4 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </Link>

      <div className="flex flex-1 flex-col p-5 pt-3">
        <header className="min-w-0">
          <h3 className="font-display truncate text-lg font-bold tracking-tight" title={project.title}>
            {project.title}
          </h3>
          <p className="mt-1 flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <span className="font-mono">{project.id}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={project.createdAt}>
              {dateFormatter.format(new Date(project.createdAt))}
            </time>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(project.sizeBytes)}</span>
          </p>
        </header>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={`/viewer/${project.id}`}
            className="ring-focus accent-gradient rounded-lg px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
          >
            {interactive ? "Open space" : "Open"}
          </Link>

          <CopyButton value={viewerUrl} label="Copy link" />

          {confirming ? (
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="ring-focus rounded-lg bg-red-500/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="ring-focus rounded-lg px-2 py-2 text-xs text-[var(--color-muted)] transition hover:text-[var(--color-ink)] disabled:opacity-50"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${project.title}`}
              className="ring-focus ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-muted)] transition hover:bg-red-500/10 hover:text-red-400"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8M6.8 7v4M9.2 7v4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
