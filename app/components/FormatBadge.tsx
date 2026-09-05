import { MODEL_FORMATS, type ModelFormat } from "@/lib/constants";

const STYLES: Record<ModelFormat, string> = {
  glb: "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-lavender)]",
  fbx: "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
  skp: "border-amber-400/40 bg-amber-400/15 text-amber-300",
};

interface FormatBadgeProps {
  format: ModelFormat;
  className?: string;
}

export function FormatBadge({ format, className = "" }: FormatBadgeProps) {
  return (
    <span
      title={MODEL_FORMATS[format].label}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${STYLES[format]} ${className}`}
    >
      {format}
    </span>
  );
}
