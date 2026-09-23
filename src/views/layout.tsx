import type { Child, FC } from 'hono/jsx';
import type { Category, NavItem, Post, Publication, User } from '../db';

export type TenantCtx = {
  pub: Publication;
  /** Prefiks linkova unutar tenanta: '' (subdomena/custom domena) ili '/@slug' (path mode) */
  base: string;
  /** Apsolutna baza za RSS/OG/emails, npr. https://tehnoetika.example.com ili https://app.hr/@tehnoetika */
  absBase: string;
  /** Rubrike publikacije (za navigaciju) — popunjava se u tenant wrap-u. */
  categories?: Category[];
  /** Uređeni izbornik; prazan = automatski izbornik. */
  nav?: NavItem[];
  /** Stranice (kind = 'page') prikvačene u izbornik. */
  pages?: Post[];
};

/** Putanje koje zauzimaju javne rute — stranica s takvim slugom ostaje na /p/:slug. */
export const TENANT_RESERVED = [
  'p', 'tekstovi', 'aktivnosti', 'video', 'projekti', 'o-nama', 'kategorija', 'archive', 'about',
  'feed.xml', 'sitemap.xml', 'robots.txt', 'subscribe', 'confirm', 'unsubscribe', 'media', 'api',
  'static', 'dashboard', 'auth', 'prijava',
];

/** URL objave/stranice: stranice dobivaju lijepi /:slug, sve ostalo /p/:slug. */
export function postHref(base: string, post: Pick<Post, 'slug' | 'kind'>): string {
  return post.kind === 'page' && !TENANT_RESERVED.includes(post.slug) ? `${base}/${post.slug}` : `${base}/p/${post.slug}`;
}

/** Tipografski preseti publikacije: Google Fonts upit + CSS varijable. */
export const FONT_PRESETS: Record<string, { label: string; query: string; body: string; display: string }> = {
  lora: {
    label: 'Lora + Spectral (klasični esej)',
    query: 'family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Spectral:ital,wght@0,400;0,500;0,600;1,400',
    body: "'Lora'",
    display: "'Spectral', 'Lora'",
  },
  playfair: {
    label: 'Source Serif + Playfair Display (svečano)',
    query: 'family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Playfair+Display:ital,wght@0,500;0,600;1,500',
    body: "'Source Serif 4'",
    display: "'Playfair Display'",
  },
  newsreader: {
    label: 'Newsreader + Inter (moderno)',
    query: 'family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Inter:wght@500;600;700',
    body: "'Newsreader'",
    display: "'Inter'",
  },
};

export const TEXT_SIZES: Record<string, { label: string; size: string }> = {
  s: { label: 'Manji', size: '1.12rem' },
  m: { label: 'Srednji', size: '1.25rem' },
  l: { label: 'Veći', size: '1.38rem' },
};

function fontStyle(pub: Publication): string {
  const preset = FONT_PRESETS[pub.font_preset] ?? FONT_PRESETS.lora;
  const size = (TEXT_SIZES[pub.text_size] ?? TEXT_SIZES.m).size;
  return `:root{--serif:${preset.body},Georgia,'Times New Roman',serif;--serif-display:${preset.display},Georgia,serif;--body-size:${size}}`;
}

/** Link unutar publikacije ('/aktivnosti' → base + putanja) ili vanjski URL. */
export function navHref(base: string, target: string): string {
  if (/^https?:\/\//.test(target)) return target;
  const path = target.startsWith('/') ? target : `/${target}`;
  return path === '/' ? `${base}/` : `${base}${path}`;
}

export function formatDate(iso: string | null, locale = 'hr-HR'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso)
  );
}

export function mediaUrl(mediaId: string, filename: string): string {
  return `/media/${mediaId}/${encodeURIComponent(filename)}`;
}

const Head: FC<{
  title: string;
  description?: string;
  ogImage?: string;
  accent?: string;
  feedUrl?: string;
  fontQuery?: string;
  extraStyle?: string;
  canonical?: string;
}> = ({ title, description, ogImage, accent, feedUrl, fontQuery, extraStyle, canonical }) => (
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {description ? <meta name="description" content={description} /> : null}
    <meta property="og:title" content={title} />
    <meta property="og:type" content="website" />
    {canonical ? <link rel="canonical" href={canonical} /> : null}
    {canonical ? <meta property="og:url" content={canonical} /> : null}
    {ogImage ? <meta name="twitter:card" content="summary_large_image" /> : null}
    {description ? <meta property="og:description" content={description} /> : null}
    {ogImage ? <meta property="og:image" content={ogImage} /> : null}
    {feedUrl ? <link rel="alternate" type="application/rss+xml" title={title} href={feedUrl} /> : null}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
    <link
      rel="stylesheet"
      href={`https://fonts.googleapis.com/css2?${fontQuery ?? FONT_PRESETS.lora.query}&display=swap`}
    />
    <link rel="stylesheet" href="/static/style.css" />
    {accent ? <style>{`:root{--accent:${accent.replace(/[^#a-zA-Z0-9(),.% -]/g, '')}}`}</style> : null}
    {/* Samo vrijednosti iz FONT_PRESETS/TEXT_SIZES (bez korisničkog unosa) — sirovo, jer JSX escapea navodnike. */}
    {extraStyle ? <style dangerouslySetInnerHTML={{ __html: extraStyle }} /> : null}
  </head>
);

export const TenantLayout: FC<{
  tenant: TenantCtx;
  pages: Post[];
  title?: string;
  description?: string;
  ogImage?: string;
  canonical?: string;
  children: Child;
}> = ({ tenant, pages, title, description, ogImage, canonical, children }) => {
  const { pub, base } = tenant;
  const nav = (tenant.nav ?? []).filter((n) => n.visible);
  return (
    <html lang={pub.locale}>
      <Head
        title={title ? `${title} — ${pub.name}` : pub.name}
        description={description ?? pub.tagline}
        ogImage={ogImage ?? (pub.logo_media_id ? `${tenant.absBase.replace(/\/@[^/]+$/, '')}/media/${pub.logo_media_id}/logo` : undefined)}
        accent={pub.accent_color}
        feedUrl={`${base}/feed.xml`}
        fontQuery={(FONT_PRESETS[pub.font_preset] ?? FONT_PRESETS.lora).query}
        extraStyle={fontStyle(pub)}
        canonical={canonical}
      />
      <body class={`tenant layout-${pub.home_layout}`}>
        <header class="site-header">
          <a class="site-identity" href={`${base}/`}>
            {pub.logo_media_id ? <img class="site-logo" src={`/media/${pub.logo_media_id}/logo`} alt="" /> : null}
            <span class="site-name">{pub.name}</span>
          </a>
          {pub.tagline ? <p class="site-tagline">{pub.tagline}</p> : null}
          <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-hidden="true" />
          <label for="nav-toggle" class="nav-toggle-label">
            <span aria-hidden="true">☰</span> Izbornik
          </label>
          <nav class="site-nav" aria-label="Glavni izbornik">
            {nav.length > 0 ? (
              nav.map((n) =>
                /^https?:\/\//.test(n.target) ? (
                  <a href={n.target} rel="noopener" target="_blank">
                    {n.label}
                  </a>
                ) : (
                  <a href={navHref(base, n.target)}>{n.label}</a>
                )
              )
            ) : (
              <>
                <a href={`${base}/`}>Početna</a>
                {(tenant.categories ?? []).map((cat) => (
                  <a href={`${base}/kategorija/${cat.slug}`}>{cat.name}</a>
                ))}
                <a href={`${base}/tekstovi`}>Arhiva</a>
                {pages.map((p) => (
                  <a href={postHref(base, p)}>{p.title}</a>
                ))}
                <a href={`${base}/o-nama`}>O nama</a>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
        <footer class="site-footer">
          <SubscribeForm tenant={tenant} />
          {pub.footer_html ? <div class="footer-info" dangerouslySetInnerHTML={{ __html: pub.footer_html }} /> : null}
          <p class="footer-meta">
            <a href={`${base}/feed.xml`}>RSS</a> · Pokreće <a href="https://tehnoetika.com/">otvorena platforma</a>
          </p>
        </footer>
      </body>
    </html>
  );
};

export const SubscribeForm: FC<{ tenant: TenantCtx }> = ({ tenant }) => (
  <form class="subscribe" method="post" action={`${tenant.base}/subscribe`}>
    <p class="subscribe-lead">Pretplatite se na {tenant.pub.name}</p>
    <div class="subscribe-row">
      <input type="email" name="email" required placeholder="vasa@adresa.hr" />
      <button type="submit">Pretplati se</button>
    </div>
  </form>
);

export const LatestItem: FC<{ tenant: TenantCtx; post: Post }> = ({ tenant, post }) => (
  <li class="latest-item">
    <a href={`${tenant.base}/p/${post.slug}`}>{post.title}</a>
    <time>{formatDate(post.published_at)}</time>
  </li>
);

export const PostCard: FC<{ tenant: TenantCtx; post: Post; coverUrl?: string | null; meta?: Child }> = ({
  tenant,
  post,
  coverUrl,
  meta,
}) => (
  <article class="post-card">
    <div class="post-card-text">
      <h3>
        <a href={`${tenant.base}/p/${post.slug}`}>{post.title}</a>
      </h3>
      {post.subtitle ? <p class="post-card-subtitle">{post.subtitle}</p> : null}
      {meta ?? <time>{formatDate(post.published_at)}</time>}
    </div>
    {coverUrl ? <img class="post-card-thumb" src={coverUrl} alt="" loading="lazy" /> : null}
  </article>
);

export const PlatformLayout: FC<{ title: string; user?: User | null; children: Child }> = ({
  title,
  user,
  children,
}) => (
  <html lang="hr">
    <Head title={title} />
    <body class="platform">
      <header class="platform-header">
        <a class="brand" href="/">
          Tehnoetika <span>platforma</span>
        </a>
        <nav>
          {user ? (
            <>
              <a href="/dashboard">Nadzorna ploča</a>
              <form method="post" action="/auth/logout" class="inline-form">
                <button class="linklike" type="submit">
                  Odjava ({user.name})
                </button>
              </form>
            </>
          ) : (
            <>
              <a href="/auth/login">Prijava</a>
              <a class="btn" href="/auth/register">
                Registracija
              </a>
            </>
          )}
        </nav>
      </header>
      <main class="platform-main">{children}</main>
      <footer class="platform-footer">
        <p>Open-source platforma za pisanje · Cloudflare Workers + D1 + R2</p>
      </footer>
    </body>
  </html>
);

export const Flash: FC<{ kind?: 'ok' | 'err'; children: Child }> = ({ kind = 'ok', children }) => (
  <p class={`flash flash-${kind}`}>{children}</p>
);
