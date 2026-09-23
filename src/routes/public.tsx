// Javne stranice tenanta. Rute se registriraju dvaput: host mode (subdomena/custom
// domena, prefix '') i path mode ('/@:pubslug'), s istim handlerima — vidi docs/SPEC.md §3.
// Institucionalne rubrike (Tekstovi, Aktivnosti, Video, Projekti, O nama, stranice na /:slug)
// opisane su u docs/PLAN-tehnoetika-site.md.
import type { Context, Hono, Next } from 'hono';
import {
  categoriesForPub,
  categoryBySlug,
  featuredPosts,
  mediaById,
  navItems,
  navPages,
  pageBySlug,
  postBySlug,
  publishedAllTypes,
  publishedEvents,
  publishedPostCount,
  publishedPostCountByCategory,
  publishedPosts,
  publishedPostsByCategory,
  pubBySlug,
  newId,
  newToken,
  type Bindings,
  type Media,
  type Post,
} from '../db';
import { emailEnabled, sendEmail } from '../email';
import { eventBadge, eventIcs, formatEventWhen, zagrebNowLocal } from '../events';
import { escapeHtml, youtubeEmbedHtml, youtubeId } from '../markdown';
import {
  Flash,
  LatestItem,
  PostCard,
  SubscribeForm,
  TenantLayout,
  formatDate,
  mediaUrl,
  postHref,
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

export const PROJECT_STATUS: Record<string, string> = {
  active: 'U tijeku',
  planned: 'U pripremi',
  done: 'Završen',
};

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

/** Sličica videa: naslovna slika, inače YouTube thumbnail. */
function videoThumb(post: Post): string | null {
  const cover = coverUrl(post);
  if (cover) return cover;
  const id = post.video_source !== 'r2' ? youtubeId(post.video_url) : null;
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

function layoutProps(t: TenantCtx) {
  return { tenant: t, pages: t.pages ?? [] };
}

// --- Kartice po tipu sadržaja ---

const EventCard = ({ t, post, past }: { t: TenantCtx; post: Post; past?: boolean }) => {
  const badge = eventBadge(post.event_start);
  return (
    <article class={`event-card${past ? ' is-past' : ''}`}>
      {badge ? (
        <div class="event-date" aria-hidden="true">
          <span class="event-day">{badge.day}</span>
          <span class="event-month">{badge.month}</span>
        </div>
      ) : null}
      <div class="event-text">
        <h3>
          <a href={`${t.base}/p/${post.slug}`}>{post.title}</a>
        </h3>
        <p class="event-meta">
          {formatEventWhen(post.event_start, post.event_end)}
          {post.event_location ? <> · {post.event_location}</> : null}
        </p>
        {post.subtitle ? <p class="post-card-subtitle">{post.subtitle}</p> : null}
        {past && post.body_md.trim() ? (
          <a class="event-note-link" href={`${t.base}/p/${post.slug}`}>
            Bilješka s aktivnosti →
          </a>
        ) : null}
      </div>
    </article>
  );
};

const VideoCard = ({ t, post }: { t: TenantCtx; post: Post }) => {
  const thumb = videoThumb(post);
  return (
    <article class="video-card">
      <a class="video-thumb" href={`${t.base}/p/${post.slug}`}>
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span class="video-thumb-empty" />}
        <span class="play" aria-hidden="true">▶</span>
      </a>
      <h3>
        <a href={`${t.base}/p/${post.slug}`}>{post.title}</a>
      </h3>
      <time>{formatDate(post.published_at)}</time>
    </article>
  );
};

const ProjectCard = ({ t, post }: { t: TenantCtx; post: Post }) => (
  <article class="project-card">
    {coverUrl(post) ? (
      <a href={`${t.base}/p/${post.slug}`}>
        <img class="project-cover" src={coverUrl(post)!} alt="" loading="lazy" />
      </a>
    ) : null}
    <div class="project-text">
      {post.project_status && PROJECT_STATUS[post.project_status] ? (
        <span class={`project-status status-${post.project_status}`}>{PROJECT_STATUS[post.project_status]}</span>
      ) : null}
      <h3>
        <a href={`${t.base}/p/${post.slug}`}>{post.title}</a>
      </h3>
      {post.subtitle ? <p class="post-card-subtitle">{post.subtitle}</p> : null}
      {post.link_url ? (
        <a class="project-link" href={post.link_url} rel="noopener" target="_blank">
          Posjeti projekt ↗
        </a>
      ) : null}
    </div>
  </article>
);

const Pagination = ({ href, page, lastPage }: { href: (p: number) => string; page: number; lastPage: number }) =>
  lastPage > 1 ? (
    <nav class="pagination">
      {page > 1 ? <a href={href(page - 1)}>← Novije</a> : <span />}
      <span>
        {page} / {lastPage}
      </span>
      {page < lastPage ? <a href={href(page + 1)}>Starije →</a> : <span />}
    </nav>
  ) : null;

// --- Naslovnica ---

async function homePage(c: C, t: TenantCtx) {
  return t.pub.home_layout === 'institution' ? institutionHome(c, t) : blogHome(c, t);
}

async function blogHome(c: C, t: TenantCtx) {
  const cats = t.categories ?? [];
  const [posts, sectionResults] = await Promise.all([
    publishedPosts(c.env.DB, t.pub.id, 11),
    // Za svaku rubriku dohvati najnovija 4 posta (paralelno).
    Promise.all(cats.map((cat) => publishedPostsByCategory(c.env.DB, t.pub.id, cat.id, 4))),
  ]);
  const [hero, ...rest] = posts;
  const latest = rest.slice(0, 7);
  // Sekcije: rubrike koje imaju objava (First Things stil).
  const sections = cats
    .map((cat, i) => ({ cat, posts: sectionResults[i] }))
    .filter((s) => s.posts.length > 0);
  return c.html(
    <TenantLayout {...layoutProps(t)} canonical={`${t.absBase}/`}>
      {hero ? (
        <>
          <div class="home">
            <article class="hero">
              {coverUrl(hero) ? <img class="hero-cover" src={coverUrl(hero)!} alt="" /> : null}
              <h2>
                <a href={`${t.base}/p/${hero.slug}`}>{hero.title}</a>
              </h2>
              {hero.subtitle ? <p class="hero-subtitle">{hero.subtitle}</p> : null}
              <time>{formatDate(hero.published_at)}</time>
            </article>
            {latest.length > 0 ? (
              <aside class="home-latest">
                <h2 class="section-label">Najnovije</h2>
                <ol class="latest">
                  {latest.map((p) => (
                    <LatestItem tenant={t} post={p} />
                  ))}
                </ol>
                {posts.length > 8 ? (
                  <p class="more">
                    <a href={`${t.base}/tekstovi`}>Cijela arhiva →</a>
                  </p>
                ) : null}
              </aside>
            ) : null}
          </div>
          {sections.map((s) => (
            <section class="home-section">
              <h2 class="section-label">
                <a href={`${t.base}/kategorija/${s.cat.slug}`}>{s.cat.name}</a>
              </h2>
              <div class="section-grid">
                {s.posts.map((p) => (
                  <PostCard tenant={t} post={p} coverUrl={coverUrl(p)} />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : (
        <p class="empty">Još nema objava.</p>
      )}
    </TenantLayout>
  );
}

/**
 * Institucionalna naslovnica (PLAN §3 Faza 3): uvod → istaknuto (npr. Deklaracija) →
 * najnoviji tekstovi → nadolazeće aktivnosti → zadnji video → projekti.
 */
async function institutionHome(c: C, t: TenantCtx) {
  const db = c.env.DB;
  const [featured, texts, events, videos, projects] = await Promise.all([
    featuredPosts(db, t.pub.id),
    publishedPosts(db, t.pub.id, 3, 0, 'text'),
    publishedEvents(db, t.pub.id, 'upcoming', zagrebNowLocal(), 3),
    publishedPosts(db, t.pub.id, 2, 0, 'video'),
    publishedPosts(db, t.pub.id, 3, 0, 'project'),
  ]);
  // Uvod: prva dva odlomka iz "O nama" (cijeli tekst je na /o-nama).
  const paras = t.pub.about_html.match(/<p>[\s\S]*?<\/p>/g) ?? [];
  const intro = paras.slice(0, 2).join('');
  const introMore = paras.length > 2 || /<(figure|h\d|ul|ol|blockquote)/.test(t.pub.about_html);
  const empty = !featured.length && !texts.length && !events.length && !videos.length && !projects.length;
  return c.html(
    <TenantLayout {...layoutProps(t)} canonical={`${t.absBase}/`}>
      {intro ? (
        <section class="inst-intro">
          <div class="post-body" dangerouslySetInnerHTML={{ __html: intro }} />
          {introMore ? (
            <p class="more">
              <a href={`${t.base}/o-nama`}>Više o nama →</a>
            </p>
          ) : null}
        </section>
      ) : null}

      {featured.map((f) => (
        <section class="inst-featured">
          <span class="kicker">Istaknuto</span>
          <h2>
            <a href={postHref(t.base, f)}>{f.title}</a>
          </h2>
          {f.subtitle ? <p class="hero-subtitle">{f.subtitle}</p> : null}
          <p class="inst-featured-actions">
            <a class="btn" href={postHref(t.base, f)}>
              Pročitaj
            </a>
            {f.attachment_media_id ? (
              <a class="btn btn-ghost" href={`/media/${f.attachment_media_id}/dokument.pdf?download=1`}>
                Preuzmi PDF
              </a>
            ) : null}
          </p>
        </section>
      ))}

      <div class="inst-grid">
        {texts.length ? (
          <section class="home-section inst-texts">
            <h2 class="section-label">
              <a href={`${t.base}/tekstovi`}>Tekstovi</a>
            </h2>
            <div class="post-list">
              {texts.map((p) => (
                <PostCard tenant={t} post={p} coverUrl={coverUrl(p)} />
              ))}
            </div>
            <p class="more">
              <a href={`${t.base}/tekstovi`}>Svi tekstovi →</a>
            </p>
          </section>
        ) : null}

        <section class="home-section inst-events">
          <h2 class="section-label">
            <a href={`${t.base}/aktivnosti`}>Nadolazeće aktivnosti</a>
          </h2>
          {events.length ? (
            events.map((e) => <EventCard t={t} post={e} />)
          ) : (
            <p class="muted-note">Trenutno nema najavljenih aktivnosti.</p>
          )}
          <p class="more">
            <a href={`${t.base}/aktivnosti`}>Sve aktivnosti →</a>
          </p>
        </section>
      </div>

      {videos.length ? (
        <section class="home-section">
          <h2 class="section-label">
            <a href={`${t.base}/video`}>Video materijali</a>
          </h2>
          <div class="video-grid">
            {videos.map((v) => (
              <VideoCard t={t} post={v} />
            ))}
          </div>
        </section>
      ) : null}

      {projects.length ? (
        <section class="home-section">
          <h2 class="section-label">
            <a href={`${t.base}/projekti`}>Projekti</a>
          </h2>
          <div class="project-grid">
            {projects.map((p) => (
              <ProjectCard t={t} post={p} />
            ))}
          </div>
        </section>
      ) : null}

      {empty && !intro ? <p class="empty">Stranica je u pripremi.</p> : null}
    </TenantLayout>
  );
}

// --- Rubrike sadržaja ---

async function textsPage(c: C, t: TenantCtx) {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const catSlug = c.req.query('rubrika') ?? '';
  const cat = catSlug ? await categoryBySlug(c.env.DB, t.pub.id, catSlug) : null;
  const [posts, total] = cat
    ? await Promise.all([
        publishedPostsByCategory(c.env.DB, t.pub.id, cat.id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
        publishedPostCountByCategory(c.env.DB, t.pub.id, cat.id),
      ])
    : await Promise.all([
        publishedPosts(c.env.DB, t.pub.id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
        publishedPostCount(c.env.DB, t.pub.id),
      ]);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cats = t.categories ?? [];
  const q = (p: number) => `${t.base}/tekstovi?${cat ? `rubrika=${cat.slug}&` : ''}page=${p}`;
  return c.html(
    <TenantLayout {...layoutProps(t)} title="Tekstovi" canonical={`${t.absBase}/tekstovi`}>
      <div class="reading-col">
        <h1 class="page-title">Tekstovi</h1>
        {cats.length ? (
          <nav class="chips" aria-label="Rubrike">
            <a class={cat ? '' : 'active'} href={`${t.base}/tekstovi`}>
              Sve
            </a>
            {cats.map((ct) => (
              <a class={cat?.id === ct.id ? 'active' : ''} href={`${t.base}/tekstovi?rubrika=${ct.slug}`}>
                {ct.name}
              </a>
            ))}
          </nav>
        ) : null}
        <section class="post-list">
          {posts.map((p) => (
            <PostCard tenant={t} post={p} coverUrl={coverUrl(p)} />
          ))}
          {posts.length === 0 ? <p class="empty">Još nema tekstova.</p> : null}
        </section>
        <Pagination href={q} page={page} lastPage={lastPage} />
      </div>
    </TenantLayout>
  );
}

async function categoryPage(c: C, t: TenantCtx) {
  const catSlug = c.req.param('catslug' as never) as string;
  const cat = await categoryBySlug(c.env.DB, t.pub.id, catSlug);
  if (!cat) return c.notFound();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const [posts, total] = await Promise.all([
    publishedPostsByCategory(c.env.DB, t.pub.id, cat.id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    publishedPostCountByCategory(c.env.DB, t.pub.id, cat.id),
  ]);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return c.html(
    <TenantLayout {...layoutProps(t)} title={cat.name}>
      <div class="reading-col">
        <h1 class="page-title">{cat.name}</h1>
        <section class="post-list">
          {posts.map((p) => (
            <PostCard tenant={t} post={p} coverUrl={coverUrl(p)} />
          ))}
          {posts.length === 0 ? <p class="empty">Nema objava u ovoj rubrici.</p> : null}
        </section>
        <Pagination href={(p) => `${t.base}/kategorija/${cat.slug}?page=${p}`} page={page} lastPage={lastPage} />
      </div>
    </TenantLayout>
  );
}

async function eventsPage(c: C, t: TenantCtx) {
  const now = zagrebNowLocal();
  const [upcoming, past] = await Promise.all([
    publishedEvents(c.env.DB, t.pub.id, 'upcoming', now),
    publishedEvents(c.env.DB, t.pub.id, 'past', now, 60),
  ]);
  return c.html(
    <TenantLayout {...layoutProps(t)} title="Aktivnosti" canonical={`${t.absBase}/aktivnosti`}>
      <div class="reading-col">
        <h1 class="page-title">Aktivnosti</h1>
        <section class="events">
          <h2 class="section-label">Nadolazeće</h2>
          {upcoming.length ? (
            upcoming.map((e) => <EventCard t={t} post={e} />)
          ) : (
            <p class="muted-note">Trenutno nema najavljenih aktivnosti.</p>
          )}
        </section>
        {past.length ? (
          <section class="events events-past">
            <h2 class="section-label">Održano</h2>
            {past.map((e) => (
              <EventCard t={t} post={e} past />
            ))}
          </section>
        ) : null}
      </div>
    </TenantLayout>
  );
}

async function eventIcsFile(c: C, t: TenantCtx) {
  const slug = (c.req.param('icsfile' as never) as string).replace(/\.ics$/, '');
  const post = await postBySlug(c.env.DB, t.pub.id, slug);
  if (!post || post.status !== 'published' || post.post_type !== 'event' || !post.event_start) return c.notFound();
  const url = `${t.absBase}/p/${post.slug}`;
  return c.body(eventIcs(post, url, new URL(c.req.url).host), 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="${post.slug}.ics"`,
  });
}

async function videosPage(c: C, t: TenantCtx) {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const size = 24;
  const [videos, total] = await Promise.all([
    publishedPosts(c.env.DB, t.pub.id, size, (page - 1) * size, 'video'),
    publishedPostCount(c.env.DB, t.pub.id, 'video'),
  ]);
  return c.html(
    <TenantLayout {...layoutProps(t)} title="Video materijali" canonical={`${t.absBase}/video`}>
      <h1 class="page-title">Video materijali</h1>
      {videos.length ? (
        <div class="video-grid">
          {videos.map((v) => (
            <VideoCard t={t} post={v} />
          ))}
        </div>
      ) : (
        <p class="empty">Još nema video materijala.</p>
      )}
      <Pagination href={(p) => `${t.base}/video?page=${p}`} page={page} lastPage={Math.max(1, Math.ceil(total / size))} />
    </TenantLayout>
  );
}

async function projectsPage(c: C, t: TenantCtx) {
  const projects = await publishedPosts(c.env.DB, t.pub.id, 100, 0, 'project');
  // Aktivni i planirani prije završenih.
  const order: Record<string, number> = { active: 0, planned: 1, done: 2 };
  projects.sort((a, b) => (order[a.project_status ?? ''] ?? 1) - (order[b.project_status ?? ''] ?? 1));
  return c.html(
    <TenantLayout {...layoutProps(t)} title="Projekti" canonical={`${t.absBase}/projekti`}>
      <h1 class="page-title">Projekti</h1>
      {projects.length ? (
        <div class="project-grid">
          {projects.map((p) => (
            <ProjectCard t={t} post={p} />
          ))}
        </div>
      ) : (
        <p class="empty">Još nema projekata.</p>
      )}
    </TenantLayout>
  );
}

async function aboutPage(c: C, t: TenantCtx) {
  return c.html(
    <TenantLayout {...layoutProps(t)} title="O nama" canonical={`${t.absBase}/o-nama`}>
      <article class="post reading-col">
        <h1>O nama</h1>
        <div class="post-body" dangerouslySetInnerHTML={{ __html: t.pub.about_html }} />
      </article>
    </TenantLayout>
  );
}

// --- Pojedinačna objava / stranica ---

const Attachment = ({ m }: { m: Media }) => {
  const url = mediaUrl(m.id, m.filename);
  return (
    <aside class="attachment">
      <span class="attachment-icon" aria-hidden="true">
        PDF
      </span>
      <div>
        <strong>{m.filename}</strong>
        <span class="muted"> · {(m.byte_size / 1024 / 1024).toFixed(1).replace('.', ',')} MB</span>
        <p>
          <a class="btn" href={`${url}?download=1`}>
            Preuzmi
          </a>{' '}
          <a href={url} target="_blank" rel="noopener">
            Otvori u pregledniku
          </a>
        </p>
      </div>
    </aside>
  );
};

function videoPlayer(post: Post): string | null {
  if (post.video_source === 'r2' && post.video_url && /^\/media\/[\w-]+\/\S+$/.test(post.video_url)) {
    const esc = escapeHtml(post.video_url);
    return `<div class="embed-video"><video controls preload="metadata" src="${esc}"></video></div>`;
  }
  const id = youtubeId(post.video_url);
  return id ? youtubeEmbedHtml(id) : null;
}

async function renderPost(c: C, t: TenantCtx, post: Post) {
  const att = post.attachment_media_id ? await mediaById(c.env.DB, post.attachment_media_id) : null;
  const attachment = att && att.publication_id === post.publication_id ? att : null;
  const origin = new URL(c.req.url).origin;
  const isPage = post.kind === 'page';
  const type = isPage ? 'page' : post.post_type;
  const past = type === 'event' && (post.event_end ?? post.event_start ?? '') < zagrebNowLocal();
  const player = type === 'video' ? videoPlayer(post) : null;
  const og = post.cover_media_id ? `${origin}${coverUrl(post)}` : type === 'video' ? (videoThumb(post) ?? undefined) : undefined;
  const typeLabel: Record<string, [string, string]> = {
    event: [past ? 'Održana aktivnost' : 'Najava aktivnosti', '/aktivnosti'],
    video: ['Video', '/video'],
    project: ['Projekt', '/projekti'],
  };
  const kicker = typeLabel[type];
  return c.html(
    <TenantLayout
      {...layoutProps(t)}
      title={post.title}
      description={post.subtitle || undefined}
      ogImage={og}
      canonical={`${t.absBase}${postHref('', post)}`}
    >
      <article class={`post reading-col post-type-${type}`}>
        {kicker ? (
          <a class="kicker" href={`${t.base}${kicker[1]}`}>
            {kicker[0]}
          </a>
        ) : null}
        <h1>{post.title}</h1>
        {post.subtitle ? <p class="post-subtitle">{post.subtitle}</p> : null}
        {!isPage ? (
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
        ) : null}

        {type === 'event' ? (
          <aside class="event-box">
            <p>
              <strong>Kada:</strong> {formatEventWhen(post.event_start, post.event_end)}
            </p>
            {post.event_location ? (
              <p>
                <strong>Gdje:</strong> {post.event_location}
              </p>
            ) : null}
            <p class="event-actions">
              {!past && post.event_start ? (
                <a class="btn" href={`${t.base}/aktivnosti/${post.slug}.ics`}>
                  Dodaj u kalendar
                </a>
              ) : null}
              {post.link_url ? (
                <a href={post.link_url} rel="noopener" target="_blank">
                  Više informacija ↗
                </a>
              ) : null}
            </p>
            {past && post.body_md.trim() ? <p class="event-past-note">Bilješka o održanoj aktivnosti</p> : null}
          </aside>
        ) : null}

        {type === 'project' && (post.project_status || post.link_url) ? (
          <aside class="event-box">
            {post.project_status && PROJECT_STATUS[post.project_status] ? (
              <p>
                <strong>Status:</strong> {PROJECT_STATUS[post.project_status]}
              </p>
            ) : null}
            {post.link_url ? (
              <p>
                <a class="btn" href={post.link_url} rel="noopener" target="_blank">
                  Posjeti projekt ↗
                </a>
              </p>
            ) : null}
          </aside>
        ) : null}

        {player ? <div class="video-player" dangerouslySetInnerHTML={{ __html: player }} /> : null}
        {!player && coverUrl(post) ? <img class="post-cover" src={coverUrl(post)!} alt="" /> : null}
        <div class="post-body" dangerouslySetInnerHTML={{ __html: post.body_html }} />
        {attachment ? <Attachment m={attachment} /> : null}
      </article>
    </TenantLayout>
  );
}

async function postPage(c: C, t: TenantCtx) {
  const slug = c.req.param('slug' as never) as string;
  const post = await postBySlug(c.env.DB, t.pub.id, slug);
  if (!post || post.status !== 'published') return c.notFound();
  // Stranice imaju lijepi URL (/deklaracija) — stari /p/ link preusmjeri.
  const pretty = postHref(t.base, post);
  if (post.kind === 'page' && pretty !== `${t.base}/p/${post.slug}`) return c.redirect(pretty, 301);
  return renderPost(c, t, post);
}

/** Catch-all /:slug za stranice; kad stranice nema, prepušta dalje (platformske rute, 404). */
async function prettyPage(c: C, t: TenantCtx, next: Next) {
  const slug = c.req.param('pageslug' as never) as string;
  const post = await pageBySlug(c.env.DB, t.pub.id, slug);
  if (!post) {
    await next();
    return c.res;
  }
  return renderPost(c, t, post);
}

// --- Stari URL-ovi → novi (301) ---

async function archiveRedirect(c: C, t: TenantCtx) {
  const page = c.req.query('page');
  return c.redirect(`${t.base}/tekstovi${page ? `?page=${encodeURIComponent(page)}` : ''}`, 301);
}

async function aboutRedirect(c: C, t: TenantCtx) {
  return c.redirect(`${t.base}/o-nama`, 301);
}

// --- Feed, sitemap, robots ---

function rfc822(iso: string | null): string {
  return new Date(iso ?? Date.now()).toUTCString();
}

async function feedXml(c: C, t: TenantCtx) {
  const posts = await publishedAllTypes(c.env.DB, t.pub.id, 20);
  const origin = new URL(c.req.url).origin;
  const absolutize = (html: string) => html.replaceAll('src="/media/', `src="${origin}/media/`);
  const items = posts
    .map((p) => {
      const lead =
        p.post_type === 'event' && p.event_start
          ? `<p><strong>${escapeHtml(formatEventWhen(p.event_start, p.event_end))}</strong>${p.event_location ? ` · ${escapeHtml(p.event_location)}` : ''}</p>`
          : p.post_type === 'video' && p.video_url
            ? `<p><a href="${escapeHtml(p.video_url)}">${escapeHtml(p.video_url)}</a></p>`
            : '';
      return `  <item>
    <title>${escapeHtml(p.title)}</title>
    <link>${t.absBase}/p/${p.slug}</link>
    <guid isPermaLink="true">${t.absBase}/p/${p.slug}</guid>
    <pubDate>${rfc822(p.published_at)}</pubDate>
    ${p.subtitle ? `<description>${escapeHtml(p.subtitle)}</description>` : ''}
    <content:encoded><![CDATA[${(lead + absolutize(p.body_html)).replaceAll(']]>', ']]]]><![CDATA[>')}]]></content:encoded>
  </item>`;
    })
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
    .all<{ slug: string; kind: 'post' | 'page'; updated_at: string }>();
  const sections = ['/', '/tekstovi', '/aktivnosti', '/video', '/projekti', '/o-nama'];
  const urls = [
    ...sections.map((s) => `  <url><loc>${escapeHtml(t.absBase + s)}</loc></url>`),
    ...posts.results.map(
      (p) =>
        `  <url><loc>${escapeHtml(t.absBase + postHref('', p))}</loc><lastmod>${escapeHtml(p.updated_at.slice(0, 10))}</lastmod></url>`
    ),
  ].join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
}

async function robotsTxt(c: C, t: TenantCtx) {
  return c.text(`User-agent: *\nAllow: /\nDisallow: /subscribe\n\nSitemap: ${t.absBase}/sitemap.xml\n`);
}

async function flashPage(c: C, t: TenantCtx, kind: 'ok' | 'err', message: string) {
  
  return c.html(
    <TenantLayout {...layoutProps(t)} title={t.pub.name}>
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

type Handler = (c: C, t: TenantCtx, next: Next) => Promise<Response>;

const routes: Array<['get' | 'post', string, Handler]> = [
  ['get', '/', homePage],
  ['get', '/tekstovi', textsPage],
  ['get', '/aktivnosti', eventsPage],
  ['get', '/aktivnosti/:icsfile{[a-z0-9-]+\\.ics}', eventIcsFile],
  ['get', '/video', videosPage],
  ['get', '/projekti', projectsPage],
  ['get', '/o-nama', aboutPage],
  ['get', '/archive', archiveRedirect],
  ['get', '/about', aboutRedirect],
  ['get', '/kategorija/:catslug', categoryPage],
  ['get', '/p/:slug', postPage],
  ['get', '/feed.xml', feedXml],
  ['get', '/sitemap.xml', sitemapXml],
  ['get', '/robots.txt', robotsTxt],
  ['post', '/subscribe', subscribePost],
  ['get', '/confirm/:token', confirmToken],
  ['get', '/unsubscribe/:token', unsubscribeToken],
  // Mora biti zadnja: stranice na lijepom URL-u (/deklaracija). Kad stranice nema, ide dalje.
  ['get', '/:pageslug{[a-z0-9][a-z0-9-]*}', prettyPage],
];

/** Registrira tenant rute; handler pada na next() kad tenant nije razriješen. */
export function registerTenantRoutes(app: Hono<AppEnv>) {
  const wrap = (fn: Handler) => async (c: C, next: Next) => {
    const t = await resolveTenant(c);
    if (!t) return next();
    // Rubrike, izbornik i prikvačene stranice (jedan krug upita po tenant-stranici).
    [t.categories, t.nav, t.pages] = await Promise.all([
      categoriesForPub(c.env.DB, t.pub.id),
      navItems(c.env.DB, t.pub.id),
      navPages(c.env.DB, t.pub.id),
    ]);
    return fn(c, t, next);
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
