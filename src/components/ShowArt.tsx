import { useId } from 'react';

const THEMES: Record<string, [string, string, string]> = {
  ember: ['#431407', '#9a3412', '#fbbf24'],
  slate: ['#020617', '#334155', '#94a3b8'],
  teal: ['#042f2e', '#0f766e', '#5eead4'],
  rose: ['#4c0519', '#be123c', '#fda4af'],
  gold: ['#451a03', '#b45309', '#fde68a'],
  forest: ['#052e16', '#15803d', '#86efac'],
  coral: ['#431407', '#c2410c', '#fdba74'],
  moss: ['#1a2e05', '#4d7c0f', '#bef264'],
  ocean: ['#082f49', '#0369a1', '#7dd3fc'],
  copper: ['#3b0a0a', '#9a3412', '#fca5a5'],
  night: ['#0c0a09', '#44403c', '#e7e5e4'],
  berry: ['#3b0764', '#7e22ce', '#d8b4fe'],
};

/** Generated SVG thumbnail: gradient + spotlight cone + mic dot. No image API. */
export function ShowArt({
  theme,
  title,
  className,
}: {
  theme: string;
  title: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const [deep, mid, glow] = THEMES[theme] ?? THEMES.ember;
  return (
    <svg viewBox="0 0 400 225" className={className} role="img" aria-label={`${title} artwork`}>
      <defs>
        <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={deep} />
          <stop offset="100%" stopColor={mid} />
        </linearGradient>
        <radialGradient id={`s${uid}`} cx="50%" cy="0%" r="75%">
          <stop offset="0%" stopColor={glow} stopOpacity="0.85" />
          <stop offset="100%" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="225" fill={`url(#g${uid})`} />
      <polygon points="150,0 250,0 330,225 70,225" fill={`url(#s${uid})`} />
      <ellipse cx="200" cy="205" rx="70" ry="12" fill={glow} opacity="0.5" />
      <rect x="192" y="120" width="16" height="60" rx="8" fill="#0c0a09" opacity="0.85" />
      <circle cx="200" cy="108" r="20" fill={glow} />
      <circle cx="200" cy="108" r="20" fill="none" stroke="#0c0a09" strokeWidth="3" opacity="0.4" />
    </svg>
  );
}
