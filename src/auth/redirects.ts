import type { UserRole } from '../db/users';

/**
 * Where logged-in users land instead of auth pages.
 * Pure: null = stay (logged out), otherwise the redirect target.
 */
export function homeFor(user: { role: UserRole } | null): string | null {
  if (!user) return null;
  return user.role === 'comedian' ? '/studio' : '/profile';
}

export type HomeVariant = 'anon' | 'viewer' | 'comedian';

/** Which home hero to render. Pure: unit-tested. */
export function homeVariant(user: { role: UserRole } | null): HomeVariant {
  if (!user) return 'anon';
  return user.role;
}
