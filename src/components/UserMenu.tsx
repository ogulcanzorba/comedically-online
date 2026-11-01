'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { UserRole } from '../db/users';

export interface MenuUser {
  displayName: string;
  role: UserRole;
}

export interface MenuLink {
  label: string;
  href: string;
}

/** Links shown in the account dropdown, by role. Pure: unit-tested. */
export function menuLinks(role: UserRole): MenuLink[] {
  return [
    { label: 'My profile', href: '/profile' },
    ...(role === 'viewer'
      ? [{ label: 'My tickets', href: '/profile#tickets' }]
      : [{ label: 'Studio', href: '/studio' }]),
  ];
}

/** Initials for the avatar circle. Pure: unit-tested. */
export function initialsFor(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

/** Logged-in account button + dropdown. Rendered by the server header with the session user. */
export function UserMenu({ user }: { user: MenuUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(ev: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    }
    function onKeyDown(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open ]);

  async function logout(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    setOpen(false);
    router.push('/');
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${user.displayName}`}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-spotlight text-sm font-bold text-ink hover:brightness-110"
      >
        <span aria-hidden="true">{initialsFor(user.displayName)}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-neutral-700 bg-neutral-900 p-2 shadow-xl"
        >
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="truncate text-sm font-semibold">{user.displayName}</span>
            <span className="rounded-full bg-neutral-700 px-2 py-0.5 text-[11px] capitalize text-neutral-200">
              {user.role}
            </span>
          </div>
          <div className="my-1 border-t border-neutral-800" />
          {menuLinks(user.role).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              {l.label}
            </Link>
          ))}
          <div className="my-1 border-t border-neutral-800" />
          <form method="post" onSubmit={(ev) => void logout(ev)}>
            <button
              type="submit"
              role="menuitem"
              className="block w-full rounded px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
