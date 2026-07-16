// Auth (registracija/prijava) + autorski dashboard: publikacije, postovi, media,
// pretplatnici, postavke. Sve rute rade na apex hostu (platformski dio).
import type { Context, Hono, Next } from 'hono';
import {
  clearLoginFailures,
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  loginRateLimited,
  recordLoginFailure,
  verifyPassword,
} from '../auth';
import {
  allPostsForDashboard,
  categoriesForPub,
  mediaForPub,
  newId,
  postById,
  pubById,
  pubsByOwner,
  subscribersForPub,
  uniqueCategorySlug,
  uniquePostSlug,
  type Category,
  type Media,
  type Post,
  type Publication,
  type User,
} from '../db';
import { renderMarkdown, slugify } from '../markdown';
import { Flash, PlatformLayout, formatDate, mediaUrl } from '../views/layout';
import type { AppEnv } from './public';

type C = Context<AppEnv>;

export const RESERVED_SLUGS = [
  'www', 'app', 'admin', 'api', 'mail', 'assets', 'dashboard', 'static', 'media', 'feed',
  'auth', 'about', 'archive', 'subscribe', 'confirm', 'unsubscribe', 'p', 'sitemap',
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// --- Zajedničke view komponente ---

const AuthForm = ({ mode, error }: { mode: 'login' | 'register'; error?: string }) => (
  <PlatformLayout title={mode === 'login' ? 'Prijava' : 'Registracija'}>
    <div class="card narrow">
      <h1>{mode === 'login' ? 'Prijava' : 'Registracija'}</h1>
      {error ? <Flash kind="err">{error}</Flash> : null}
      <form method="post" action={`/auth/${mode}`}>
        {mode === 'register' ? (
          <label>
            Ime
            <input name="name" required maxlength={80} />
          </label>
        ) : null}
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <label>
          Lozinka
          <input type="password" name="password" required minlength={8} />
        </label>
        <button type="submit">{mode === 'login' ? 'Prijavi se' : 'Registriraj se'}</button>
      </form>
      {mode === 'login' ? (
        <p class="muted">
          <a href="/prijava">Prijava Domovina računom →</a>
        </p>
      ) : null}
      <p class="muted">
        {mode === 'login' ? (
          <>
            Nemate račun? <a href="/auth/register">Registrirajte se</a>
          </>
        ) : (
          <>
            Već imate račun? <a href="/auth/login">Prijavite se</a>
          </>
        )}
      </p>
    </div>
  </PlatformLayout>
);

const DashNav = ({ pub, active }: { pub: Publication; active: string }) => (
  <nav class="dash-nav">
    <a href="/dashboard">← Publikacije</a>
    <strong>{pub.name}</strong>
    {(
      [
        ['posts', 'Objave'],
        ['categories', 'Rubrike'],
        ['media', 'Mediji'],
        ['subscribers', 'Pretplatnici'],
        ['settings', 'Postavke'],
      ] as const
    ).map(([key, label]) => (
      <a class={active === key ? 'active' : ''} href={`/dashboard/${pub.id}/${key}`}>
        {label}
      </a>
    ))}
    <a href={`/@${pub.slug}`} target="_blank">
      Pogledaj stranicu ↗
    </a>
  </nav>
);

// --- Editor forma ---

const PostForm = ({
  pub,
  post,
  media,
  categories,
  error,
}: {
  pub: Publication;
  post?: Post;
  media: Media[];
  categories: Category[];
  error?: string;
}) => {
  const action = post ? `/dashboard/${pub.id}/posts/${post.id}` : `/dashboard/${pub.id}/posts/new`;
  const images = media.filter((m) => m.kind === 'image');
  return (
    <PlatformLayout title={post ? `Uredi: ${post.title}` : 'Nova objava'}>
      <DashNav pub={pub} active="posts" />
      {error ? <Flash kind="err">{error}</Flash> : null}
      <form method="post" action={action} class="editor" data-pub-id={pub.id}>
        <div class="editor-main">
          <input class="editor-title" name="title" placeholder="Naslov" required maxlength={200} value={post?.title ?? ''} />
          <input class="editor-subtitle" name="subtitle" placeholder="Podnaslov (opcionalno)" maxlength={300} value={post?.subtitle ?? ''} />
          <div class="editor-toolbar">
            <button type="button" class="fmt" data-fmt="bold" title="Podebljano (Ctrl+B)"><strong>B</strong></button>
            <button type="button" class="fmt" data-fmt="italic" title="Kurziv (Ctrl+I)"><em>I</em></button>
            <button type="button" class="fmt" data-fmt="h2" title="Naslov">H</button>
            <button type="button" class="fmt" data-fmt="quote" title="Citat">❝</button>
            <button type="button" class="fmt" data-fmt="ul" title="Nabrajanje">☰</button>
            <button type="button" class="fmt" data-fmt="link" title="Poveznica (Ctrl+K)">🔗</button>
            <span class="tb-sep" aria-hidden="true"></span>
            <button type="button" id="btn-upload">📎 Slika/video</button>
            <input type="file" id="file-input" hidden accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm" />
            <button type="button" id="btn-preview">👁 Pregled</button>
            <span id="upload-status" class="muted"></span>
          </div>
          <textarea id="body-md" name="body_md" rows={20} placeholder={'Pišite… označite tekst pa kliknite B/I, ili povucite/zalijepite sliku izravno.\n\nZalijepite YouTube/Vimeo/Facebook link u zaseban red za video embed.'}>
            {post?.body_md ?? ''}
          </textarea>
          <div id="preview" class="post-body preview-pane" hidden></div>
        </div>
        <aside class="editor-side">
          <label>
            Slug (URL)
            <input name="slug" value={post?.slug ?? ''} placeholder="automatski iz naslova" pattern="[a-z0-9-]*" />
          </label>
          <label>
            Vrsta
            <select name="kind">
              <option value="post" selected={(post?.kind ?? 'post') === 'post'}>Objava</option>
              <option value="page" selected={post?.kind === 'page'}>Stranica</option>
            </select>
          </label>
          <label>
            Rubrika
            <select name="category_id">
              <option value="">— bez rubrike —</option>
              {categories.map((cat) => (
                <option value={cat.id} selected={post?.category_id === cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" name="pinned_nav" value="1" checked={Boolean(post?.pinned_nav)} />
            Prikaži u navigaciji (za stranice)
          </label>
          <label>
            Naslovna slika
            <select name="cover_media_id">
              <option value="">— bez slike —</option>
              {images.map((m) => (
                <option value={m.id} selected={post?.cover_media_id === m.id}>
                  {m.filename}
                </option>
              ))}
            </select>
          </label>
          <div class="editor-actions">
            <button type="submit" name="action" value="save">Spremi skicu</button>
            <button type="submit" name="action" value="publish" class="primary">
              {post?.status === 'published' ? 'Ažuriraj objavu' : 'Objavi'}
            </button>
            {post?.status === 'published' ? (
              <button type="submit" name="action" value="unpublish" class="warn">Vrati u skicu</button>
            ) : null}
            {post ? (
              <button type="submit" name="action" value="delete" class="danger" formnovalidate>
                Obriši
              </button>
            ) : null}
          </div>
          {post?.status === 'published' ? (
            <p class="muted">
              Objavljeno: {formatDate(post.published_at)} ·{' '}
              <a href={`/@${pub.slug}/p/${post.slug}`} target="_blank">otvori ↗</a>
            </p>
          ) : null}
        </aside>
      </form>
      <script src="/static/dashboard.js"></script>
    </PlatformLayout>
  );
};

const CategoriesPage = ({
  pub,
  categories,
  user,
}: {
  pub: Publication;
  categories: Category[];
  user?: User | null;
}) => (
  <PlatformLayout title={`Rubrike — ${pub.name}`} user={user}>
    <DashNav pub={pub} active="categories" />
    <div class="list-head">
      <h1>Rubrike</h1>
      <span class="muted">Tematske sekcije za naslovnicu i navigaciju.</span>
    </div>
    <form method="post" action={`/dashboard/${pub.id}/categories`} class="cat-add">
      <input name="name" placeholder="Naziv rubrike (npr. Digitalni nadzor)" required maxlength={60} />
      <button type="submit" class="primary">+ Dodaj</button>
    </form>
    {categories.length === 0 ? (
      <p class="muted">Još nema rubrika. Dodaj prvu iznad — pojavit će se u navigaciji i kao sekcija na naslovnoj.</p>
    ) : (
      <ul class="cat-list">
        {categories.map((cat) => (
          <li>
            <a href={`/@${pub.slug}/kategorija/${cat.slug}`} target="_blank">
              {cat.name}
            </a>
            <code class="muted">/{cat.slug}</code>
            <form
              method="post"
              action={`/dashboard/${pub.id}/categories/${cat.id}/delete`}
              class="inline-form"
            >
              <button type="submit" class="danger">Obriši</button>
            </form>
          </li>
        ))}
      </ul>
    )}
  </PlatformLayout>
);

// --- Registracija ruta ---

export function registerPlatformRoutes(app: Hono<AppEnv>) {
  // Landing na apexu (tenant handler za '/' je pao na next() kad nema tenanta)
  app.get('/', async (c) => {
    const user = await currentUser(c);
    const pubs = await c.env.DB.prepare(
      'SELECT slug, name, tagline FROM publications ORDER BY created_at LIMIT 50'
    ).all<{ slug: string; name: string; tagline: string }>();
    return c.html(
      <PlatformLayout title="Tehnoetika platforma" user={user}>
        <section class="landing-hero">
          <h1>Vaša publikacija. Vaši čitatelji. Vaša platforma.</h1>
          <p>Open-source alternativa Substacku: tekstovi, slike i video — na vlastitoj infrastrukturi.</p>
          {user ? <a class="btn" href="/dashboard">Otvori nadzornu ploču</a> : <a class="btn" href="/auth/register">Pokreni publikaciju</a>}
        </section>
        <section class="pub-grid">
          {pubs.results.map((p) => (
            <a class="pub-card" href={`/@${p.slug}`}>
              <h3>{p.name}</h3>
              <p>{p.tagline}</p>
            </a>
          ))}
        </section>
      </PlatformLayout>
    );
  });

  // --- Auth ---
  app.get('/auth/register', (c) => c.html(<AuthForm mode="register" />));
  app.get('/auth/login', (c) => c.html(<AuthForm mode="login" />));

  app.post('/auth/register', async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      return c.html(<AuthForm mode="register" error="Provjerite podatke: ime, ispravan email i lozinka od najmanje 8 znakova." />, 400);
    }
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) {
      return c.html(<AuthForm mode="register" error="Račun s tim emailom već postoji." />, 409);
    }
    const id = newId();
    await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
      .bind(id, email, await hashPassword(password), name)
      .run();
    await createSession(c, id);
    return c.redirect('/dashboard/new');
  });

  app.post('/auth/login', async (c) => {
    const body = await c.req.parseBody();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (await loginRateLimited(c.env.DB, email)) {
      return c.html(<AuthForm mode="login" error="Previše pokušaja. Pokušajte ponovno za 15 minuta." />, 429);
    }
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      await recordLoginFailure(c.env.DB, email);
      return c.html(<AuthForm mode="login" error="Pogrešan email ili lozinka." />, 401);
    }
    await clearLoginFailures(c.env.DB, email);
    await createSession(c, user.id);
    return c.redirect('/dashboard');
  });

  app.post('/auth/logout', async (c) => {
    await destroySession(c);
    return c.redirect('/');
  });

  // --- Dashboard guard ---
  app.use('/dashboard/*', async (c, next) => {
    const user = await currentUser(c);
    if (!user) return c.redirect('/auth/login');
    c.set('user', user);
    await next();
  });
  app.use('/dashboard', async (c, next) => {
    const user = await currentUser(c);
    if (!user) return c.redirect('/auth/login');
    c.set('user', user);
    await next();
  });

  app.get('/dashboard', async (c) => {
    const user = c.get('user')!;
    const pubs = await pubsByOwner(c.env.DB, user.id);
    return c.html(
      <PlatformLayout title="Nadzorna ploča" user={user}>
        <h1>Vaše publikacije</h1>
        <section class="pub-grid">
          {pubs.map((p) => (
            <a class="pub-card" href={`/dashboard/${p.id}/posts`}>
              <h3>{p.name}</h3>
              <p class="muted">/@{p.slug}</p>
            </a>
          ))}
          <a class="pub-card new" href="/dashboard/new">
            <h3>+ Nova publikacija</h3>
          </a>
        </section>
      </PlatformLayout>
    );
  });

  const NewPubForm = ({ user, error }: { user: User; error?: string }) => (
    <PlatformLayout title="Nova publikacija" user={user}>
      <div class="card narrow">
        <h1>Nova publikacija</h1>
        {error ? <Flash kind="err">{error}</Flash> : null}
        <form method="post" action="/dashboard/new">
          <label>
            Ime publikacije
            <input name="name" id="pub-name" required maxlength={120} placeholder="npr. Sapere Aude" />
          </label>
          <label>
            Slug (adresa: /@slug ili slug.domena)
            <input name="slug" id="pub-slug" required pattern="[a-z0-9-]{3,40}" placeholder="sapereaude" />
          </label>
          <label>
            Kratki opis (tagline)
            <input name="tagline" maxlength={300} />
          </label>
          <button type="submit">Stvori</button>
        </form>
      </div>
      <script src="/static/dashboard.js"></script>
    </PlatformLayout>
  );

  app.get('/dashboard/new', (c) => c.html(<NewPubForm user={c.get('user')!} />));

  app.post('/dashboard/new', async (c) => {
    const user = c.get('user')!;
    const body = await c.req.parseBody();
    const name = String(body.name ?? '').trim();
    const slug = slugify(String(body.slug ?? ''));
    const tagline = String(body.tagline ?? '').trim();
    if (!name || !SLUG_RE.test(slug)) {
      return c.html(<NewPubForm user={user} error="Ime je obavezno, slug mora imati 3–40 malih slova/brojki/crtica." />, 400);
    }
    if (RESERVED_SLUGS.includes(slug)) {
      return c.html(<NewPubForm user={user} error="Taj slug je rezerviran, odaberite drugi." />, 400);
    }
    const taken = await c.env.DB.prepare('SELECT id FROM publications WHERE slug = ?').bind(slug).first();
    if (taken) {
      return c.html(<NewPubForm user={user} error="Slug je zauzet, odaberite drugi." />, 409);
    }
    const id = newId();
    await c.env.DB.prepare(
      'INSERT INTO publications (id, owner_user_id, slug, name, tagline) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(id, user.id, slug, name, tagline)
      .run();
    return c.redirect(`/dashboard/${id}/posts`);
  });

  // --- Guard vlasništva publikacije ---
  app.use('/dashboard/:pubId/*', async (c, next) => {
    const pub = await pubById(c.env.DB, c.req.param('pubId'));
    if (!pub || pub.owner_user_id !== c.get('user')!.id) return c.notFound();
    c.set('dpub', pub);
    await next();
  });

  const pubOf = (c: C) => c.get('dpub')!;

  app.get('/dashboard/:pubId/posts', async (c) => {
    const pub = pubOf(c);
    const posts = await allPostsForDashboard(c.env.DB, pub.id);
    return c.html(
      <PlatformLayout title={`Objave — ${pub.name}`} user={c.get('user')}>
        <DashNav pub={pub} active="posts" />
        <div class="list-head">
          <h1>Objave</h1>
          <a class="btn" href={`/dashboard/${pub.id}/posts/new`}>+ Nova objava</a>
        </div>
        <table class="table">
          <thead>
            <tr><th>Naslov</th><th>Vrsta</th><th>Status</th><th>Datum</th></tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr>
                <td><a href={`/dashboard/${pub.id}/posts/${p.id}`}>{p.title}</a></td>
                <td>{p.kind === 'page' ? 'stranica' : 'objava'}</td>
                <td><span class={`badge badge-${p.status}`}>{p.status === 'published' ? 'objavljeno' : 'skica'}</span></td>
                <td>{formatDate(p.published_at ?? p.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {posts.length === 0 ? <p class="empty">Još nema objava — napišite prvu.</p> : null}
      </PlatformLayout>
    );
  });

  app.get('/dashboard/:pubId/posts/new', async (c) => {
    const pub = pubOf(c);
    return c.html(<PostForm pub={pub} media={await mediaForPub(c.env.DB, pub.id)} categories={await categoriesForPub(c.env.DB, pub.id)} />);
  });

  async function applyPostForm(c: C, pub: Publication, post?: Post): Promise<Response> {
    const body = await c.req.parseBody();
    const action = String(body.action ?? 'save');

    if (action === 'delete' && post) {
      await c.env.DB.prepare('DELETE FROM posts WHERE id = ? AND publication_id = ?')
        .bind(post.id, pub.id)
        .run();
      return c.redirect(`/dashboard/${pub.id}/posts`);
    }

    const title = String(body.title ?? '').trim();
    if (!title) {
      return c.html(<PostForm pub={pub} post={post} media={await mediaForPub(c.env.DB, pub.id)} categories={await categoriesForPub(c.env.DB, pub.id)} error="Naslov je obavezan." />, 400);
    }
    const subtitle = String(body.subtitle ?? '').trim();
    const bodyMd = String(body.body_md ?? '');
    const kind = body.kind === 'page' ? 'page' : 'post';
    const pinned = body.pinned_nav === '1' && kind === 'page' ? 1 : 0;
    const coverRaw = String(body.cover_media_id ?? '');
    const cover = coverRaw || null;
    // Rubrika: prihvati samo id koji pripada ovoj publikaciji.
    const catRaw = String(body.category_id ?? '');
    const cats = await categoriesForPub(c.env.DB, pub.id);
    const categoryId = cats.some((ct) => ct.id === catRaw) ? catRaw : null;
    const slugInput = slugify(String(body.slug ?? '')) || slugify(title);
    const slug = await uniquePostSlug(c.env.DB, pub.id, slugInput, post?.id);
    const html = renderMarkdown(bodyMd);
    const now = new Date().toISOString();

    let status = post?.status ?? 'draft';
    let publishedAt = post?.published_at ?? null;
    if (action === 'publish') {
      status = 'published';
      publishedAt = publishedAt ?? now;
    } else if (action === 'unpublish') {
      status = 'draft';
    }

    if (post) {
      await c.env.DB.prepare(
        `UPDATE posts SET title=?, subtitle=?, slug=?, body_md=?, body_html=?, cover_media_id=?, category_id=?, kind=?, pinned_nav=?, status=?, published_at=?, updated_at=? WHERE id=? AND publication_id=?`
      )
        .bind(title, subtitle, slug, bodyMd, html, cover, categoryId, kind, pinned, status, publishedAt, now, post.id, pub.id)
        .run();
      return c.redirect(`/dashboard/${pub.id}/posts/${post.id}`);
    }
    const id = newId();
    await c.env.DB.prepare(
      `INSERT INTO posts (id, publication_id, slug, title, subtitle, body_md, body_html, cover_media_id, category_id, kind, pinned_nav, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, pub.id, slug, title, subtitle, bodyMd, html, cover, categoryId, kind, pinned, status, publishedAt)
      .run();
    return c.redirect(`/dashboard/${pub.id}/posts/${id}`);
  }

  app.post('/dashboard/:pubId/posts/new', async (c) => applyPostForm(c, pubOf(c)));

  app.get('/dashboard/:pubId/posts/:id', async (c) => {
    const pub = pubOf(c);
    const post = await postById(c.env.DB, pub.id, c.req.param('id'));
    if (!post) return c.notFound();
    return c.html(<PostForm pub={pub} post={post} media={await mediaForPub(c.env.DB, pub.id)} categories={await categoriesForPub(c.env.DB, pub.id)} />);
  });

  app.post('/dashboard/:pubId/posts/:id', async (c) => {
    const pub = pubOf(c);
    const post = await postById(c.env.DB, pub.id, c.req.param('id'));
    if (!post) return c.notFound();
    return applyPostForm(c, pub, post);
  });

  // --- Rubrike (kategorije) ---
  app.get('/dashboard/:pubId/categories', async (c) => {
    const pub = pubOf(c);
    const cats = await categoriesForPub(c.env.DB, pub.id);
    return c.html(<CategoriesPage pub={pub} categories={cats} user={c.get('user')} />);
  });

  app.post('/dashboard/:pubId/categories', async (c) => {
    const pub = pubOf(c);
    const body = await c.req.parseBody();
    const name = String(body.name ?? '').trim().slice(0, 60);
    if (name) {
      const slug = await uniqueCategorySlug(c.env.DB, pub.id, slugify(name));
      const cats = await categoriesForPub(c.env.DB, pub.id);
      await c.env.DB.prepare(
        'INSERT INTO categories (id, publication_id, name, slug, position) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(newId(), pub.id, name, slug, cats.length)
        .run();
    }
    return c.redirect(`/dashboard/${pub.id}/categories`);
  });

  app.post('/dashboard/:pubId/categories/:id/delete', async (c) => {
    const pub = pubOf(c);
    const id = c.req.param('id');
    // Odveži postove pa obriši rubriku (bez brisanja objava).
    await c.env.DB.prepare('UPDATE posts SET category_id = NULL WHERE category_id = ? AND publication_id = ?')
      .bind(id, pub.id)
      .run();
    await c.env.DB.prepare('DELETE FROM categories WHERE id = ? AND publication_id = ?')
      .bind(id, pub.id)
      .run();
    return c.redirect(`/dashboard/${pub.id}/categories`);
  });

  // --- Mediji ---
  app.get('/dashboard/:pubId/media', async (c) => {
    const pub = pubOf(c);
    const items = await mediaForPub(c.env.DB, pub.id);
    return c.html(
      <PlatformLayout title={`Mediji — ${pub.name}`} user={c.get('user')}>
        <DashNav pub={pub} active="media" />
        <div class="list-head">
          <h1>Mediji</h1>
          <span class="muted">Upload ide kroz editor objave (📎) — ovdje je knjižnica.</span>
        </div>
        <div class="media-grid">
          {items.map((m) => (
            <figure class="media-item">
              {m.kind === 'image' ? (
                <img src={mediaUrl(m.id, m.filename)} alt={m.filename} loading="lazy" />
              ) : (
                <video src={mediaUrl(m.id, m.filename)} preload="metadata" controls />
              )}
              <figcaption>
                <code>{m.filename}</code> · {(m.byte_size / 1024 / 1024).toFixed(1)} MB
                <form method="post" action={`/dashboard/${pub.id}/media/${m.id}/delete`} class="inline-form">
                  <button class="danger small" type="submit">Obriši</button>
                </form>
              </figcaption>
            </figure>
          ))}
        </div>
        {items.length === 0 ? <p class="empty">Nema medija.</p> : null}
      </PlatformLayout>
    );
  });

  app.post('/dashboard/:pubId/media/:id/delete', async (c) => {
    const pub = pubOf(c);
    const media = await c.env.DB.prepare('SELECT * FROM media WHERE id = ? AND publication_id = ?')
      .bind(c.req.param('id'), pub.id)
      .first<Media>();
    if (media) {
      await c.env.MEDIA.delete(media.storage_key);
      await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(media.id).run();
    }
    return c.redirect(`/dashboard/${pub.id}/media`);
  });

  // --- Pretplatnici ---
  app.get('/dashboard/:pubId/subscribers', async (c) => {
    const pub = pubOf(c);
    const subs = await subscribersForPub(c.env.DB, pub.id);
    return c.html(
      <PlatformLayout title={`Pretplatnici — ${pub.name}`} user={c.get('user')}>
        <DashNav pub={pub} active="subscribers" />
        <div class="list-head">
          <h1>Pretplatnici ({subs.filter((s) => s.status === 'confirmed').length})</h1>
          <a class="btn" href={`/dashboard/${pub.id}/subscribers.csv`}>Preuzmi CSV</a>
        </div>
        <table class="table">
          <thead>
            <tr><th>Email</th><th>Status</th><th>Prijavljen</th></tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr>
                <td>{s.email}</td>
                <td><span class={`badge badge-${s.status}`}>{s.status}</span></td>
                <td>{formatDate(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {subs.length === 0 ? <p class="empty">Još nema pretplatnika.</p> : null}
      </PlatformLayout>
    );
  });

  app.get('/dashboard/:pubId/subscribers.csv', async (c) => {
    const pub = pubOf(c);
    const subs = await subscribersForPub(c.env.DB, pub.id);
    const q = (s: string | null) => `"${(s ?? '').replace(/"/g, '""')}"`;
    const csv = ['email,status,confirmed_at,created_at']
      .concat(subs.map((s) => [q(s.email), q(s.status), q(s.confirmed_at), q(s.created_at)].join(',')))
      .join('\n');
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${pub.slug}-pretplatnici.csv"`,
    });
  });

  // --- Postavke ---
  const SettingsForm = ({ pub, user, saved }: { pub: Publication; user: User; saved?: boolean }) => (
    <PlatformLayout title={`Postavke — ${pub.name}`} user={user}>
      <DashNav pub={pub} active="settings" />
      <div class="card">
        <h1>Postavke publikacije</h1>
        {saved ? <Flash>Spremljeno.</Flash> : null}
        <form method="post" action={`/dashboard/${pub.id}/settings`} class="settings" data-pub-id={pub.id}>
          <label>
            Ime
            <input name="name" required maxlength={120} value={pub.name} />
          </label>
          <label>
            Tagline
            <input name="tagline" maxlength={300} value={pub.tagline} />
          </label>
          <label>
            O nama (markdown)
            <textarea name="about_md" rows={8}>{pub.about_md}</textarea>
          </label>
          <label>
            Akcentna boja
            <input type="color" name="accent_color" value={pub.accent_color} />
          </label>
          <label>
            Logo
            <input type="file" id="logo-input" accept="image/jpeg,image/png,image/gif,image/webp" />
            <input type="hidden" name="logo_media_id" id="logo-media-id" value={pub.logo_media_id ?? ''} />
            <span id="upload-status" class="muted"></span>
            {pub.logo_media_id ? <img class="logo-preview" src={`/media/${pub.logo_media_id}/logo`} alt="logo" /> : null}
          </label>
          <label>
            Vlastita domena (aktivacija dolazi kasnije — Cloudflare for SaaS)
            <input name="custom_domain" value={pub.custom_domain ?? ''} placeholder="blog.mojadomena.hr" />
          </label>
          <button type="submit">Spremi</button>
        </form>
        <p class="muted">
          Adresa publikacije: <code>/@{pub.slug}</code>
          {' '}(uz vlastitu domenu platforme i <code>{pub.slug}.&lt;domena&gt;</code>)
        </p>
      </div>
      <script src="/static/dashboard.js"></script>
    </PlatformLayout>
  );

  app.get('/dashboard/:pubId/settings', (c) =>
    c.html(<SettingsForm pub={pubOf(c)} user={c.get('user')!} saved={c.req.query('saved') === '1'} />)
  );

  app.post('/dashboard/:pubId/settings', async (c) => {
    const pub = pubOf(c);
    const body = await c.req.parseBody();
    const name = String(body.name ?? '').trim() || pub.name;
    const tagline = String(body.tagline ?? '').trim();
    const aboutMd = String(body.about_md ?? '');
    const accent = /^#[0-9a-fA-F]{6}$/.test(String(body.accent_color ?? '')) ? String(body.accent_color) : pub.accent_color;
    const logo = String(body.logo_media_id ?? '') || null;
    const domain = String(body.custom_domain ?? '').trim().toLowerCase() || null;
    await c.env.DB.prepare(
      'UPDATE publications SET name=?, tagline=?, about_md=?, about_html=?, accent_color=?, logo_media_id=?, custom_domain=? WHERE id=?'
    )
      .bind(name, tagline, aboutMd, renderMarkdown(aboutMd), accent, logo, domain, pub.id)
      .run();
    return c.redirect(`/dashboard/${pub.id}/settings?saved=1`);
  });
}
