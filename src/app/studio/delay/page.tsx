import Link from 'next/link';
import { DelayDemo } from '@/components/DelayDemo';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Preview delay',
  description: 'How the 10-second broadcast delay works.',
};

export default function DelayPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/studio" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Studio
      </Link>
      <h1 className="mt-2 font-serif text-3xl">The 10-second delay</h1>
      <p className="mt-2 text-neutral-300">
        Everything you perform reaches viewers exactly 10 seconds after our server receives it. That
        window is what the moderator uses: each 2-second chunk is transcribed, checked against the{' '}
        <Link href="/studio/rulebook" className="underline">
          rulebook
        </Link>
        , and released with its decisions — the stream itself is never cut.
      </p>
      <div className="mt-6">
        <DelayDemo />
      </div>
    </main>
  );
}
