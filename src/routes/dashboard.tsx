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
  canEditPub,
  categoriesForPub,
  mediaForPub,
  membersForPub,
  navItems,
  newId,
  postById,
  pubById,
  pubsForUser,
  subscribersForPub,
  uniqueCategorySlug,
  uniquePostSlug,
  type Category,
  type Media,
  type NavItem,
  type Post,
  type Publication,
  type User,
} from '../db';
import { parseLocalDateTime } from '../events';
import { renderMarkdown, slugify, youtubeId } from '../markdown';
import {
  FONT_PRESETS,
  Flash,
  PlatformLayout,
  TEXT_SIZES,
  formatDate,
  mediaUrl,
  postHref,
} from '../views/layout';
import { PROJECT_STATUS, type AppEnv } from './public';

type C = Context<AppEnv>;

export const RESERVED_SLUGS = [
  'www', 'app', 'admin', 'api', 'mail', 'assets', 'dashboard', 'static', 'media', 'feed',
  'auth', 'about', 'archive', 'subscribe', 'confirm', 'unsubscribe', 'p', 'sitemap',
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// Javna adresa publikacije za linkove iz dashboarda. platformHost se postavlja u
// dashboard guardu iz env.PLATFORM_HOST; bez njega ostaje path mode (/@slug).
let platformHost = '';
function siteUrl(pub: Publication): string {
  if (pub.custom_domain) return `https://${pub.custom_domain}`;
  return platformHost ? `https://${pub.slug}.${platformHost}` : `/@${pub.slug}`;
}

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
        ['nav', 'Izbornik'],
        ['media', 'Mediji'],
        ['subscribers', 'Pretplatnici'],
        ['members', 'Urednici'],
        ['settings', 'Postavke'],
      ] as const
    ).map(([key, label]) => (
      <a class={active === key ? 'active' : ''} href={`/dashboard/${pub.id}/${key}`}>
        {label}
      </a>
    ))}
    <a href={siteUrl(pub)} target="_blank">
      Pogledaj stranicu ↗
    </a>
  </nav>
);

// --- Editor forma ---

const TYPE_LABELS: Record<string, string> = {
  text: 'Tekst',
  event: 'Aktivnost (događaj)',
  video: 'Video',
  project: 'Projekt',
};

const PostForm = ({
  pub,
  post,
  media,
  categories,
  error,
  presetType,
  user,
}: {
  user?: User | null;
  pub: Publication;
  post?: Post;
  media: Media[];
  categories: Category[];
  error?: string;
  presetType?: string;
}) => {
  const action = post ? `/dashboard/${pub.id}/posts/${post.id}` : `/dashboard/${pub.id}/posts/new`;
  const images = media.filter((m) => m.kind === 'image');
  const files = media.filter((m) => m.kind === 'file');
  const kind = post?.kind ?? (presetType === 'page' ? 'page' : 'post');
  const type = post?.post_type ?? (presetType && presetType in TYPE_LABELS ? presetType : 'text');
  const show = (...types: string[]) => kind === 'post' && types.includes(type);
  return (
    <PlatformLayout title={post ? `Uredi: ${post.title}` : 'Nova objava'} user={user}>
      <DashNav pub={pub} active="posts" />
      {error ? <Flash kind="err">{error}</Flash> : null}
      <form method="post" action={action} class="editor" data-pub-id={pub.id} data-post-id={post?.id ?? 'new'}>
        <div class="editor-main">
          <input class="editor-title" name="title" placeholder="Naslov" required maxlength={200} value={post?.title ?? ''} />
          <input class="editor-subtitle" name="subtitle" placeholder="Podnaslov (opcionalno)" maxlength={300} value={post?.subtitle ?? ''} />

          <fieldset class="type-fields" data-types="event" hidden={!show('event')}>
            <legend>Aktivnost</legend>
            <div class="field-row">
              <label>
                Početak
                <input type="datetime-local" name="event_start" value={post?.event_start ?? ''} />
              </label>
              <label>
                Kraj (opcionalno)
                <input type="datetime-local" name="event_end" value={post?.event_end ?? ''} />
              </label>
            </div>
            <label>
              Lokacija
              <input name="event_location" maxlength={200} value={post?.event_location ?? ''} placeholder="npr. Zagreb, Trg bana Jelačića 1 — ili Online" />
            </label>
            <p class="muted">
              Tekst ispod je najava. Nakon održane aktivnosti samo dopiši bilješku i slike u isti tekst — objava se sama
              premješta među "Održano".
            </p>
          </fieldset>

          <fieldset class="type-fields" data-types="video" hidden={!show('video')}>
            <legend>Video</legend>
            <label>
              YouTube poveznica
              <input name="video_url" value={post?.video_source !== 'r2' ? (post?.video_url ?? '') : ''} placeholder="https://www.youtube.com/watch?v=…" />
            </label>
            <p class="muted">Sličica se uzima s YouTubea ako nije odabrana naslovna slika. Tekst ispod je opis videa.</p>
          </fieldset>

          <fieldset class="type-fields" data-types="project" hidden={!show('project')}>
            <legend>Projekt</legend>
            <label>
              Status
              <select name="project_status">
                {Object.entries(PROJECT_STATUS).map(([k, label]) => (
                  <option value={k} selected={(post?.project_status ?? 'active') === k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset class="type-fields" data-types="event project" hidden={!show('event', 'project')}>
            <label>
              Vanjska poveznica (opcionalno)
              <input type="url" name="link_url" value={post?.link_url ?? ''} placeholder="https://…" />
            </label>
          </fieldset>

          <div class="editor-toolbar" role="toolbar" aria-label="Oblikovanje">
            <div class="tb-row">
              <button type="button" class="fmt" data-fmt="h2" title="Naslov">H2</button>
              <button type="button" class="fmt" data-fmt="h3" title="Podnaslov">H3</button>
              <button type="button" class="fmt" data-fmt="quote" title="Citat">❝</button>
              <button type="button" class="fmt" data-fmt="pullquote" title="Istaknuti citat">❝❝</button>
              <button type="button" class="fmt" data-fmt="ul" title="Nabrajanje">•</button>
              <button type="button" class="fmt" data-fmt="ol" title="Numerirani popis">1.</button>
              <button type="button" class="fmt" data-fmt="hr" title="Razdjelnica">―</button>
              <button type="button" class="fmt" data-fmt="table" title="Tablica">▦</button>
              <span class="tb-sep" aria-hidden="true"></span>
              <button type="button" class="fmt" data-fmt="bold" title="Podebljano (Ctrl+B)"><strong>B</strong></button>
              <button type="button" class="fmt" data-fmt="italic" title="Kurziv (Ctrl+I)"><em>I</em></button>
              <button type="button" class="fmt" data-fmt="strike" title="Precrtano"><s>S</s></button>
              <button type="button" class="fmt" data-fmt="link" title="Poveznica (Ctrl+K)">🔗</button>
              <button type="button" class="fmt" data-fmt="footnote" title="Fusnota">¹</button>
            </div>
            <div class="tb-row">
              <button type="button" id="btn-image">🖼 Slika</button>
              <button type="button" id="btn-video">▶ Video</button>
              <button type="button" id="btn-upload">📎 Datoteka</button>
              <input type="file" id="file-input" hidden accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,application/pdf" />
              <span class="tb-sep" aria-hidden="true"></span>
              <button type="button" id="btn-preview" aria-pressed="false">👁 Pregled uživo</button>
              <span id="upload-status" class="muted"></span>
            </div>
          </div>
          <div class="editor-panes">
            <textarea id="body-md" name="body_md" rows={22} placeholder={'Pišite… označite tekst i odaberite stil iz trake koja se pojavi.\n\nSliku povucite ili zalijepite izravno ovdje.'}>
              {post?.body_md ?? ''}
            </textarea>
            <div id="preview" class="post-body preview-pane" hidden></div>
          </div>
          <div class="editor-status">
            <span id="word-count"></span>
            <span id="autosave-status"></span>
          </div>
          <div id="float-toolbar" class="float-toolbar" hidden>
            <button type="button" data-fmt="bold" title="Podebljano"><strong>B</strong></button>
            <button type="button" data-fmt="italic" title="Kurziv"><em>I</em></button>
            <button type="button" data-fmt="link" title="Poveznica">🔗</button>
            <button type="button" data-fmt="h2" title="Naslov">H2</button>
            <button type="button" data-fmt="quote" title="Citat">❝</button>
          </div>
        </div>
        <aside class="editor-side">
          <label>
            Vrsta
            <select name="kind" id="kind-select">
              <option value="post" selected={kind === 'post'}>Objava</option>
              <option value="page" selected={kind === 'page'}>Stranica (O nama, Deklaracija…)</option>
            </select>
          </label>
          <label data-kinds="post" hidden={kind !== 'post'}>
            Tip objave
            <select name="post_type" id="type-select">
              {Object.entries(TYPE_LABELS).map(([k, label]) => (
                <option value={k} selected={type === k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Slug (URL)
            <input name="slug" value={post?.slug ?? ''} placeholder="automatski iz naslova" pattern="[a-z0-9-]*" />
          </label>
          <label data-kinds="post" hidden={kind !== 'post'}>
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
          <label class="check" data-kinds="page" hidden={kind !== 'page'}>
            <input type="checkbox" name="pinned_nav" value="1" checked={Boolean(post?.pinned_nav)} />
            Prikaži u automatskom izborniku
          </label>
          <label class="check">
            <input type="checkbox" name="featured" value="1" checked={Boolean(post?.featured)} />
            Istakni na naslovnici
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
          <label>
            Prilog za preuzimanje (PDF)
            <select name="attachment_media_id" id="attachment-select">
              <option value="">— bez priloga —</option>
              {files.map((m) => (
                <option value={m.id} selected={post?.attachment_media_id === m.id}>
                  {m.filename}
                </option>
              ))}
            </select>
            <span class="muted">PDF učitaj gumbom 📎 Datoteka ili u Medijima.</span>
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
              <button type="submit" name="action" value="delete" class="danger" formnovalidate data-confirm="Obrisati ovu objavu?">
                Obriši
              </button>
            ) : null}
          </div>
          {post?.status === 'published' ? (
            <p class="muted">
              Objavljeno: {formatDate(post.published_at)} ·{' '}
              <a href={`${siteUrl(pub)}${postHref('', post)}`} target="_blank">otvori ↗</a>
            </p>
          ) : null}
        </aside>
      </form>
      {/* Dijalozi su izvan forme editora: ugniježđeni <form> nije dopušten u HTML-u. */}
      <dialog id="img-dialog" class="img-dialog">
        <form method="dialog">
          <h2>Umetni sliku</h2>
          <div class="img-pick">
            {images.slice(0, 60).map((m) => (
              <button type="button" class="img-choice" data-url={mediaUrl(m.id, m.filename)} title={m.filename}>
                <img src={mediaUrl(m.id, m.filename)} alt="" loading="lazy" />
              </button>
            ))}
            <button type="button" class="img-choice img-upload" id="img-upload-btn">＋ Učitaj novu</button>
            <input type="file" id="img-file" hidden accept="image/jpeg,image/png,image/gif,image/webp" />
          </div>
          <input type="hidden" id="img-url" />
          <label>
            Opis ispod slike (opcionalno)
            <input id="img-caption" maxlength={300} />
          </label>
          <label>
            Alternativni tekst (za čitače ekrana)
            <input id="img-alt" maxlength={200} />
          </label>
          <fieldset class="align-pick">
            <legend>Poravnanje</legend>
            <label class="check"><input type="radio" name="img-align" value="center" checked /> Centrirano</label>
            <label class="check"><input type="radio" name="img-align" value="wide" /> Preko cijele širine</label>
            <label class="check"><input type="radio" name="img-align" value="left" /> Lijevo uz tekst</label>
            <label class="check"><input type="radio" name="img-align" value="right" /> Desno uz tekst</label>
          </fieldset>
          <div class="dialog-actions">
            <button type="submit" value="cancel" class="secondary-btn">Odustani</button>
            <button type="button" id="img-insert" class="btn" disabled>Umetni</button>
          </div>
        </form>
      </dialog>
      <dialog id="video-dialog" class="img-dialog">
        <form method="dialog">
          <h2>Umetni video</h2>
          <label>
            YouTube, Vimeo ili Facebook poveznica
            <input id="video-url" type="url" placeholder="https://www.youtube.com/watch?v=…" />
          </label>
          <div class="dialog-actions">
            <button type="submit" value="cancel" class="secondary-btn">Odustani</button>
            <button type="button" id="video-insert" class="btn">Umetni</button>
          </div>
        </form>
      </dialog>
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
            <a href={`${siteUrl(pub)}/kategorija/${cat.slug}`} target="_blank">
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
    platformHost = c.env.PLATFORM_HOST ?? '';
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
    platformHost = c.env.PLATFORM_HOST ?? '';
    const pubs = await pubsForUser(c.env.DB, user.id);
    return c.html(
      <PlatformLayout title="Nadzorna ploča" user={user}>
        <h1>Vaše publikacije</h1>
        <section class="pub-grid">
          {pubs.map((p) => (
            <a class="pub-card" href={`/dashboard/${p.id}/posts`}>
              <h3>{p.name}</h3>
              <p class="muted">{siteUrl(p).replace(/^https:\/\//, '')}</p>
              {p.owner_user_id !== user.id ? <p class="muted">urednik</p> : null}
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
    if (!pub || !(await canEditPub(c.env.DB, pub, c.get('user')!.id))) return c.notFound();
    c.set('dpub', pub);
    await next();
  });

  const pubOf = (c: C) => c.get('dpub')!;

  app.get('/dashboard/:pubId/posts', async (c) => {
    const pub = pubOf(c);
    const filter = c.req.query('tip') ?? '';
    const valid = ['text', 'event', 'video', 'project', 'page'].includes(filter) ? filter : '';
    const posts = await allPostsForDashboard(c.env.DB, pub.id, valid || undefined);
    const tabs: Array<[string, string]> = [
      ['', 'Sve'],
      ['text', 'Tekstovi'],
      ['event', 'Aktivnosti'],
      ['video', 'Video'],
      ['project', 'Projekti'],
      ['page', 'Stranice'],
    ];
    const typeName = (p: Post) =>
      p.kind === 'page' ? 'stranica' : ({ text: 'tekst', event: 'aktivnost', video: 'video', project: 'projekt' } as Record<string, string>)[p.post_type] ?? 'tekst';
    return c.html(
      <PlatformLayout title={`Objave — ${pub.name}`} user={c.get('user')}>
        <DashNav pub={pub} active="posts" />
        <div class="list-head">
          <h1>Objave</h1>
          <a class="btn" href={`/dashboard/${pub.id}/posts/new${valid ? `?tip=${valid}` : ''}`}>+ Nova objava</a>
        </div>
        <nav class="chips">
          {tabs.map(([k, label]) => (
            <a class={valid === k ? 'active' : ''} href={`/dashboard/${pub.id}/posts${k ? `?tip=${k}` : ''}`}>
              {label}
            </a>
          ))}
        </nav>
        <table class="table">
          <thead>
            <tr><th>Naslov</th><th>Tip</th><th>Status</th><th>Datum</th></tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr>
                <td>
                  <a href={`/dashboard/${pub.id}/posts/${p.id}`}>{p.title}</a>
                  {p.featured ? <span class="badge badge-featured">istaknuto</span> : null}
                </td>
                <td>{typeName(p)}</td>
                <td><span class={`badge badge-${p.status}`}>{p.status === 'published' ? 'objavljeno' : 'skica'}</span></td>
                <td>{p.post_type === 'event' && p.event_start ? `📅 ${formatDate(p.event_start)}` : formatDate(p.published_at ?? p.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {posts.length === 0 ? <p class="empty">Još nema objava ovog tipa.</p> : null}
      </PlatformLayout>
    );
  });

  app.get('/dashboard/:pubId/posts/new', async (c) => {
    const pub = pubOf(c);
    return c.html(
      <PostForm
        user={c.get('user')}
        pub={pub}
        media={await mediaForPub(c.env.DB, pub.id)}
        categories={await categoriesForPub(c.env.DB, pub.id)}
        presetType={c.req.query('tip')}
      />
    );
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
      return c.html(<PostForm user={c.get('user')} pub={pub} post={post} media={await mediaForPub(c.env.DB, pub.id)} categories={await categoriesForPub(c.env.DB, pub.id)} error="Naslov je obavezan." />, 400);
    }
    const subtitle = String(body.subtitle ?? '').trim();
    const bodyMd = String(body.body_md ?? '');
    const kind = body.kind === 'page' ? 'page' : 'post';
    const pinned = body.pinned_nav === '1' && kind === 'page' ? 1 : 0;
    const featured = body.featured === '1' ? 1 : 0;
    const typeRaw = String(body.post_type ?? 'text');
    const postType = kind === 'page' ? 'text' : ['text', 'event', 'video', 'project'].includes(typeRaw) ? typeRaw : 'text';
    // Mediji: prihvati samo id-eve koji pripadaju ovoj publikaciji.
    const ownMedia = await mediaForPub(c.env.DB, pub.id);
    const mediaOk = (raw: unknown, k: Media['kind']) => {
      const id = String(raw ?? '');
      return ownMedia.some((m) => m.id === id && m.kind === k) ? id : null;
    };
    const cover = mediaOk(body.cover_media_id, 'image');
    const attachment = mediaOk(body.attachment_media_id, 'file');
    const httpUrl = (raw: unknown) => {
      const v = String(raw ?? '').trim();
      return /^https?:\/\/\S+$/.test(v) ? v.slice(0, 500) : null;
    };
    const isEvent = postType === 'event';
    const eventStart = isEvent ? parseLocalDateTime(body.event_start) : null;
    const eventEndRaw = isEvent ? parseLocalDateTime(body.event_end) : null;
    const eventEnd = eventStart && eventEndRaw && eventEndRaw > eventStart ? eventEndRaw : null;
    const eventLocation = isEvent ? String(body.event_location ?? '').trim().slice(0, 200) || null : null;
    const linkUrl = postType === 'event' || postType === 'project' ? httpUrl(body.link_url) : null;
    const videoUrl = postType === 'video' ? httpUrl(body.video_url) : null;
    const projectStatus =
      postType === 'project' && String(body.project_status) in PROJECT_STATUS ? String(body.project_status) : null;
    const formError =
      isEvent && !eventStart
        ? 'Aktivnost treba datum i vrijeme početka.'
        : postType === 'video' && !youtubeId(videoUrl)
          ? 'Za video upišite ispravnu YouTube poveznicu.'
          : null;
    // Rubrika: prihvati samo id koji pripada ovoj publikaciji.
    const catRaw = String(body.category_id ?? '');
    const cats = await categoriesForPub(c.env.DB, pub.id);
    const categoryId = cats.some((ct) => ct.id === catRaw) ? catRaw : null;
    // Nepotpuna aktivnost/video se ne objavljuje: spremi kao dosad i vrati s porukom.
    const blocked = formError && action === 'publish' ? formError : null;
    const errQs = blocked ? `?greska=${encodeURIComponent(blocked)}` : '';
    const slugInput = slugify(String(body.slug ?? '')) || slugify(title);
    const slug = await uniquePostSlug(c.env.DB, pub.id, slugInput, post?.id);
    const html = renderMarkdown(bodyMd);
    const now = new Date().toISOString();

    let status = post?.status ?? 'draft';
    let publishedAt = post?.published_at ?? null;
    if (action === 'publish' && !blocked) {
      status = 'published';
      publishedAt = publishedAt ?? now;
    } else if (action === 'unpublish') {
      status = 'draft';
    }

    if (post) {
      await c.env.DB.prepare(
        `UPDATE posts SET title=?, subtitle=?, slug=?, body_md=?, body_html=?, cover_media_id=?, category_id=?, kind=?, pinned_nav=?, status=?, published_at=?, updated_at=?,
           post_type=?, event_start=?, event_end=?, event_location=?, link_url=?, video_source=?, video_url=?, project_status=?, attachment_media_id=?, featured=?
         WHERE id=? AND publication_id=?`
      )
        .bind(title, subtitle, slug, bodyMd, html, cover, categoryId, kind, pinned, status, publishedAt, now,
          postType, eventStart, eventEnd, eventLocation, linkUrl, videoUrl ? 'youtube' : null, videoUrl, projectStatus, attachment, featured,
          post.id, pub.id)
        .run();
      return c.redirect(`/dashboard/${pub.id}/posts/${post.id}${errQs}`);
    }
    const id = newId();
    await c.env.DB.prepare(
      `INSERT INTO posts (id, publication_id, slug, title, subtitle, body_md, body_html, cover_media_id, category_id, kind, pinned_nav, status, published_at,
         post_type, event_start, event_end, event_location, link_url, video_source, video_url, project_status, attachment_media_id, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, pub.id, slug, title, subtitle, bodyMd, html, cover, categoryId, kind, pinned, status, publishedAt,
        postType, eventStart, eventEnd, eventLocation, linkUrl, videoUrl ? 'youtube' : null, videoUrl, projectStatus, attachment, featured)
      .run();
    return c.redirect(`/dashboard/${pub.id}/posts/${id}${errQs}`);
  }

  app.post('/dashboard/:pubId/posts/new', async (c) => applyPostForm(c, pubOf(c)));

  app.get('/dashboard/:pubId/posts/:id', async (c) => {
    const pub = pubOf(c);
    const post = await postById(c.env.DB, pub.id, c.req.param('id'));
    if (!post) return c.notFound();
    return c.html(
      <PostForm
        user={c.get('user')}
        pub={pub}
        post={post}
        media={await mediaForPub(c.env.DB, pub.id)}
        categories={await categoriesForPub(c.env.DB, pub.id)}
        error={c.req.query('greska')?.slice(0, 200)}
      />
    );
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

  // --- Izbornik (uređiva navigacija) ---

  // Institucionalni izbornik iz Lukinog zahtjeva (PLAN §2): 6 rubrika.
  const INSTITUTION_NAV: Array<[string, string]> = [
    ['Tekstovi', '/tekstovi'],
    ['Aktivnosti', '/aktivnosti'],
    ['Video materijali', '/video'],
    ['O nama', '/o-nama'],
    ['Projekti', '/projekti'],
    ['Deklaracija', '/deklaracija'],
  ];
  const BUILTIN_TARGETS = ['/', '/tekstovi', '/aktivnosti', '/video', '/projekti', '/o-nama'];

  const NavPage = ({
    pub,
    user,
    items,
    pages,
    saved,
  }: {
    pub: Publication;
    user: User;
    items: NavItem[];
    pages: Post[];
    saved?: boolean;
  }) => {
    const pageSlugs = new Set(pages.map((p) => `/${p.slug}`));
    const broken = (target: string) =>
      target.startsWith('/') &&
      !BUILTIN_TARGETS.includes(target) &&
      !target.startsWith('/kategorija/') &&
      !target.startsWith('/p/') &&
      !pageSlugs.has(target);
    return (
      <PlatformLayout title={`Izbornik — ${pub.name}`} user={user}>
        <DashNav pub={pub} active="nav" />
        <div class="list-head">
          <h1>Izbornik</h1>
          <span class="muted">Redoslijed, nazivi i vidljivost stavki u zaglavlju stranice.</span>
        </div>
        {saved ? <Flash>Spremljeno.</Flash> : null}
        <form method="post" action={`/dashboard/${pub.id}/nav`} class="card nav-editor">
          {items.length === 0 ? (
            <p class="muted">
              Izbornik je trenutno <strong>automatski</strong> (Početna, rubrike, Arhiva, prikvačene stranice, O nama). Dodaj
              prvu stavku ili postavi institucionalni izbornik.
            </p>
          ) : (
            <table class="table nav-table">
              <thead>
                <tr><th>Naziv</th><th>Poveznica</th><th>Vidljivo</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((n, i) => (
                  <tr>
                    <td>
                      <input name={`label.${n.id}`} value={n.label} maxlength={40} required />
                    </td>
                    <td>
                      <input name={`target.${n.id}`} value={n.target} maxlength={300} required />
                      {broken(n.target) ? <span class="warn-text">⚠ stranica ne postoji ili nije objavljena</span> : null}
                    </td>
                    <td>
                      <input type="checkbox" name={`visible.${n.id}`} value="1" checked={Boolean(n.visible)} />
                    </td>
                    <td class="nav-ops">
                      <button type="submit" name="op" value={`up:${n.id}`} disabled={i === 0} title="Gore">↑</button>
                      <button type="submit" name="op" value={`down:${n.id}`} disabled={i === items.length - 1} title="Dolje">↓</button>
                      <button type="submit" name="op" value={`del:${n.id}`} class="danger" title="Ukloni">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div class="nav-add">
            <input name="new_label" placeholder="Naziv nove stavke" maxlength={40} />
            <input name="new_target" placeholder="/aktivnosti ili https://…" maxlength={300} list="nav-targets" />
            <datalist id="nav-targets">
              {BUILTIN_TARGETS.map((t) => <option value={t} />)}
              {pages.map((p) => <option value={`/${p.slug}`}>{p.title}</option>)}
            </datalist>
          </div>
          <div class="nav-actions">
            <button type="submit" name="op" value="save" class="primary">Spremi</button>
            <button type="submit" name="op" value="preset" class="secondary-btn" data-confirm="Zamijeniti izbornik s 6 institucionalnih rubrika?">
              Postavi institucionalni izbornik (6 rubrika)
            </button>
            {items.length ? (
              <button type="submit" name="op" value="reset" class="secondary-btn" data-confirm="Obrisati sve stavke i vratiti automatski izbornik?">
                Vrati automatski izbornik
              </button>
            ) : null}
          </div>
          <p class="muted">
            Poveznice unutar stranice: <code>/</code>, <code>/tekstovi</code>, <code>/aktivnosti</code>, <code>/video</code>,{' '}
            <code>/projekti</code>, <code>/o-nama</code>, <code>/kategorija/…</code> ili <code>/slug-stranice</code>.
          </p>
        </form>
        <script src="/static/dashboard.js"></script>
      </PlatformLayout>
    );
  };

  app.get('/dashboard/:pubId/nav', async (c) => {
    const pub = pubOf(c);
    const [items, pages] = await Promise.all([
      navItems(c.env.DB, pub.id),
      c.env.DB.prepare("SELECT * FROM posts WHERE publication_id = ? AND kind = 'page' AND status = 'published' ORDER BY title")
        .bind(pub.id)
        .all<Post>()
        .then((r) => r.results),
    ]);
    return c.html(<NavPage pub={pub} user={c.get('user')!} items={items} pages={pages} saved={c.req.query('saved') === '1'} />);
  });

  app.post('/dashboard/:pubId/nav', async (c) => {
    const pub = pubOf(c);
    const db = c.env.DB;
    const body = await c.req.parseBody();
    const op = String(body.op ?? 'save');
    const cleanTarget = (raw: unknown) => {
      const v = String(raw ?? '').trim().slice(0, 300);
      if (/^https?:\/\/\S+$/.test(v)) return v;
      const path = '/' + v.replace(/^\/+/, '').replace(/[^a-z0-9/_.-]/gi, '').toLowerCase();
      return path;
    };

    if (op === 'preset' || op === 'reset') {
      const stmts = [db.prepare('DELETE FROM nav_items WHERE publication_id = ?').bind(pub.id)];
      if (op === 'preset') {
        INSTITUTION_NAV.forEach(([label, target], i) =>
          stmts.push(
            db.prepare('INSERT INTO nav_items (id, publication_id, label, target, position) VALUES (?, ?, ?, ?, ?)')
              .bind(newId(), pub.id, label, target, i)
          )
        );
      }
      await db.batch(stmts);
      return c.redirect(`/dashboard/${pub.id}/nav?saved=1`);
    }

    const items = await navItems(db, pub.id);
    // 1) Spremi izmjene postojećih stavki.
    let list = items.map((n) => ({
      ...n,
      label: String(body[`label.${n.id}`] ?? n.label).trim().slice(0, 40) || n.label,
      target: body[`target.${n.id}`] !== undefined ? cleanTarget(body[`target.${n.id}`]) : n.target,
      visible: body[`visible.${n.id}`] === '1' ? 1 : 0,
    }));
    // 2) Operacija nad jednom stavkom.
    const [verb, id] = op.split(':');
    const idx = list.findIndex((n) => n.id === id);
    const stmts: D1PreparedStatement[] = [];
    if (verb === 'del' && idx >= 0) {
      stmts.push(db.prepare('DELETE FROM nav_items WHERE id = ? AND publication_id = ?').bind(id, pub.id));
      list = list.filter((n) => n.id !== id);
    } else if ((verb === 'up' || verb === 'down') && idx >= 0) {
      const j = verb === 'up' ? idx - 1 : idx + 1;
      if (j >= 0 && j < list.length) [list[idx], list[j]] = [list[j], list[idx]];
    }
    // 3) Nova stavka.
    const newLabel = String(body.new_label ?? '').trim().slice(0, 40);
    const newTarget = String(body.new_target ?? '').trim();
    if (newLabel && newTarget) {
      const n = { id: newId(), publication_id: pub.id, label: newLabel, target: cleanTarget(newTarget), position: 0, visible: 1 };
      stmts.push(
        db.prepare('INSERT INTO nav_items (id, publication_id, label, target, position, visible) VALUES (?, ?, ?, ?, 0, 1)')
          .bind(n.id, pub.id, n.label, n.target)
      );
      list.push(n);
    }
    list.forEach((n, i) => {
      if (verb === 'del' && n.id === id) return;
      stmts.push(
        db.prepare('UPDATE nav_items SET label = ?, target = ?, visible = ?, position = ? WHERE id = ? AND publication_id = ?')
          .bind(n.label, n.target, n.visible, i, n.id, pub.id)
      );
    });
    if (stmts.length) await db.batch(stmts);
    return c.redirect(`/dashboard/${pub.id}/nav?saved=1`);
  });

  // --- Urednici (više administratora po publikaciji) ---

  app.get('/dashboard/:pubId/members', async (c) => {
    const pub = pubOf(c);
    const user = c.get('user')!;
    const isOwner = pub.owner_user_id === user.id;
    const [members, owner] = await Promise.all([
      membersForPub(c.env.DB, pub.id),
      c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(pub.owner_user_id).first<{ name: string; email: string }>(),
    ]);
    const msg = c.req.query('msg');
    return c.html(
      <PlatformLayout title={`Urednici — ${pub.name}`} user={user}>
        <DashNav pub={pub} active="members" />
        <div class="list-head">
          <h1>Urednici</h1>
          <span class="muted">Urednici mogu pisati, objavljivati i mijenjati postavke. Dodaje ih i uklanja samo vlasnik.</span>
        </div>
        {msg ? <Flash kind={c.req.query('ok') === '1' ? 'ok' : 'err'}>{msg.slice(0, 200)}</Flash> : null}
        <table class="table">
          <thead>
            <tr><th>Ime</th><th>Email</th><th>Uloga</th><th></th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{owner?.name}</td>
              <td>{owner?.email}</td>
              <td><span class="badge badge-published">vlasnik</span></td>
              <td></td>
            </tr>
            {members.map((m) => (
              <tr>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td><span class="badge">urednik</span></td>
                <td>
                  {isOwner ? (
                    <form method="post" action={`/dashboard/${pub.id}/members/${m.user_id}/delete`} class="inline-form">
                      <button type="submit" class="danger small">Ukloni</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isOwner ? (
          <form method="post" action={`/dashboard/${pub.id}/members`} class="cat-add">
            <input type="email" name="email" placeholder="email urednika" required />
            <button type="submit" class="primary">+ Dodaj urednika</button>
          </form>
        ) : null}
        <p class="muted">
          Urednik se prvo mora prijaviti na platformu (e-mailom i lozinkom ili Domovina računom) — tek tada ga možete
          dodati po e-mail adresi.
        </p>
      </PlatformLayout>
    );
  });

  app.post('/dashboard/:pubId/members', async (c) => {
    const pub = pubOf(c);
    const back = (msg: string, ok = false) =>
      c.redirect(`/dashboard/${pub.id}/members?msg=${encodeURIComponent(msg)}${ok ? '&ok=1' : ''}`);
    if (pub.owner_user_id !== c.get('user')!.id) return back('Urednike dodaje samo vlasnik publikacije.');
    const body = await c.req.parseBody();
    const email = String(body.email ?? '').trim().toLowerCase();
    const u = await c.env.DB.prepare('SELECT id, name FROM users WHERE email = ?').bind(email).first<{ id: string; name: string }>();
    if (!u) return back(`Korisnik ${email} još nema račun na platformi — neka se prvo prijavi.`);
    if (u.id === pub.owner_user_id) return back('To je vlasnik publikacije.');
    await c.env.DB.prepare('INSERT OR IGNORE INTO publication_members (publication_id, user_id, role) VALUES (?, ?, ?)')
      .bind(pub.id, u.id, 'editor')
      .run();
    return back(`${u.name} je dodan kao urednik.`, true);
  });

  app.post('/dashboard/:pubId/members/:userId/delete', async (c) => {
    const pub = pubOf(c);
    if (pub.owner_user_id === c.get('user')!.id) {
      await c.env.DB.prepare('DELETE FROM publication_members WHERE publication_id = ? AND user_id = ?')
        .bind(pub.id, c.req.param('userId'))
        .run();
    }
    return c.redirect(`/dashboard/${pub.id}/members`);
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
          <span class="media-upload" data-pub-id={pub.id}>
            <button type="button" class="btn" id="media-upload-btn">+ Učitaj (slika, video, PDF)</button>
            <input type="file" id="media-upload-input" hidden multiple accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,application/pdf" />
            <span id="upload-status" class="muted"></span>
          </span>
        </div>
        <div class="media-grid">
          {items.map((m) => (
            <figure class="media-item">
              {m.kind === 'image' ? (
                <img src={mediaUrl(m.id, m.filename)} alt={m.filename} loading="lazy" />
              ) : m.kind === 'file' ? (
                <a class="media-file" href={mediaUrl(m.id, m.filename)} target="_blank">
                  PDF
                </a>
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
        <script src="/static/dashboard.js"></script>
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
            O nama (markdown) — stranica /o-nama; na institucionalnoj naslovnici ujedno i uvodni tekst
            <textarea name="about_md" rows={8}>{pub.about_md}</textarea>
          </label>
          <label>
            Raspored naslovnice
            <select name="home_layout">
              <option value="blog" selected={pub.home_layout !== 'institution'}>Blog — istaknuti tekst + najnovije + rubrike</option>
              <option value="institution" selected={pub.home_layout === 'institution'}>
                Institucija — uvod, istaknuto, tekstovi, aktivnosti, video, projekti
              </option>
            </select>
          </label>
          <div class="field-row">
            <label>
              Tipografija
              <select name="font_preset">
                {Object.entries(FONT_PRESETS).map(([k, f]) => (
                  <option value={k} selected={pub.font_preset === k}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Veličina teksta
              <select name="text_size">
                {Object.entries(TEXT_SIZES).map(([k, t]) => (
                  <option value={k} selected={pub.text_size === k}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Podnožje (markdown) — kontakt, adresa, društvene mreže
            <textarea name="footer_md" rows={4} placeholder={'Kontakt: info@primjer.hr · [Facebook](https://facebook.com/…)'}>
              {pub.footer_md}
            </textarea>
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
          Adresa publikacije: <a href={siteUrl(pub)} target="_blank">{siteUrl(pub)}</a>
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
    const homeLayout = body.home_layout === 'institution' ? 'institution' : 'blog';
    const fontPreset = String(body.font_preset ?? '') in FONT_PRESETS ? String(body.font_preset) : pub.font_preset;
    const textSize = String(body.text_size ?? '') in TEXT_SIZES ? String(body.text_size) : pub.text_size;
    const footerMd = String(body.footer_md ?? '').slice(0, 2000);
    await c.env.DB.prepare(
      'UPDATE publications SET name=?, tagline=?, about_md=?, about_html=?, accent_color=?, logo_media_id=?, custom_domain=?, home_layout=?, font_preset=?, text_size=?, footer_md=?, footer_html=? WHERE id=?'
    )
      .bind(name, tagline, aboutMd, renderMarkdown(aboutMd), accent, logo, domain, homeLayout, fontPreset, textSize, footerMd, renderMarkdown(footerMd), pub.id)
      .run();
    return c.redirect(`/dashboard/${pub.id}/settings?saved=1`);
  });
}
