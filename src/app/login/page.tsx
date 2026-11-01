'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const inputCls = 'w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'login failed');
      const next = new URLSearchParams(window.location.search).get('next') || '/';
      router.push(next.startsWith('/') && !next.startsWith('//') ? next : '/');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login failed');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Welcome back</h1>
      <form onSubmit={(ev) => void submit(ev)} className="mt-6 space-y-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" className={inputCls} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" className={inputCls} />
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-amber-300 px-5 py-3 font-semibold text-neutral-950 hover:bg-amber-200 disabled:opacity-50">
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-sm text-neutral-400">
          New here?{' '}
          <Link href="/register" className="underline">
            Create an account
          </Link>
        </p>
      </form>
    </main>
  );
}
