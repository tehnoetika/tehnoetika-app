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
  home_layout: 'blog' | 'institution';
  font_preset: string;
  text_size: string;
  footer_md: string;
  footer_html: string;
  created_at: string;
};

export type PostType = 'text' | 'event' | 'video' | 'project';

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
  category_id: string | null;
  post_type: PostType;
  event_start: string | null;
  event_end: string | null;
  event_location: string | null;
  link_url: string | null;
  video_source: string | null;
  video_url: string | null;
  project_status: string | null;
  attachment_media_id: string | null;
  featured: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  publication_id: string;
  name: string;
  slug: string;
  position: number;
  created_at: string;
};

export type NavItem = {
  id: string;
  publication_id: string;
  label: string;
  target: string;
  position: number;
  visible: number;
};

export type Member = {
  publication_id: string;
  user_id: string;
  role: string;
  created_at: string;
  email: string;
  name: string;
};

export type Media = {
  id: string;
  publication_id: string;
  kind: 'image' | 'video' | 'file';
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

/** Publikacije koje korisnik smije uređivati: vlastite + one gdje je urednik. */
export async function pubsForUser(db: D1Database, userId: string): Promise<Publication[]> {
  const r = await db
    .prepare(
      'SELECT * FROM publications WHERE owner_user_id = ? OR id IN (SELECT publication_id FROM publication_members WHERE user_id = ?) ORDER BY created_at'
    )
    .bind(userId, userId)
    .all<Publication>();
  return r.results;
}

/** Smije li korisnik uređivati publikaciju (vlasnik ili urednik). */
export async function canEditPub(db: D1Database, pub: Publication, userId: string): Promise<boolean> {
  if (pub.owner_user_id === userId) return true;
  const row = await db
    .prepare('SELECT 1 AS ok FROM publication_members WHERE publication_id = ? AND user_id = ?')
    .bind(pub.id, userId)
    .first();
  return Boolean(row);
}

export async function membersForPub(db: D1Database, pubId: string): Promise<Member[]> {
  const r = await db
    .prepare(
      'SELECT m.*, u.email, u.name FROM publication_members m JOIN users u ON u.id = m.user_id WHERE m.publication_id = ? ORDER BY m.created_at'
    )
    .bind(pubId)
    .all<Member>();
  return r.results;
}

export async function allPublications(db: D1Database): Promise<Publication[]> {
  const r = await db.prepare('SELECT * FROM publications ORDER BY created_at').all<Publication>();
  return r.results;
}

// --- Posts ---

/** Objavljeni postovi jednog tipa (default: tekstovi), najnoviji prvo. */
export async function publishedPosts(
  db: D1Database,
  pubId: string,
  limit: number,
  offset = 0,
  type: PostType = 'text'
): Promise<Post[]> {
  const r = await db
    .prepare(
      "SELECT * FROM posts WHERE publication_id = ? AND status = 'published' AND kind = 'post' AND post_type = ? ORDER BY published_at DESC LIMIT ? OFFSET ?"
    )
    .bind(pubId, type, limit, offset)
    .all<Post>();
  return r.results;
}

export async function publishedPostCount(db: D1Database, pubId: string, type: PostType = 'text'): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM posts WHERE publication_id = ? AND status = 'published' AND kind = 'post' AND post_type = ?"
    )
    .bind(pubId, type)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Svi objavljeni postovi svih tipova (RSS). */
export async function publishedAllTypes(db: D1Database, pubId: string, limit: number): Promise<Post[]> {
  const r = await db
    .prepare(
      "SELECT * FROM posts WHERE publication_id = ? AND status = 'published' AND kind = 'post' ORDER BY published_at DESC LIMIT ?"
    )
    .bind(pubId, limit)
    .all<Post>();
  return r.results;
}

/** Događaji: nadolazeći (uzlazno) ili održani (silazno) u odnosu na lokalno "sada". */
export async function publishedEvents(
  db: D1Database,
  pubId: string,
  when: 'upcoming' | 'past',
  nowLocal: string,
  limit = 100
): Promise<Post[]> {
  // Događaj je nadolazeći dok ne završi (event_end, inače event_start).
  const sql =
    when === 'upcoming'
      ? "SELECT * FROM posts WHERE publication_id = ? AND status = 'published' AND kind = 'post' AND post_type = 'event' AND COALESCE(event_end, event_start, '') >= ? ORDER BY event_start ASC LIMIT ?"
      : "SELECT * FROM posts WHERE publication_id = ? AND status = 'published' AND kind = 'post' AND post_type = 'event' AND COALESCE(event_end, event_start, '') < ? ORDER BY event_start DESC LIMIT ?";
  const r = await db.prepare(sql).bind(pubId, nowLocal, limit).all<Post>();
  return r.results;
}

export async function featuredPosts(db: D1Database, pubId: string): Promise<Post[]> {
  const r = await db
    .prepare(
      "SELECT * FROM posts WHERE publication_id = ? AND status = 'published' AND featured = 1 ORDER BY published_at DESC LIMIT 3"
    )
    .bind(pubId)
    .all<Post>();
  return r.results;
}

/** Objavljena stranica (kind = 'page') po slugu — za lijepe URL-ove /:slug. */
export async function pageBySlug(db: D1Database, pubId: string, slug: string): Promise<Post | null> {
  return db
    .prepare("SELECT * FROM posts WHERE publication_id = ? AND slug = ? AND kind = 'page' AND status = 'published'")
    .bind(pubId, slug)
    .first<Post>();
}

// --- Izbornik ---

export async function navItems(db: D1Database, pubId: string): Promise<NavItem[]> {
  const r = await db
    .prepare('SELECT * FROM nav_items WHERE publication_id = ? ORDER BY position, rowid')
    .bind(pubId)
    .all<NavItem>();
  return r.results;
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

export async function allPostsForDashboard(db: D1Database, pubId: string, type?: string): Promise<Post[]> {
  const r = type
    ? await db
        .prepare(
          "SELECT * FROM posts WHERE publication_id = ? AND (post_type = ? OR (? = 'page' AND kind = 'page')) AND (? = 'page' OR kind = 'post') ORDER BY COALESCE(published_at, updated_at) DESC"
        )
        .bind(pubId, type, type, type)
        .all<Post>()
    : await db
        .prepare('SELECT * FROM posts WHERE publication_id = ? ORDER BY COALESCE(published_at, updated_at) DESC')
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

// --- Categories (rubrike) ---

export async function categoriesForPub(db: D1Database, pubId: string): Promise<Category[]> {
  const r = await db
    .prepare('SELECT * FROM categories WHERE publication_id = ? ORDER BY position, name')
    .bind(pubId)
    .all<Category>();
  return r.results;
}

export async function categoryBySlug(
  db: D1Database,
  pubId: string,
  slug: string
): Promise<Category | null> {
  return db
    .prepare('SELECT * FROM categories WHERE publication_id = ? AND slug = ?')
    .bind(pubId, slug)
    .first<Category>();
}

/** Objavljeni postovi u jednoj rubrici (najnoviji prvo). */
export async function publishedPostsByCategory(
  db: D1Database,
  pubId: string,
  categoryId: string,
  limit: number,
  offset = 0
): Promise<Post[]> {
  const r = await db
    .prepare(
      "SELECT * FROM posts WHERE publication_id = ? AND category_id = ? AND status = 'published' AND kind = 'post' ORDER BY published_at DESC LIMIT ? OFFSET ?"
    )
    .bind(pubId, categoryId, limit, offset)
    .all<Post>();
  return r.results;
}

export async function publishedPostCountByCategory(
  db: D1Database,
  pubId: string,
  categoryId: string
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM posts WHERE publication_id = ? AND category_id = ? AND status = 'published' AND kind = 'post'"
    )
    .bind(pubId, categoryId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Jedinstveni slug rubrike unutar publikacije. */
export async function uniqueCategorySlug(
  db: D1Database,
  pubId: string,
  base: string
): Promise<string> {
  let slug = base || 'rubrika';
  for (let i = 2; i < 100; i++) {
    const row = await db
      .prepare('SELECT id FROM categories WHERE publication_id = ? AND slug = ?')
      .bind(pubId, slug)
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
