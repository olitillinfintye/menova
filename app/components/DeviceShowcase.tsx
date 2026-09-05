"use client";

import { useEffect, useRef, useState } from "react";

import { LogoLockup } from "@/app/components/Logo";

type Device = "headset" | "tablet" | "browser" | "mobile";

interface DeviceMeta {
  label: string;
  icon: React.ReactNode;
  /** Outer frame sizing; the video always fills the screen area. */
  frame: string;
  screen: string;
  /** `cover` fills the cut-out; `contain` shows the whole recording. */
  fit: "cover" | "contain";
  hint: string;
}

const DEVICES: Record<Device, DeviceMeta> = {
  headset: {
    label: "Headset",
    icon: <path d="M3 10a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-2.5l-1.5-2h-4l-1.5 2H6a3 3 0 0 1-3-3v-4Z" />,
    // Visor: soft top corners, bottom corners swept up on a tall ellipse.
    frame: "max-w-4xl rounded-[3rem_3rem_7rem_7rem/3rem_3rem_11rem_11rem] border-[3px] p-2.5",
    screen: "aspect-[2/1] rounded-[2.5rem_2.5rem_6.5rem_6.5rem/2.5rem_2.5rem_10.5rem_10.5rem]",
    fit: "cover",
    hint: "Enter VR · 1:1 scale · hand tracking",
  },
  tablet: {
    label: "Tablet",
    icon: <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 15h.01" />,
    frame: "max-w-3xl rounded-[2rem] border-[3px] p-3",
    screen: "aspect-[4/3] rounded-[1.4rem]",
    fit: "cover",
    hint: "Drag left to walk · drag right to look",
  },
  browser: {
    label: "Browser",
    icon: <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm0 3h18M6 6.5h.01M8.5 6.5h.01" />,
    frame: "max-w-5xl rounded-2xl border-2 p-1.5",
    screen: "aspect-[16/9] rounded-xl",
    fit: "cover",
    hint: "WASD to walk · click to look · Shift to sprint",
  },
  mobile: {
    label: "Mobile",
    icon: <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm4 17h.01" />,
    frame: "max-w-[19rem] rounded-[2.5rem] border-[3px] p-2",
    screen: "aspect-[9/19] rounded-[2rem]",
    fit: "cover",
    hint: "Tap a floor to teleport · pinch to zoom",
  },
};

const ORDER: Device[] = ["headset", "tablet", "browser", "mobile"];

function Icon({ children, className = "h-5 w-5" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function HudButton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-[var(--color-navy)] shadow-sm backdrop-blur"
    >
      {children}
    </span>
  );
}

interface DeviceShowcaseProps {
  src: string;
  title?: string;
  caption?: string;
  /** Copy rendered to the left of the device tabs. */
  children?: React.ReactNode;
}

/**
 * Enviz-style device gallery: one looping walkthrough video, framed as a
 * headset, tablet, browser or phone, with the Menova viewer chrome laid over it.
 */
export function DeviceShowcase({
  src,
  title = "Riverside Pavilion",
  caption = "Interactive Space · rendered live in the browser",
  children,
}: DeviceShowcaseProps) {
  const [device, setDevice] = useState<Device>("browser");
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    // Honour reduced-motion: show the first frame instead of autoplaying.
    // Otherwise kick playback explicitly, since the `autoplay` attribute is
    // ignored when React attaches `src` after the element is created.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
    } else {
      video.play().catch(() => undefined);
    }

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  };

  const meta = DEVICES[device];
  const portrait = device === "mobile";
  const headset = device === "headset";
  const morph = "duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]";

  return (
    <div>
      {/* ------------------------------ frame ------------------------------ */}
      <div
        className={`relative mx-auto border-[var(--color-accent)] bg-[var(--color-canvas)] shadow-[0_0_0_1px_rgb(201_150_42_/_0.35),0_40px_120px_-40px_rgb(201_150_42_/_0.6)] transition-[max-width,border-radius,padding] ${morph} ${meta.frame}`}
      >
        {/* Headset straps: slide out from behind the visor. */}
        {(["left", "right"] as const).map((side) => (
          <span
            key={side}
            aria-hidden="true"
            className={`absolute top-[22%] -z-10 h-[46%] w-10 bg-[var(--color-accent)] transition-[transform,opacity] ${morph} ${
              side === "left" ? "-left-8 rounded-l-3xl" : "-right-8 rounded-r-3xl"
            } ${headset ? "translate-x-0 opacity-100" : side === "left" ? "translate-x-8 opacity-0" : "-translate-x-8 opacity-0"}`}
          />
        ))}
        {/* Headset face-pad highlight. */}
        <span
          aria-hidden="true"
          className={`absolute inset-x-[18%] top-0 h-1.5 -translate-y-1/2 rounded-full bg-[var(--color-lavender)] transition-[opacity,transform] ${morph} ${
            headset ? "opacity-100 scale-x-100" : "opacity-0 scale-x-50"
          }`}
        />
        {/* Nose cut-out: rises through the bottom edge for the headset. */}
        <span
          aria-hidden="true"
          className={`absolute -bottom-[3px] left-1/2 z-10 h-[27%] w-[21%] -translate-x-1/2 rounded-t-[100%] border-[3px] border-b-0 border-[var(--color-accent)] bg-[var(--color-canvas)] transition-[transform,opacity] ${morph} ${
            headset ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
          }`}
        />
        {/* device-specific chrome */}
        {device === "browser" && (
          <div className="flex items-center justify-between px-3 py-1.5 text-[var(--color-lavender)]">
            <div className="flex items-center gap-3">
              <span className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full border border-current" />
                <span className="h-2.5 w-2.5 rounded-full border border-current" />
                <span className="h-2.5 w-2.5 rounded-full border border-current" />
              </span>
              <Icon className="h-4 w-4">
                <path d="M4 5h16v14H4V5Zm5 0v14" />
              </Icon>
              <Icon className="h-4 w-4">
                <path d="m14 6-6 6 6 6" />
              </Icon>
              <Icon className="h-4 w-4 opacity-40">
                <path d="m10 6 6 6-6 6" />
              </Icon>
            </div>
            <span className="hidden rounded-md bg-white/5 px-3 py-0.5 font-mono text-[11px] text-[var(--color-muted)] sm:block">
              menova.studio/viewer/proj_a7f29c1d
            </span>
          </div>
        )}
        {device === "tablet" && (
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-1 h-2 w-2 -translate-y-1/2 rounded-full bg-[var(--color-accent)]/60"
          />
        )}
        {device === "mobile" && (
          <span
            aria-hidden="true"
            className="absolute top-3.5 left-1/2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-[var(--color-canvas)]"
          />
        )}

        {/* ------------------------------ screen ---------------------------- */}
        <div
          className={`group relative overflow-hidden bg-[#151537] transition-[aspect-ratio,border-radius] ${morph} ${meta.screen}`}
        >
          <video
            ref={videoRef}
            src={src}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={`${title} walkthrough preview`}
            className={`absolute inset-0 h-full w-full ${meta.fit === "cover" ? "object-cover" : "object-contain"}`}
          />

          {/* HUD overlay */}
          <div
            className={`pointer-events-none absolute inset-0 flex flex-col justify-between transition-[padding] ${morph} ${
              headset ? "px-[7%] pt-4 pb-[6%]" : "p-3 sm:p-4"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex gap-1.5">
                <HudButton label="Back">
                  <Icon className="h-3.5 w-3.5">
                    <path d="m14 6-6 6 6 6" />
                  </Icon>
                </HudButton>
                <HudButton label="Help">
                  <Icon className="h-3.5 w-3.5">
                    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                  </Icon>
                </HudButton>
              </div>
              <span className="flex items-center gap-1.5 rounded-md bg-black/35 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur">
                Powered by <LogoLockup className="h-3.5 w-auto" />
              </span>
            </div>

            <div className={`flex items-end justify-between gap-3 ${portrait ? "flex-col-reverse items-stretch" : ""}`}>
              <div className="flex flex-col gap-1.5">
                <HudButton label="Walk mode">
                  <Icon className="h-3.5 w-3.5">
                    <path d="M13 4.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM9 21l2-6-2-2v-4l3-2 2 3h3M11 13l2 2v6" />
                  </Icon>
                </HudButton>
                <HudButton label="Share">
                  <Icon className="h-3.5 w-3.5">
                    <path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
                  </Icon>
                </HudButton>
              </div>

              <div
                className={`glass rounded-xl px-3 py-2 text-center transition-transform ${morph} ${
                  portrait ? "" : "hidden sm:block"
                } ${headset ? "-translate-y-[120%]" : ""}`}
              >
                <p className="text-xs font-semibold text-white">{title}</p>
                <p className="mt-0.5 text-[10px] text-white/70">{meta.hint}</p>
              </div>

              <div className={`flex gap-1.5 ${portrait ? "justify-end" : "flex-col"}`}>
                <HudButton label="Info">
                  <Icon className="h-3.5 w-3.5">
                    <path d="M12 11v5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                  </Icon>
                </HudButton>
                <HudButton label="Viewpoints">
                  <Icon className="h-3.5 w-3.5">
                    <path d="M12 21s6-5.2 6-10a6 6 0 0 0-12 0c0 4.8 6 10 6 10Zm0-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                  </Icon>
                </HudButton>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={togglePlayback}
            aria-pressed={playing}
            aria-label={playing ? "Pause preview" : "Play preview"}
            className="ring-focus absolute top-1/2 left-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-black/60 focus-visible:opacity-100 data-[paused=true]:opacity-100"
            data-paused={!playing}
          >
            {playing ? (
              <Icon>
                <path d="M9 5v14M15 5v14" />
              </Icon>
            ) : (
              <Icon>
                <path d="M8 5v14l11-7L8 5Z" />
              </Icon>
            )}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-[var(--color-muted)]">{caption}</p>

      {/* ------------------------------- tabs ------------------------------ */}
      <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1fr_auto]">
        <div>{children}</div>
        <div
          role="tablist"
          aria-label="Choose a device"
          className="flex flex-wrap items-center gap-2 lg:justify-end"
        >
          {ORDER.map((key) => {
            const active = key === device;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setDevice(key)}
                className={`ring-focus inline-flex items-center gap-2.5 rounded-xl px-5 py-3 text-[15px] font-semibold transition ${
                  active
                    ? "bg-white text-[var(--color-navy)] shadow-[0_16px_40px_-20px_rgb(0_0_0_/_0.6)]"
                    : "text-[var(--color-ink)]/80 hover:bg-white/5 hover:text-[var(--color-ink)]"
                }`}
              >
                <Icon>{DEVICES[key].icon}</Icon>
                {DEVICES[key].label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
