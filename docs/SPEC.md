# SPEC — Tehnoetika Platform

**Single source of truth** za open-source multitenant SaaS platformu za pisanje — jednostavnu alternativu Substacku. Naručitelj: Luka Goleš Babić. Referentne publikacije: [tehnoetika.substack.com](https://tehnoetika.substack.com/) i [sapereaudecro.substack.com](https://sapereaudecro.substack.com/).

Konsolidirano iz tri research izvještaja (2026-07-11): analiza Substack profila, MVP feature set open-source alternativa, Cloudflare arhitektura.

---

## 1. Što gradimo

Jedna deployana instanca (jedan Cloudflare Worker) hosta **N publikacija** (tenanta). Svaki autor dobiva vlastitu publikaciju s javnim stranicama za tekstove, slike i video. Sve besplatno, bez naplate — fokus na pisanju i objavi.

### Nalazi iz analize referentnih publikacija

| | Tehnoetika | Sapere Aude |
|---|---|---|
| Sadržaj | ~12 dugih eseja / pozicijskih dokumenata | ~500+ postova od 2019., 2–3 tjedno |
| Jezik | hrvatski | hrvatski |
| Byline | institucionalni (Savjet), ne osobni | kolektivni portal |
| Formati | long-form tekst, "Sažetak" uvod, fusnote, H2–H4, numerirane liste | eseji s cover slikama, kratki postovi s inline slikama, **video-reakcije** (Facebook/YouTube embed), najave događanja |
| Monetizacija | nema (free) | nema (free) |

**Izvedeni zahtjevi:**
- Hrvatski jezik UI-ja i sadržaja; dijakritika u tekstu, ASCII slugovi (`o-ustavnoj-zastiti-gotovine`), dedup sufiksi kod kolizije
- Post: naslov, podnaslov, cover slika, datum, byline publikacije (avatar + ime)
- Bogato formatiranje: H2–H4, bold/italic, citati, horizontalne linije, numerirane/bullet liste, linkovi, inline slike, fusnote (markdown pokriva sve)
- **Video embed** (YouTube, Vimeo, Facebook/fb.watch) — zalijepiš URL u zasebni red, renderira se player
- Upload vlastitog videa (mp4/webm) i slika
- Stranice-postovi za navigaciju (npr. "Aktivnosti", "O nama") — postovi tipa `page` prikazani u navigaciji
- Arhiva kronološki s thumbnailovima i paginacijom (mora podnijeti i 12 i 500+ postova)
- Email subscribe (samo free), RSS

## 2. MVP opseg

### Uključeno
1. **Multitenant publikacije** — rezolucija tenanta po subdomeni (`{slug}.example.com`) s path fallbackom (`/@{slug}`) koji radi na `workers.dev` i lokalno
2. **Auth** — registracija/prijava emailom i lozinkom, cookie sesije; svaki korisnik može imati više publikacija
3. **Editor** — markdown s live previewom; draft → objavljeno; autoslug iz naslova (hrvatska dijakritika → ASCII)
4. **Media** — upload slika (jpeg/png/gif/webp, ≤10 MB) i videa (mp4/webm, ≤95 MB) na R2; serviranje kroz Worker s Range podrškom (206) za video
5. **Javne stranice** (SSR): naslovnica, arhiva s paginacijom, post, about, stranice u navigaciji, RSS 2.0, sitemap, OG meta tagovi
6. **Subscriberi** — email capture forma, potvrda (double opt-in ako je email provider konfiguriran, inače auto-confirm), unsubscribe token, CSV export
7. **Dashboard** — lista postova (draft/objavljeno), editor, media knjižnica, subscriberi, postavke publikacije (ime, tagline, opis, logo, akcentna boja)

### Izvan opsega (svjesno)
Naplata/Stripe/paywall (shema rezervira `visibility` polje) · masovno slanje newslettera (samo confirm email; kasnije Resend/Listmonk iza `EmailProvider` sučelja) · komentari, lajkovi, Notes, preporuke · podcast hosting · custom domene po tenantu (polje u shemi; aktivacija = Cloudflare for SaaS, 100 hostnames free) · više autora po publikaciji (owner-only; kasnije `publication_members`) · transkodiranje videa (Cloudflare Stream kao paid upgrade path) · teme (jedna tema + akcentna boja/logo) · analitika.

## 3. Arhitektura (Cloudflare)

**Jedan Worker: Hono + `hono/jsx` SSR.** Najmanji bundle, bez adaptera, jedan router za javne stranice + dashboard + API. tsconfig: `"jsx": "react-jsx"`, `"jsxImportSource": "hono/jsx"`.

| Komponenta | Izbor | Zašto |
|---|---|---|
| Compute | Workers + Hono | SSR HTML + JSON API + admin u jednom Workeru; bundle u KB |
| Baza | **D1**, jedna shared baza, `publication_id` na svakoj tenant tablici | 10 GB (paid) / 500 MB (free) dovoljno za tekst; indeksi na svaki `(publication_id, …)` lookup jer se naplaćuju *skenirani* redovi |
| Media | **R2** bucket, ključevi `pub/{publication_id}/{media_id}/{filename}` | $0 egress; serviranje kroz Worker s Range za video; custom-domain public bucket kasnija optimizacija |
| Sesije | D1 tablica (`token_hash` = SHA-256 tokena) | trajno, revocable; KV opcionalno kao cache |
| Static assets | Workers Static Assets (`public/`, binding `ASSETS`) | CSS/JS se servira prije Workera, besplatno |

### Routing tenanta
- Prod: Workers **routes** `example.com/*` + `*.example.com/*` (wildcard DNS proxied; Universal SSL pokriva `*.example.com`). Workers Custom Domains NE podržavaju wildcard — koristiti routes.
- `workers.dev` NEMA wildcard subdomene → path-based `/@{slug}` je primarni mod dok se ne spoji domena.
- Middleware: `Host` header → subdomena ≠ apex → tenant; inače `/@{slug}` prefix → tenant; inače platformske stranice (landing, auth, dashboard).
- `PLATFORM_HOST` env var definira apex. Rezervirani slugovi: `www, app, admin, api, mail, assets, dashboard, static, media, feed`.

### Auth
- PBKDF2-SHA-384, **100.000 iteracija** (WebCrypto cap u Workers), 16-byte salt, format `pbkdf2-sha384$100000$salt$hash` (omogućuje buduću nadogradnju)
- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, 30 dana; sesije u D1
- Rate limiting prijave: jednostavan brojač neuspjeha po emailu u D1; Turnstile kao kasnija nadogradnja

### Upload i video
- Upload ide kroz Worker (`env.MEDIA.put(key, body)`) — zona limit 100 MB tijela zahtjeva na Free/Pro → cap videa 95 MB, slika 10 MB
- Video se servira kroz Worker: parse `Range` header → `get(key, {range})` → `206` + `Content-Range` + `Accept-Ranges: bytes` + `ETag` (koristiti `httpEtag`)
- Bez transkodiranja: uputa autoru "web-ready MP4 (H.264/AAC)"; veći videi → YouTube/Facebook embed (što Sapere Aude ionako radi)
- Presigned S3 URL-ovi za >100 MB: post-MVP

### Email
- `EmailProvider` sučelje; MVP podržava **Resend** (HTTP API, `RESEND_API_KEY` secret) i **noop** (bez providera → subscriber odmah `confirmed`)
- MailChannels free Workers integracija je ugašena (EOL 2024-08-31) — ne koristiti
- Cloudflare Email Service (Beta, Workers Paid) — opcija kasnije

### Markdown i sigurnost
- `marked` za render; **raw HTML se escapea** (XSS izolacija među tenantima)
- Embed: redak koji je sam URL na YouTube/Vimeo/fb.watch/Facebook video → responsive iframe; redak koji je URL na uploadani video/sliku → `<video>`/`<img>`
- Renderirani HTML se kešira u `posts.body_html` (regeneracija pri spremanju)

## 4. Model podataka (D1 / SQLite)

SQLite konvencije: `INTEGER` 0/1 za bool, `TEXT` ISO-8601 za datume, `PRAGMA foreign_keys = ON` po konekciji nije trajan → FK definirani u shemi, brisanje eksplicitno. ID-jevi: 16-byte random hex.

```
users            id, email UNIQUE, password_hash, name, created_at
sessions         id, user_id→users, token_hash UNIQUE, expires_at, created_at
publications     id, owner_user_id→users, slug UNIQUE, name, tagline, about_md, about_html,
                 logo_media_id, accent_color, custom_domain UNIQUE NULL, locale ('hr'), created_at
posts            id, publication_id→publications, slug, title, subtitle, body_md, body_html,
                 cover_media_id, kind ('post'|'page'), status ('draft'|'published'),
                 visibility ('public'), pinned_nav INTEGER, published_at, created_at, updated_at
                 UNIQUE(publication_id, slug); INDEX(publication_id, status, published_at DESC)
media            id, publication_id, kind ('image'|'video'), storage_key, filename, mime_type,
                 byte_size, created_at; INDEX(publication_id, created_at DESC)
subscribers      id, publication_id, email, status ('pending'|'confirmed'|'unsubscribed'),
                 confirm_token, unsubscribe_token, confirmed_at, created_at
                 UNIQUE(publication_id, email)
login_attempts   email, window_start, count (rate limiting)
```

## 5. URL mapa

**Platforma (apex):** `/` landing (popis publikacija + CTA) · `/auth/register|login|logout` · `/dashboard` (izbor publikacije, nova publikacija) · `/dashboard/:pubId/posts|posts/new|posts/:id|media|subscribers|settings` · `/api/:pubId/upload` (POST multipart) · `/api/preview` (POST markdown→HTML)

**Tenant (subdomena ili `/@slug` prefix):** `/` naslovnica · `/archive` (paginacija `?page=`) · `/p/:slug` post · `/about` · `/feed.xml` · `/sitemap.xml` · `/subscribe` (POST) · `/confirm/:token` · `/unsubscribe/:token`

**Media (globalno):** `/media/:mediaId/:filename` — Range podrška, `Cache-Control: public, max-age=31536000, immutable`

## 6. Struktura projekta

```
src/index.tsx        entry: Hono app, tenant middleware, mount ruta
src/db.ts            tipovi + tenant-scoped data access (prepared statements, bind())
src/auth.ts          PBKDF2, sesije, cookie helpers, rate limit
src/markdown.ts      marked config + embed transform + slugify (hr dijakritika)
src/email.ts         EmailProvider (resend | noop)
src/routes/public.tsx   tenant javne stranice + RSS + sitemap + subscribe
src/routes/dashboard.tsx dashboard + editor
src/routes/api.ts       upload, preview
src/routes/media.ts     R2 serving s Range
src/views/*.tsx      layouts + komponente
public/style.css     jedna tema (clean Substack look, akcentna boja kao CSS var)
migrations/0001_init.sql
seed.sql             demo: publikacije "tehnoetika" i "sapereaude" + demo post
wrangler.jsonc
```

## 7. Wrangler konfiguracija

```jsonc
{
  "name": "tehnoetika-app",
  "main": "src/index.tsx",
  "compatibility_date": "2026-07-01",
  "assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": true },
  "d1_databases": [{ "binding": "DB", "database_name": "tehnoetika-db", "database_id": "…", "migrations_dir": "migrations" }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "tehnoetika-media" }],
  "vars": { "PLATFORM_HOST": "" },
  "observability": { "enabled": true }
  // routes za produkcijsku domenu dodati kad postoji zona; secrets: RESEND_API_KEY (opcionalno)
}
```

**Dev:** `npm run db:migrate:local && npm run db:seed:local && npm run dev` → `http://localhost:8787`, tenant kao `/@tehnoetika`.
**Deploy:** `wrangler d1 create` + `wrangler r2 bucket create` → upisati ID-jeve → `npm run db:migrate:remote` → `npm run deploy`.

## 8. Ograničenja platforme (relevantna)

| Limit | Vrijednost | Posljedica |
|---|---|---|
| Worker CPU (free) | 10 ms | PBKDF2 @100k je na rubu — auth može zahtijevati Workers Paid (30 s); sve ostalo stane |
| Request body (Free/Pro zona) | 100 MB | cap upload videa 95 MB |
| D1 free | 500 MB, 5M reads/dan | dovoljno za start; indeksirati sve tenant lookupe |
| R2 free | 10 GB, egress $0 | dovoljno za slike + kraće videe |
| workers.dev | bez wildcard subdomena | path-based tenancy dok se ne spoji vlastita domena |
