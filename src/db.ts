// Tipovi i tenant-scoped pristup podacima. Sve preko prepared statements + bind().

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  PLATFORM_HOST: string;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
  // Domovina SSO (self-hosted Supabase GoTrue na api.domovina.ai).
  // JWT_SECRET je tajni potpisni ključ (HS256) — worker secret; URL/ANON su javni.
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

export type User = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
};

export type Publication = {
  id: string;
  owner_user_id: string;
  slug: string;
  name: string;
  tagline: string;
  about_md: string;
  about_html: string;
  logo_media_id: string | null;
  accent_color: string;
  custom_domain: string | null;
  locale: string;
  created_at: string;
};

export type Post = {
  id: string;
  publication_id: string;
  slug: string;
  title: string;
  subtitle: string;
  body_md: string;
  body_html: string;
  cover_media_id: string | null;
  kind: 'post' | 'page';
  status: 'draft' | 'published';
  visibility: string;
  pinned_nav: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Media = {
  id: string;
  publication_id: string;
  kind: 'image' | 'video';
  storage_key: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
};

export type Subscriber = {
  id: string;
  publication_id: string;
  email: string;
  status: 'pending' | 'confirmed' | 'unsubscribed';
  confirm_token: string | null;
  unsubscribe_token: string;
  confirmed_at: string | null;
  created_at: string;
};

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Publications ---

export async function pubBySlug(db: D1Database, slug: string): Promise<Publication | null> {
  return db.prepare('SELECT * FROM publications WHERE slug = ?').bind(slug).first<Publication>();
}

export async function pubByDomain(db: D1Database, domain: string): Promise<Publication | null> {
  return db.prepare('SELECT * FROM publications WHERE custom_domain = ?').bind(domain).first<Publication>();
}

export async function pubById(db: D1Database, id: string): Promise<Publication | null> {
  return db.prepare('SELECT * FROM publications WHERE id = ?').bind(id).first<Publication>();
}

export async function pubsByOwner(db: D1Database, userId: string): Promise<Publication[]> {
  const r = await db
    .prepare('SELECT * FROM publications WHERE owner_user_id = ? ORDER BY created_at')
    .bind(userId)
    .all<Publication>();
  return r.results;
}

export async function allPublications(db: D1Database): Promise<Publication[]> {
  const r = await db.prepare('SELECT * FROM publications ORDER BY created_at').all<Publication>();
  return r.results;
}

// --- Posts ---

export async function publishedPosts(
  db: D1Database,
  pubId: string,
  limit: number,
  offset = 0
): Promise<Post[]> {
  const r = await db
    .prepare(
      "SELECT * FROM posts WHERE publication_id = ? AND status = 'published' AND kind = 'post' ORDER BY published_at DESC LIMIT ? OFFSET ?"
    )
    .bind(pubId, limit, offset)
    .all<Post>();
  return r.results;
}

export async function publishedPostCount(db: D1Database, pubId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE publication_id = ? AND status = 'published' AND kind = 'post'")
    .bind(pubId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function navPages(db: D1Database, pubId: string): Promise<Post[]> {
  const r = await db
    .prepare(
      "SELECT * FROM posts WHERE publication_id = ? AND status = 'published' AND kind = 'page' AND pinned_nav = 1 ORDER BY created_at"
    )
    .bind(pubId)
    .all<Post>();
  return r.results;
}

export async function postBySlug(db: D1Database, pubId: string, slug: string): Promise<Post | null> {
  return db
    .prepare('SELECT * FROM posts WHERE publication_id = ? AND slug = ?')
    .bind(pubId, slug)
    .first<Post>();
}

export async function postById(db: D1Database, pubId: string, id: string): Promise<Post | null> {
  return db
    .prepare('SELECT * FROM posts WHERE publication_id = ? AND id = ?')
    .bind(pubId, id)
    .first<Post>();
}

export async function allPostsForDashboard(db: D1Database, pubId: string): Promise<Post[]> {
  const r = await db
    .prepare(
      'SELECT * FROM posts WHERE publication_id = ? ORDER BY COALESCE(published_at, updated_at) DESC'
    )
    .bind(pubId)
    .all<Post>();
  return r.results;
}

/** Jedinstveni slug unutar publikacije: dodaje -2, -3… kod kolizije. */
export async function uniquePostSlug(
  db: D1Database,
  pubId: string,
  base: string,
  excludePostId?: string
): Promise<string> {
  let slug = base || 'post';
  for (let i = 2; i < 100; i++) {
    const row = await db
      .prepare('SELECT id FROM posts WHERE publication_id = ? AND slug = ? AND id != ?')
      .bind(pubId, slug, excludePostId ?? '')
      .first();
    if (!row) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${newId().slice(0, 6)}`;
}

// --- Media ---

export async function mediaById(db: D1Database, id: string): Promise<Media | null> {
  return db.prepare('SELECT * FROM media WHERE id = ?').bind(id).first<Media>();
}

export async function mediaForPub(db: D1Database, pubId: string): Promise<Media[]> {
  const r = await db
    .prepare('SELECT * FROM media WHERE publication_id = ? ORDER BY created_at DESC')
    .bind(pubId)
    .all<Media>();
  return r.results;
}

// --- Subscribers ---

export async function confirmedSubscriberCount(db: D1Database, pubId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM subscribers WHERE publication_id = ? AND status = 'confirmed'")
    .bind(pubId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function subscribersForPub(db: D1Database, pubId: string): Promise<Subscriber[]> {
  const r = await db
    .prepare('SELECT * FROM subscribers WHERE publication_id = ? ORDER BY created_at DESC')
    .bind(pubId)
    .all<Subscriber>();
  return r.results;
}
