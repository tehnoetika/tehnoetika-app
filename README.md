# Tehnoetika Platforma

Open-source **multitenant platforma za pisanje** — jednostavna alternativa Substacku, izgrađena u potpunosti na Cloudflare stacku (Workers + D1 + R2). Jedna deployana instanca hosta više publikacija; svaki autor dobiva vlastitu stranicu za tekstove, slike i video.

Specifikacija i arhitekturne odluke: **[docs/SPEC.md](docs/SPEC.md)** (single source of truth).

## Funkcionalnosti

- **Multitenant publikacije** — rezolucija po subdomeni (`slug.vasa-domena.hr`) ili path fallbacku (`/@slug`, radi i na `*.workers.dev`); polje za buduću vlastitu domenu po publikaciji
- **Pisanje** — markdown editor s previewom, skica → objava, ASCII slugovi iz hrvatskih naslova, naslovna slika, podnaslov
- **Media** — upload slika (≤10 MB) i videa (MP4/WebM ≤95 MB) na R2; video streaming s Range (206) podrškom; YouTube/Vimeo/Facebook embed lijepljenjem linka u zaseban red
- **Javne stranice** — naslovnica, arhiva s paginacijom, post, "O nama", stranice u navigaciji (npr. "Aktivnosti"), RSS 2.0, sitemap, OG meta tagovi, akcentna boja i logo po publikaciji
- **Pretplatnici** — email capture, double opt-in (uz konfiguriran email provider; bez njega auto-potvrda), odjava tokenom, CSV export
- **Auth** — email + lozinka (PBKDF2-SHA-384), cookie sesije u D1, rate limit prijave
- **Sigurnost** — raw HTML u markdownu se escapea (XSS izolacija među tenantima), tenant-scoped upiti, authz na uploadu i dashboardu

## Lokalni razvoj

```bash
npm install
npm run db:migrate:local   # primijeni D1 migracije lokalno
npm run db:seed:local      # demo podaci (luka@example.com / sapereaude)
npm run dev                # http://localhost:8787
```

Publikacije su na `http://localhost:8787/@tehnoetika` i `/@sapereaude`; dashboard na `/dashboard`.

## Deploy na Cloudflare

1. **Resursi:**
   ```bash
   npx wrangler d1 create tehnoetika-db      # upiši database_id u wrangler.jsonc
   npx wrangler r2 bucket create tehnoetika-media
   ```
2. **Migracije i deploy:**
   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```
   Aplikacija odmah radi na `<name>.<account>.workers.dev` s path-based tenancy (`/@slug`).

3. **Vlastita domena sa subdomenama po publikaciji** (opcionalno):
   - Dodaj zonu u Cloudflare, napravi **proxied wildcard DNS** zapis `*` i apex zapis
   - U `wrangler.jsonc` odkomentiraj `routes` (apex `example.com/*` + `*.example.com/*`) i postavi `"PLATFORM_HOST": "example.com"`, pa ponovno `npm run deploy`
   - Universal SSL pokriva `*.example.com`; Workers Custom Domains ne podržavaju wildcard — koriste se routes
   - `*.workers.dev` nema wildcard subdomene, zato path mode ostaje fallback

4. **Slanje emailova za double opt-in** (opcionalno):
   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```
   i postavi `EMAIL_FROM` u `wrangler.jsonc` (verificirana adresa kod Resenda). Bez toga se pretplatnici potvrđuju odmah, bez slanja emaila.

## Ograničenja (svjesna, vidi SPEC §8)

- Video se poslužuje bez transkodiranja — preporuka autorima: web-ready MP4 (H.264/AAC) do 95 MB, veće na YouTube/Facebook pa embed; Cloudflare Stream je plaćeni upgrade path
- Newsletter blast (slanje svakog posta svim pretplatnicima) nije u MVP-u — lista se izvozi u CSV; `EmailProvider` sučelje je spremno za nadogradnju
- Naplata/paywall, komentari i više autora po publikaciji su izvan opsega MVP-a (shema ih anticipira)
- Free Workers plan ima 10 ms CPU-a — PBKDF2 pri prijavi može zahtijevati Workers Paid plan

## Stack

Cloudflare Workers · [Hono](https://hono.dev) + `hono/jsx` SSR · D1 (SQLite) · R2 · Workers Static Assets · TypeScript · [marked](https://marked.js.org)

## Licenca

MIT
