'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChunkDebug, Decision } from '@/moderation/types';
import rulebookData from '@/moderation/rulebook.json';
import { localRecording, useLocalRecording } from '@/lib/local-recording';
import { formatSceneRange, planForBroadcast, sceneRangeS } from '@/lib/censor-plan';
import { CensoredBroadcastPlayer, type BroadcastMarker } from './CensoredBroadcastPlayer';

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
  // New broadcast started: wipe the previous broadcast's log and debug rows.
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
          const msg = JSON.parse(ev.data) as {
            type?: string;
            seq: number;
            decisions: Decision[];
            debug?: ChunkDebug;
          };
          // Chunk metas only; end-of-stream and future control frames are ignored.
          pending =
            msg.type === 'chunk' && typeof msg.seq === 'number' && Array.isArray(msg.decisions)
              ? msg
              : null;
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
          const known = (d: Decision) => `${d.action}|${d.ruleId ?? ''}|${d.startMs}|${d.endMs}`;
          if (!prev.some((e) => e.seq === evt.seq)) {
            const next = [...prev, evt].slice(-200);
            save(showSlug, next);
            return next;
          }
          // Same chunk re-reported (e.g. a safety-margin pad landed after its
          // own decisions): merge new decisions instead of dropping them.
          const next = prev.map((e) => {
            if (e.seq !== evt.seq) return e;
            const seen = new Set(e.decisions.map(known));
            const merged = [...e.decisions];
            for (const d of evt.decisions) {
              if (!seen.has(known(d))) {
                seen.add(known(d));
                merged.push(d);
              }
            }
            return { ...e, decisions: merged };
          });
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

/** Collapsible per-chunk debug: transcript, language, rule, stage timings, SAM breakdown, errors. */
function DebugCell({ debug }: { debug: ChunkDebug | undefined }) {
  if (!debug) return <span className="text-neutral-600">—</span>;
  const errors = Object.entries(debug.errors);
  const sam = debug.samBreakdown;
  const gate = debug.gateBreakdown;
  const vision = debug.visionBreakdown;
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
            {debug.timingsMs.halvesMs !== undefined
              ? ` · halves ${debug.timingsMs.halvesMs}ms`
              : ''}
          </dd>
        </div>
        {sam && (
          <div>
            <dt className="inline text-neutral-500">sam: </dt>
            <dd className="inline">
              {sam.source} extract {sam.extractMs}ms
              {sam.concepts.map((c) => (
                <span key={c.ruleId}>
                  {' '}· {c.ruleId}: {c.boxes} boxes
                  {c.confidence !== null ? ` (conf ${c.confidence.toFixed(2)})` : ''} ttfb{' '}
                  {c.ttfbMs}ms/{c.ms}ms x{c.attempts}
                  {c.failedFrames > 0 ? ` failed=${c.failedFrames}` : ''}
                </span>
              ))}
            </dd>
          </div>
        )}
        {gate && (
          <div>
            <dt className="inline text-neutral-500">gate: </dt>
            <dd className="inline">
              {gate.source} extract {gate.extractMs}ms · {gate.ms}ms
              {gate.frames.map((f) => (
                <span key={f.frame}>
                  {' '}· f{f.frame}@{f.frameMs}ms: {f.verdict}
                </span>
              ))}
              {gate.failedFrames > 0 ? ` failed=${gate.failedFrames}` : ''}
            </dd>
          </div>
        )}
        {vision && (
          <div>
            <dt className="inline text-neutral-500">vision: </dt>
            <dd className="inline">
              {vision.model} {vision.effort}
              {vision.secondCall ? '->low' : ''} · {vision.frames}f(prev{vision.prevFrames}) ·{' '}
              {vision.ms}ms · in{vision.inputTokens}/out{vision.outputTokens} ·{' '}
              {vision.results.map((r) => (
                <span key={r.id}>
                  {' '}· {r.id}: {r.confidence.toFixed(2)}
                  {r.present ? '' : ' (absent)'}
                </span>
              ))}{' '}
              ⇒ {vision.decision}
            </dd>
          </div>
        )}
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

/** Live log table + post-broadcast recap, fed by one passive relay connection. */
export function ModerationPanels({ showSlug }: { showSlug: string }) {
  const { events, clear } = useModerationFeed(showSlug);
  useLocalRecording(); // refresh as recording blobs land
  const live = [...events].reverse().slice(0, 20);
  const censored = events.filter((e) => e.decisions.some((d) => d.action === 'bleep' || d.action === 'blur'));
  const ended = localRecording.status === 'ended';
  const full = ended ? localRecording.full() : null;
  const plan = full ? planForBroadcast(events, full.seconds) : null;
  const markers: BroadcastMarker[] = censored.flatMap((e) =>
    e.decisions
      .filter((d) => d.action === 'bleep' || d.action === 'blur')
      .map((d) => ({
        seq: e.seq,
        atS: sceneRangeS(e.seq, d.startMs, d.endMs).startS,
        action: d.action as 'bleep' | 'blur',
        label: `${ruleLabel(d.ruleId)}: ${d.explanation ?? d.reason}`,
      })),
  );

  return (
    <>
      <section aria-label="Live moderation log" className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-2xl">Moderation log</h2>
          {events.length > 0 && (
            <button
              onClick={() => clear()}
              className="text-xs text-neutral-400 underline hover:text-white"
            >
              Clear log
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Flagged chunks as they air (12s behind you). Empty until the broadcast hits a rule.
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
        {full && plan ? (
          <div className="mt-3">
            <p className="mb-2 text-sm text-neutral-400">
              The full broadcast as viewers saw it — blur boxes and bleeps applied. Click a marker
              to jump to that moment.
            </p>
            <CensoredBroadcastPlayer
              url={full.url}
              plan={plan}
              markers={markers}
              fileName={`comedically-broadcast-censored.webm`}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-400">
            After the broadcast ends, the full censored recording lands here with its scene
            timestamps and reasons.
          </p>
        )}
        {censored.length > 0 && (
          <ul className="mt-4 space-y-2">
            {censored.map((e) => (
              <li key={e.seq} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3 text-sm">
                {e.decisions
                  .filter((d) => d.action === 'bleep' || d.action === 'blur')
                  .map((d, i) => (
                    <p key={i}>
                      <span className="font-mono text-xs text-neutral-500">
                        @{formatSceneRange(e.seq, d.startMs, d.endMs)}
                      </span>{' '}
                      <span className="font-semibold text-amber-200">{d.action}</span>{' '}
                      <span className="text-neutral-400">
                        — {ruleLabel(d.ruleId)}: {d.explanation ?? d.reason}
                      </span>
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
