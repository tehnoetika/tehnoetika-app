// Javne stranice tenanta: naslovnica, arhiva, post, about, RSS, sitemap, pretplata.
// Rute se registriraju dvaput: host mode (subdomena/custom domena, prefix '') i
// path mode ('/@:pubslug'), s istim handlerima — vidi docs/SPEC.md §3.
import type { Context, Hono, Next } from 'hono';
import {
  navPages,
  postBySlug,
  publishedPostCount,
  publishedPosts,
  pubBySlug,
  newId,
  newToken,
  type Bindings,
  type Post,
} from '../db';
import { emailEnabled, sendEmail } from '../email';
import { escapeHtml } from '../markdown';
import {
  Flash,
  PostCard,
  SubscribeForm,
  TenantLayout,
  formatDate,
  mediaUrl,
  type TenantCtx,
} from '../views/layout';

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    tenant: TenantCtx | null;
    user?: import('../db').User | null;
    dpub?: import('../db').Publication;
  };
};

type C = Context<AppEnv>;

const PAGE_SIZE = 20;

async function resolveTenant(c: C): Promise<TenantCtx | null> {
  // path mode: parametar dolazi s vodećim '@' (npr. "@tehnoetika")
  const slugParam = (c.req.param('pubslug' as never) as string | undefined)?.replace(/^@/, '');
  if (slugParam !== undefined) {
    const pub = await pubBySlug(c.env.DB, slugParam);
    if (!pub) return null;
    const url = new URL(c.req.url);
    return { pub, base: `/@${pub.slug}`, absBase: `${url.protocol}//${url.host}/@${pub.slug}` };
  }
  return c.get('tenant');
}

function coverUrl(post: Post): string | null {
  return post.cover_media_id ? mediaUrl(post.cover_media_id, 'cover') : null;
}

async function homePage(c: C, t: TenantCtx) {
  const [posts, pages] = await Promise.all([
    publishedPosts(c.env.DB, t.pub.id, 11),
    navPages(c.env.DB, t.pub.id),
  ]);
  const [hero, ...rest] = posts;
  return c.html(
    <TenantLayout tenant={t} pages={pages}>
      <SubscribeForm tenant={t} />
      {hero ? (
        <article class="hero">
          {coverUrl(hero) ? <img class="hero-cover" src={coverUrl(hero)!} alt="" /> : null}
          <h2>
            <a href={`${t.base}/p/${hero.slug}`}>{hero.title}</a>
          </h2>
          {hero.subtitle ? <p class="hero-subtitle">{hero.subtitle}</p> : null}
          <time>{formatDate(hero.published_at)}</time>
        </article>
      ) : (
        <p class="empty">Još nema objava.</p>
      )}
      <section class="post-list">
        {rest.map((p) => (
          <PostCard tenant={t} post={p} coverUrl={coverUrl(p)} />
        ))}
      </section>
      {posts.length > 10 ? (
        <p class="more">
          <a href={`${t.base}/archive`}>Cijela arhiva →</a>
        </p>
      ) : null}
    </TenantLayout>
  );
}

async function archivePage(c: C, t: TenantCtx) {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const [posts, total, pages] = await Promise.all([
    publishedPosts(c.env.DB, t.pub.id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    publishedPostCount(c.env.DB, t.pub.id),
    navPages(c.env.DB, t.pub.id),
  ]);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return c.html(
    <TenantLayout tenant={t} pages={pages} title="Arhiva">
      <h1 class="page-title">Arhiva</h1>
      <section class="post-list">
        {posts.map((p) => (
          <PostCard tenant={t} post={p} coverUrl={coverUrl(p)} />
        ))}
        {posts.length === 0 ? <p class="empty">Nema objava na ovoj stranici.</p> : null}
      </section>
      <nav class="pagination">
        {page > 1 ? <a href={`${t.base}/archive?page=${page - 1}`}>← Novije</a> : <span />}
        <span>
          {page} / {lastPage}
        </span>
        {page < lastPage ? <a href={`${t.base}/archive?page=${page + 1}`}>Starije →</a> : <span />}
      </nav>
    </TenantLayout>
  );
}

async function postPage(c: C, t: TenantCtx) {
  const slug = c.req.param('slug' as never) as string;
  const [post, pages] = await Promise.all([
    postBySlug(c.env.DB, t.pub.id, slug),
    navPages(c.env.DB, t.pub.id),
  ]);
  if (!post || post.status !== 'published') return c.notFound();
  const origin = new URL(c.req.url).origin;
  return c.html(
    <TenantLayout
      tenant={t}
      pages={pages}
      title={post.title}
      description={post.subtitle || undefined}
      ogImage={post.cover_media_id ? `${origin}${coverUrl(post)}` : undefined}
    >
      <article class="post">
        <h1>{post.title}</h1>
        {post.subtitle ? <p class="post-subtitle">{post.subtitle}</p> : null}
        <div class="byline">
          {t.pub.logo_media_id ? <img src={mediaUrl(t.pub.logo_media_id, 'logo')} alt="" /> : null}
          <span>{t.pub.name}</span>
          {post.published_at ? (
            <>
              <span class="dot">·</span>
              <time>{formatDate(post.published_at)}</time>
            </>
          ) : null}
        </div>
        {coverUrl(post) ? <img class="post-cover" src={coverUrl(post)!} alt="" /> : null}
        <div class="post-body" dangerouslySetInnerHTML={{ __html: post.body_html }} />
      </article>
    </TenantLayout>
  );
}

async function aboutPage(c: C, t: TenantCtx) {
  const pages = await navPages(c.env.DB, t.pub.id);
  return c.html(
    <TenantLayout tenant={t} pages={pages} title="O nama">
      <article class="post">
        <h1>O nama</h1>
        <div class="post-body" dangerouslySetInnerHTML={{ __html: t.pub.about_html }} />
      </article>
    </TenantLayout>
  );
}

function rfc822(iso: string | null): string {
  return new Date(iso ?? Date.now()).toUTCString();
}

async function feedXml(c: C, t: TenantCtx) {
  const posts = await publishedPosts(c.env.DB, t.pub.id, 20);
  const origin = new URL(c.req.url).origin;
  const absolutize = (html: string) => html.replaceAll('src="/media/', `src="${origin}/media/`);
  const items = posts
    .map(
      (p) => `  <item>
    <title>${escapeHtml(p.title)}</title>
    <link>${t.absBase}/p/${p.slug}</link>
    <guid isPermaLink="true">${t.absBase}/p/${p.slug}</guid>
    <pubDate>${rfc822(p.published_at)}</pubDate>
    ${p.subtitle ? `<description>${escapeHtml(p.subtitle)}</description>` : ''}
    <content:encoded><![CDATA[${absolutize(p.body_html)}]]></content:encoded>
  </item>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${escapeHtml(t.pub.name)}</title>
  <link>${t.absBase}/</link>
  <description>${escapeHtml(t.pub.tagline)}</description>
  <language>${t.pub.locale}</language>
${items}
</channel>
</rss>`;
  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
}

async function sitemapXml(c: C, t: TenantCtx) {
  const posts = await c.env.DB.prepare(
    "SELECT slug, kind, updated_at FROM posts WHERE publication_id = ? AND status = 'published' ORDER BY published_at DESC LIMIT 5000"
  )
    .bind(t.pub.id)
    .all<{ slug: string; kind: string; updated_at: string }>();
  const urls = [
    `${t.absBase}/`,
    `${t.absBase}/archive`,
    `${t.absBase}/about`,
    ...posts.results.map((p) => `${t.absBase}/p/${p.slug}`),
  ]
    .map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
}

async function flashPage(c: C, t: TenantCtx, kind: 'ok' | 'err', message: string) {
  const pages = await navPages(c.env.DB, t.pub.id);
  return c.html(
    <TenantLayout tenant={t} pages={pages} title={t.pub.name}>
      <Flash kind={kind}>{message}</Flash>
      <p class="more">
        <a href={`${t.base}/`}>← Natrag na naslovnicu</a>
      </p>
    </TenantLayout>
  );
}

async function subscribePost(c: C, t: TenantCtx) {
  const body = await c.req.parseBody();
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return flashPage(c, t, 'err', 'Neispravna email adresa.');
  }
  const db = c.env.DB;
  const existing = await db
    .prepare('SELECT * FROM subscribers WHERE publication_id = ? AND email = ?')
    .bind(t.pub.id, email)
    .first<{ id: string; status: string }>();
  const useOptIn = emailEnabled(c.env);
  const confirmToken = newToken();

  if (existing && existing.status === 'confirmed') {
    return flashPage(c, t, 'ok', 'Već ste pretplaćeni. Hvala!');
  }
  if (existing) {
    await db
      .prepare("UPDATE subscribers SET status = ?, confirm_token = ?, confirmed_at = CASE WHEN ? = 'confirmed' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE confirmed_at END WHERE id = ?")
      .bind(useOptIn ? 'pending' : 'confirmed', useOptIn ? confirmToken : null, useOptIn ? 'pending' : 'confirmed', existing.id)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO subscribers (id, publication_id, email, status, confirm_token, unsubscribe_token, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 'confirmed' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END)"
      )
      .bind(
        newId(),
        t.pub.id,
        email,
        useOptIn ? 'pending' : 'confirmed',
        useOptIn ? confirmToken : null,
        newToken(),
        useOptIn ? 'pending' : 'confirmed'
      )
      .run();
  }

  if (useOptIn) {
    const link = `${t.absBase}/confirm/${confirmToken}`;
    await sendEmail(
      c.env,
      email,
      `Potvrdite pretplatu — ${t.pub.name}`,
      `<p>Pozdrav,</p><p>kliknite za potvrdu pretplate na <strong>${escapeHtml(t.pub.name)}</strong>:</p><p><a href="${link}">${link}</a></p>`
    );
    return flashPage(c, t, 'ok', 'Poslali smo vam email s potvrdom pretplate — provjerite sandučić.');
  }
  return flashPage(c, t, 'ok', 'Pretplaćeni ste. Hvala!');
}

async function confirmToken(c: C, t: TenantCtx) {
  const token = c.req.param('token' as never) as string;
  const r = await c.env.DB.prepare(
    "UPDATE subscribers SET status = 'confirmed', confirm_token = NULL, confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE publication_id = ? AND confirm_token = ?"
  )
    .bind(t.pub.id, token)
    .run();
  return flashPage(
    c,
    t,
    r.meta.changes > 0 ? 'ok' : 'err',
    r.meta.changes > 0 ? 'Pretplata potvrđena. Hvala!' : 'Nevažeća ili već iskorištena poveznica.'
  );
}

async function unsubscribeToken(c: C, t: TenantCtx) {
  const token = c.req.param('token' as never) as string;
  const r = await c.env.DB.prepare(
    "UPDATE subscribers SET status = 'unsubscribed' WHERE publication_id = ? AND unsubscribe_token = ?"
  )
    .bind(t.pub.id, token)
    .run();
  return flashPage(
    c,
    t,
    r.meta.changes > 0 ? 'ok' : 'err',
    r.meta.changes > 0 ? 'Odjavljeni ste s pretplate.' : 'Nevažeća poveznica.'
  );
}

type Handler = (c: C, t: TenantCtx) => Promise<Response>;

const routes: Array<['get' | 'post', string, Handler]> = [
  ['get', '/', homePage],
  ['get', '/archive', archivePage],
  ['get', '/p/:slug', postPage],
  ['get', '/about', aboutPage],
  ['get', '/feed.xml', feedXml],
  ['get', '/sitemap.xml', sitemapXml],
  ['post', '/subscribe', subscribePost],
  ['get', '/confirm/:token', confirmToken],
  ['get', '/unsubscribe/:token', unsubscribeToken],
];

/** Registrira tenant rute; handler pada na next() kad tenant nije razriješen. */
export function registerTenantRoutes(app: Hono<AppEnv>) {
  const wrap = (fn: Handler) => async (c: C, next: Next) => {
    const t = await resolveTenant(c);
    if (!t) return next();
    return fn(c, t);
  };
  // Hono ne podržava parcijalne segmente ('/@:param'), pa '@' ulazi u regex parametra.
  const seg = '/:pubslug{@[a-z0-9-]+}';
  for (const [method, path, fn] of routes) {
    // host mode (subdomena / custom domena): rute na korijenu
    app[method](path, wrap(fn));
    // path mode: /@slug prefiks — radi na workers.dev i lokalno
    app[method](path === '/' ? seg : `${seg}${path}`, wrap(fn));
  }
}
