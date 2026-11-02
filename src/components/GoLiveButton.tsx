'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Pre-flight go-live check: only navigates to broadcast when the API allows it. */
export function GoLiveButton({ showId }: { showId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'needs-acceptance' | 'error'>('idle');

  async function go(): Promise<void> {
    setState('busy');
    try {
      const res = await fetch('/api/studio/go-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string };
      if (res.ok && data.ok) {
        router.push(`/studio/go-live?show=${encodeURIComponent(showId)}`);
        return;
      }
      setState(data.code === 'rulebook-acceptance-required' ? 'needs-acceptance' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <div>
      <button
        onClick={() => void go()}
        disabled={state === 'busy'}
        className="rounded-md bg-red-500 px-6 py-3 font-semibold text-white hover:bg-red-400 disabled:opacity-50"
      >
        {state === 'busy' ? 'Checking…' : 'Go live now'}
      </button>
      {state === 'needs-acceptance' && (
        <p className="mt-2 text-sm text-amber-200">
          Accept the rulebook above first — the button unlocks after you scroll and tick the box.
        </p>
      )}
      {state === 'error' && (
        <p className="mt-2 text-sm text-red-300">Go-live refused. Try again or re-read the rulebook.</p>
      )}
    </div>
  );
}
