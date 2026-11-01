import Link from 'next/link';
import { notFound } from 'next/navigation';
import { categoryBySlug } from '@/data/categories';
import { listShows } from '@/db/shows';
import { findUserById } from '@/db/users';
import { countByTier } from '@/db/tickets';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ShowCard } from '@/components/ShowCard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = categoryBySlug(slug);
  if (!category) return { title: 'Category not found' };
  return {
    title: category.name,
    description: category.description,
    alternates: { canonical: `/categories/${slug}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = categoryBySlug(slug);
  if (!category) notFound();
  const shows = listShows({ category: slug });
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/categories" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← All categories
      </Link>
      <div className="mt-4 flex items-center gap-3">
        <CategoryIcon slug={slug} className="h-10 w-10 text-amber-300" />
        <h1 className="font-serif text-4xl">{category.name}</h1>
      </div>
      <p className="mt-2 text-neutral-400">{category.description}</p>
      <section aria-label={`${category.name} shows`} className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shows.map((show) => (
          <ShowCard
            key={show.id}
            show={show}
            comedianName={findUserById(show.comedian_id)?.stage_name ?? 'Unknown comic'}
            sold={countByTier(show.id)}
          />
        ))}
      </section>
      {shows.length === 0 && <p className="mt-6 text-neutral-400">No shows in this category yet.</p>}
    </main>
  );
}
