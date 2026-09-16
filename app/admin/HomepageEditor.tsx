"use client";

import { upload } from "@vercel/blob/client";
import { Check, ExternalLink, LoaderCircle, RefreshCw, RotateCcw, Save, Upload, Video, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError } from "@/lib/errors";
import { THUMBNAIL_ACCEPT, validateThumbnailFile } from "@/lib/project-thumbnails";
import { HOME_CONTENT_SECTIONS, HOME_SECTION_KEYS, parseHomeContent, type HomeContentSection, type HomeContentState } from "@/lib/site-content";

async function readContent(response: Response): Promise<HomeContentState> {
  const body = await response.json().catch(() => null) as HomeContentState & { error?: string } | null;
  if (!response.ok || !body?.content || typeof body.revision !== "number") {
    throw new Error(body?.error || "The homepage could not be saved. Please try again.");
  }
  return body;
}

export function HomepageEditor({ initialState }: { initialState: HomeContentState }) {
  const [published, setPublished] = useState(initialState);
  const [draft, setDraft] = useState(initialState.content);
  const [section, setSection] = useState<HomeContentSection>("hero");
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [pending, setPending] = useState<"uploading" | "saving" | "restoring" | "loading" | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmation, setConfirmation] = useState<"restore" | "reload" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const uploadedImage = useRef<{ pathname: string; url: string; filename: string } | null>(null);
  const dirty = image !== null || JSON.stringify(draft) !== JSON.stringify(published.content);
  const busy = pending !== null;
  const buttonClass = "ring-focus inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-line-strong)] px-3 py-2.5 text-sm font-medium transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50";
  const iconButtonClass = "ring-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--color-line-strong)] disabled:opacity-50";

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  useEffect(() => () => requestController.current?.abort(), []);
  useEffect(() => { setPreviewError(false); }, [image, draft.hero.imageUrl]);
  useEffect(() => {
    if (invalidField) document.getElementById(`home-${invalidField}`)?.focus();
  }, [invalidField, section]);
  useEffect(() => {
    if (!dirty) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  function changeField(key: string, value: string) {
    setDraft((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
    setInvalidField(null);
    setMessage("");
    if (section === "hero" && key === "imageUrl") {
      setImage(null);
      uploadedImage.current = null;
    }
  }

  function chooseImage(file?: File) {
    if (!file || busy) return;
    setError(null);
    setMessage("");
    try {
      validateThumbnailFile(file.name, file.size, file.type);
      setImage({ file, url: URL.createObjectURL(file) });
      uploadedImage.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Choose a JPG, PNG, or WebP image.");
    }
  }

  function discard() {
    setDraft(published.content);
    setImage(null);
    uploadedImage.current = null;
    setInvalidField(null);
    setError(null);
    setConfirmation(null);
    setMessage("Draft discarded.");
  }

  function navigateSection(event: KeyboardEvent<HTMLButtonElement>, current: HomeContentSection) {
    const index = HOME_SECTION_KEYS.indexOf(current);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % HOME_SECTION_KEYS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + HOME_SECTION_KEYS.length - 1) % HOME_SECTION_KEYS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = HOME_SECTION_KEYS.length - 1;
    else return;
    event.preventDefault();
    setSection(HOME_SECTION_KEYS[next]);
    document.getElementById(`home-tab-${HOME_SECTION_KEYS[next]}`)?.focus();
  }

  async function submit(action: "save" | "restore" | "reload") {
    if (busy) return;
    setError(null);
    setMessage("");
    setInvalidField(null);
    setPending(action === "save" ? "saving" : action === "restore" ? "restoring" : "loading");
    const controller = new AbortController();
    requestController.current = controller;
    try {
      let content = action === "save" ? parseHomeContent(draft) : null;
      if (action === "save" && content && image) {
        if (!uploadedImage.current) {
          setPending("uploading");
          setProgress(0);
          const contentType = validateThumbnailFile(image.file.name, image.file.size, image.file.type);
          const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
          const blob = await upload(`site-images/home/${crypto.randomUUID()}.${extension}`, image.file, {
            access: "public",
            handleUploadUrl: "/api/admin/homepage/upload",
            contentType,
            clientPayload: JSON.stringify({ filename: image.file.name, sizeBytes: image.file.size }),
            abortSignal: controller.signal,
            onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
          });
          if (controller.signal.aborted) return;
          uploadedImage.current = { pathname: blob.pathname, url: blob.url, filename: image.file.name };
        }
        content = { ...content, hero: { ...content.hero, imageUrl: uploadedImage.current.url } };
        setPending("saving");
      }
      const response = await fetch("/api/admin/homepage", {
        method: action === "save" ? "PUT" : action === "restore" ? "DELETE" : "GET",
        cache: "no-store",
        signal: controller.signal,
        ...(action !== "reload" ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "save" ? {
            content, revision: published.revision,
            ...(image && uploadedImage.current ? { imageUpload: uploadedImage.current } : {}),
          } : { revision: published.revision }),
        } : {}),
      });
      if (response.status === 409) setConflict(true);
      const saved = await readContent(response);
      setPublished(saved);
      setDraft(saved.content);
      setImage(null);
      uploadedImage.current = null;
      setConflict(false);
      setConfirmation(null);
      setMessage(action === "restore" ? "Default homepage restored." : action === "reload" ? "Latest content loaded." : "Homepage saved.");
    } catch (cause) {
      if (controller.signal.aborted) setMessage("Upload cancelled.");
      else {
        setError(cause instanceof Error ? cause.message : "The homepage could not be saved.");
        const location = cause instanceof ApiError ? cause.details as { section: HomeContentSection; field: string } | undefined : undefined;
        if (location) {
          setSection(location.section);
          setInvalidField(`${location.section}-${location.field}`);
        }
      }
    } finally {
      setPending(null);
      requestController.current = null;
    }
  }

  return <form noValidate onSubmit={(event) => { event.preventDefault(); void submit("save"); }} className="mt-7 min-w-0">
    <div className="sticky top-0 z-20 border-y border-[var(--color-line)] bg-[var(--color-canvas)] py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${dirty ? "text-amber-300" : "text-[var(--color-ink)]"}`}>{dirty ? "Unsaved changes" : published.revision ? "Published" : "Default content"}</p>
          {published.updatedAt && <p className="mt-1 text-xs text-[var(--color-muted)]">Saved <time dateTime={published.updatedAt}>{new Date(published.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time></p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy || !dirty || conflict} className={`${buttonClass} border-transparent bg-[var(--color-accent)] text-white hover:brightness-110`}>
            {busy ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {pending === "uploading" ? `Uploading ${progress}%` : pending === "saving" ? "Saving" : "Save homepage"}
          </button>
          <button type="button" disabled={busy || !dirty} onClick={discard} title="Discard changes" aria-label="Discard changes" className={iconButtonClass}><X className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" disabled={busy || conflict} onClick={() => setConfirmation("restore")} title="Restore defaults" aria-label="Restore defaults" className={iconButtonClass}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
          {pending === "uploading" && <button type="button" onClick={() => requestController.current?.abort()} title="Cancel upload" aria-label="Cancel upload" className={iconButtonClass}><X className="h-4 w-4" aria-hidden="true" /></button>}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 break-words text-sm text-red-300">{error}</p>}
      {conflict && <button type="button" disabled={busy} onClick={() => setConfirmation("reload")} className={`${buttonClass} mt-3`}><RefreshCw className="h-4 w-4" aria-hidden="true" />Reload latest content</button>}
      {confirmation && <div role="group" aria-label={confirmation === "restore" ? "Restore homepage defaults" : "Reload homepage content"} className="mt-4 border-t border-[var(--color-line)] pt-3">
        <p className="text-sm">{confirmation === "restore" ? "Replace all homepage content with the defaults? Videos will stay unchanged." : "Load the latest published content? Your unsaved changes will be discarded."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void submit(confirmation)} className={buttonClass}>
            {confirmation === "restore" ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {pending === "restoring" ? "Restoring" : pending === "loading" ? "Loading" : confirmation === "restore" ? "Restore homepage" : "Reload content"}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmation(null)} className={buttonClass}>Cancel</button>
        </div>
      </div>}
      <p role="status" className="mt-2 flex min-h-5 items-start gap-2 text-sm text-emerald-300">{message && <><Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{message}</>}</p>
    </div>
    <div className="grid min-w-0 gap-7 py-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0">
        <div role="tablist" aria-label="Homepage sections" className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:flex lg:flex-col">
          {HOME_SECTION_KEYS.map((key) => <button key={key} id={`home-tab-${key}`} type="button" role="tab" aria-selected={section === key} aria-controls={`home-panel-${key}`}
            tabIndex={section === key ? 0 : -1} disabled={busy} onClick={() => setSection(key)} onKeyDown={(event) => navigateSection(event, key)}
            className={`ring-focus flex min-w-0 items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium ${section === key ? "bg-[var(--color-surface-2)] text-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"}`}>
            <span>{HOME_CONTENT_SECTIONS[key].label}</span>
            {(JSON.stringify(draft[key]) !== JSON.stringify(published.content[key]) || key === "hero" && image) && <span className="text-[10px] text-amber-300">Edited</span>}
          </button>)}
        </div>
        <div className="mt-5 flex flex-wrap gap-4 border-t border-[var(--color-line)] pt-4 lg:flex-col">
          <Link href="/admin/videos" className="ring-focus inline-flex items-center gap-2 rounded-md text-sm text-[var(--color-muted)]"><Video className="h-4 w-4" aria-hidden="true" />Videos</Link>
          <a href="/" target="_blank" rel="noopener noreferrer" className="ring-focus inline-flex items-center gap-2 rounded-md text-sm text-[var(--color-muted)]"><ExternalLink className="h-4 w-4" aria-hidden="true" />View website</a>
        </div>
      </aside>
      <section id={`home-panel-${section}`} role="tabpanel" aria-labelledby={`home-tab-${section}`} className="min-w-0">
        <h2 className="font-display mb-5 text-xl font-semibold">{HOME_CONTENT_SECTIONS[section].label}</h2>
        <fieldset disabled={busy} className="grid min-w-0 gap-x-6 gap-y-5 md:grid-cols-2">
          {Object.entries(HOME_CONTENT_SECTIONS[section].fields).map(([key, definition]) => {
            const value = (draft[section] as Record<string, string>)[key];
            const id = `home-${section}-${key}`;
            const invalid = invalidField === `${section}-${key}`;
            const inputClass = `ring-focus w-full min-w-0 rounded-md border bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink)] disabled:opacity-60 ${invalid ? "border-red-400" : "border-[var(--color-line-strong)]"}`;
            return <div key={id} className={`min-w-0 scroll-mt-44 ${definition.kind === "paragraph" || definition.kind === "image" ? "md:col-span-2" : ""}`}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <label htmlFor={id} className="text-sm font-medium">{definition.label}</label>
                <span id={`${id}-length`} className="shrink-0 text-xs text-[var(--color-muted)]">{value.length}/{definition.maxLength}</span>
              </div>
              {definition.kind === "paragraph" ? <textarea id={id} value={value} maxLength={definition.maxLength} required rows={3} aria-invalid={invalid || undefined} aria-describedby={`${id}-length`} onChange={(event) => changeField(key, event.target.value)} className={`${inputClass} resize-y`} /> :
                <input id={id} type="text" value={value} maxLength={definition.maxLength} required aria-invalid={invalid || undefined} aria-describedby={`${id}-length`}
                  inputMode={definition.kind === "link" || definition.kind === "image" ? "url" : "text"} onChange={(event) => changeField(key, event.target.value)} className={inputClass} />}
              {definition.kind === "image" && <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <img src={image?.url ?? draft.hero.imageUrl} alt="Homepage background preview" className="aspect-[3/2] w-full rounded-lg bg-[var(--color-surface)] object-contain" onError={() => setPreviewError(true)} onLoad={() => setPreviewError(false)} />
                  {previewError && <p className="mt-2 text-xs text-amber-300">Image preview unavailable.</p>}
                </div>
                <div className="min-w-0 self-center">
                  <input ref={fileInput} type="file" accept={THUMBNAIL_ACCEPT} aria-label="Choose homepage image" className="sr-only" tabIndex={-1} onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ""; }} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => fileInput.current?.click()} className={buttonClass}><Upload className="h-4 w-4 shrink-0" aria-hidden="true" />Choose image</button>
                    {image && <button type="button" onClick={() => { setImage(null); uploadedImage.current = null; }} title="Discard image selection" aria-label="Discard image selection" className={iconButtonClass}><X className="h-4 w-4" aria-hidden="true" /></button>}
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-muted)]">JPG, PNG or WebP. Maximum 5 MB.</p>
                  {image && <p className="mt-3 break-all text-sm">{image.file.name}</p>}
                </div>
              </div>}
            </div>;
          })}
        </fieldset>
      </section>
    </div>
  </form>;
}