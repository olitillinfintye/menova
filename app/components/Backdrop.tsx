/**
 * Ambient page backdrop for navy pages: blueprint grid plus two soft
 * lavender fields. Purely decorative and fixed behind all content.
 */
export function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="bg-grid absolute inset-0" />
      <div className="absolute -top-40 left-1/2 h-[42rem] w-[42rem] -translate-x-[60%] rounded-full bg-[var(--color-accent)] opacity-[0.18] blur-[140px] animate-float" />
      <div className="absolute top-1/3 right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-[var(--color-lavender)] opacity-[0.1] blur-[150px] animate-float-slow" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[var(--color-canvas)] to-transparent" />
    </div>
  );
}
