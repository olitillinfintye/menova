"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { Backdrop } from "@/app/components/Backdrop";
import { FormatBadge } from "@/app/components/FormatBadge";
import { Arrow, SiteNav } from "@/app/components/SiteNav";
import { CopyButton } from "@/app/dashboard/CopyButton";
import { ErrorModal } from "@/app/dashboard/ErrorModal";
import { ProjectCard } from "@/app/dashboard/ProjectCard";
import { EmbeddedWorkspace } from "@/app/dashboard/WorkspaceContext";
import {
  ALLOWED_EXTENSIONS,
  BLOB_FOLDER,
  FILE_INPUT_ACCEPT,
  MAX_FILE_BYTES,
  MODEL_FORMATS,
  type ModelFormat,
  buildViewerUrl,
  formatBytes,
  getModelFormat,
  stripModelExtension,
} from "@/lib/constants";
import type { Project, ProjectListResponse, ProjectResponse } from "@/lib/types";

/** Files above this size use multipart transfer (parallel, resumable parts). */
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

interface ModalState {
  title: string;
  message: string;
}

/** Reads `{ error }` from a failed JSON response, falling back to the status. */
async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* non-JSON body */
  }
  return `${fallback} (HTTP ${response.status})`;
}

/**
 * `@vercel/blob` reports every failed token handshake as the same opaque
 * message. Ask the readiness probe what actually went wrong.
 */
async function explainUploadFailure(error: unknown): Promise<string> {
  const message =
    error instanceof Error
      ? error.message
      : "An unexpected error interrupted the upload. Please try again.";
  if (!/client token/i.test(message)) return message;

  try {
    const probe = await fetch("/api/upload", { cache: "no-store" });
    if (!probe.ok) return await readError(probe, "The upload service rejected the request.");
  } catch {
    /* fall through to the generic hint */
  }
  return `${message}. Check that the server can reach Vercel Blob and that you are signed in.`;
}

/** Strips path separators and unsafe characters from a user-supplied name. */
function sanitiseFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "model.glb";
  const safe = base
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-80);
  return safe.length > 0 ? safe : "model.glb";
}

const FORMAT_LIST = ALLOWED_EXTENSIONS.join(", ");

export default function DashboardPage() {
  const embedded = useContext(EmbeddedWorkspace);
  const WorkspaceElement = embedded ? "div" : "main";
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [lastUploaded, setLastUploaded] = useState<Project | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // Nested dragenter/dragleave events fire for every child element, so the
  // highlight is only stable if we count enter/leave pairs.
  const dragDepth = useRef(0);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setListError(null);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not load your projects."));
      }
      const data = (await response.json()) as ProjectListResponse;
      setProjects(data.projects ?? []);
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Could not load your projects.",
      );
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const startUpload = useCallback(
    async (file: File) => {
      if (uploading) return;

      // ---- client-side gates ------------------------------------------------
      const format = getModelFormat(file.name);
      if (!format) {
        setModal({
          title: "Unsupported file type",
          message: `Archviz accepts ${FORMAT_LIST} models. "${file.name}" was rejected.`,
        });
        return;
      }

      if (file.size > MAX_FILE_BYTES) {
        setModal({
          title: "File is too large",
          message: `"${file.name}" is ${formatBytes(file.size)}. The maximum upload size is ${formatBytes(
            MAX_FILE_BYTES,
          )}. Decimate the mesh or compress the textures, then try again.`,
        });
        return;
      }

      if (file.size === 0) {
        setModal({
          title: "Empty file",
          message: `"${file.name}" contains no data.`,
        });
        return;
      }

      setUploading(true);
      setProgress(0);
      setLastUploaded(null);

      const uploadRef = crypto.randomUUID();
      const title = stripModelExtension(file.name).slice(0, 120) || "Untitled space";

      try {
        // Streams from the browser straight into Vercel Blob, so the 4.5MB
        // serverless request-body limit never applies.
        const blob = await upload(`${BLOB_FOLDER}/${sanitiseFilename(file.name)}`, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          contentType: file.type || "application/octet-stream",
          multipart: file.size > MULTIPART_THRESHOLD,
          clientPayload: JSON.stringify({ title, sizeBytes: file.size, uploadRef }),
          onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
        });

        // Register the metadata. On a deployed URL the `onUploadCompleted`
        // webhook usually wins this race; the call is idempotent through
        // `uploadRef` and returns whichever row exists, which also covers
        // localhost, where the webhook cannot reach us at all.
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            blobUrl: blob.url,
            blobPathname: blob.pathname,
            sizeBytes: file.size,
            uploadRef,
          }),
        });

        if (!response.ok) {
          throw new Error(
            await readError(
              response,
              "The model uploaded but the project record could not be saved.",
            ),
          );
        }

        const { project } = (await response.json()) as ProjectResponse;
        setProgress(100);
        setLastUploaded(project);
        setProjects((current) => [
          project,
          ...current.filter((entry) => entry.id !== project.id),
        ]);
      } catch (error) {
        setModal({
          title: "Upload failed",
          message: await explainUploadFailure(error),
        });
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [uploading],
  );

  const handleFileList = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (files.length > 1) {
        setModal({
          title: "One model at a time",
          message: "Drop a single model file. Batch uploads are not supported yet.",
        });
        return;
      }
      void startUpload(files[0]);
    },
    [startUpload],
  );

  const handleDelete = useCallback(async (project: Project) => {
    try {
      const response = await fetch(`/api/projects?id=${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not delete the project."));
      }
      setProjects((current) => current.filter((entry) => entry.id !== project.id));
      setLastUploaded((current) => (current?.id === project.id ? null : current));
    } catch (error) {
      setModal({
        title: "Delete failed",
        message: error instanceof Error ? error.message : "Could not delete the project.",
      });
    }
  }, []);

  const totalBytes = projects.reduce((sum, project) => sum + project.sizeBytes, 0);
  const formats = Object.keys(MODEL_FORMATS) as ModelFormat[];

  return (
    <>
      {!embedded && <Backdrop />}
      {!embedded && <SiteNav current="dashboard" />}

      <WorkspaceElement className={embedded ? "w-full pb-12" : "mx-auto w-full max-w-6xl px-5 pt-10 pb-20 sm:px-8 lg:pt-14"}>
        <header className="animate-fade-up flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="text-xs font-medium text-[var(--color-accent)]">Archviz workspace</span>
            <h1 className="font-display mt-3 text-3xl font-bold">
              {embedded ? "Models" : "Projects"}
            </h1>
            <p className="mt-2 max-w-lg text-sm text-[var(--color-muted)]">
              Powered by Menova Studio
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] text-sm">
            {[
              { label: "Spaces", value: String(projects.length) },
              { label: "Stored", value: formatBytes(totalBytes) },
              { label: "Per model", value: formatBytes(MAX_FILE_BYTES) },
            ].map((stat) => (
              <div key={stat.label} className="bg-[var(--color-surface)] px-4 py-3">
                <dt className="text-[11px] text-[var(--color-muted)]">{stat.label}</dt>
                <dd className="font-display mt-0.5 font-bold tabular-nums text-[var(--color-ink)]">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        {/* ----------------------------- Dropzone ----------------------------- */}
        <section aria-labelledby="upload-heading" className="animate-fade-up mt-10 [animation-delay:80ms]">
          <h2 id="upload-heading" className="sr-only">
            Upload a model
          </h2>

          <div
            onDragEnter={(event) => {
              event.preventDefault();
              dragDepth.current += 1;
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setIsDragging(false);
              handleFileList(event.dataTransfer.files);
            }}
            className={`relative overflow-hidden border-y border-[var(--color-line)] py-8 text-center transition duration-300 sm:py-10 ${
              isDragging
                ? "border-[var(--color-accent)] shadow-[var(--shadow-glow)]"
                : "hover:border-[var(--color-line-strong)]"
            }`}
          >
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(201_150_42_/_0.28),transparent_60%)] transition-opacity duration-300 ${
                isDragging || uploading ? "opacity-100" : "opacity-0"
              }`}
            />
            {/* Dashed inner frame, drawn separately so the outer card keeps its solid border. */}
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-1 rounded-md border border-dashed transition-colors duration-300 ${
                isDragging ? "border-[var(--color-accent)]/70" : "border-[var(--color-line)]"
              }`}
            />

            <input
              ref={inputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              className="sr-only"
              onChange={(event) => handleFileList(event.target.files)}
              disabled={uploading}
            />

            <div className="relative">
              <span className="relative mx-auto flex h-16 w-16 items-center justify-center">
                {(isDragging || uploading) && (
                  <span className="absolute inset-0 animate-pulse-ring rounded-2xl border border-[var(--color-accent)]" />
                )}
                <span
                  className={`flex h-16 w-16 items-center justify-center rounded-2xl border transition duration-300 ${
                    isDragging
                      ? "accent-gradient border-transparent text-white"
                      : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-accent)]"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    {uploading ? (
                      <path d="M12 3 3 8l9 5 9-5-9-5ZM3 8v8l9 5 9-5V8M12 13v8" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </svg>
                </span>
              </span>

              <p className="font-display mt-5 text-xl font-bold text-[var(--color-ink)]">
                {uploading
                  ? "Uploading your model…"
                  : isDragging
                    ? "Release to upload"
                    : "New model"}
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted)]">
                GLB, FBX or SKP · {formatBytes(MAX_FILE_BYTES)} maximum
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {formats.map((format) => (
                  <span
                    key={format}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-canvas)]/60 py-1 pr-3 pl-1.5 text-xs text-[var(--color-muted)]"
                  >
                    <FormatBadge format={format} />
                    {MODEL_FORMATS[format].label}
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="ring-focus btn-slant accent-gradient mt-7 inline-flex items-center gap-2 py-3 pl-6 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? "Please wait…" : "Browse files"}
                {!uploading && <Arrow />}
              </button>

              {uploading && (
                <div className="mx-auto mt-8 max-w-md">
                  <div
                    role="progressbar"
                    aria-label="Upload progress"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]"
                  >
                    <div
                      className="accent-gradient h-full rounded-full transition-[width] duration-200 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                    <div className="shimmer absolute inset-0 animate-shimmer" />
                  </div>
                  <p className="mt-2 font-mono text-xs tabular-nums text-[var(--color-muted)]">
                    {progress}%
                  </p>
                </div>
              )}
            </div>
          </div>

          {lastUploaded && !uploading && (
            <div className="animate-fade-up mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-mint)]/30 bg-[var(--color-mint)]/[0.06] p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mint)]/15 text-[var(--color-mint)]">
                <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m4 10.5 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-ink)]">
                  {lastUploaded.title} is live.
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-[var(--color-muted)]">
                  {buildViewerUrl(lastUploaded.id)}
                </p>
              </div>
              <CopyButton value={buildViewerUrl(lastUploaded.id)} label="Copy link" />
              <a
                href={`/viewer/${lastUploaded.id}`}
                className="ring-focus accent-gradient rounded-lg px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
              >
                Open space
              </a>
            </div>
          )}
        </section>

        {/* --------------------------- Project grid --------------------------- */}
        <section aria-labelledby="projects-heading" className="animate-fade-up mt-14 [animation-delay:160ms]">
          <div className="flex items-center justify-between">
            <h2 id="projects-heading" className="font-display text-2xl font-bold tracking-tight">
              Library
            </h2>
            <button
              type="button"
              onClick={() => void loadProjects()}
              disabled={loadingProjects}
              className="ring-focus inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-50"
            >
              <svg
                viewBox="0 0 16 16"
                className={`h-3.5 w-3.5 ${loadingProjects ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {loadingProjects ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {listError && (
            <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              {listError}
            </p>
          )}

          {loadingProjects && projects.length === 0 && !listError && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((key) => (
                <div key={key} className="card h-64 overflow-hidden rounded-3xl">
                  <div className="shimmer h-full w-full animate-shimmer" />
                </div>
              ))}
            </div>
          )}

          {!loadingProjects && projects.length === 0 && !listError && (
            <div className="card mt-5 flex flex-col items-center rounded-3xl px-6 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Zm8 4.5v9m0-9 8-4.5M12 12 4 7.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <p className="font-display mt-5 text-xl font-bold">No spaces yet</p>
              <p className="mt-1 max-w-sm text-sm text-[var(--color-muted)]">
                Upload a {FORMAT_LIST} model above to create your first walkthrough.
              </p>
            </div>
          )}

          {projects.length > 0 && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </section>

        {modal && (
          <ErrorModal title={modal.title} message={modal.message} onClose={() => setModal(null)} />
        )}
      </WorkspaceElement>
    </>
  );
}
