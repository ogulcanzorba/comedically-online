import { redirect } from 'next/navigation';

/**
 * The broadcast studio now lives inside each show's pre-live page.
 * Old links land on the dashboard, or the show's prepare page when ?show= is given.
 */
export default async function GoLiveRedirect({
  searchParams,
}: {
  searchParams?: Promise<{ show?: string }>;
}) {
  const show = (await searchParams)?.show;
  redirect(typeof show === 'string' && show ? `/studio/shows/${show}/prepare` : '/studio');
}
