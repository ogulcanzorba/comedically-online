import { getDb } from './client';

export interface Tag {
  slug: string;
  label: string;
}

export function slugifyTag(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function ensureTag(slug: string, label?: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO tags(slug, label) VALUES(?, ?)')
    .run(slug, label ?? slug);
}

export function setShowTags(showId: string, slugs: string[], source: string): void {
  const db = getDb();
  const insert = db.prepare('INSERT OR IGNORE INTO show_tags(show_id, tag_slug, source) VALUES(?, ?, ?)');
  const tx = db.transaction((list: string[]) => {
    for (const slug of list) {
      ensureTag(slug);
      insert.run(showId, slug, source);
    }
  });
  tx(slugs);
}

export function hasSourceTags(showId: string, source: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS ok FROM show_tags WHERE show_id = ? AND source = ? LIMIT 1')
    .get(showId, source) as { ok: number } | undefined;
  return row !== undefined;
}

export function getShowTags(showId: string): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.slug, t.label FROM tags t
       JOIN show_tags st ON st.tag_slug = t.slug
       WHERE st.show_id = ? ORDER BY t.slug ASC`,
    )
    .all(showId) as Tag[];
}
