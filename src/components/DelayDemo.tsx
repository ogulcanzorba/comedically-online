'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const DELAY_S = 12;

/** Interactive 12s delay demo: press start, watch a moment arrive "late". */
export function DelayDemo() {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(DELAY_S);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    [],
  );

  function start(): void {
    if (timer.current !== null) window.clearInterval(timer.current);
    setLeft(DELAY_S);
    setRunning(true);
    timer.current = window.setInterval(() => {
      setLeft((prev) => {
        if (prev <= 1) {
          if (timer.current !== null) window.clearInterval(timer.current);
          timer.current = null;
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-6 text-center">
      <p className="font-mono text-6xl font-bold tabular-nums" aria-live="polite">
        {running || left < DELAY_S ? left : String(DELAY_S)}
      </p>
      <div
        className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded bg-neutral-800"
        role="progressbar"
        aria-valuenow={running || left < DELAY_S ? DELAY_S - left : 0}
        aria-valuemin={0}
        aria-valuemax={DELAY_S}
        aria-label="Delay progress"
      >
        <div
          className="h-full bg-spotlight transition-all duration-1000"
          style={{ width: `${((running || left < DELAY_S ? DELAY_S - left : 0) / DELAY_S) * 100}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-neutral-400">
        {left === 0 && !running
          ? 'That moment just reached the viewers.'
          : 'Press start: this is how long moderation gets per chunk.'}
      </p>
      <button
        onClick={start}
        disabled={running}
        className="mt-4 rounded-md bg-spotlight px-5 py-2 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
      >
        {running ? 'Running…' : 'Run 12s demo'}
      </button>
      <p className="mt-4 text-sm">
        <Link href="/shows/demo-night" className="underline">
          Watch the live Demo Night stream
        </Link>
      </p>
    </div>
  );
}
