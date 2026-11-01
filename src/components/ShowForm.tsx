'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Tier } from '@/db/shows';
import { CATEGORIES } from '@/data/categories';
import { THEMES } from '@/data/themes';
import { COMMON_TIMEZONES } from '@/lib/timezone';

export interface ShowFormInitial {
  title: string;
  description: string;
  date: string;
  time: string;
  timezone: string;
  durationMin: number;
  categorySlug: string;
  tiers: Tier[];
  thumbnailTheme: string;
}

interface TierDraft {
  id: string;
  name: string;
  price: string;
  min: string;
  cap: string;
}

const inputCls = 'w-full rounded-md border border-neutral-700 bg-neutral-900 p-2.5 text-sm';
const labelCls = 'mb-1 block text-sm font-medium text-neutral-300';

function toDrafts(tiers: Tier[]): TierDraft[] {
  return tiers.map((t) => ({
    id: t.id,
    name: t.name,
    price: (t.price_cents / 100).toString(),
    min: t.min_cents === undefined ? '' : (t.min_cents / 100).toString(),
    cap: t.cap === undefined ? '' : String(t.cap),
  }));
}

export function ShowForm({ initial, showId }: { initial?: ShowFormInitial; showId?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'UTC');
  const [durationMin, setDurationMin] = useState(String(initial?.durationMin ?? 60));
  const [categorySlug, setCategorySlug] = useState(initial?.categorySlug ?? 'stand-up');
  const [thumbnailTheme, setThumbnailTheme] = useState(initial?.thumbnailTheme ?? 'ember');
  const [tiers, setTiers] = useState<TierDraft[]>(
    initial ? toDrafts(initial.tiers) : [{ id: 'standard', name: 'Standard', price: '10', min: '', cap: '' }],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function setTier(i: number, patch: Partial<TierDraft>): void {
    setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  async function submit(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        title,
        description,
        date,
        time,
        timezone,
        durationMin: Number(durationMin),
        categorySlug,
        thumbnailTheme,
        tiers: tiers.map((t) => ({
          id: t.id.trim().toLowerCase(),
          name: t.name.trim(),
          price_cents: Math.round(Number(t.price) * 100),
          ...(t.min.trim() !== '' ? { min_cents: Math.round(Number(t.min) * 100) } : {}),
          ...(t.cap.trim() !== '' ? { cap: Number(t.cap) } : {}),
        })),
      };
      const url = showId ? `/api/shows/${showId}` : '/api/shows';
      const res = await fetch(url, {
        method: showId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; show?: { slug: string } };
      if (!res.ok || !data.ok || !data.show) throw new Error(data.error ?? 'save failed');
      router.push(`/shows/${data.show.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(ev) => void submit(ev)} className="space-y-4">
      <div>
        <label htmlFor="sf-title" className={labelCls}>Title</label>
        <input id="sf-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label htmlFor="sf-desc" className={labelCls}>Description</label>
        <textarea id="sf-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputCls} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="sf-date" className={labelCls}>Date</label>
          <input id="sf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="sf-time" className={labelCls}>Start time</label>
          <input id="sf-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="sf-tz" className={labelCls}>Your time zone</label>
          <select id="sf-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="sf-dur" className={labelCls}>Duration (minutes)</label>
          <input id="sf-dur" type="number" min={15} max={480} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="sf-cat" className={labelCls}>Category</label>
          <select id="sf-cat" value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={inputCls}>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sf-theme" className={labelCls}>Thumbnail theme</label>
          <select id="sf-theme" value={thumbnailTheme} onChange={(e) => setThumbnailTheme(e.target.value)} className={inputCls}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-neutral-300">Ticket tiers</legend>
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => setTiers([{ id: 'standard', name: 'Standard', price: '10', min: '', cap: '' }])} className="rounded border border-neutral-600 px-2 py-1 hover:border-neutral-400">
            Template: single tier
          </button>
          <button
            type="button"
            onClick={() =>
              setTiers([
                { id: 'early', name: 'Early Bird', price: '7', min: '', cap: '50' },
                { id: 'standard', name: 'Standard', price: '10', min: '', cap: '' },
                { id: 'vip', name: 'VIP', price: '20', min: '', cap: '20' },
              ])
            }
            className="rounded border border-neutral-600 px-2 py-1 hover:border-neutral-400"
          >
            Template: Early + Standard + VIP
          </button>
          <button
            type="button"
            onClick={() => setTiers([{ id: 'pwyw', name: 'Pay what you want', price: '12', min: '3', cap: '' }])}
            className="rounded border border-neutral-600 px-2 py-1 hover:border-neutral-400"
          >
            Template: pay what you want
          </button>
        </div>
        <div className="space-y-2">
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-neutral-800 p-3 sm:grid-cols-6">
              <input value={t.id} onChange={(e) => setTier(i, { id: e.target.value })} placeholder="id (slug)" aria-label="Tier id" className={inputCls} />
              <input value={t.name} onChange={(e) => setTier(i, { name: e.target.value })} placeholder="Name" aria-label="Tier name" className={inputCls} />
              <input value={t.price} onChange={(e) => setTier(i, { price: e.target.value })} placeholder="$ price" inputMode="decimal" aria-label="Price in dollars" className={inputCls} />
              <input value={t.min} onChange={(e) => setTier(i, { min: e.target.value })} placeholder="$ min (PWYW)" inputMode="decimal" aria-label="Pay-what-you-want minimum" className={inputCls} />
              <input value={t.cap} onChange={(e) => setTier(i, { cap: e.target.value })} placeholder="Cap (opt)" inputMode="numeric" aria-label="Ticket cap" className={inputCls} />
              <button type="button" onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))} className="rounded border border-neutral-700 px-2 text-sm hover:border-red-400">
                Remove
              </button>
            </div>
          ))}
        </div>
        {tiers.length < 6 && (
          <button
            type="button"
            onClick={() => setTiers((prev) => [...prev, { id: '', name: '', price: '', min: '', cap: '' }])}
            className="mt-2 rounded border border-neutral-600 px-3 py-1.5 text-sm hover:border-neutral-400"
          >
            + Add tier
          </button>
        )}
      </fieldset>

      {error && <p className="text-sm text-red-300">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-md bg-amber-300 px-6 py-2.5 font-semibold text-neutral-950 hover:bg-amber-200 disabled:opacity-50">
        {busy ? 'Saving…' : showId ? 'Save changes' : 'Create show'}
      </button>
    </form>
  );
}
