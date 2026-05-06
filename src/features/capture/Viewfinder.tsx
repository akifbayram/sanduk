/** Dashed viewfinder frame with accent-color corner brackets and an optional centered hint. */
export function Viewfinder({ hint }: { hint?: string }) {
  return (
    <div className="flex-1 relative flex items-center justify-center">
      <div className="absolute inset-4 border border-dashed border-white/40 pointer-events-none">
        <div className="absolute -top-px -left-px h-4 w-4 border-t-2 border-l-2 border-[var(--accent)]" />
        <div className="absolute -top-px -right-px h-4 w-4 border-t-2 border-r-2 border-[var(--accent)]" />
        <div className="absolute -bottom-px -left-px h-4 w-4 border-b-2 border-l-2 border-[var(--accent)]" />
        <div className="absolute -bottom-px -right-px h-4 w-4 border-b-2 border-r-2 border-[var(--accent)]" />
      </div>
      {hint && (
        <p className="relative text-[13px] text-white/55 font-medium text-center px-6">
          {hint}
        </p>
      )}
    </div>
  );
}
