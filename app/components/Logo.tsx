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
const LOCKUP = { width: 1293, height: 558 };
const MARK = { width: 293, height: 294 };

/** Gold swoosh from the Menova Studios logo. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string; tone?: Tone }) {
  return (
    <Image
      src="/brand/menova-mark.png"
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
    <Image
      src={tone === "light" ? "/brand/menova-lockup-light.png" : "/brand/menova-lockup-dark.png"}
      alt="Menova Studios"
      width={LOCKUP.width}
      height={LOCKUP.height}
      priority
      className={`object-contain ${className}`}
    />
  );
}

export function Logo({ className = "", compact = false, tone = "dark" }: LogoProps) {
  return (
    <Link
      href="/"
      className={`ring-focus inline-flex items-center rounded-lg ${className}`}
      aria-label="Menova Studios home"
    >
      {compact ? <LogoMark /> : <LogoLockup tone={tone} className="h-11 w-auto sm:h-12" />}
    </Link>
  );
}
