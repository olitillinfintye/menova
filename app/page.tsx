import Link from "next/link";
import { Scan } from "lucide-react";

import { DeviceShowcase } from "@/app/components/DeviceShowcase";
import { FormatBadge } from "@/app/components/FormatBadge";
import { LogoLockup, LogoMark } from "@/app/components/Logo";
import { Arrow, SiteNav } from "@/app/components/SiteNav";
import { MAX_FILE_BYTES, MODEL_FORMATS, type ModelFormat, formatBytes } from "@/lib/constants";
import { getHomeContent } from "@/lib/site-content-db";
import { getSiteVideos } from "@/lib/site-media-db";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

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

export default async function HomePage() {
  const [videos, { content }] = await Promise.all([getSiteVideos(), getHomeContent()]);
  const formats = Object.keys(MODEL_FORMATS) as ModelFormat[];
  const solutions = ([1, 2, 3, 4, 5] as const).map((number) => ({
    title: content.solutions[`card${number}Title`],
    body: content.solutions[`card${number}Body`],
    tag: content.solutions[`card${number}Tag`],
  }));
  const workflow = ([1, 2, 3, 4] as const).map((number) => ({
    number: String(number).padStart(2, "0"),
    title: content.workflow[`step${number}Title`],
    body: content.workflow[`step${number}Body`],
  }));
  const footerLinks = ([1, 2, 3, 4, 5, 6] as const).map((number) => ({
    label: content.footer[`link${number}Label`],
    href: content.footer[`link${number}Href`],
  }));

  return (
    <>
      <div className={styles.hero} data-home-hero>
        <div className={styles.scene} aria-hidden="true">
          <img
            src={content.hero.imageUrl}
            alt=""
            fetchPriority="high"
            decoding="async"
          />
        </div>

        <SiteNav current="home" tone="dark" />

        <main className="relative mx-auto w-full max-w-6xl px-5 sm:px-8">
          <section className={styles.composition} aria-labelledby="home-heading">
            <div className={styles.copy}>
            <p className={styles.brand}>{content.hero.brand}</p>
            <div className={`${styles.headline} font-display animate-fade-up`}>
              <p>{content.hero.lead}</p>
              <h1 id="home-heading"><span>{content.hero.heading}</span><span>{content.hero.headingEnd}</span></h1>
            </div>
            <p className={`${styles.intro} animate-fade-up [animation-delay:80ms]`}>
              {content.hero.body}
            </p>
            <div className={`${styles.actions} animate-fade-up mt-7 flex flex-wrap items-center gap-3 [animation-delay:140ms]`}>
              <Link
                href={content.hero.buttonHref}
                className="ring-focus inline-flex items-center gap-2 rounded-md px-5 py-3.5 text-sm font-semibold text-white transition hover:text-[var(--color-accent)]"
              >
                {content.hero.buttonLabel}
                <Arrow className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className={`${styles.credit} mt-8 text-xs text-white/65`}>{content.hero.credit}</p>
            </div>
            <div className={styles.visual}>
              <div className={styles.phoneFloat} data-home-ar-phone>
                <div className={styles.phone}>
                  <div className={styles.screen}>
                    <video
                      src={videos.home.url}
                      autoPlay muted loop playsInline preload="metadata"
                      aria-label={content.hero.videoLabel}
                    />
                    <div className={styles.island} aria-hidden="true" />
                    <div className={styles.phoneHeader} aria-hidden="true"><span>{content.hero.phoneBrand}</span><span>{content.hero.phoneMode}</span></div>
                    <div className={styles.reticle} aria-hidden="true"><span /></div>
                    <p className={styles.phoneCaption} aria-hidden="true">{content.hero.phoneCaption}</p>
                    <div className={styles.homeBar} aria-hidden="true" />
                  </div>
                </div>
                <div className={styles.phoneLabel}>
                  <Scan size={21} aria-hidden="true" />
                  <span>{content.hero.phoneLabel}<small>{content.hero.phoneDescription}</small></span>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* =========================== NAVY SECTIONS ========================== */}
      <div className={`${styles.content} relative bg-[var(--color-canvas)] text-[var(--color-ink)]`}>
        <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0" />

        <main className="relative mx-auto w-full max-w-6xl px-5 sm:px-8">
          {/* --------------------------- devices ---------------------------- */}
          <section id="devices" className="animate-fade-up scroll-mt-24 pt-16 pb-20 [animation-delay:220ms] sm:pt-20">
            <DeviceShowcase src={videos.devices.url} title={content.devices.previewTitle} caption={content.devices.previewCaption}>
              <h2 className="font-display max-w-md text-3xl leading-[1.1] font-bold tracking-tight sm:text-4xl">
                {content.devices.heading}
              </h2>
              <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--color-muted)]">
                {content.devices.body}
              </p>
            </DeviceShowcase>

          </section>
          {/* --------------------------- solutions -------------------------- */}
          <section id="solutions" className="scroll-mt-24 py-24">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:items-end">
              <h2 className="font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
                {content.solutions.heading}
                <br />
                <span className="text-highlight">{content.solutions.highlight}</span> {content.solutions.headingEnd}
              </h2>
              <p className="max-w-xl text-base leading-relaxed text-[var(--color-muted)] lg:justify-self-end">
                {content.solutions.body}
              </p>
            </div>

            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {solutions.map((solution, index) => (
                <li
                  key={index}
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
                    href={content.solutions.buttonHref}
                    className="ring-focus mt-8 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-[var(--color-ink)] transition group-hover:text-[var(--color-lavender)]"
                  >
                    {content.solutions.buttonLabel}
                    <Arrow className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* --------------------------- workflow --------------------------- */}
          <section id="workflow" className="scroll-mt-24 pb-24">
            <span className="eyebrow">{content.workflow.eyebrow}</span>
            <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div>
                <h2 className="font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
                  {content.workflow.heading}
                  <br />
                  <span className="text-highlight">{content.workflow.highlight}</span>
                </h2>
                <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--color-muted)]">
                  {content.workflow.body}
                </p>
                <Link
                  href={content.workflow.buttonHref}
                  className="ring-focus btn-slant mt-8 inline-flex items-center gap-2 bg-[var(--color-accent)] py-3 pl-5 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  {content.workflow.buttonLabel}
                  <Arrow />
                </Link>
              </div>

              <div className="min-w-0 border-t border-[var(--color-line)] pt-8">
                <ol className="space-y-8">
                  {workflow.map((step, index) => (
                    <li key={step.number} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[3rem_minmax(0,1fr)]">
                      <span className="font-display text-sm font-bold text-[var(--color-accent-strong)]">
                        {step.number}
                      </span>
                      <div>
                        <h3 className="font-display text-xl font-bold tracking-tight">{step.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{step.body}</p>

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
                            <span className="truncate">menova-flax.vercel.app/viewer/your-project</span>
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
                <span className="eyebrow">{content.formats.eyebrow}</span>
                <h2 className="font-display mt-6 text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
                  {content.formats.heading} <span className="text-highlight">{content.formats.highlight}</span>
                </h2>
                <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--color-muted)]">
                  {content.formats.body}
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
                          {content.formats[`${format}Label`]}
                          <span className="font-mono text-xs font-normal text-[var(--color-muted)]">
                            {meta.extension}
                          </span>
                          {meta.walkthrough ? (
                            <span className="rounded-full bg-[var(--color-mint)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-mint)]">
                              {content.formats.interactiveLabel}
                            </span>
                          ) : (
                            <span className="rounded-full bg-[var(--color-lavender)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-lavender)]">
                              {content.formats.storedLabel}
                            </span>
                          )}
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">
                          {content.formats[`${format}Description`]}
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
            <div className="relative border-y border-[var(--color-line)] px-6 py-16 text-center sm:px-12 sm:py-20">
              <div
                aria-hidden="true"
                className="bg-grid absolute inset-0"
              />
              <div className="relative">
                <LogoMark className="mx-auto h-14 w-14" />
                <h2 className="font-display mt-6 text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl">
                  {content.callToAction.heading}
                  <br />
                  {content.callToAction.headingEnd}
                </h2>
                <p className="mx-auto mt-4 max-w-md text-base text-[var(--color-navy-muted)]">
                  {content.callToAction.body}
                </p>
                <Link
                  href={content.callToAction.buttonHref}
                  className="ring-focus btn-slant mt-9 inline-flex items-center gap-2 bg-[var(--color-navy)] py-3.5 pl-6 text-sm font-semibold text-white transition hover:brightness-125"
                >
                  {content.callToAction.buttonLabel}
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
                {content.footer.body}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-[var(--color-lavender)] uppercase">
                {content.footer.productHeading}
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-[var(--color-muted)]">
                {footerLinks.map(({ label, href }, index) => (
                  <li key={index}>
                    <Link href={href} className="ring-focus rounded transition hover:text-[var(--color-ink)]">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-[var(--color-lavender)] uppercase">
                {content.footer.contactHeading}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted)]">
                {content.footer.contactBody}
              </p>
              <Link
                href={content.footer.contactHref}
                className="ring-focus mt-4 inline-flex items-center gap-1.5 rounded text-sm font-semibold text-[var(--color-ink)] transition hover:text-[var(--color-lavender)]"
              >
                {content.footer.contactLabel}
                <Arrow className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <div className="mx-auto max-w-6xl px-5 pb-8 text-xs text-[var(--color-muted)] sm:px-8">
            © {new Date().getFullYear()} {content.footer.copyright}
          </div>
        </footer>
      </div>
    </>
  );
}
