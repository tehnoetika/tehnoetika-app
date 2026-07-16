-- Kategorije (rubrike) po publikaciji + sekcijska naslovna (inspirirano First Things).

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (publication_id, slug)
);
CREATE INDEX idx_categories_pub ON categories(publication_id, position);

ALTER TABLE posts ADD COLUMN category_id TEXT REFERENCES categories(id);
CREATE INDEX idx_posts_category ON posts(category_id, published_at DESC);
