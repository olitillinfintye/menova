"use client";

import { upload } from "@vercel/blob/client";
import { ImagePlus, ImageOff, LoaderCircle, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { THUMBNAIL_ACCEPT, validateThumbnailFile } from "@/lib/project-thumbnails";
import type { Project, ProjectResponse } from "@/lib/types";

interface ThumbnailEditorProps {
  project: Project;
  disabled: boolean;
  onChange: (project: Project) => void;
  onBusyChange: (busy: boolean) => void;
}

async function readProject(response: Response): Promise<Project> {
  const body = await response.json().catch(() => null) as (Partial<ProjectResponse> & { error?: string }) | null;
  if (!response.ok || !body?.project) throw new Error(body?.error || "The thumbnail could not be saved. Please try again.");
  return body.project;
}

export function ThumbnailEditor({ project, disabled, onChange, onBusyChange }: ThumbnailEditorProps) {
  const [draft, setDraft] = useState<{ file: File; url: string } | null>(null);
  const [pending, setPending] = useState<"uploading" | "saving" | "removing" | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploadedPath = useRef<string | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const busy = pending !== null;
  const buttonClass = "ring-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] text-[var(--color-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-50";

  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url); }, [draft]);
  useEffect(() => () => uploadController.current?.abort(), []);

  function chooseFile(file?: File) {
    if (!file || busy || disabled) return;
    setError(null);
    setMessage("");
    try {
      validateThumbnailFile(file.name, file.size, file.type);
      setDraft({ file, url: URL.createObjectURL(file) });
      uploadedPath.current = null;
      setPreviewError(false);
      setConfirmRemove(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Choose a JPG, PNG, or WebP image.");
    }
  }

  function discardDraft() {
    setDraft(null);
    uploadedPath.current = null;
    setPreviewError(false);
    setError(null);
    setMessage("");
  }

  async function save() {
    if (!draft || busy || disabled || previewError) return;
    setError(null);
    setMessage("");
    onBusyChange(true);
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      if (!uploadedPath.current) {
        setPending("uploading");
        setProgress(0);
        const contentType = validateThumbnailFile(draft.file.name, draft.file.size, draft.file.type);
        const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
        const blob = await upload(`project-thumbnails/${project.id}/${crypto.randomUUID()}.${extension}`, draft.file, {
          access: "public",
          handleUploadUrl: "/api/admin/thumbnails/upload",
          contentType,
          clientPayload: JSON.stringify({ projectId: project.id, filename: draft.file.name, sizeBytes: draft.file.size }),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
        });
        if (controller.signal.aborted) return;
        uploadedPath.current = blob.pathname;
      }
      setPending("saving");
      const saved = await readProject(await fetch("/api/admin/thumbnails", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: project.id, pathname: uploadedPath.current, filename: draft.file.name }),
      }));
      onChange(saved);
      discardDraft();
      setMessage("Thumbnail saved.");
    } catch (cause) {
      if (controller.signal.aborted) setMessage("Upload cancelled.");
      else setError(cause instanceof Error ? cause.message : "The upload failed. Please try again.");
    } finally {
      setPending(null);
      onBusyChange(false);
      uploadController.current = null;
    }
  }

  async function remove() {
    if (busy || disabled) return;
    setPending("removing");
    onBusyChange(true);
    setError(null);
    setMessage("");
    try {
      const saved = await readProject(await fetch("/api/admin/thumbnails", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: project.id }),
      }));
      onChange(saved);
      discardDraft();
      setConfirmRemove(false);
      setMessage("Thumbnail removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The thumbnail could not be removed.");
    } finally {
      setPending(null);
      onBusyChange(false);
    }
  }

  return <div className="mt-4 min-w-0 border-t border-[var(--color-line)] pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto text-xs text-[var(--color-muted)]">Thumbnail</span>
      <input ref={input} type="file" accept={THUMBNAIL_ACCEPT} aria-label={`Choose thumbnail for ${project.title}`}
        disabled={busy || disabled} className="sr-only" tabIndex={-1}
        onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
      <button type="button" disabled={busy || disabled} onClick={() => input.current?.click()} className={buttonClass}
        aria-label={`Choose thumbnail for ${project.title}`} title="Choose thumbnail (JPG, PNG or WebP, up to 5 MB)">
        <ImagePlus className="h-4 w-4" aria-hidden="true" />
      </button>
      {draft ? <>
        <button type="button" disabled={busy || disabled || previewError} onClick={() => void save()} className={buttonClass}
          aria-label={`Save thumbnail for ${project.title}`} title="Save thumbnail">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" disabled={disabled || (busy && pending !== "uploading")} className={buttonClass}
          title={pending === "uploading" ? "Cancel upload" : "Discard thumbnail changes"}
          aria-label={pending === "uploading" ? `Cancel thumbnail upload for ${project.title}` : `Discard thumbnail changes for ${project.title}`}
          onClick={() => pending === "uploading" ? uploadController.current?.abort() : discardDraft()}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </> : project.thumbnailUrl && <button type="button" disabled={busy || disabled} onClick={() => setConfirmRemove(true)} className={buttonClass}
        aria-label={`Remove thumbnail for ${project.title}`} title="Remove thumbnail">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
      </button>}
    </div>
    {draft && <>
      <img src={draft.url} alt={`${project.title} thumbnail preview`} onError={() => setPreviewError(true)}
        className="mt-3 h-24 w-full rounded-md object-cover" />
      <p className="mt-2 break-all text-xs text-[var(--color-muted)]">{draft.file.name}</p>
    </>}
    {previewError && <p role="alert" className="mt-2 text-xs text-red-300">This image cannot be displayed. Choose another image.</p>}
    {pending === "uploading" && <div role="progressbar" aria-label={`Thumbnail upload progress for ${project.title}`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
      <div className="h-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${progress}%` }} />
    </div>}
    {confirmRemove && <div role="group" aria-label={`Remove thumbnail for ${project.title}`} className="mt-3">
      <p className="text-xs">Remove this thumbnail?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy || disabled} onClick={() => void remove()}
          className="ring-focus rounded-md bg-red-500/15 px-3 py-2 text-xs text-red-300 disabled:opacity-50">Remove</button>
        <button type="button" disabled={busy || disabled} onClick={() => setConfirmRemove(false)}
          className="ring-focus rounded-md px-3 py-2 text-xs text-[var(--color-muted)] disabled:opacity-50">Cancel</button>
      </div>
    </div>}
    {error && <p role="alert" className="mt-2 break-words text-xs text-red-300">{error}</p>}
    <p role="status" className="mt-2 min-h-4 text-xs text-[var(--color-muted)]">
      {pending === "uploading" ? `Uploading ${progress}%` : pending === "saving" ? "Saving thumbnail..." : pending === "removing" ? "Removing thumbnail..." : message || (draft ? "Unsaved thumbnail" : "")}
    </p>
  </div>;
}