'use client';

import { useEffect, useRef, useState } from 'react';
import { activeBlursAt, isBleepedAt, type CensorPlan } from '@/lib/censor-plan';
import { renderCensoredVideo } from '@/lib/censor-render';

export interface BroadcastMarker {
  seq: number;
  action: 'bleep' | 'blur';
  label: string;
}

/**
 * The whole broadcast as viewers saw it: blur boxes over the video, audio
 * muted during bleeps, markers on the timeline, one censored download.
 */
export function CensoredBroadcastPlayer({
  url,
  plan,
  markers,
  fileName,
}: {
  url: string;
  plan: CensorPlan;
  markers: BroadcastMarker[];
  fileName: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [renderError, setRenderError] = useState('');
  const muted = isBleepedAt(plan, now);
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);
  const blurs = activeBlursAt(plan, now);
  const sync = (el: HTMLVideoElement): void => setNow(el.currentTime);
  const seek = (seq: number): void => {
    if (videoRef.current) videoRef.current.currentTime = seq * 2;
  };
  const download = async (): Promise<void> => {
    setRenderError('');
    setProgress(0);
    try {
      const blob = await renderCensoredVideo(url, plan, setProgress);
      const out = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = out;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : 'render failed');
    } finally {
      setProgress(null);
    }
  };
  const span = Math.max(plan.durationS, 1);
  return (
    <div>
      <div className="relative">
        <video
          ref={videoRef}
          src={url}
          controls
          preload="metadata"
          className="block aspect-video w-full rounded-md bg-black"
          onTimeUpdate={(e) => sync(e.currentTarget)}
          onSeeked={(e) => sync(e.currentTarget)}
        />
        {blurs.map((b, i) => (
          <div
            key={i}
            aria-hidden="true"
            className="pointer-events-none absolute rounded-sm bg-black/45 backdrop-blur-md"
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
            }}
          />
        ))}
        {muted && (
          <span className="absolute right-2 top-2 rounded bg-neutral-950/80 px-2 py-0.5 text-[11px] font-semibold text-red-300">
            MUTED
          </span>
        )}
      </div>
      <div className="relative mt-2 h-2 rounded bg-neutral-800" role="img" aria-label={`${markers.length} censored moments`}>
        {markers.map((m) => (
          <button
            key={`${m.seq}-${m.action}`}
            title={`@${m.seq * 2}s ${m.action}: ${m.label}`}
            onClick={() => seek(m.seq)}
            className={`absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full ${
              m.action === 'bleep' ? 'bg-red-400' : 'bg-amber-300'
            }`}
            style={{ left: `${Math.min(100, ((m.seq * 2) / span) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        {progress !== null ? (
          <span className="text-sm text-neutral-400">
            Rendering censored broadcast {Math.round(progress * 100)}%… (real time)
          </span>
        ) : (
          <button
            onClick={() => void download()}
            className="rounded-md bg-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-white"
          >
            Download censored broadcast
          </button>
        )}
      </div>
      {renderError && <p className="mt-1 text-sm text-red-300">Censored render failed ({renderError}).</p>}
    </div>
  );
}
