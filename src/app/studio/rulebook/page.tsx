import Link from 'next/link';
import { RULEBOOK_RULES, RULEBOOK_VERSION, RULEBOOK_VERSION_HASH } from '@/moderation/rulebook';
import { RuleCard } from '@/components/RuleCard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Rulebook',
  description: 'The moderation rules every Comedically Online broadcast follows.',
};

export default function RulebookPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/studio" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Studio
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Rulebook</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Version {RULEBOOK_VERSION} · revision <span className="font-mono">{RULEBOOK_VERSION_HASH}</span> ·
        the exact rules the moderator enforces. Accept the current revision on a show&apos;s{' '}
        <Link href="/studio/shows" className="underline">
          prepare page
        </Link>{' '}
        before going live; if the rulebook changes you will be asked to accept again.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {RULEBOOK_RULES.map((rule) => (
          <RuleCard key={rule.id} rule={rule} />
        ))}
      </div>
    </main>
  );
}
