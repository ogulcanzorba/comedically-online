'use client';

import { useEffect, useState } from 'react';

function parts(ms: number): string {
  if (ms <= 0) return 'Starting…';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** Ticking countdown. Reloads once when the start time passes (player appears). */
export function Countdown({ targetUtc }: { targetUtc: string }) {
  const [label, setLabel] = useState('…');
  useEffect(() => {
    const target = Date.parse(targetUtc);
    let reloaded = false;
    const update = (): void => {
      const left = target - Date.now();
      setLabel(parts(left));
      if (left <= 0 && !reloaded) {
        reloaded = true;
        window.setTimeout(() => window.location.reload(), 2000);
      }
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [targetUtc]);
  return (
    <span className="font-mono text-4xl font-bold tabular-nums" suppressHydrationWarning>
      {label}
    </span>
  );
}
