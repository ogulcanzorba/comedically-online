/** Backfill auto tags for shows that have none. Honors TAG_MODE. */
import { listShows } from '../src/db/shows';
import { hasSourceTags, setShowTags } from '../src/db/tags';
import { autoTag, tagMode } from '../src/tags/index';

async function main(): Promise<void> {
  const shows = listShows();
  let tagged = 0;
  for (const show of shows) {
    if (hasSourceTags(show.id, 'auto')) continue;
    const tags = await autoTag(show.title, show.description, show.category_slug);
    setShowTags(show.id, tags, 'auto');
    tagged += 1;
    console.log(`${show.slug}: ${tags.join(', ')}`);
  }
  console.log(`Tagged ${tagged}/${shows.length} shows (mode=${tagMode()}).`);
}

void main();
