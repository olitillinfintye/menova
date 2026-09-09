/**
 * Ambient page backdrop for navy pages: blueprint grid plus two soft
 * lavender fields. Purely decorative and fixed behind all content.
 */
export function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="bg-grid absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[var(--color-canvas)] to-transparent" />
    </div>
  );
}
