import { useId } from 'react';
import { themeById } from '@/data/themes';

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
  const { deep, mid, glow } = themeById(theme);
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
