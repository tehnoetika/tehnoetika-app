-- Tehnoetika Platform — inicijalna shema (vidi docs/SPEC.md §4)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  about_md TEXT NOT NULL DEFAULT '',
  about_html TEXT NOT NULL DEFAULT '',
  logo_media_id TEXT,
  accent_color TEXT NOT NULL DEFAULT '#1a7f6b',
  custom_domain TEXT UNIQUE,
  locale TEXT NOT NULL DEFAULT 'hr',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_publications_owner ON publications(owner_user_id);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  cover_media_id TEXT,
  kind TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post','page')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  visibility TEXT NOT NULL DEFAULT 'public',
  pinned_nav INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (publication_id, slug)
);
CREATE INDEX idx_posts_pub_status ON posts(publication_id, status, published_at DESC);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  storage_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_media_pub ON media(publication_id, created_at DESC);

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','unsubscribed')),
  confirm_token TEXT UNIQUE,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (publication_id, email)
);
CREATE INDEX idx_subscribers_pub ON subscribers(publication_id, status);

CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
