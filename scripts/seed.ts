/** Seed the local SQLite DB with fictional comedians, viewers, and shows. Idempotent. */
import seed from '../data/seed-shows.json';
import { getDb } from '../src/db/client';
import { createUser } from '../src/db/users';
import { createShow, type Tier } from '../src/db/shows';
import { createTicket } from '../src/db/tickets';
import { setShowTags } from '../src/db/tags';
import { hashPassword } from '../src/auth/password';

const SEED_PASSWORD = 'Comedy123!';

interface SeedTier {
  id: string;
  name: string;
  price_cents: number;
  min_cents?: number;
  cap?: number;
}

async function main(): Promise<void> {
  const db = getDb();
  const now = Date.now();
  // Reset seed rows for a deterministic re-seed.
  db.exec(`DELETE FROM show_tags WHERE show_id LIKE 'seed-%';
    DELETE FROM tickets WHERE show_id LIKE 'seed-%' OR user_id LIKE 'seed-%';
    DELETE FROM shows WHERE id LIKE 'seed-%';
    DELETE FROM users WHERE id LIKE 'seed-%';`);

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const comedianIds = new Map<string, string>();
  for (const c of seed.comedians) {
    const id = `seed-comedian-${c.key}`;
    createUser({
      id,
      role: 'comedian',
      email: c.email,
      passwordHash,
      displayName: c.displayName,
      stageName: c.stageName,
      bio: c.bio,
      comedyStyles: c.styles,
      country: c.country,
    });
    comedianIds.set(c.key, id);
  }
  const viewerIds = new Map<string, string>();
  for (const v of seed.viewers) {
    const id = `seed-viewer-${v.email.split('@')[0]}`;
    createUser({ id, role: 'viewer', email: v.email, passwordHash, displayName: v.displayName, country: v.country });
    viewerIds.set(v.email, id);
  }

  for (const s of seed.shows) {
    const comedianId = comedianIds.get(s.comedian);
    if (!comedianId) throw new Error(`unknown comedian ${s.comedian}`);
    const id = `seed-show-${s.slug}`;
    const show = createShow({
      id,
      slug: s.slug,
      comedianId,
      title: s.title,
      description: s.description,
      startsAtUtc: new Date(now + s.startsInHours * 3600_000).toISOString(),
      durationMin: s.durationMin,
      categorySlug: s.category,
      timezone: 'UTC',
      tiers: (s.tiers as SeedTier[]).map(
        (t): Tier => ({ id: t.id, name: t.name, price_cents: t.price_cents, min_cents: t.min_cents, cap: t.cap }),
      ),
      thumbnailTheme: s.theme,
    });
    setShowTags(show.id, [s.category], 'category');
  }

  // Sell out the tiny room: both seed viewers hold its only 2 tickets.
  const tiny = seed.shows.find((s) => s.slug === 'sixty-jokes');
  if (tiny) {
    const showId = `seed-show-${tiny.slug}`;
    let i = 0;
    for (const userId of viewerIds.values()) {
      i += 1;
      createTicket({ showId, userId, tier: 'standard', priceCents: 800, orderRef: `MOCK-SEED-${i}` });
    }
  }

  const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const shows = (db.prepare('SELECT COUNT(*) AS n FROM shows').get() as { n: number }).n;
  console.log(`Seeded ${users} users, ${shows} shows. Seed password for all: ${SEED_PASSWORD}`);
}

void main();
