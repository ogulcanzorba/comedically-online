/** Inline SVG logo: mic under a spotlight cone + wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" role="img" aria-label="Comedically Online logo">
        <polygon points="9,1 23,1 29,30 3,30" fill="#ffc53d" opacity="0.25" />
        <rect x="14" y="13" width="4" height="11" rx="2" fill="#f4f4f5" />
        <circle cx="16" cy="10" r="5" fill="#ffc53d" />
        <rect x="13" y="24" width="10" height="2.5" rx="1.25" fill="#ff6b5b" />
      </svg>
      <span className="font-serif text-lg font-bold">
        Comedically <span className="text-spotlight">Online</span>
      </span>
    </span>
  );
}
