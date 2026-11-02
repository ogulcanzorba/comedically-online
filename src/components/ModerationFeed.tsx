'use client';

import { useEffect, useState } from 'react';
import type { ChunkDebug, Decision } from '@/moderation/types';
import rulebookData from '@/moderation/rulebook.json';
import { localRecording, useLocalRecording } from '@/lib/local-recording';

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
function useModerationFeed(showSlug: string): FeedEvent[] {
  const [events, setEvents] = useState<FeedEvent[]>(() => load(showSlug));

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

  return events;
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
            voice {debug.timingsMs.voiceMs}ms · sam {debug.timingsMs.samMs}ms · judge{' '}
            {debug.timingsMs.judgeMs}ms
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

/** Per-event violation clip from the device-local recording, with play + download. */
function ClipCell({ seq, playing, onToggle }: { seq: number; playing: boolean; onToggle: () => void }) {
  const clip = localRecording.clipFor(seq);
  if (!clip) return <span className="text-neutral-600">—</span>;
  return (
    <div>
      <div className="flex gap-2 text-xs">
        <button onClick={onToggle} className="text-neutral-300 underline hover:text-white">
          {playing ? 'Close' : 'Play'}
        </button>
        <a
          href={clip.url}
          download={`comedically-clip-seq${seq}.webm`}
          className="text-neutral-300 underline hover:text-white"
        >
          Download
        </a>
      </div>
      {playing && (
        <video src={clip.url} controls preload="metadata" className="mt-2 w-64 max-w-full rounded-md bg-black" />
      )}
    </div>
  );
}

/** Live log table + post-broadcast recap, fed by one passive relay connection. */
export function ModerationPanels({ showSlug }: { showSlug: string }) {
  const events = useModerationFeed(showSlug);
  useLocalRecording(); // refresh clip cells as recording blobs land
  const [playing, setPlaying] = useState<number | null>(null);
  const showClips = localRecording.hasRecording;
  const live = [...events].reverse().slice(0, 20);
  const censored = events.filter((e) => e.decisions.some((d) => d.action === 'bleep' || d.action === 'blur'));
  const toggle = (seq: number): void => setPlaying((prev) => (prev === seq ? null : seq));

  return (
    <>
      <section aria-label="Live moderation log" className="mt-8">
        <h2 className="font-serif text-2xl">Moderation log</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Flagged chunks as they air (15s behind you). Empty until the broadcast hits a rule.
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
                          <ClipCell seq={e.seq} playing={playing === e.seq} onToggle={() => toggle(e.seq)} />
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
                    <ClipCell seq={e.seq} playing={playing === e.seq} onToggle={() => toggle(e.seq)} />
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
