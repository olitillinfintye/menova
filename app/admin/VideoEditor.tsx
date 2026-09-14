"use client";

import { upload } from "@vercel/blob/client";
import { Check, LoaderCircle, RotateCcw, Save, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/constants";
import { SITE_VIDEO_SLOTS, validateVideoFile, type SiteVideo, type SiteVideos, type SiteVideoSlot } from "@/lib/site-media";

async function readVideo(response: Response): Promise<SiteVideo> {
  const body = await response.json().catch(() => null) as { video?: SiteVideo; error?: string } | null;
  if (!response.ok || !body?.video) throw new Error(body?.error || "The video could not be saved. Please try again.");
  return body.video;
}

function VideoSection({ slot, initialVideo }: { slot: SiteVideoSlot; initialVideo: SiteVideo }) {
  const [video, setVideo] = useState(initialVideo);
  const [draft, setDraft] = useState<{ file: File; url: string } | null>(null);
  const [pending, setPending] = useState<"uploading" | "saving" | "resetting" | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploadedPath = useRef<string | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const label = SITE_VIDEO_SLOTS[slot];
  const busy = pending !== null;
  const buttonClass = "ring-focus inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-line-strong)] px-3 py-2.5 text-sm font-medium transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50";

  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url); }, [draft]);
  useEffect(() => () => uploadController.current?.abort(), []);

  function chooseFile(file?: File) {
    if (!file || busy) return;
    setError(null);
    setMessage("");
    try {
      validateVideoFile(file.name, file.size, file.type);
      setDraft({ file, url: URL.createObjectURL(file) });
      uploadedPath.current = null;
      setPreviewError(false);
      setConfirmReset(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Choose an MP4 or WebM video.");
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
    if (!draft || busy) return;
    setError(null);
    setMessage("");
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      if (!uploadedPath.current) {
        setPending("uploading");
        setProgress(0);
        const contentType = validateVideoFile(draft.file.name, draft.file.size, draft.file.type);
        const extension = contentType === "video/webm" ? "webm" : "mp4";
        const blob = await upload(`site-videos/${slot}/${crypto.randomUUID()}.${extension}`, draft.file, {
          access: "public",
          handleUploadUrl: "/api/admin/media/upload",
          contentType,
          multipart: draft.file.size > 5 * 1024 * 1024,
          clientPayload: JSON.stringify({ slot, filename: draft.file.name, sizeBytes: draft.file.size }),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
        });
        if (controller.signal.aborted) return;
        uploadedPath.current = blob.pathname;
      }
      setPending("saving");
      const saved = await readVideo(await fetch("/api/admin/media", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, pathname: uploadedPath.current, filename: draft.file.name }),
      }));
      setVideo(saved);
      setDraft(null);
      uploadedPath.current = null;
      setPreviewError(false);
      setMessage(`${label} video saved.`);
    } catch (cause) {
      if (controller.signal.aborted) setMessage("Upload cancelled.");
      else setError(cause instanceof Error ? cause.message : "The upload failed. Please try again.");
    } finally {
      setPending(null);
      uploadController.current = null;
    }
  }

  async function reset() {
    if (busy) return;
    setPending("resetting");
    setError(null);
    setMessage("");
    try {
      const restored = await readVideo(await fetch("/api/admin/media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot }),
      }));
      setVideo(restored);
      discardDraft();
      setConfirmReset(false);
      setMessage(`${label} default restored.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The default video could not be restored.");
    } finally {
      setPending(null);
    }
  }

  return <section aria-labelledby={`${slot}-video-heading`} className="grid min-w-0 gap-5 border-t border-[var(--color-line)] py-7 md:grid-cols-2 md:gap-8">
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${slot}-video-heading`} className="font-display text-xl font-semibold">{label} video</h2>
        <span className={`text-xs font-medium ${draft ? "text-amber-300" : "text-[var(--color-muted)]"}`}>
          {draft ? "Unsaved changes" : video.updatedAt ? "Published" : "Default video"}
        </span>
      </div>
      <video key={draft?.url ?? video.url} src={draft?.url ?? video.url} aria-label={`${label} video preview`}
        controls muted playsInline preload="metadata" onError={() => setPreviewError(true)}
        className="aspect-video w-full rounded-lg bg-black object-contain" />
      {previewError && <p className="mt-2 text-xs text-amber-300">Preview unavailable. Check the video format or connection.</p>}
    </div>
    <div className="flex min-w-0 flex-col justify-center">
      <p className="break-all text-sm font-medium">{draft?.file.name ?? video.filename}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        {draft ? formatBytes(draft.file.size) : video.sizeBytes ? formatBytes(video.sizeBytes) : "Original video"}
      </p>
      <input ref={input} id={`${slot}-video-file`} type="file" accept=".mp4,.webm,video/mp4,video/webm"
        aria-label={`Choose ${label.toLowerCase()} video`} disabled={busy} className="sr-only" tabIndex={-1}
        onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={buttonClass}>
          <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />Choose video
        </button>
        {draft && <>
          <button type="button" disabled={busy} onClick={() => void save()}
            className={`${buttonClass} border-transparent bg-[var(--color-accent)] text-white hover:brightness-110`}>
            {busy ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {pending === "uploading" ? "Uploading" : pending === "saving" ? "Saving" : "Save video"}
          </button>
          <button type="button" disabled={busy && pending !== "uploading"} title={pending === "uploading" ? "Cancel upload" : "Discard changes"}
            aria-label={pending === "uploading" ? `Cancel ${label.toLowerCase()} upload` : `Discard ${label.toLowerCase()} changes`}
            onClick={() => pending === "uploading" ? uploadController.current?.abort() : discardDraft()}
            className="ring-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--color-line-strong)] disabled:opacity-50">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </>}
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">MP4 or WebM. Maximum 100 MB.</p>
      {pending === "uploading" && <div className="mt-4">
        <div role="progressbar" aria-label={`${label} upload progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
          className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
          <div className="h-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1 text-right font-mono text-xs text-[var(--color-muted)]">{progress}%</p>
      </div>}
      <div className="mt-5">
        {confirmReset ? <div role="group" aria-label={`Restore default ${label.toLowerCase()} video`}>
          <p className="text-sm">Restore the default {label.toLowerCase()} video?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void reset()} className={buttonClass}>
              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />{pending === "resetting" ? "Restoring" : "Restore"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmReset(false)} className={buttonClass}>Cancel</button>
          </div>
        </div> : <button type="button" disabled={busy || !video.updatedAt} onClick={() => setConfirmReset(true)}
          className="ring-focus inline-flex items-center gap-2 rounded-md text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-50">
          <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Restore default
        </button>}
      </div>
      {error && <p role="alert" className="mt-3 break-words text-sm text-red-300">{error}</p>}
      <p role="status" className="mt-3 flex min-h-5 items-start gap-2 text-sm text-emerald-300">
        {message && <><Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{message}</>}
      </p>
    </div>
  </section>;
}

export function VideoEditor({ videos }: { videos: SiteVideos }) {
  return <div className="mt-8">
    <VideoSection slot="home" initialVideo={videos.home} />
    <VideoSection slot="devices" initialVideo={videos.devices} />
  </div>;
}