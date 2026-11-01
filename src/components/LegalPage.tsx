import type { Metadata } from 'next';
import Link from 'next/link';

export function legalMetadata(title: string, description: string, path: string): Metadata {
  return { title, description, alternates: { canonical: path } };
}

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Home
      </Link>
      <h1 className="mt-2 font-serif text-4xl">{title}</h1>
      <p className="mt-1 text-sm text-neutral-500">Last updated: {updated}</p>
      <p className="mt-4 rounded-md border border-amber-200/40 bg-amber-100/10 p-3 text-sm text-amber-100">
        Template draft for a hackathon demo — must be reviewed by a lawyer before launch. It does not
        claim legal compliance.
      </p>
      <article className="mt-6 space-y-5 text-[15px] leading-relaxed text-neutral-300 [&_h2]:pt-2 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:text-neutral-100 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
        {children}
      </article>
    </main>
  );
}
