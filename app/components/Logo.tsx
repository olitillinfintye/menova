import Link from "next/link";

interface LogoProps {
  className?: string;
  /** Hide the wordmark and render the mark only. */
  compact?: boolean;
  /** Navy-on-light variant for the landing hero. */
  tone?: "dark" | "light";
}

/** Chevron-roof mark: a folded plan sheet that reads as a house gable. */
export function LogoMark({
  className = "h-8 w-8",
  tone = "dark",
}: {
  className?: string;
  tone?: "dark" | "light";
}) {
  const primary = tone === "light" ? "#1b1b3f" : "#f4f3fb";
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path d="M4 26V12l12-8 12 8v14H4Z" fill={primary} />
      <path d="M4 26V12l12-8v22H4Z" fill="#8b5cf6" />
      <path d="M11 26v-8h10v8" fill={tone === "light" ? "#f7f6fb" : "#16163a"} />
    </svg>
  );
}

export function Logo({ className = "", compact = false, tone = "dark" }: LogoProps) {
  return (
    <Link
      href="/"
      className={`ring-focus inline-flex items-center gap-2.5 rounded-lg ${className}`}
      aria-label="Menova Studio home"
    >
      <LogoMark tone={tone} />
      {!compact && (
        <span
          className={`font-display text-[19px] font-bold tracking-tight ${
            tone === "light" ? "text-[var(--color-navy)]" : "text-[var(--color-ink)]"
          }`}
        >
          menova
        </span>
      )}
    </Link>
  );
}
