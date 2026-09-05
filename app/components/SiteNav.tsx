import Link from "next/link";

import { Logo } from "@/app/components/Logo";

interface SiteNavProps {
  /** Highlights the dashboard link and swaps the CTA. */
  current?: "home" | "dashboard";
  /** `light` sits on the off-white hero; `dark` on navy pages. */
  tone?: "light" | "dark";
}

const LINKS = [
  { href: "/#solutions", label: "Solutions" },
  { href: "/#workflow", label: "Workflow" },
  { href: "/#formats", label: "Formats" },
  { href: "/#devices", label: "Devices" },
];

export function SiteNav({ current = "home", tone = "dark" }: SiteNavProps) {
  const light = tone === "light";
  const linkClass = light
    ? "text-[var(--color-navy)] hover:text-[var(--color-accent-strong)]"
    : "text-[var(--color-ink)]/80 hover:text-[var(--color-ink)]";

  return (
    <header className={`relative z-40 ${light ? "bg-[var(--color-paper)]" : ""}`}>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
        <Logo tone={light ? "light" : "dark"} />

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`ring-focus rounded-md text-[15px] font-medium transition ${linkClass}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            aria-current={current === "dashboard" ? "page" : undefined}
            className={`ring-focus hidden rounded-md text-[15px] font-medium transition sm:inline-flex ${linkClass}`}
          >
            {current === "dashboard" ? "Dashboard" : "Login"}
          </Link>
          <Link
            href="/dashboard"
            className={`ring-focus btn-slant inline-flex items-center gap-2 py-2.5 pl-5 text-sm font-semibold transition hover:brightness-110 ${
              light
                ? "bg-[var(--color-navy)] text-white"
                : "bg-[var(--color-accent)] text-white"
            }`}
          >
            Get Started
            <Arrow />
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function Arrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M3 8h10m0 0L9 4m4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
