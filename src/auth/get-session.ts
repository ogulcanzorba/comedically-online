import { cookies } from 'next/headers';
import { SESSION_COOKIE } from './cookie';
import { verifySession } from './session';
import { findUserById, toPublic, type PublicUser } from '../db/users';

/** Current logged-in user for server components, or null. */
export async function getSessionUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const userId = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const row = findUserById(userId);
  return row ? toPublic(row) : null;
}
