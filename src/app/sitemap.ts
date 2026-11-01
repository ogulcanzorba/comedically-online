import type { MetadataRoute } from 'next';
import { listShows } from '@/db/shows';
import { CATEGORIES } from '@/data/categories';

export const dynamic = 'force-dynamic';

const STATIC_ROUTES = [
  '',
  '/categories',
  '/search',
  '/login',
  '/register',
  '/terms',
  '/privacy',
  '/cookies',
  '/community-guidelines',
  '/moderation-policy',
  '/contact',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const now = new Date();
  let shows: Array<{ slug: string; updated_at: string }> = [];
  try {
    shows = listShows().map((s) => ({ slug: s.slug, updated_at: s.updated_at }));
  } catch {
    shows = [];
  }
  return [
    ...STATIC_ROUTES.map((route) => ({ url: `${base}${route || '/'}`, lastModified: now })),
    ...CATEGORIES.map((c) => ({ url: `${base}/categories/${c.slug}`, lastModified: now })),
    ...shows.map((s) => ({ url: `${base}/shows/${s.slug}`, lastModified: new Date(s.updated_at) })),
  ];
}
