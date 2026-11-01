CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('comedian','viewer')),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  stage_name TEXT,
  bio TEXT,
  comedy_styles TEXT,
  country TEXT,
  age_confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shows(
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  comedian_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  category_slug TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  tiers_json TEXT NOT NULL DEFAULT '[]',
  thumbnail_theme TEXT NOT NULL DEFAULT 'ember',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shows_starts ON shows(starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_shows_comedian ON shows(comedian_id);
CREATE INDEX IF NOT EXISTS idx_shows_category ON shows(category_slug);

CREATE TABLE IF NOT EXISTS tickets(
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL REFERENCES shows(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  tier TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  order_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(show_id, user_id, tier)
);
CREATE INDEX IF NOT EXISTS idx_tickets_lookup ON tickets(show_id, user_id);

CREATE TABLE IF NOT EXISTS tags(
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS show_tags(
  show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  tag_slug TEXT NOT NULL REFERENCES tags(slug),
  source TEXT NOT NULL DEFAULT 'auto',
  PRIMARY KEY(show_id, tag_slug)
);
CREATE INDEX IF NOT EXISTS idx_show_tags_tag ON show_tags(tag_slug);
