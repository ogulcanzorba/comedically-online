import Link from 'next/link';
import { getSessionUser } from '@/auth/get-session';
import { LogoutButton } from './LogoutButton';
import { Logo } from './Logo';

export async function SiteHeader() {
  const user = await getSessionUser();
  return (
    <header className="border-b border-neutral-800">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
        <Link href="/" aria-label="Comedically Online home">
          <Logo />
        </Link>
        <nav className="flex gap-4 text-sm" aria-label="Main">
          <Link href="/" className="text-neutral-300 hover:text-white">
            Shows
          </Link>
          <Link href="/categories" className="text-neutral-300 hover:text-white">
            Categories
          </Link>
          {user?.role === 'comedian' && (
            <>
              <Link href="/studio/shows" className="text-neutral-300 hover:text-white">
                My shows
              </Link>
              <Link href="/studio" className="text-neutral-300 hover:text-white">
                Go live
              </Link>
            </>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          {user ? (
            <>
              <span className="text-neutral-400">{user.displayName}</span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="text-neutral-300 hover:text-white">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-amber-300 px-3 py-1.5 font-semibold text-neutral-950 hover:bg-amber-200"
              >
                Join
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
