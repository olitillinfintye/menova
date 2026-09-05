"use client";

import { useCallback, useState } from "react";

import { MAX_HOTSPOTS, MAX_HOTSPOT_LABEL } from "@/lib/constants";
import type { Hotspot, ProjectResponse } from "@/lib/types";

interface HotspotEditorProps {
  projectId: string;
  hotspots: Hotspot[];
  onChange: (hotspots: Hotspot[]) => void;
  /** Feet position + heading in model space, from the live viewer. */
  getPose: () => { position: { x: number; y: number; z: number }; yaw: number };
  onGoTo: (hotspot: Hotspot) => void;
  onSaved: (hotspots: Hotspot[]) => void;
  onNotice: (message: string) => void;
  onClose: () => void;
}

function newId(): string {
  return `hs_${Math.random().toString(36).slice(2, 10)}`;
}

/** Side panel for authoring hotspots: add at the current viewpoint, rename, reorder, save. */
export function HotspotEditor({
  projectId,
  hotspots,
  onChange,
  getPose,
  onGoTo,
  onSaved,
  onNotice,
  onClose,
}: HotspotEditorProps) {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const update = useCallback(
    (next: Hotspot[]) => {
      onChange(next);
      setDirty(true);
    },
    [onChange],
  );

  const addHere = () => {
    if (hotspots.length >= MAX_HOTSPOTS) {
      onNotice(`A space can have at most ${MAX_HOTSPOTS} hotspots.`);
      return;
    }
    const pose = getPose();
    update([
      ...hotspots,
      { id: newId(), label: `Point ${hotspots.length + 1}`, position: pose.position, yaw: pose.yaw },
    ]);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= hotspots.length) return;
    const next = [...hotspots];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotspots }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Save failed (HTTP ${response.status})`);
      }
      const { project } = (await response.json()) as ProjectResponse;
      onSaved(project.hotspots);
      setDirty(false);
      onNotice("Hotspots saved. Anyone with the link will see them.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save hotspots.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="glass pointer-events-auto flex max-h-[calc(100vh-9rem)] w-[min(22rem,calc(100vw-2rem))] flex-col rounded-2xl">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="font-display text-sm font-bold">Hotspots</p>
          <p className="text-[11px] text-[var(--color-muted)]">
            Walk somewhere, then add a point. The first one is the AR entrance.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close hotspot editor"
          className="ring-focus flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <ol className="flex-1 space-y-2 overflow-y-auto p-3">
        {hotspots.length === 0 && (
          <li className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-[var(--color-muted)]">
            No hotspots yet. Move to a viewpoint and press “Add hotspot here”.
          </li>
        )}
        {hotspots.map((hotspot, index) => (
          <li key={hotspot.id} className="rounded-xl bg-[var(--color-canvas)]/60 p-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] font-display text-xs font-bold text-[var(--color-navy)]">
                {index + 1}
              </span>
              <input
                value={hotspot.label}
                maxLength={MAX_HOTSPOT_LABEL}
                onChange={(event) =>
                  update(
                    hotspots.map((entry) =>
                      entry.id === hotspot.id ? { ...entry, label: event.target.value } : entry,
                    ),
                  )
                }
                aria-label={`Hotspot ${index + 1} label`}
                className="ring-focus min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-[var(--color-ink)] transition hover:border-white/10 focus:border-[var(--color-accent)]/60"
              />
            </div>
            <div className="mt-1.5 flex items-center gap-1 pl-9">
              <button type="button" onClick={() => onGoTo(hotspot)} className="ring-focus rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--color-lavender)] transition hover:bg-white/5">
                Go
              </button>
              <button
                type="button"
                onClick={() => {
                  const pose = getPose();
                  update(
                    hotspots.map((entry) =>
                      entry.id === hotspot.id ? { ...entry, position: pose.position, yaw: pose.yaw } : entry,
                    ),
                  );
                }}
                className="ring-focus rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
              >
                Move here
              </button>
              <span className="ml-auto flex items-center gap-0.5">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up" className="ring-focus rounded-md p-1 text-[var(--color-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)] disabled:opacity-30">
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 10 4-4 4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === hotspots.length - 1} aria-label="Move down" className="ring-focus rounded-md p-1 text-[var(--color-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)] disabled:opacity-30">
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => update(hotspots.filter((entry) => entry.id !== hotspot.id))}
                  aria-label={`Delete ${hotspot.label}`}
                  className="ring-focus rounded-md p-1 text-[var(--color-muted)] transition hover:bg-red-500/10 hover:text-red-400"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </span>
            </div>
          </li>
        ))}
      </ol>

      <footer className="flex items-center gap-2 border-t border-white/10 p-3">
        <button
          type="button"
          onClick={addHere}
          className="ring-focus inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-3 py-2 text-xs font-semibold text-[var(--color-lavender)] transition hover:bg-[var(--color-accent)]/20"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 3v10M3 8h10" strokeLinecap="round" /></svg>
          Add hotspot here
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="ring-focus accent-gradient rounded-xl px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </footer>
    </aside>
  );
}
