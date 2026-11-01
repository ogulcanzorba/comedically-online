import { randomUUID } from 'node:crypto';
import { getDb } from './client';

export interface Tier {
  id: string;
  name: string;
  /** Unit price in cents (for pay-what-you-want: the suggested price). */
  price_cents: number;
  /** Present => pay-what-you-want with this minimum in cents. */
  min_cents?: number;
  /** Present => at most this many tickets per tier (sold out beyond). */
  cap?: number;
}

export interface ShowRow {
  id: string;
  slug: string;
  comedian_id: string;
  title: string;
  description: string;
  starts_at_utc: string;
  duration_min: number;
  category_slug: string;
  timezone: string;
  tiers_json: string;
  thumbnail_theme: string;
  created_at: string;
  updated_at: string;
}

export interface Show extends Omit<ShowRow, 'tiers_json'> {
  tiers: Tier[];
}

export function parseTiers(json: string): Tier[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is Tier =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as Tier).id === 'string' &&
        typeof (t as Tier).name === 'string' &&
        typeof (t as Tier).price_cents === 'number',
    );
  } catch {
    return [];
  }
}

function toShow(row: ShowRow): Show {
  const { tiers_json, ...rest } = row;
  return { ...rest, tiers: parseTiers(tiers_json) };
}

export interface CreateShowInput {
  id?: string;
  slug: string;
  comedianId: string;
  title: string;
  description: string;
  startsAtUtc: string;
  durationMin: number;
  categorySlug: string;
  timezone: string;
  tiers: Tier[];
  thumbnailTheme: string;
}

export function createShow(input: CreateShowInput): Show {
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();
  getDb()
    .prepare(
      `INSERT INTO shows(id, slug, comedian_id, title, description, starts_at_utc, duration_min,
        category_slug, timezone, tiers_json, thumbnail_theme, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.slug,
      input.comedianId,
      input.title,
      input.description,
      input.startsAtUtc,
      input.durationMin,
      input.categorySlug,
      input.timezone,
      JSON.stringify(input.tiers),
      input.thumbnailTheme,
      now,
      now,
    );
  const row = getShowById(id);
  if (!row) throw new Error('show insert failed');
  return row;
}

export function updateShow(
  id: string,
  patch: Partial<Omit<CreateShowInput, 'id' | 'comedianId' | 'slug'>>,
): Show | undefined {
  const fields: string[] = [];
  const values: Array<string | number> = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    values.push(patch.description);
  }
  if (patch.startsAtUtc !== undefined) {
    fields.push('starts_at_utc = ?');
    values.push(patch.startsAtUtc);
  }
  if (patch.durationMin !== undefined) {
    fields.push('duration_min = ?');
    values.push(patch.durationMin);
  }
  if (patch.categorySlug !== undefined) {
    fields.push('category_slug = ?');
    values.push(patch.categorySlug);
  }
  if (patch.timezone !== undefined) {
    fields.push('timezone = ?');
    values.push(patch.timezone);
  }
  if (patch.tiers !== undefined) {
    fields.push('tiers_json = ?');
    values.push(JSON.stringify(patch.tiers));
  }
  if (patch.thumbnailTheme !== undefined) {
    fields.push('thumbnail_theme = ?');
    values.push(patch.thumbnailTheme);
  }
  if (fields.length === 0) return getShowById(id);
  fields.push('updated_at = ?');
  values.push(new Date().toISOString(), id);
  getDb().prepare(`UPDATE shows SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getShowById(id);
}

export function getShowById(id: string): Show | undefined {
  const row = getDb().prepare('SELECT * FROM shows WHERE id = ?').get(id) as ShowRow | undefined;
  return row ? toShow(row) : undefined;
}

export function getShowBySlug(slug: string): Show | undefined {
  const row = getDb().prepare('SELECT * FROM shows WHERE slug = ?').get(slug) as ShowRow | undefined;
  return row ? toShow(row) : undefined;
}

export interface ListShowsOpts {
  category?: string;
  q?: string;
  comedianId?: string;
  limit?: number;
}

export function listShows(opts: ListShowsOpts = {}): Show[] {
  const where: string[] = [];
  const values: Array<string | number> = [];
  if (opts.category) {
    where.push('category_slug = ?');
    values.push(opts.category);
  }
  if (opts.comedianId) {
    where.push('comedian_id = ?');
    values.push(opts.comedianId);
  }
  if (opts.q) {
    where.push('(title LIKE ? OR description LIKE ?)');
    values.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM shows ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY starts_at_utc ASC LIMIT ?`,
    )
    .all(...values, opts.limit ?? 100) as ShowRow[];
  return rows.map(toShow);
}

/** Full search across titles, descriptions, and tags. */
export function searchShows(q: string, limit = 50): Show[] {
  const like = `%${q}%`;
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT s.* FROM shows s
       LEFT JOIN show_tags st ON st.show_id = s.id
       LEFT JOIN tags t ON t.slug = st.tag_slug
       WHERE s.title LIKE ? OR s.description LIKE ? OR t.slug LIKE ? OR t.label LIKE ?
       ORDER BY s.starts_at_utc ASC LIMIT ?`,
    )
    .all(like, like, like, like, limit) as ShowRow[];
  return rows.map(toShow);
}
