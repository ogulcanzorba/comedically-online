'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChunkDebug, Decision } from '@/moderation/types';
import rulebookData from '@/moderation/rulebook.json';
import { localRecording, useLocalRecording } from '@/lib/local-recording';
import { activeBlursAt, isBleepedAt, planForClip, type CensorPlan } from '@/lib/censor-plan';
import { renderCensoredClip } from '@/lib/censor-render';

export interface FeedEvent {
  seq: number;
  at: number;
  decisions: Decision[];
  debug?: ChunkDebug;
}

const TITLES = new Map(
  (rulebookData.rules as Array<{ id: string; title: string }>).map((r) => [r.id, r.title]),
);

function storageKey(showSlug: string): string {
  return `modlog:${showSlug}`;
}

function load(showSlug: string): FeedEvent[] {
  try {
    const raw = window.localStorage.getItem(storageKey(showSlug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FeedEvent[]) : [];
  } catch {
    return [];
  }
}

function save(showSlug: string, events: FeedEvent[]): void {
  try {
    window.localStorage.setItem(storageKey(showSlug), JSON.stringify(events.slice(-200)));
  } catch {
    // private mode: session-only log
  }
}

function sceneTime(seq: number): string {
  const s = seq * 2;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Passive viewer connection that collects moderation decisions as they air.
 * Powers both the live log and the post-broadcast recap; persisted locally.
 */
function useModerationFeed(showSlug: string): { events: FeedEvent[]; clear: () => void } {
  const [events, setEvents] = useState<FeedEvent[]>(() => load(showSlug));
  const genRef = useRef(localRecording.generation);
  const storeVersion = useLocalRecording();
  // New broadcast started: wipe the previous broadcast's log, debug rows, and clips.
  useEffect(() => {
    if (localRecording.generation !== genRef.current) {
      genRef.current = localRecording.generation;
      setEvents([]);
      save(showSlug, []);
    }
  }, [storeVersion, showSlug]);
  const clear = (): void => {
    setEvents([]);
    save(showSlug, []);
  };

  useEffect(() => {
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=viewer`,
    );
    ws.binaryType = 'arraybuffer';
    let pending: { seq: number; decisions: Decision[]; debug?: ChunkDebug } | null = null;
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        try {
          pending = JSON.parse(ev.data) as { seq: number; decisions: Decision[]; debug?: ChunkDebug };
        } catch {
          pending = null;
        }
        return;
      }
      if (pending && Array.isArray(pending.decisions) && pending.decisions.length > 0) {
        const evt: FeedEvent = {
          seq: pending.seq,
          at: Date.now(),
          decisions: pending.decisions,
          ...(pending.debug ? { debug: pending.debug } : {}),
        };
        setEvents((prev) => {
          if (prev.some((e) => e.seq === evt.seq)) return prev;
          const next = [...prev, evt].slice(-200);
          save(showSlug, next);
          return next;
        });
      }
      pending = null;
    };
    return () => ws.close();
  }, [showSlug]);

  return { events, clear };
}

function ruleLabel(ruleId: string | undefined): string {
  if (!ruleId) return '—';
  return TITLES.get(ruleId) ?? ruleId;
}

/** Collapsible per-chunk debug: transcript, language, rule, stage timings, raw errors. */
function DebugCell({ debug }: { debug: ChunkDebug | undefined }) {
  if (!debug) return <span className="text-neutral-600">—</span>;
  const errors = Object.entries(debug.errors);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">Debug</summary>
      <dl className="mt-1 space-y-1 font-mono text-[11px] text-neutral-400">
        <div>
          <dt className="inline text-neutral-500">transcript: </dt>
          <dd className="inline break-words">{JSON.stringify(debug.transcript) || '(empty)'}</dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">language: </dt>
          <dd className="inline">{debug.language}</dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">rule: </dt>
          <dd className="inline">{debug.matchedRule ?? 'none'}</dd>
        </div>
        <div>
          <dt className="inline text-neutral-500">timings: </dt>
          <dd className="inline">
            queue {debug.timingsMs.queueMs}ms · voice {debug.timingsMs.voiceMs}ms · sam{' '}
            {debug.timingsMs.samMs}ms · judge{' '}
            {debug.judgeSkipped ? 'skipped (no rule candidate)' : `${debug.timingsMs.judgeMs}ms`}
          </dd>
        </div>
        {errors.length > 0 && (
          <div>
            <dt className="inline text-neutral-500">errors: </dt>
            <dd className="inline break-words text-red-300">
              {errors.map(([stage, msg]) => `${stage}: ${msg}`).join(' | ')}
            </dd>
          </div>
        )}
      </dl>
    </details>
  );
}

/** Clip player with viewer-identical censorship: blur overlays + bleep mute. */
function CensoredClipPlayer({ url, plan }: { url: string; plan: CensorPlan }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const muted = isBleepedAt(plan, now);
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);
  const blurs = activeBlursAt(plan, now);
  const sync = (el: HTMLVideoElement): void => setNow(el.currentTime);
  return (
    <div className="relative w-64 max-w-full">
      <video
        ref={videoRef}
        src={url}
        controls
        preload="metadata"
        className="block w-full rounded-md bg-black"
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
  );
}

/** Per-event violation clip from the device-local recording, with play + download. */
function ClipCell({
  event,
  playing,
  onToggle,
}: {
  event: FeedEvent;
  playing: boolean;
  onToggle: () => void;
}) {
  const clip = localRecording.clipFor(event.seq);
  const [mode, setMode] = useState<'censored' | 'original'>('censored');
  const [progress, setProgress] = useState<number | null>(null);
  const [renderError, setRenderError] = useState('');
  if (!clip) return <span className="text-neutral-600">—</span>;
  const plan = planForClip(event.decisions, clip.startS, event.seq, clip.endS);
  const downloadCensored = async (): Promise<void> => {
    setRenderError('');
    setProgress(0);
    try {
      const blob = await renderCensoredClip(clip.url, plan, setProgress);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comedically-clip-seq${event.seq}-censored.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : 'render failed');
    } finally {
      setProgress(null);
    }
  };
  return (
    <div>
      <div className="flex gap-1 text-xs" role="group" aria-label="Clip version">
        {(['censored', 'original'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded px-2 py-0.5 ${
              mode === m ? 'bg-neutral-200 text-neutral-950' : 'text-neutral-400 underline'
            }`}
          >
            {m === 'censored' ? 'Show censored' : 'Show original'}
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-2 text-xs">
        <button onClick={onToggle} className="text-neutral-300 underline hover:text-white">
          {playing ? 'Close' : 'Play'}
        </button>
        {mode === 'original' ? (
          <a
            href={clip.url}
            download={`comedically-clip-seq${event.seq}.webm`}
            className="text-neutral-300 underline hover:text-white"
          >
            Download
          </a>
        ) : progress !== null ? (
          <span className="text-neutral-400">Rendering {Math.round(progress * 100)}%…</span>
        ) : (
          <button onClick={() => void downloadCensored()} className="text-neutral-300 underline hover:text-white">
            Download
          </button>
        )}
      </div>
      {renderError && (
        <p className="mt-1 text-xs text-red-300">
          Censored render failed ({renderError}) —{' '}
          <a href={clip.url} download={`comedically-clip-seq${event.seq}.webm`} className="underline">
            download original
          </a>
        </p>
      )}
      {playing && (
        <div className="mt-2">
          {mode === 'original' ? (
            <video src={clip.url} controls preload="metadata" className="block w-64 max-w-full rounded-md bg-black" />
          ) : (
            <CensoredClipPlayer url={clip.url} plan={plan} />
          )}
        </div>
      )}
    </div>
  );
}

/** Live log table + post-broadcast recap, fed by one passive relay connection. */
export function ModerationPanels({ showSlug }: { showSlug: string }) {
  const { events, clear } = useModerationFeed(showSlug);
  useLocalRecording(); // refresh clip cells as recording blobs land
  const [playing, setPlaying] = useState<number | null>(null);
  const showClips = localRecording.hasRecording;
  const live = [...events].reverse().slice(0, 20);
  const censored = events.filter((e) => e.decisions.some((d) => d.action === 'bleep' || d.action === 'blur'));
  const toggle = (seq: number): void => setPlaying((prev) => (prev === seq ? null : seq));

  return (
    <>
      <section aria-label="Live moderation log" className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-2xl">Moderation log</h2>
          {events.length > 0 && (
            <button
              onClick={() => {
                clear();
                setPlaying(null);
              }}
              className="text-xs text-neutral-400 underline hover:text-white"
            >
              Clear log
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Flagged chunks as they air (20s behind you). Empty until the broadcast hits a rule.
        </p>
        {live.length === 0 ? (
          <p className="mt-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-400">
            No flagged moments yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Scene</th>
                  <th className="px-3 py-2 font-medium">Rule</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Why</th>
                  <th className="px-3 py-2 font-medium">Debug</th>
                  {showClips && <th className="px-3 py-2 font-medium">Clip</th>}
                </tr>
              </thead>
              <tbody>
                {live.map((e) =>
                  e.decisions.map((d, i) => (
                    <tr key={`${e.seq}-${i}`} className="border-b border-neutral-800/60 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                        {new Date(e.at).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">~{sceneTime(e.seq)}</td>
                      <td className="px-3 py-2">{ruleLabel(d.ruleId)}</td>
                      <td className="px-3 py-2 font-semibold text-amber-200">{d.action}</td>
                      <td className="px-3 py-2 text-xs text-neutral-400">{d.explanation ?? d.reason}</td>
                      {i === 0 && (
                        <td rowSpan={e.decisions.length} className="px-3 py-2 align-top">
                          <DebugCell debug={e.debug} />
                        </td>
                      )}
                      {showClips && i === 0 && (
                        <td rowSpan={e.decisions.length} className="px-3 py-2 align-top">
                          <ClipCell event={e} playing={playing === e.seq} onToggle={() => toggle(e.seq)} />
                        </td>
                      )}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="recap" aria-label="Broadcast recap" className="mt-8 scroll-mt-20">
        <h2 className="font-serif text-2xl">Recap: censored moments</h2>
        {censored.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">
            After the broadcast, every bleep and blur lands here with its scene timestamp and reason.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {censored.map((e) => (
              <li key={e.seq} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3 text-sm">
                {e.decisions
                  .filter((d) => d.action === 'bleep' || d.action === 'blur')
                  .map((d, i) => (
                    <p key={i}>
                      <span className="font-mono text-xs text-neutral-500">@{sceneTime(e.seq)}</span>{' '}
                      <span className="font-semibold text-amber-200">{d.action}</span>{' '}
                      <span className="text-neutral-400">
                        — {ruleLabel(d.ruleId)}: {d.explanation ?? d.reason}
                      </span>
                    </p>
                  ))}
                {showClips && (
                  <div className="mt-2">
                    <ClipCell event={e} playing={playing === e.seq} onToggle={() => toggle(e.seq)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
