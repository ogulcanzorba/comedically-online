'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RuleCard, type RuleCardRule } from './RuleCard';

export interface AcceptanceState {
  hash: string;
  at: string;
}

/**
 * Rulebook acceptance: the button unlocks only after scrolling the full
 * rulebook AND ticking the checkbox. Re-acceptance is required when the
 * revision hash changes.
 */
export function RulebookAccept({
  rules,
  version,
  versionHash,
  accepted,
}: {
  rules: RuleCardRule[];
  version: string;
  versionHash: string;
  accepted: AcceptanceState | null;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const current = accepted?.hash === versionHash;

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) setScrolled(true);
  }

  async function accept(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/studio/accept-rulebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: versionHash }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'acceptance failed');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'acceptance failed');
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif text-xl">Rulebook acceptance</h2>
        <span className="text-xs text-neutral-500">
          v{version} · <span className="font-mono">{versionHash}</span>
        </span>
        {current && (
          <span className="ml-auto rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
            Accepted ✓
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Rulebook (scroll to read everything)"
        className="mt-3 max-h-96 space-y-4 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950/60 p-4"
      >
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} />
        ))}
      </div>
      {!scrolled && !current && (
        <p className="mt-2 text-xs text-neutral-500">Scroll to the bottom to unlock acceptance.</p>
      )}

      {current ? (
        <p className="mt-3 text-sm text-neutral-300">
          Accepted{accepted ? ` on ${new Date(accepted.at).toLocaleString()}` : ''}. If the rulebook
          changes you will be asked to accept the new revision before your next broadcast.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="flex items-start gap-2 text-sm text-neutral-200">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-1"
            />
            I have read and accept the rulebook above (revision{' '}
            <span className="font-mono">{versionHash}</span>).
          </label>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button
            onClick={() => void accept()}
            disabled={!scrolled || !checked || busy}
            className="rounded-md bg-spotlight px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-40"
          >
            {busy ? 'Recording…' : 'I have read and accept'}
          </button>
        </div>
      )}
    </div>
  );
}
