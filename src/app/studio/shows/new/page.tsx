import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { ShowForm } from '@/components/ShowForm';
import { RevenueCalculator } from '@/components/RevenueCalculator';

export const dynamic = 'force-dynamic';

export default async function NewShowPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/studio/shows/new');
  if (user.role !== 'comedian') redirect('/');
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/studio/shows" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← My shows
      </Link>
      <h1 className="mt-2 font-serif text-3xl">New show</h1>
      <div className="mt-6">
        <ShowForm />
      </div>
      <div className="mt-8">
        <RevenueCalculator />
      </div>
    </main>
  );
}
