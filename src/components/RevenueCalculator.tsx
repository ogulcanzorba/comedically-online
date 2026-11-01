'use client';

import { useState } from 'react';
import { revenueFor, suggestedRange } from '@/lib/pricing';
import { formatCents } from '@/lib/datetime';

const inputCls = 'w-full rounded-md border border-neutral-700 bg-neutral-900 p-2 text-sm';

/** Standalone pricing helper: estimates payouts and suggests a price range. */
export function RevenueCalculator() {
  const [avgPrice, setAvgPrice] = useState('10');
  const [fee, setFee] = useState('10');
  const [duration, setDuration] = useState('60');
  const [weekend, setWeekend] = useState(true);

  const avg = Math.round(Number(avgPrice) * 100) || 0;
  const feePct = Number(fee) || 0;
  const range = suggestedRange(Number(duration) || 60, weekend);

  return (
    <section id="revenue-calculator" aria-label="Revenue calculator" className="scroll-mt-20 rounded-md border border-neutral-800 bg-neutral-900/60 p-5">
      <h2 className="font-serif text-xl">Pricing helper</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="text-sm">
          Avg ticket ($)
          <input value={avgPrice} onChange={(e) => setAvgPrice(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1`} />
        </label>
        <label className="text-sm">
          Platform fee (%)
          <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1`} />
        </label>
        <label className="text-sm">
          Duration (min)
          <input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" className={`${inputCls} mt-1`} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={weekend} onChange={(e) => setWeekend(e.target.checked)} />
          Weekend show
        </label>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-400">
            <th className="py-1 font-medium">Tickets</th>
            <th className="font-medium">Gross</th>
            <th className="font-medium">Fee</th>
            <th className="font-medium">Your payout</th>
          </tr>
        </thead>
        <tbody>
          {[25, 50, 100, 250].map((n) => {
            const r = revenueFor(n, avg, feePct);
            return (
              <tr key={n} className="border-t border-neutral-800">
                <td className="py-1.5">{n}</td>
                <td>{formatCents(r.grossCents)}</td>
                <td className="text-neutral-400">{formatCents(r.feeCents)}</td>
                <td className="font-semibold text-emerald-300">{formatCents(r.payoutCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 text-sm">
        Suggested Standard range:{' '}
        <strong className="text-amber-200">
          {formatCents(range.low)} – {formatCents(range.high)}
        </strong>
      </p>
      <details className="mt-2 text-xs text-neutral-400">
        <summary className="cursor-pointer underline">Assumptions behind these numbers</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Base range by duration (venue-size analogs): ≤30 min ≈ bar set ($5–$8); ≤60 min ≈ club hour ($9–$15); ≤90 min ≈ long show ($12–$20); longer ≈ marathon ($15–$25).</li>
          <li>Weekend shows (Fri–Sun) get +20%, rounded to whole dollars.</li>
          <li>Rule of thumb: VIP ≈ 2× Standard, Early Bird ≈ 30% off Standard.</li>
          <li>Payout = gross minus the platform fee only. No payment-processor cut is modeled — checkout is mock, so treat this as directional, not a quote.</li>
        </ul>
      </details>
    </section>
  );
}
