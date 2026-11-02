import { getDb } from './client';

export interface Acceptance {
  user_id: string;
  rulebook_hash: string;
  accepted_at: string;
}

export function recordAcceptance(userId: string, hash: string): Acceptance {
  const at = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO rulebook_acceptances(user_id, rulebook_hash, accepted_at)
       VALUES(?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET rulebook_hash = excluded.rulebook_hash, accepted_at = excluded.accepted_at`,
    )
    .run(userId, hash, at);
  return { user_id: userId, rulebook_hash: hash, accepted_at: at };
}

export function getAcceptance(userId: string): Acceptance | undefined {
  return getDb().prepare('SELECT * FROM rulebook_acceptances WHERE user_id = ?').get(userId) as
    | Acceptance
    | undefined;
}

/** Valid only when the stored hash matches the current rulebook revision. */
export function hasValidAcceptance(userId: string, currentHash: string): boolean {
  return getAcceptance(userId)?.rulebook_hash === currentHash;
}
