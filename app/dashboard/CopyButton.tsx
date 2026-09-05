"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

/**
 * Copies `value` to the clipboard.
 *
 * `navigator.clipboard` is unavailable on insecure origins and in some
 * embedded webviews, so a hidden-textarea fallback keeps the button working.
 */
export function CopyButton({ value, label = "Copy link", className = "" }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    const flash = (next: "copied" | "failed") => {
      setState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        flash("copied");
        return;
      }
      throw new Error("Clipboard API unavailable");
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        flash(ok ? "copied" : "failed");
      } catch {
        flash("failed");
      }
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={
        className ||
        `ring-focus inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
          state === "copied"
            ? "border-[var(--color-mint)]/40 bg-[var(--color-mint)]/10 text-[var(--color-mint)]"
            : state === "failed"
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface-3)]"
        }`
      }
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {state === "copied" ? (
          <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2m-7-5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
