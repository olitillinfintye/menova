import Link from "next/link";

import { DeviceShowcase } from "@/app/components/DeviceShowcase";
import { FormatBadge } from "@/app/components/FormatBadge";
import { LogoLockup, LogoMark } from "@/app/components/Logo";
import { Arrow, SiteNav } from "@/app/components/SiteNav";
import { MAX_FILE_BYTES, MODEL_FORMATS, type ModelFormat, formatBytes } from "@/lib/constants";

const WALKTHROUGH_VIDEO = "/media/space-walkthrough.mp4";

const DEVICES = [
  {
    label: "Headset",
    icon: (
      <path d="M3 10a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-2.5l-1.5-2h-4l-1.5 2H6a3 3 0 0 1-3-3v-4Z" />
    ),
  },
  {
    label: "Tablet",
    icon: <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 15h.01" />,
  },
  {
    label: "Browser",
    icon: <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm0 3h18M6 6.5h.01M8.5 6.5h.01" />,
  },
  {
    label: "Mobile",
    icon: <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm4 17h.01" />,
  },
];

const SOLUTIONS = [
  {
    title: "The yes that holds",
    body: "Help clients understand scale, flow and feel before decisions become expensive.",
    tag: "Design validation",
  },
  {
    title: "Send it home",
    body: "A walkable presentation clients can revisit, share and experience after the meeting.",
    tag: "Client presentations",
  },
  {
    title: "Campaign-ready visuals",
    body: "Turn one model into accurate 4K renders and content for every stage of the sale.",
    tag: "Marketing assets",
  },
  {
    title: "Walk every design",
    body: "A virtual display home for every design, without the build cost.",
    tag: "Display homes",
  },
  {
    title: "Sell before it stands",
    body: "Give buyers the confidence to understand, share and commit before construction begins.",
    tag: "Off-plan sales",
  },
];

const WORKFLOW = [
  {
    number: "01",
    title: "Start with your files",
    body: `Export from Revit, ArchiCAD, SketchUp, 3ds Max or Blender as .glb, .fbx or .skp. Up to ${formatBytes(MAX_FILE_BYTES)} per model.`,
  },
  {
    number: "02",
    title: "Your Space comes to life",
    body: "Your project becomes a walkable home clients can open on mobile, tablet, browser or headset.",
  },
  {
    number: "03",
    title: "Share it where decisions happen",
    body: "Send a link, open it in a meeting, walk through it remotely or use it for sign-off.",
  },
  {
    number: "04",
    title: "Create visual assets on demand",
    body: "Capture 4K renders from any viewpoint, straight from the browser, whenever you need them.",
  },
];

const PARTNERS = ["Northgate Homes", "Atelier Ward", "Brixton & Co", "Halden Property", "Marlow Living", "Studio Kite"];

function Icon({ children, className = "h-6 w-6" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function HomePage() {
  const formats = Object.keys(MODEL_FORMATS) as ModelFormat[];

  return (
    <>
      {/* ============================ LIGHT HERO ============================ */}
      <div className="relative overflow-hidden bg-[var(--color-paper)] text-[var(--color-navy)]">
        <div aria-hidden="true" className="bg-grid-light pointer-events-none absolute inset-0" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 right-[-10rem] h-[36rem] w-[36rem] rounded-full bg-[var(--color-lavender)] opacity-40 blur-[140px]"
        />

        <SiteNav current="home" tone="light" />

        <main className="relative mx-auto w-full max-w-6xl px-5 sm:px-8">
          <section className="pt-10 pb-20 text-center sm:pt-16 lg:pt-20 lg:pb-24">
            <h1 className="font-display animate-fade-up mx-auto max-w-4xl text-[2.75rem] leading-[1.02] font-extrabold tracking-[-0.035em] sm:text-6xl lg:text-[5.25rem]">
              Your clients can&apos;t read plans.
            </h1>
            <p className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-navy-muted)] [animation-delay:80ms] sm:text-xl">
              Upload a 3D model. They walk the home like it was already built.
            </p>
            <div className="animate-fade-up mt-9 flex flex-wrap items-center justify-center gap-3 [animation-delay:140ms]">
              <Link
                href="/dashboard"
                className="ring-focus btn-slant inline-flex items-center gap-2 bg-[var(--color-navy)] py-3.5 pl-6 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
              >
                Get Started
                <Arrow />
              </Link>
              <Link
                href="#workflow"
                className="ring-focus inline-flex items-center gap-2 rounded-md px-5 py-3.5 text-sm font-semibold text-[var(--color-navy)] transition hover:text-[var(--color-accent-strong)]"
              >
                See how it works
                <Arrow className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>
        </main>
      </div>

      {/* =========================== NAVY SECTIONS ========================== */}
      <div className="relative bg-[var(--color-canvas)] text-[var(--color-ink)]">
        <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0" />

        <main className="relative mx-auto w-full max-w-6xl px-5 sm:px-8">
          {/* --------------------------- devices ---------------------------- */}
          <section id="devices" className="animate-fade-up scroll-mt-24 pt-16 pb-20 [animation-delay:220ms] sm:pt-20">
            <DeviceShowcase src={WALKTHROUGH_VIDEO}>
              <h2 className="font-display max-w-md text-3xl leading-[1.1] font-bold tracking-tight sm:text-4xl">
                Complete clarity, everywhere decisions happen.
              </h2>
              <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--color-muted)]">
                Walk the home in VR. Review it on tablet. Share it by browser. Reopen it on mobile.
                One link, no installs.
              </p>
            </DeviceShowcase>

            <div className="mt-16 border-t border-white/10 pt-8">
              <p className="text-center text-xs font-medium tracking-[0.18em] text-[var(--color-muted)] uppercase">
                Trusted by builders, architects and agents
              </p>
              <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
                {PARTNERS.map((partner) => (
                  <li
                    key={partner}
                    className="font-display text-base font-bold tracking-tight text-[var(--color-ink)]/40"
                  >
                    {partner}
                  </li>
                ))}
              </ul>
            </div>
          </section>
          {/* --------------------------- solutions -------------------------- */}
          <section id="solutions" className="scroll-mt-24 py-24">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:items-end">
              <h2 className="font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
                One Space.
                <br />
                <span className="text-highlight">Five ways</span> to close the gap.
              </h2>
              <p className="max-w-xl text-base leading-relaxed text-[var(--color-muted)] lg:justify-self-end">
                From sign-off to sales, Menova turns your existing 3D models into walkable experiences
                your clients can understand, share and decide from.
              </p>
            </div>

            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {SOLUTIONS.map((solution, index) => (
                <li
                  key={solution.title}
                  className={`card group flex flex-col justify-between rounded-2xl p-5 transition duration-300 hover:-translate-y-1 hover:border-[var(--color-accent)]/60 ${
                    index === 0 ? "sm:col-span-2 lg:col-span-1" : ""
                  }`}
                >
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.14em] text-[var(--color-lavender)] uppercase">
                      {solution.tag}
                    </p>
                    <h3 className="font-display mt-4 text-xl font-bold tracking-tight">{solution.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">{solution.body}</p>
                  </div>
                  <Link
                    href="/dashboard"
                    className="ring-focus mt-8 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-[var(--color-ink)] transition group-hover:text-[var(--color-lavender)]"
                  >
                    Open card
                    <Arrow className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* --------------------------- workflow --------------------------- */}
          <section id="workflow" className="scroll-mt-24 pb-24">
            <span className="eyebrow">The workflow</span>
            <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_1.3fr]">
              <div>
                <h2 className="font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
                  From what you have.
                  <br />
                  <span className="text-highlight">To what they can walk through.</span>
                </h2>
                <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--color-muted)]">
                  Upload a 3D model and Menova turns it into a walkable Space your clients can open,
                  share and decide from — with renders created from the same source.
                </p>
                <Link
                  href="/dashboard"
                  className="ring-focus btn-slant mt-8 inline-flex items-center gap-2 bg-[var(--color-accent)] py-3 pl-5 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  Get Started
                  <Arrow />
                </Link>
              </div>

              <div className="paper rounded-[1.75rem] p-6 sm:p-8">
                <ol className="space-y-8">
                  {WORKFLOW.map((step, index) => (
                    <li key={step.number} className="grid gap-4 sm:grid-cols-[3rem_1fr]">
                      <span className="font-display text-sm font-bold text-[var(--color-accent-strong)]">
                        {step.number}
                      </span>
                      <div>
                        <h3 className="font-display text-xl font-bold tracking-tight">{step.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--color-navy-muted)]">{step.body}</p>

                        {index === 0 && (
                          <div className="mt-5 rounded-2xl border-2 border-dashed border-[var(--color-navy)]/15 bg-[var(--color-paper)] p-5 text-center">
                            <Icon className="mx-auto h-6 w-6 text-[var(--color-accent-strong)]">
                              <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                            </Icon>
                            <p className="mt-2 text-sm font-semibold">Drop your file here</p>
                            <p className="mt-1 text-xs text-[var(--color-navy-muted)]">
                              GLB, FBX, SKP · Max {formatBytes(MAX_FILE_BYTES)}
                            </p>
                            <div className="mt-4 flex items-center justify-between rounded-xl bg-white px-3 py-2 text-left text-xs shadow-sm">
                              <span className="flex items-center gap-2 font-medium">
                                <FormatBadge format="skp" />
                                model.skp
                              </span>
                              <span className="rounded-full bg-[var(--color-mint)]/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                Approved
                              </span>
                            </div>
                          </div>
                        )}

                        {index === 1 && (
                          <div className="mt-5 grid grid-cols-4 gap-2">
                            {DEVICES.map((device) => (
                              <span
                                key={device.label}
                                className="flex flex-col items-center gap-1.5 rounded-xl bg-[var(--color-paper)] py-3 text-[10px] font-semibold text-[var(--color-navy-muted)]"
                              >
                                <Icon className="h-5 w-5 text-[var(--color-accent-strong)]">{device.icon}</Icon>
                                {device.label}
                              </span>
                            ))}
                          </div>
                        )}

                        {index === 2 && (
                          <div className="mt-5 flex items-center gap-2 rounded-xl bg-[var(--color-paper)] p-2 pl-3 font-mono text-xs text-[var(--color-navy-muted)]">
                            <span className="truncate">menova.studio/viewer/proj_a7f29c1d</span>
                            <span className="ml-auto rounded-lg bg-[var(--color-navy)] px-2.5 py-1.5 font-sans text-[11px] font-semibold text-white">
                              Copy link
                            </span>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>

          {/* ---------------------------- formats --------------------------- */}
          <section id="formats" className="scroll-mt-24 pb-24">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
              <div>
                <span className="eyebrow">Bring your own pipeline</span>
                <h2 className="font-display mt-6 text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
                  glTF, FBX <span className="text-highlight">or SketchUp.</span>
                </h2>
                <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--color-muted)]">
                  Draco, Meshopt and KTX2 compression are decoded on the fly, and FBX units are
                  normalised to metres so 1:1 mode stays true to scale.
                </p>
              </div>

              <ul className="grid gap-3">
                {formats.map((format) => {
                  const meta = MODEL_FORMATS[format];
                  return (
                    <li key={format} className="card flex gap-5 rounded-2xl p-5">
                      <FormatBadge format={format} className="mt-1 h-fit" />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                          {meta.label}
                          <span className="font-mono text-xs font-normal text-[var(--color-muted)]">
                            {meta.extension}
                          </span>
                          {meta.walkthrough ? (
                            <span className="rounded-full bg-[var(--color-mint)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-mint)]">
                              Interactive walkthrough
                            </span>
                          ) : (
                            <span className="rounded-full bg-[var(--color-lavender)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-lavender)]">
                              Stored &amp; shareable
                            </span>
                          )}
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">
                          {meta.description}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* ------------------------------ CTA ----------------------------- */}
          <section className="pb-24">
            <div className="relative overflow-hidden rounded-[2rem] bg-[var(--color-paper)] px-6 py-16 text-center text-[var(--color-navy)] sm:px-12 sm:py-20">
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(201_150_42_/_0.28),transparent_60%)]"
              />
              <div className="relative">
                <LogoMark className="mx-auto h-14 w-14" />
                <h2 className="font-display mt-6 text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
                  Close the imagination gap
                  <br />
                  on your next project.
                </h2>
                <p className="mx-auto mt-4 max-w-md text-base text-[var(--color-navy-muted)]">
                  Every step of your visualisation needs in one place.
                </p>
                <Link
                  href="/dashboard"
                  className="ring-focus btn-slant mt-9 inline-flex items-center gap-2 bg-[var(--color-navy)] py-3.5 pl-6 text-sm font-semibold text-white transition hover:brightness-125"
                >
                  Get Started
                  <Arrow />
                </Link>
              </div>
            </div>
          </section>
        </main>

        <footer className="relative border-t border-white/10">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <LogoLockup className="h-12 w-auto" />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--color-muted)]">
                Web-based architectural visualisation. Upload a model, share a link, walk the space
                on desktop, mobile or Meta Quest.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-[var(--color-lavender)] uppercase">
                Product
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-[var(--color-muted)]">
                {[
                  ["Solutions", "/#solutions"],
                  ["Workflow", "/#workflow"],
                  ["Formats", "/#formats"],
                  ["Dashboard", "/dashboard"],
                ].map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className="ring-focus rounded transition hover:text-[var(--color-ink)]">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-[var(--color-lavender)] uppercase">
                Have questions?
              </p>
              <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted)]">
                Open the studio and upload your first model. A shareable link is ready in under a
                minute.
              </p>
              <Link
                href="/dashboard"
                className="ring-focus mt-4 inline-flex items-center gap-1.5 rounded text-sm font-semibold text-[var(--color-ink)] transition hover:text-[var(--color-lavender)]"
              >
                Chat to us
                <Arrow className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <div className="mx-auto max-w-6xl px-5 pb-8 text-xs text-[var(--color-muted)] sm:px-8">
            © {new Date().getFullYear()} Menova Studios. Built for architects who present in real spaces.
          </div>
        </footer>
      </div>
    </>
  );
}
