"use client";

import { useEffect, useRef } from "react";

interface ErrorModalProps {
  title: string;
  message: string;
  onClose: () => void;
}

/** Accessible, focus-trapping error dialog used for blocked uploads. */
export function ErrorModal({ title, message, onClose }: ErrorModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-modal-title"
        aria-describedby="error-modal-message"
        className="card animate-fade-up w-full max-w-md rounded-3xl p-6 shadow-2xl [animation-duration:0.35s]"
      >
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M10 6.5v4M10 13.5h.01M8.6 3.3 2.4 14.2A1.6 1.6 0 0 0 3.8 16.6h12.4a1.6 1.6 0 0 0 1.4-2.4L11.4 3.3a1.6 1.6 0 0 0-2.8 0Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="error-modal-title" className="font-display text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <p
              id="error-modal-message"
              className="mt-2 text-sm leading-relaxed break-words text-[var(--color-muted)]"
            >
              {message}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ring-focus rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface-3)]"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
