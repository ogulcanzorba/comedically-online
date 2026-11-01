'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Role = 'viewer' | 'comedian';

const inputCls = 'w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm';

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('viewer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('');
  const [stageName, setStageName] = useState('');
  const [bio, setBio] = useState('');
  const [styles, setStyles] = useState('');
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          email,
          password,
          displayName,
          country,
          stageName,
          bio,
          comedyStyles: styles
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          ageConfirmed: adult,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'registration failed');
      router.push(role === 'comedian' ? '/studio' : '/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'registration failed');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Join the club</h1>
      <p className="mt-2 text-sm text-neutral-400">18+ only. One account for watching or performing.</p>

      <div className="mt-6 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Account role">
        {(['viewer', 'comedian'] as Role[]).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={role === r}
            onClick={() => setRole(r)}
            className={`rounded-md border p-4 text-left capitalize ${
              role === r ? 'border-amber-300 bg-amber-100/10' : 'border-neutral-700 hover:border-neutral-500'
            }`}
          >
            <span className="font-semibold">{r}</span>
            <span className="mt-1 block text-sm normal-case text-neutral-400">
              {r === 'viewer' ? 'Buy tickets, watch shows.' : 'Go live, sell tickets.'}
            </span>
          </button>
        ))}
      </div>

      <form onSubmit={(ev) => void submit(ev)} className="mt-6 space-y-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" className={inputCls} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ characters)" type="password" autoComplete="new-password" className={inputCls} />
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" autoComplete="nickname" className={inputCls} />
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country (optional)" autoComplete="country-name" className={inputCls} />
        {role === 'comedian' && (
          <>
            <input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="Stage name" className={inputCls} />
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio (max 500)" rows={3} className={inputCls} />
            <input value={styles} onChange={(e) => setStyles(e.target.value)} placeholder="Comedy styles, comma separated (e.g. satire, improv)" className={inputCls} />
          </>
        )}
        <label className="flex items-start gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-1" />
          I confirm I am 18 or older.
        </label>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-amber-300 px-5 py-3 font-semibold text-neutral-950 hover:bg-amber-200 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-sm text-neutral-400">
          Already have an account?{' '}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
