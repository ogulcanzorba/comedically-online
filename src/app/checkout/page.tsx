'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatCents } from '@/lib/datetime';

interface TierInfo {
  id: string;
  name: string;
  price_cents: number;
  min_cents?: number;
  cap?: number;
}

interface ShowInfo {
  id: string;
  slug: string;
  title: string;
  tiers: TierInfo[];
  comedian: string;
  sold: Record<string, number>;
}

const inputCls = 'w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm';

function CheckoutInner() {
  const router = useRouter();
  const params = useSearchParams();
  const showSlug = params.get('show') ?? '';
  const preselect = params.get('tier') ?? '';
  const [show, setShow] = useState<ShowInfo | null>(null);
  const [tierId, setTierId] = useState(preselect);
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [card, setCard] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [orderRef, setOrderRef] = useState('');

  useEffect(() => {
    if (!showSlug) return;
    void fetch(`/api/shows/by-slug/${encodeURIComponent(showSlug)}`)
      .then(async (r) => (await r.json()) as { ok: boolean; show?: ShowInfo })
      .then((d) => {
        if (!d.ok || !d.show) throw new Error('show not found');
        setShow(d.show);
        setTierId((prev) => prev || d.show?.tiers[0]?.id || '');
      })
      .catch(() => setError('Show not found.'));
  }, [showSlug]);

  const tier = show?.tiers.find((t) => t.id === tierId);
  const soldOut = tier?.cap !== undefined && (show?.sold[tier.id] ?? 0) >= tier.cap;
  const needsCard = tier !== undefined && tier.price_cents > 0;
  const pwywMin = tier?.min_cents;

  async function submit(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    if (!show || !tier) return;
    setError('');
    if (needsCard && (!name.trim() || !card.trim() || !expiry.trim() || !cvc.trim())) {
      setError('Fill every card field. Any fake values work; nothing is charged or stored.');
      return;
    }
    let amountCents: number | undefined;
    if (pwywMin !== undefined) {
      amountCents = Math.round(Number(amount) * 100);
      if (!Number.isInteger(amountCents) || amountCents < pwywMin) {
        setError(`Enter at least ${formatCents(pwywMin)}.`);
        return;
      }
    }
    setBusy(true);
    try {
      // Only show/tier/amount leave the browser. Card fields are never sent anywhere.
      const res = await fetch('/api/tickets/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId: show.id, tierId: tier.id, amountCents }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; orderRef?: string; slug?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'purchase failed');
      setOrderRef(data.orderRef ?? '');
      router.push(`/shows/${data.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'purchase failed');
      setBusy(false);
    }
  }

  if (!showSlug) {
    return (
      <p className="text-neutral-400">
        Pick a show first.{' '}
        <Link href="/" className="underline">
          Browse shows
        </Link>
        .
      </p>
    );
  }

  return (
    <div>
      <p className="inline-block rounded-md border border-amber-200/40 bg-amber-100/10 px-3 py-1 text-sm font-semibold text-amber-100">
        MOCK PAYMENT, no money is charged
      </p>
      {!show && !error && <p className="mt-4 text-neutral-400">Loading show…</p>}
      {show && (
        <>
          <h2 className="mt-4 font-serif text-2xl">{show.title}</h2>
          <p className="text-sm text-neutral-400">by {show.comedian}</p>
          <form onSubmit={(ev) => void submit(ev)} className="mt-6 space-y-4">
            <div>
              <label htmlFor="co-tier" className="mb-1 block text-sm font-medium text-neutral-300">Tier</label>
              <select id="co-tier" value={tierId} onChange={(e) => setTierId(e.target.value)} className={inputCls}>
                {show.tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.min_cents !== undefined ? `min ${formatCents(t.min_cents)}` : formatCents(t.price_cents)}
                  </option>
                ))}
              </select>
            </div>
            {pwywMin !== undefined && (
              <div>
                <label htmlFor="co-amount" className="mb-1 block text-sm font-medium text-neutral-300">
                  Your price ($, min {formatCents(pwywMin)})
                </label>
                <input id="co-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="12" className={inputCls} />
              </div>
            )}
            {soldOut && <p className="text-sm text-red-300">This tier is sold out. Pick another.</p>}
            {needsCard && !soldOut && (
              <div className="space-y-3">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name on card (fake)" autoComplete="off" className={inputCls} />
                <input value={card} onChange={(e) => setCard(e.target.value.replace(/[^\d ]/g, '').slice(0, 19))} placeholder="Card number (fake)" inputMode="numeric" autoComplete="off" className={inputCls} />
                <div className="grid grid-cols-2 gap-3">
                  <input value={expiry} onChange={(e) => setExpiry(e.target.value.slice(0, 5))} placeholder="MM/YY" autoComplete="off" className={inputCls} />
                  <input value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="CVC" inputMode="numeric" autoComplete="off" className={inputCls} />
                </div>
              </div>
            )}
            {error && <p className="text-sm text-red-300">{error}</p>}
            <button type="submit" disabled={busy || soldOut || !tier} className="w-full rounded-md bg-amber-300 px-5 py-3 font-semibold text-neutral-950 hover:bg-amber-200 disabled:opacity-50">
              {busy ? 'Confirming…' : tier && tier.price_cents === 0 ? 'Claim free pass (mock)' : `Pay ${tier ? formatCents(tier.price_cents) : ''} (mock)`}
            </button>
            {orderRef && <p className="text-xs text-neutral-500">Order ref: {orderRef}</p>}
            <p className="text-xs text-neutral-500">
              No payment provider. Card fields stay in your browser; only the tier choice is sent, and
              only a fake order record is stored.
            </p>
          </form>
        </>
      )}
      {error && !show && <p className="mt-4 text-sm text-red-300">{error}</p>}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Get your ticket</h1>
      <div className="mt-4">
        <Suspense fallback={<p className="text-neutral-400">Loading…</p>}>
          <CheckoutInner />
        </Suspense>
      </div>
    </main>
  );
}
