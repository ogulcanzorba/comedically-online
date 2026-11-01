'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicUser } from '@/db/users';

const inputCls = 'w-full rounded-md border border-neutral-700 bg-neutral-900 p-2.5 text-sm';
const labelCls = 'mb-1 block text-sm font-medium text-neutral-300';

export function ProfileForm({ user }: { user: PublicUser }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio ?? '');
  const [country, setCountry] = useState(user.country ?? '');
  const [stageName, setStageName] = useState(user.stageName ?? '');
  const [styles, setStyles] = useState(user.comedyStyles.join(', '));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          bio,
          country,
          ...(user.role === 'comedian'
            ? {
                stageName,
                comedyStyles: styles
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'save failed');
      setMessage('Saved.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(ev) => void submit(ev)} className="space-y-3">
      <div>
        <label htmlFor="pf-name" className={labelCls}>Display name</label>
        <input id="pf-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label htmlFor="pf-bio" className={labelCls}>Bio</label>
        <textarea id="pf-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className={inputCls} />
      </div>
      <div>
        <label htmlFor="pf-country" className={labelCls}>Country</label>
        <input id="pf-country" value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls} />
      </div>
      {user.role === 'comedian' && (
        <>
          <div>
            <label htmlFor="pf-stage" className={labelCls}>Stage name</label>
            <input id="pf-stage" value={stageName} onChange={(e) => setStageName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="pf-styles" className={labelCls}>Comedy styles (comma separated)</label>
            <input id="pf-styles" value={styles} onChange={(e) => setStyles(e.target.value)} className={inputCls} />
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
      {message && <p className="text-sm text-emerald-300">{message}</p>}
      <button type="submit" disabled={busy} className="rounded-md bg-amber-300 px-5 py-2 font-semibold text-neutral-950 hover:bg-amber-200 disabled:opacity-50">
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
