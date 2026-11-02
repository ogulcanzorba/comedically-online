import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { StudioNav } from '@/components/StudioNav';

/** The whole studio area is comedian-only. Viewers get a friendly 403. */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/studio');
  if (user.role !== 'comedian') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="font-serif text-3xl">403 — Comedians only</h1>
        <p className="mt-2 text-neutral-400">
          The studio is where comedians run their shows. Your account is a viewer account.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/register"
            className="rounded-md bg-amber-300 px-5 py-2.5 font-semibold text-neutral-950 hover:bg-amber-200"
          >
            Register as comedian
          </Link>
          <Link
            href="/"
            className="rounded-md border border-neutral-600 px-5 py-2.5 hover:border-neutral-400"
          >
            Browse shows
          </Link>
        </div>
      </main>
    );
  }
  return (
    <>
      <StudioNav />
      {children}
    </>
  );
}
