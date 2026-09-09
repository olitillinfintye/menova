import Image from "next/image";
import Link from "next/link";

type Tone = "dark" | "light";

interface LogoProps {
  className?: string;
  /** Render the swoosh mark only. */
  compact?: boolean;
  /** `light` = black wordmark for light backgrounds; `dark` = white wordmark for navy. */
  tone?: Tone;
}

/** Intrinsic sizes of the generated brand assets in public/brand. */
const MARK = { width: 512, height: 512 };

/** Gold swoosh from the Menova Studios logo. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string; tone?: Tone }) {
  return (
    <Image
      src="/brand/archviz-mark.png"
      alt=""
      aria-hidden="true"
      width={MARK.width}
      height={MARK.height}
      className={`object-contain ${className}`}
    />
  );
}

/** Full "MENNOVA STUDIOS" lockup, transparent, in the requested tone. */
export function LogoLockup({ className = "h-9 w-auto", tone = "dark" }: { className?: string; tone?: Tone }) {
  return (
    <span className={`archviz-lockup inline-flex items-center gap-2.5 ${tone === "light" ? "text-[var(--color-navy)]" : "text-[var(--color-ink)]"} ${className}`}>
      <LogoMark className="h-full max-h-12 w-auto shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="font-display text-2xl leading-none font-bold">Archviz</span>
        <span className="mt-1 text-[9px] leading-tight font-medium opacity-70">Powered by Menova Studio</span>
      </span>
    </span>
  );
}

export function Logo({ className = "", compact = false, tone = "dark" }: LogoProps) {
  return (
    <Link
      href="/"
      className={`ring-focus inline-flex items-center rounded-lg ${className}`}
      aria-label="Archviz home"
    >
      {compact ? <LogoMark /> : <LogoLockup tone={tone} className="h-11 w-auto sm:h-12" />}
    </Link>
  );
}
