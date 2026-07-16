import type { Child, FC } from 'hono/jsx';
import type { Category, Post, Publication, User } from '../db';

export type TenantCtx = {
  pub: Publication;
  /** Prefiks linkova unutar tenanta: '' (subdomena/custom domena) ili '/@slug' (path mode) */
  base: string;
  /** Apsolutna baza za RSS/OG/emails, npr. https://tehnoetika.example.com ili https://app.hr/@tehnoetika */
  absBase: string;
  /** Rubrike publikacije (za navigaciju) — popunjava se u tenant wrap-u. */
  categories?: Category[];
};

export function formatDate(iso: string | null, locale = 'hr-HR'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso)
  );
}

export function mediaUrl(mediaId: string, filename: string): string {
  return `/media/${mediaId}/${encodeURIComponent(filename)}`;
}

const Head: FC<{ title: string; description?: string; ogImage?: string; accent?: string; feedUrl?: string }> = ({
  title,
  description,
  ogImage,
  accent,
  feedUrl,
}) => (
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {description ? <meta name="description" content={description} /> : null}
    <meta property="og:title" content={title} />
    {description ? <meta property="og:description" content={description} /> : null}
    {ogImage ? <meta property="og:image" content={ogImage} /> : null}
    {feedUrl ? <link rel="alternate" type="application/rss+xml" title={title} href={feedUrl} /> : null}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&display=swap"
    />
    <link rel="stylesheet" href="/static/style.css" />
    {accent ? <style>{`:root{--accent:${accent.replace(/[^#a-zA-Z0-9(),.% -]/g, '')}}`}</style> : null}
  </head>
);

export const TenantLayout: FC<{
  tenant: TenantCtx;
  pages: Post[];
  title?: string;
  description?: string;
  ogImage?: string;
  children: Child;
}> = ({ tenant, pages, title, description, ogImage, children }) => {
  const { pub, base } = tenant;
  return (
    <html lang={pub.locale}>
      <Head
        title={title ? `${title} — ${pub.name}` : pub.name}
        description={description ?? pub.tagline}
        ogImage={ogImage}
        accent={pub.accent_color}
        feedUrl={`${base}/feed.xml`}
      />
      <body class="tenant">
        <header class="site-header">
          <a class="site-identity" href={`${base}/`}>
            {pub.logo_media_id ? <img class="site-logo" src={`/media/${pub.logo_media_id}/logo`} alt="" /> : null}
            <span class="site-name">{pub.name}</span>
          </a>
          {pub.tagline ? <p class="site-tagline">{pub.tagline}</p> : null}
          <nav class="site-nav">
            <a href={`${base}/`}>Početna</a>
            {(tenant.categories ?? []).map((cat) => (
              <a href={`${base}/kategorija/${cat.slug}`}>{cat.name}</a>
            ))}
            <a href={`${base}/archive`}>Arhiva</a>
            {pages.map((p) => (
              <a href={`${base}/p/${p.slug}`}>{p.title}</a>
            ))}
            <a href={`${base}/about`}>O nama</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer class="site-footer">
          <SubscribeForm tenant={tenant} />
          <p class="footer-meta">
            <a href={`${base}/feed.xml`}>RSS</a> · Pokreće <a href="/">otvorena platforma</a>
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

export const PostCard: FC<{ tenant: TenantCtx; post: Post; coverUrl?: string | null }> = ({
  tenant,
  post,
  coverUrl,
}) => (
  <article class="post-card">
    <div class="post-card-text">
      <h3>
        <a href={`${tenant.base}/p/${post.slug}`}>{post.title}</a>
      </h3>
      {post.subtitle ? <p class="post-card-subtitle">{post.subtitle}</p> : null}
      <time>{formatDate(post.published_at)}</time>
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
