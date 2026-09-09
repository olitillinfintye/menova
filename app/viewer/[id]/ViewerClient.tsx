"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ViewerApi, XrSessionMode } from "@/app/viewer/[id]/ViewerCanvas";
import { HotspotEditor } from "@/app/viewer/[id]/HotspotEditor";
import { QuickLookButton } from "@/app/viewer/[id]/QuickLookButton";
import { FormatBadge } from "@/app/components/FormatBadge";
import { LogoLockup, LogoMark } from "@/app/components/Logo";
import type { InputMode, PresentationMode } from "@/src/needle/ArchPresentationCore";
import { MODEL_FORMATS, type ModelFormat, getModelFormat } from "@/lib/constants";
import type { Hotspot, Project } from "@/lib/types";

// three.js, the loaders and the XR layer all touch `window` at module scope,
// so the whole canvas is client-only.
const ViewerCanvas = dynamic(() => import("@/app/viewer/[id]/ViewerCanvas"), {
  ssr: false,
});

interface ViewerClientProps {
  project: Pick<Project, "id" | "title" | "blobUrl" | "blobPathname" | "hotspots">;
  /** Opens the hotspot editor (builder link with `?edit=1`). */
  editable?: boolean;
}

const INPUT_HINTS: Record<InputMode, string> = {
  desktop: "WASD to walk · click to look · click a marker to go there",
  touch: "Drag left to walk · drag right to look · tap a marker to go there",
  controllers: "Left stick walks · right stick turns · trigger on a floor or marker to teleport",
  hands: "Hand tracking active",
};

const OVERLAY_BUTTON =
  "ring-focus glass rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[var(--color-ink)] transition hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)]/80 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * SketchUp has no browser-side parser, so a `.skp` space is a hosted download
 * with export guidance rather than a walkthrough.
 */
function SketchUpNotice({ project }: ViewerClientProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid absolute inset-0" />
        <div className="absolute top-1/4 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[var(--color-lavender)] opacity-[0.14] blur-[140px]" />
      </div>

      <div className="card animate-fade-up w-full max-w-lg rounded-[2rem] p-8 sm:p-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="ring-focus rounded-lg" aria-label="Archviz home">
            <LogoLockup className="h-9 w-auto" />
          </Link>
          <FormatBadge format="skp" />
        </div>

        <h1 className="font-display mt-8 text-2xl font-semibold tracking-tight sm:text-3xl">
          {project.title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
          {MODEL_FORMATS.skp.description}
        </p>

        <ol className="mt-6 space-y-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-canvas)]/50 p-4 text-sm">
          {[
            "Open the model in SketchUp.",
            "File → Export → 3D Model…",
            "Choose glTF (.glb) or FBX, enable “Export texture maps”, and save.",
            "Upload the exported file to create an interactive space.",
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="font-mono text-xs text-[var(--color-lavender)]">0{index + 1}</span>
              <span className="text-[var(--color-ink)]">{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href={project.blobUrl}
            download
            className="ring-focus accent-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Download .skp
          </a>
          <Link
            href="/dashboard"
            className="ring-focus inline-flex items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-ink)] transition hover:border-[var(--color-line-strong)]"
          >
            Back to studio
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function ViewerClient({ project, editable = false }: ViewerClientProps) {
  const format = getModelFormat(project.blobPathname) ?? "glb";

  if (format === "skp") return <SketchUpNotice project={project} />;

  return <InteractiveViewer project={project} format={format} editable={editable} />;
}

interface InteractiveViewerProps extends ViewerClientProps {
  format: Exclude<ModelFormat, "skp">;
}

function InteractiveViewer({ project, format, editable = false }: InteractiveViewerProps) {
  const [api, setApi] = useState<ViewerApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<PresentationMode>("walkthrough");
  const [inputMode, setInputMode] = useState<InputMode>("desktop");
  const [xrSupport, setXrSupport] = useState({ vr: false, ar: false, quickLook: false });
  const [presenting, setPresenting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hotspots, setHotspots] = useState<Hotspot[]>(project.hotspots);
  const [editing, setEditing] = useState(editable);
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [modelScale, setModelScale] = useState(1);
  const [floorDetected, setFloorDetected] = useState(false);
  const [androidApp, setAndroidApp] = useState(false);

  useEffect(() => {
    setAndroidApp(navigator.userAgent.includes("ArchvizAndroid/"));
  }, []);

  const arOverlayRef = useRef<HTMLDivElement>(null);
  const arControlsRef = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 7000);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  // Keep the 3D markers in step with the (possibly unsaved) list.
  useEffect(() => {
    api?.setHotspots(hotspots);
  }, [api, hotspots]);

  // Taps on the AR HUD buttons must not double as "place the model here".
  useEffect(() => {
    const controls = arControlsRef.current;
    if (!controls) return;
    const swallow = (event: Event) => event.preventDefault();
    controls.addEventListener("beforexrselect", swallow);
    return () => controls.removeEventListener("beforexrselect", swallow);
  }, [presenting]);

  const arActive = presenting && mode === "ar";

  const handleCapture = useCallback(async () => {
    if (!api || capturing) return;
    setCapturing(true);
    try {
      await api.capture4K();
      showNotice("4K render saved to your downloads.");
    } catch (captureError) {
      showNotice(
        captureError instanceof Error
          ? captureError.message
          : "The render could not be captured.",
      );
    } finally {
      setCapturing(false);
    }
  }, [api, capturing, showNotice]);

  const handleEnterXR = useCallback(
    async (sessionMode: XrSessionMode, presentation?: PresentationMode) => {
      if (!api) return;
      try {
        setPlaced(false);
        await api.enterXR(sessionMode, {
          presentation,
          overlayRoot: presentation === "ar" ? arOverlayRef.current : null,
        });
      } catch (xrError) {
        showNotice(
          xrError instanceof Error
            ? `Could not start the immersive session: ${xrError.message}`
            : "Could not start the immersive session.",
        );
      }
    },
    [api, showNotice],
  );

  const goTo = useCallback(
    (hotspot: Hotspot) => {
      api?.goToHotspot(hotspot);
      setActiveHotspot(hotspot.id);
    },
    [api],
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--color-canvas)]">
      <ViewerCanvas
        url={project.blobUrl}
        format={format}
        title={project.title}
        hotspots={project.hotspots}
        onLoadProgress={setProgress}
        onLoaded={() => setLoading(false)}
        onError={(message) => {
          setError(message);
          setLoading(false);
        }}
        onNotice={showNotice}
        onModeChange={setMode}
        onInputModeChange={setInputMode}
        onHotspotSelect={(hotspot) => setActiveHotspot(hotspot.id)}
        onPlaced={() => setPlaced(true)}
        onPlacementChange={setPlaced}
        onScaleChange={setModelScale}
        onFloorDetected={setFloorDetected}
        onXrSupport={setXrSupport}
        onXrPresentingChange={setPresenting}
        onReady={setApi}
      />

      {/* ------------------------------ loading ------------------------------ */}
      {loading && !error && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-[var(--color-canvas)]/95 backdrop-blur-sm"
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <div className="bg-grid absolute inset-0" />
            <div className="absolute top-1/3 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[var(--color-accent)] opacity-[0.14] blur-[130px]" />
          </div>

          <span className="relative flex h-16 w-16 items-center justify-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-spin rounded-2xl border-2 border-[var(--color-line-strong)] border-t-[var(--color-accent)] [animation-duration:1.4s]"
            />
            <LogoMark className="h-7 w-7" />
          </span>

          <div className="text-center">
            <p className="font-display mb-2 text-2xl font-bold">Archviz</p>
            <p className="font-display text-base font-semibold tracking-tight">Preparing {project.title}</p>
            <p className="mt-1 font-mono text-xs tabular-nums text-[var(--color-muted)]">
              {progress === null
                ? "Downloading model…"
                : `Downloading model… ${Math.round(progress)}%`}
            </p>
            <p className="mt-3 text-xs text-[var(--color-muted)]">Powered by Menova Studio</p>
          </div>
          {progress !== null && (
            <div className="relative h-1.5 w-64 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
              <div
                className="accent-gradient h-full rounded-full transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
              <div className="shimmer absolute inset-0 animate-shimmer" />
            </div>
          )}
        </div>
      )}

      {/* ------------------------------- error ------------------------------- */}
      {error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--color-canvas)]/95 p-6">
          <div className="card animate-fade-up max-w-md rounded-3xl border-red-500/30 p-7 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M10 6.5v4M10 13.5h.01M8.6 3.3 2.4 14.2A1.6 1.6 0 0 0 3.8 16.6h12.4a1.6 1.6 0 0 0 1.4-2.4L11.4 3.3a1.6 1.6 0 0 0-2.8 0Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h2 className="font-display mt-5 text-lg font-semibold tracking-tight">This space could not open</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">{error}</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="ring-focus accent-gradient rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Reload
              </button>
              <Link
                href="/dashboard"
                className="ring-focus rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition hover:border-[var(--color-line-strong)]"
              >
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------ overlay ------------------------------ */}
      {!loading && !error && !presenting && (
        <>
          <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
            <div className="glass pointer-events-auto flex items-center gap-3 rounded-2xl py-2 pr-4 pl-2.5">
              <Link href="/dashboard" className="ring-focus shrink-0 rounded-lg" aria-label="Archviz workspace">
                <LogoMark className="h-7 w-7 shrink-0" />
              </Link>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink)]">
                  <span className="truncate">{project.title}</span>
                  <FormatBadge format={format} />
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">Archviz · Powered by Menova Studio</p>
              </div>
            </div>

            <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
              {androidApp && (
                <button
                  type="button"
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.set("archvizOpenBrowser", "1");
                    window.location.assign(url.href);
                  }}
                  className={OVERLAY_BUTTON}
                >
                  Open XR in browser
                </button>
              )}
              {xrSupport.ar && (
                <button
                  type="button"
                  onClick={() => void handleEnterXR("immersive-ar", "ar")}
                  disabled={!api}
                  className={`${OVERLAY_BUTTON} accent-gradient inline-flex items-center gap-2 border-transparent text-white`}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M8 2 3 4.5v7L8 14l5-2.5v-7L8 2Zm0 5L3 4.5M8 7l5-2.5M8 7v7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  View in your space
                </button>
              )}
              {!xrSupport.ar && xrSupport.quickLook && api && (
                <QuickLookButton
                  key={project.blobUrl}
                  api={api}
                  title={project.title}
                  onError={showNotice}
                  className={`${OVERLAY_BUTTON} accent-gradient inline-flex items-center gap-2 border-transparent text-white`}
                />
              )}
              {xrSupport.vr && (
                <button
                  type="button"
                  onClick={() => void handleEnterXR("immersive-vr", "walkthrough")}
                  disabled={!api}
                  className={`${OVERLAY_BUTTON} inline-flex items-center gap-2`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-mint)]" />
                  Enter VR · 1:1
                </button>
              )}
              {xrSupport.ar && (
                <button
                  type="button"
                  onClick={() => void handleEnterXR("immersive-ar", "ar")}
                  disabled={!api}
                  className={OVERLAY_BUTTON}
                >
                  Mixed Reality · Room Scale
                </button>
              )}
              {editable && (
                <button
                  type="button"
                  onClick={() => setEditing((value) => !value)}
                  aria-pressed={editing}
                  className={`${OVERLAY_BUTTON} inline-flex items-center gap-2 ${
                    editing ? "border-[var(--color-accent)]/70" : ""
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M8 14s4.5-3.9 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10.1 8 14 8 14Zm0-6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {editing ? "Done editing" : "Edit hotspots"}
                </button>
              )}
            </div>
          </header>

          {editing && api && (
            <div className="pointer-events-none absolute top-20 right-4 z-20">
              <HotspotEditor
                projectId={project.id}
                hotspots={hotspots}
                onChange={setHotspots}
                getPose={api.getPose}
                onGoTo={goTo}
                onSaved={setHotspots}
                onNotice={showNotice}
                onClose={() => setEditing(false)}
              />
            </div>
          )}

          {hotspots.length > 0 && !editing && (
            <nav
              aria-label="Hotspots"
              className="pointer-events-none absolute inset-x-0 bottom-20 z-20 flex justify-center px-4"
            >
              <div className="glass pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-2xl p-1">
                {hotspots.map((hotspot, index) => (
                  <button
                    key={hotspot.id}
                    type="button"
                    onClick={() => goTo(hotspot)}
                    aria-current={activeHotspot === hotspot.id ? "location" : undefined}
                    className={`ring-focus inline-flex shrink-0 items-center gap-2 rounded-xl py-1.5 pr-3 pl-1.5 text-xs font-semibold transition ${
                      activeHotspot === hotspot.id
                        ? "bg-white/10 text-[var(--color-ink)]"
                        : "text-[var(--color-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
                    }`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)] font-display text-[10px] font-bold text-[var(--color-navy)]">
                      {index + 1}
                    </span>
                    {hotspot.label}
                  </button>
                ))}
              </div>
            </nav>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="glass pointer-events-auto inline-flex overflow-hidden rounded-2xl p-1">
              {(
                [
                  { value: "walkthrough", label: "1:1 Walk" },
                  { value: "dollhouse", label: "Dollhouse" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => api?.setMode(option.value)}
                  disabled={!api}
                  aria-pressed={mode === option.value}
                  className={`ring-focus rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                    mode === option.value
                      ? "accent-gradient text-white shadow-[0_6px_18px_-6px_rgb(201_150_42_/_0.9)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void handleCapture()}
              disabled={!api || capturing}
              className={`${OVERLAY_BUTTON} pointer-events-auto inline-flex items-center gap-2`}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2.5 5.5h2l1.3-2h4.4l1.3 2h2v7h-11v-7Zm5.5 5.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {capturing ? "Rendering…" : "Capture 4K"}
            </button>
          </div>
        </>
      )}

      {/* ------------------------- AR dom-overlay HUD ------------------------ */}
      {/* Always mounted: `requestSession` needs the element before AR starts. */}
      <div
        ref={arOverlayRef}
        className={`pointer-events-none absolute inset-0 z-40 flex flex-col justify-between p-4 ${
          arActive ? "" : "hidden"
        }`}
      >
        <div className="flex justify-center">
          <p className="glass rounded-2xl px-4 py-2.5 text-center text-xs font-medium text-white">
            {placed
              ? `Placed · ${Math.round(modelScale * 100)}%`
              : floorDetected ? "Floor detected" : "Detecting floor"}
          </p>
        </div>

        <div ref={arControlsRef} className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
          {!placed && (
            <button
              type="button"
              onClick={() => api?.placeOnDetectedFloor()}
              disabled={!floorDetected}
              className={OVERLAY_BUTTON}
            >
              Place model
            </button>
          )}
          {placed && (
            <label className="glass flex max-w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-white">
              Scale
              <input
                aria-label="Model scale"
                type="range"
                min="0.02"
                max="2"
                step="0.01"
                value={modelScale}
                onChange={(event) => api?.setScale(Number(event.target.value))}
                className="w-28 accent-[var(--color-accent)]"
              />
              <output className="w-10 text-right tabular-nums">{Math.round(modelScale * 100)}%</output>
              <button type="button" className="ring-focus px-2 py-1" onClick={() => api?.setScale(1)}>
                1:1
              </button>
            </label>
          )}
          {placed && (
            <button
              type="button"
              onClick={() => {
                api?.resetPlacement();
                setPlaced(false);
              }}
              className={`${OVERLAY_BUTTON} inline-flex items-center gap-2`}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Re-place
            </button>
          )}
          {hotspots.length > 0 && placed && (
            <div className="glass flex max-w-[60vw] gap-1 overflow-x-auto rounded-xl p-1">
              {hotspots.map((hotspot, index) => (
                <button
                  key={hotspot.id}
                  type="button"
                  onClick={() => goTo(hotspot)}
                  title={hotspot.label}
                  className="ring-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)] font-display text-xs font-bold text-[var(--color-navy)]"
                >
                  {index + 1}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => void api?.exitXR()}
            className={`${OVERLAY_BUTTON} inline-flex items-center gap-2`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="m4 4 8 8m0-8-8 8" strokeLinecap="round" />
            </svg>
            Exit AR
          </button>
        </div>
      </div>

      {/* ------------------------------ notices ------------------------------ */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="glass animate-fade-up absolute bottom-24 left-1/2 z-30 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-xs text-[var(--color-ink)] [animation-duration:0.35s]"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
