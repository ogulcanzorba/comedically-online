'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Plan = 'ticket' | 'sub';

const PLANS: Array<{ id: Plan; name: string; price: string; blurb: string }> = [
  { id: 'ticket', name: 'Ticket', price: '$5', blurb: 'One night, one stage.' },
  { id: 'sub', name: 'Subscription', price: '$12/mo', blurb: 'Every show, all month.' },
];

export default function CheckoutPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan>('ticket');
  const [name, setName] = useState('');
  const [card, setCard] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setError('');
    if (!name.trim() || !card.trim() || !expiry.trim() || !cvc.trim()) {
      setError('Fill every field. Any fake values work; nothing is charged or stored.');
      return;
    }
    setBusy(true);
    try {
      // Only the plan leaves the browser. Card fields are never sent anywhere.
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error('checkout failed');
      router.push('/watch');
    } catch {
      setError('Mock checkout hiccup. Try again.');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Get in</h1>
      <p className="mt-3 inline-block rounded-md border border-amber-200/40 bg-amber-100/10 px-3 py-1 text-sm font-semibold text-amber-100">
        MOCK PAYMENT, no money is charged
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {PLANS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPlan(p.id)}
            className={`rounded-md border p-4 text-left ${
              plan === p.id ? 'border-amber-300 bg-amber-100/10' : 'border-neutral-700 hover:border-neutral-500'
            }`}
          >
            <span className="font-semibold">{p.name}</span>
            <span className="ml-2 text-amber-200">{p.price}</span>
            <span className="mt-1 block text-sm text-neutral-400">{p.blurb}</span>
          </button>
        ))}
      </div>

      <form onSubmit={(ev) => void submit(ev)} className="mt-6 space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name on card (fake)"
          autoComplete="off"
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm"
        />
        <input
          value={card}
          onChange={(e) => setCard(e.target.value.replace(/[^\d ]/g, '').slice(0, 19))}
          placeholder="Card number (fake, e.g. 4242 4242 4242 4242)"
          inputMode="numeric"
          autoComplete="off"
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            value={expiry}
            onChange={(e) => setExpiry(e.target.value.slice(0, 5))}
            placeholder="MM/YY"
            autoComplete="off"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm"
          />
          <input
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="CVC"
            inputMode="numeric"
            autoComplete="off"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-amber-300 px-5 py-3 font-semibold text-neutral-950 hover:bg-amber-200 disabled:opacity-50"
        >
          {busy ? 'Confirming…' : `Pay ${plan === 'sub' ? '$12/mo' : '$5'} (mock)`}
        </button>
        <p className="text-xs text-neutral-500">
          No payment provider. Card fields stay in your browser; only the plan choice is sent, and
          only to set an unlock cookie for /watch.
        </p>
      </form>
    </main>
  );
}
