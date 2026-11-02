'use client';

import { useEffect, useState } from 'react';
import type { Decision } from '@/moderation/types';
import rulebookData from '@/moderation/rulebook.json';

export interface FeedEvent {
  seq: number;
  at: number;
  decisions: Decision[];
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
    let pending: { seq: number; decisions: Decision[] } | null = null;
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        try {
          pending = JSON.parse(ev.data) as { seq: number; decisions: Decision[] };
        } catch {
          pending = null;
        }
        return;
      }
      if (pending && Array.isArray(pending.decisions) && pending.decisions.length > 0) {
        const evt: FeedEvent = { seq: pending.seq, at: Date.now(), decisions: pending.decisions };
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

/** Live log table + post-broadcast recap, fed by one passive relay connection. */
export function ModerationPanels({ showSlug }: { showSlug: string }) {
  const events = useModerationFeed(showSlug);
  const live = [...events].reverse().slice(0, 20);
  const censored = events.filter((e) => e.decisions.some((d) => d.action === 'bleep' || d.action === 'blur'));

  return (
    <>
      <section aria-label="Live moderation log" className="mt-8">
        <h2 className="font-serif text-2xl">Moderation log</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Flagged chunks as they air (10s behind you). Empty until the broadcast hits a rule.
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
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Broadcast recap" className="mt-8">
        <h2 className="font-serif text-2xl">Recap: censored moments</h2>
        {censored.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">
            After the broadcast, every bleep and blur lands here with its scene timestamp and reason.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {censored.map((e) =>
              e.decisions
                .filter((d) => d.action === 'bleep' || d.action === 'blur')
                .map((d, i) => (
                  <li key={`${e.seq}-${i}`} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-3 text-sm">
                    <span className="font-mono text-xs text-neutral-500">@{sceneTime(e.seq)}</span>{' '}
                    <span className="font-semibold text-amber-200">{d.action}</span>{' '}
                    <span className="text-neutral-400">
                      — {ruleLabel(d.ruleId)}: {d.explanation ?? d.reason}
                    </span>
                  </li>
                )),
            )}
          </ul>
        )}
      </section>
    </>
  );
}
