import Link from 'next/link';

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Get in</h1>
      <p className="mt-3 inline-block rounded-md border border-amber-200/40 bg-amber-100/10 px-3 py-1 text-sm font-semibold text-amber-100">
        MOCK PAYMENT, no money is charged
      </p>
      <p className="mt-4 text-sm text-neutral-400">
        Ticket ($5) and subscription ($12/mo) checkout lands on Day 3. During Day 1 rehearsal,{' '}
        <Link href="/watch" className="underline">
          /watch
        </Link>{' '}
        is open.
      </p>
    </main>
  );
}
