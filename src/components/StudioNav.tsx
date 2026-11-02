'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { label: 'Overview', href: '/studio' },
  { label: 'My shows', href: '/studio/shows' },
  { label: 'Rulebook', href: '/studio/rulebook' },
  { label: 'Tools', href: '/studio#tools' },
];

/** Studio sub-navigation with active state. Rendered inside the gated layout. */
export function StudioNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Studio" className="border-b border-neutral-800 bg-neutral-950">
      <div className="mx-auto flex max-w-4xl gap-1 px-6">
        {ITEMS.map((item) => {
          const active =
            item.href === '/studio' ? pathname === '/studio' : pathname.startsWith(item.href.split('#')[0]);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`border-b-2 px-3 py-3 text-sm font-medium ${
                active
                  ? 'border-spotlight text-white'
                  : 'border-transparent text-neutral-400 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
