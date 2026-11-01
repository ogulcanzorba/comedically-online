import Link from 'next/link';
import { Logo } from './Logo';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-neutral-800">
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-10 sm:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 text-sm text-neutral-400">Live comedy, moderated by someone who gets the joke.</p>
          <p className="mt-2 text-xs text-neutral-500">18+ only. Hackathon test build.</p>
        </div>
        <nav aria-label="Shows">
          <h2 className="text-sm font-semibold text-neutral-300">Shows</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-neutral-400">
            <li><Link href="/" className="hover:text-white">All shows</Link></li>
            <li><Link href="/categories" className="hover:text-white">Categories</Link></li>
            <li><Link href="/search" className="hover:text-white">Search</Link></li>
            <li><Link href="/shows/demo-night" className="hover:text-white">Demo Night (free)</Link></li>
          </ul>
        </nav>
        <nav aria-label="Perform">
          <h2 className="text-sm font-semibold text-neutral-300">Perform</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-neutral-400">
            <li><Link href="/register" className="hover:text-white">Join as comedian</Link></li>
            <li><Link href="/studio/shows" className="hover:text-white">My shows</Link></li>
            <li><Link href="/studio" className="hover:text-white">Go live</Link></li>
          </ul>
        </nav>
        <nav aria-label="Legal and safety">
          <h2 className="text-sm font-semibold text-neutral-300">Legal &amp; safety</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-neutral-400">
            <li><Link href="/terms" className="hover:text-white">Terms</Link></li>
            <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
            <li><Link href="/cookies" className="hover:text-white">Cookies</Link></li>
            <li><Link href="/community-guidelines" className="hover:text-white">Community guidelines</Link></li>
            <li><Link href="/moderation-policy" className="hover:text-white">Moderation policy</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-neutral-800">
        <p className="mx-auto max-w-5xl px-6 py-4 text-xs text-neutral-500">
          © {new Date().getFullYear()} Comedically Online (fictional demo). Legal pages are templates — see README.
        </p>
      </div>
    </footer>
  );
}
