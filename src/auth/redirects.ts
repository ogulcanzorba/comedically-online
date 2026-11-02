import type { UserRole } from '../db/users';

/**
 * Where logged-in users land instead of auth pages.
 * Pure: null = stay (logged out), otherwise the redirect target.
 */
export function homeFor(user: { role: UserRole } | null): string | null {
  if (!user) return null;
  return user.role === 'comedian' ? '/studio' : '/profile';
}
