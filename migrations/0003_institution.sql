-- Institucionalna stranica (docs/PLAN-tehnoetika-site.md): tipovi sadržaja, izbornik,
-- PDF prilozi, tipografija, institucionalna naslovnica i više urednika po publikaciji.

-- Tipovi sadržaja. kind ('post'|'page') ima CHECK koji SQLite ne mijenja ALTER-om,
-- pa tip ide u zaseban stupac: text | event | video | project.
ALTER TABLE posts ADD COLUMN post_type TEXT NOT NULL DEFAULT 'text';
-- Događaj: lokalno vrijeme Europe/Zagreb, 'YYYY-MM-DDTHH:MM' (usporedivo kao string).
ALTER TABLE posts ADD COLUMN event_start TEXT;
ALTER TABLE posts ADD COLUMN event_end TEXT;
ALTER TABLE posts ADD COLUMN event_location TEXT;
-- Vanjska poveznica (projekt, izvor, prijava kod organizatora).
ALTER TABLE posts ADD COLUMN link_url TEXT;
-- Video: izvor 'youtube' sada, 'r2' ciljno (PLAN §3.1) — model je dvoizvoran od početka.
ALTER TABLE posts ADD COLUMN video_source TEXT;
ALTER TABLE posts ADD COLUMN video_url TEXT;
-- Projekt: 'active' | 'planned' | 'done'.
ALTER TABLE posts ADD COLUMN project_status TEXT;
-- Prilog za preuzimanje (npr. PDF Deklaracije).
ALTER TABLE posts ADD COLUMN attachment_media_id TEXT;
-- Istaknuto na institucionalnoj naslovnici.
ALTER TABLE posts ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_posts_type ON posts(publication_id, post_type, status, published_at DESC);
CREATE INDEX idx_posts_event ON posts(publication_id, post_type, event_start);

-- Publikacija: raspored naslovnice, tipografija, podnožje.
ALTER TABLE publications ADD COLUMN home_layout TEXT NOT NULL DEFAULT 'blog';      -- blog | institution
ALTER TABLE publications ADD COLUMN font_preset TEXT NOT NULL DEFAULT 'lora';      -- lora | playfair | newsreader
ALTER TABLE publications ADD COLUMN text_size TEXT NOT NULL DEFAULT 'm';           -- s | m | l
ALTER TABLE publications ADD COLUMN footer_md TEXT NOT NULL DEFAULT '';
ALTER TABLE publications ADD COLUMN footer_html TEXT NOT NULL DEFAULT '';

-- Uređivi izbornik. Prazan = automatski izbornik (ponašanje prije ove migracije).
CREATE TABLE nav_items (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  label TEXT NOT NULL,
  target TEXT NOT NULL,          -- relativna putanja unutar publikacije ('/aktivnosti') ili apsolutni URL
  position INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_nav_pub ON nav_items(publication_id, position);

-- Više urednika po publikaciji. Vlasnik ostaje u publications.owner_user_id;
-- ovdje su dodatni urednici (role 'editor').
CREATE TABLE publication_members (
  publication_id TEXT NOT NULL REFERENCES publications(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (publication_id, user_id)
);
CREATE INDEX idx_members_user ON publication_members(user_id);

-- media.kind dobiva 'file' (PDF). CHECK se mijenja samo rebuildom tablice;
-- na media ne pokazuje nijedan FOREIGN KEY, pa je rebuild siguran.
CREATE TABLE media_new (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  kind TEXT NOT NULL CHECK (kind IN ('image','video','file')),
  storage_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO media_new (id, publication_id, kind, storage_key, filename, mime_type, byte_size, created_at)
  SELECT id, publication_id, kind, storage_key, filename, mime_type, byte_size, created_at FROM media;
DROP TABLE media;
ALTER TABLE media_new RENAME TO media;
CREATE INDEX idx_media_pub ON media(publication_id, created_at DESC);
