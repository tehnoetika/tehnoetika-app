# PLAN — Tehnoetika institucionalna stranica (Lukin feature request)

Analiza postojećeg stanja i plan razvoja za zahtjev od 2026-08-14:

> Tehnoetika.domovina.ai (kasnije prebacujemo u tehnoetika.hr) · 6 pageva: Tekstovi, Aktivnosti (events), Video materijali, O nama, Projekti, Deklaracija · Login za admina — admin upravlja CMS-om · CMS — objave tekstova imaju napredniji designer (moguće dodavanje slika, uređivanje fontova)

Nadopunjuje [SPEC.md](SPEC.md) (arhitektura ostaje ista); ovdje je samo delta.

---

## 1. Što već imamo (provjereno na živoj instanci)

| Područje | Stanje |
|---|---|
| Runtime | Worker `tehnoetika-app` (Hono + `hono/jsx` SSR), D1 `tehnoetika-db`, R2 `tehnoetika-media`, račun D.O.M. |
| Domene | `tehnoetika.com` (platforma), `www.tehnoetika.com` → tenant `lukademo` preko `custom_domain`, wildcard route `*.tehnoetika.com/*` → tenant po slugu |
| Publikacije | `domovina`, `savjet` ("Savjet za tehnoetiku i antitotalitarizam", 2 test posta), `lukademo` (486 postova, 408 covera) |
| Login | e-mail + lozinka (PBKDF2-SHA-384) na `/auth/login` **i** Domovina SSO (magic link + Google) na `/prijava`; cookie sesije u D1 |
| Autorizacija | vlasnik publikacije (`owner_user_id`) vidi i uređuje samo svoje — guard u `src/routes/dashboard.tsx:424` |
| CMS | lista objava, editor, rubrike, medijska knjižnica, pretplatnici, postavke publikacije |
| Editor | markdown + toolbar (B, I, H2, citat, lista, link), upload slike/videa klikom, drag&dropom i paste-om, pregled, naslovna slika, rubrika, slug, skica → objava |
| Javne rute | `/`, `/archive`, `/kategorija/:slug`, `/p/:slug`, `/about`, `/feed.xml`, `/sitemap.xml`, subscribe/confirm/unsubscribe |
| Stranice | `posts.kind = 'page'` + `pinned_nav` → statična stranica u navigaciji (već pokriva "O nama", "Deklaracija", "Projekti" kao čisti tekst) |
| Mediji | R2 + serviranje kroz Worker s Range (206) za video; YouTube/Vimeo/Facebook embed lijepljenjem linka u zaseban red |

**Zaključak:** kostur (multitenancy, auth, CMS, mediji, SEO) je gotov. Nedostaju **tipovi sadržaja** (događaji, video, projekti), **konfigurabilna navigacija**, **domena** i **jači editor**.

## 2. Gap analiza prema Lukinom zahtjevu

| Traženo | Imamo | Nedostaje |
|---|---|---|
| `tehnoetika.domovina.ai` | app već razrješava tenant po `custom_domain` (`src/index.tsx:34`) | DNS/route za taj host; DNS zapis trenutno **ne postoji** (`dig` prazan) |
| kasnije `tehnoetika.hr` | jedno polje `custom_domain` po publikaciji | podrška za više domena po publikaciji + 301 sa starog hosta |
| **Tekstovi** | `/archive` s paginacijom | hrvatski URL `/tekstovi`, filtriranje po rubrici |
| **Aktivnosti (events)** | ništa (samo obična objava) | model događaja: datum, vrijeme, lokacija, link; popis "nadolazeće / prošle" + bilješka o odrađenoj aktivnosti |
| **Video materijali** | embed radi unutar objave | tip sadržaja `video` + galerija s thumbnailovima (MVP: samo YouTube) |
| **O nama** | `/about` iz `publications.about_md` | samo sadržaj |
| **Projekti** | ništa | tip sadržaja `project` (naziv, opis, slika, status, poveznica) |
| **Deklaracija** | statična stranica | sadržaj + PDF za preuzimanje (opcionalno potpisnici) |
| Login za admina | ✅ lozinka + Domovina SSO, owner-only guard | ništa nužno; više admina po publikaciji je backlog |
| Napredniji designer | markdown toolbar, upload slika | dijalog za sliku (opis, poravnanje, širina), tipografski blokovi, tipografski preseti, live preview |
| Navigacija od 6 stavki | nav se generira automatski (Početna, rubrike, Arhiva, stranice, O nama) | uređivanje izbornika (naziv, redoslijed, vidljivost) |
| Naslovnica | blogovski raspored (hero + najnovije + sekcije rubrika) | institucionalni raspored za Savjet |

---

## 3. Plan razvoja

### Faza 0 — Domena `tehnoetika.domovina.ai` (0,5 dana)

1. Utvrditi u kojem je Cloudflare računu zona `domovina.ai` (nameserveri su Cloudflare, ali račun vjerojatno nije D.O.M.).
2. **Ako je zona u istom računu (D.O.M.):** u `wrangler.jsonc` dodati `{ "pattern": "tehnoetika.domovina.ai", "custom_domain": true }` → wrangler sam radi DNS + certifikat.
3. **Ako je zona u drugom računu (očekivano):** Cloudflare for SaaS na zoni `tehnoetika.com` — Custom Hostname `tehnoetika.domovina.ai` + fallback origin; u zoni `domovina.ai` proxied CNAME na fallback origin + TXT validacija. Besplatno do 100 hostnameova i isti mehanizam koji ionako treba za `tehnoetika.hr` i za tenant domene općenito.
4. U dashboardu publikacije → Postavke → Vlastita domena = `tehnoetika.domovina.ai`.
5. Domovina SSO: **dodati** (ne prepisati) `https://tehnoetika.domovina.ai/prijava` u GoTrue redirect allowlist.
6. Selidba na `tehnoetika.hr` kasnije: nova migracija s tablicom `publication_domains` (primarna + aliasi) i 301 s aliasa na primarnu; do tada je dovoljno promijeniti `custom_domain`.

### Faza 1 — Tipovi sadržaja i navigacija (3 dana)

**Migracija `0003_content_types.sql`:**

```sql
-- kind već ima CHECK ('post','page'); SQLite ne mijenja CHECK ALTER-om,
-- pa novi tipovi idu u zaseban stupac bez CHECK-a (bez rebuilda tablice).
ALTER TABLE posts ADD COLUMN post_type TEXT NOT NULL DEFAULT 'text'; -- text|event|video|project
ALTER TABLE posts ADD COLUMN event_start TEXT;      -- ISO-8601
ALTER TABLE posts ADD COLUMN event_end TEXT;
ALTER TABLE posts ADD COLUMN event_location TEXT;
ALTER TABLE posts ADD COLUMN link_url TEXT;         -- vanjska poveznica (projekt, prijava, izvor)
CREATE INDEX idx_posts_type ON posts(publication_id, post_type, published_at DESC);
CREATE INDEX idx_posts_event ON posts(publication_id, event_start);

CREATE TABLE nav_items (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  label TEXT NOT NULL,
  kind TEXT NOT NULL,      -- section|category|page|url|home
  target TEXT NOT NULL,    -- 'tekstovi' | slug rubrike | slug stranice | apsolutni URL
  position INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_nav_pub ON nav_items(publication_id, position);
```

**Javne rute** (`src/routes/public.tsx`) — hrvatski URL-ovi, stari ostaju kao 301:

| Ruta | Sadržaj |
|---|---|
| `/tekstovi` | `post_type = 'text'`, paginacija, filter po rubrici (`/archive` → 301) |
| `/aktivnosti` | nadolazeći događaji uzlazno + prošli silazno; datum, vrijeme, lokacija; `.ics` po događaju. Prošli događaj ima **bilješku o odrađenoj aktivnosti** (isto tijelo objave + slike) — bez prijava sudionika |
| `/video` | grid s naslovnim slikama; detalj s embedom (MVP: YouTube; vidi §3.1 za R2 put) |
| `/projekti` | kartice: slika, naziv, opis, status, poveznica |
| `/o-nama` | postojeći `about_html` (`/about` → 301) |
| `/:slug` | stranice (`kind = 'page'`) dobivaju lijepi URL — registrira se **zadnje**, prije 404 |

Navigacija: `TenantLayout` (`src/views/layout.tsx:77`) prestaje generirati izbornik automatski i čita `nav_items`; fallback na današnje ponašanje kad tablica nema zapisa (da `lukademo` i `domovina` ostanu nepromijenjeni).

**Dashboard:** u editoru odabir tipa ("Tekst / Događaj / Video / Projekt") s uvjetnim poljima (datum i vrijeme, lokacija, poveznica); lista objava dobiva filter po tipu; nova stranica **Izbornik** za redoslijed, nazive i vidljivost stavki.

RSS i sitemap uključuju nove tipove.

#### 3.1 Video: YouTube za MVP, R2 + HTML5 player kao ciljno stanje

Luka je za prvu ruku tražio **samo YouTube embed** — to već radi (`src/markdown.ts:45`), pa je za MVP dovoljno na tip `video` staviti polje s YouTube URL-om i renderirati postojeći embed.

Ciljno stanje je ipak **vlastito hostanje na R2 + HTML5 `<video>` player**, i to iz jednog razloga: R2 nema naplatu egressa, a serviranje kroz Worker s Range podrškom (206) već je implementirano (`src/routes/media.ts`) i radi dobro. Time video materijali prestaju ovisiti o YouTubeu (brisanje, demonetizacija, moderacija, tracking gledatelja) uz nula troška prometa.

Zato u Fazi 1 model treba biti **spreman za oba izvora od prvog dana**, iako se implementira samo YouTube:

- `video_source TEXT` (`youtube` | `r2`) i `video_url TEXT` uz postojeći `cover_media_id` za thumbnail
- kod izvora `r2` video se već sada može uploadati kroz editor (MP4/WebM do 95 MB) i servirati preko `/media/:id/:filename`
- prikaz na `/video` je isti u oba slučaja — mijenja se samo player u detalju objave

Ograničenja koja treba imati na umu prije prelaska na R2: nema transkodiranja (autor mora dati web-ready MP4 H.264/AAC), limit tijela zahtjeva je 100 MB na Free/Pro zoni (odatle cap od 95 MB), a za veće datoteke treba presigned upload izravno na R2 ili Cloudflare Stream (plaćeno). Thumbnail se za R2 videe ne generira automatski — uzima se naslovna slika objave.

**Ovo je zabilježeno kao odluka, ne kao zadatak za sada.**

### Faza 2 — Napredniji editor (3 dana)

**Potvrđeno s Lukom:** ne treba WYSIWYG — treba "kao na Substacku": uređivanje teksta po stilovima i tipografiji te lako dodavanje slika. To je točno opcija ispod.

Ostajemo na **markdownu kao izvoru istine** i nadograđujemo sučelje. Markdown čuva 486 postojećih postova, izbjegava sanitizaciju HTML-a i drži bundle malim.

- Toolbar u dva reda: **blokovi** (H2, H3, citat, istaknuti citat, lista, numerirana lista, linija, tablica), **inline** (bold, kurziv, poveznica, fusnota), **umetanje** (slika iz knjižnice, upload, video embed).
- **Plutajući toolbar na označeni tekst** (Substack model): označiš rečenicu → iznad se pojavi B / I / poveznica / naslov / citat. Ovo je ono što Luka misli pod "uređivanje po stilovima".
- **Dijalog za sliku:** odabir iz medijske knjižnice ili upload, opis (caption), poravnanje (uz tekst / centrirano / preko cijele širine) → umeće `![alt](url "opis"){.wide}`.
- `src/markdown.ts`: `<figure>` + `<figcaption>`, whitelist klasa (`.wide .center .left .right`), istaknuti citat, fusnote. Whitelist, ne prolaz raw HTML-a — XSS izolacija ostaje.
- Live split preview (bez klika na "Pregled"), autosave skice svakih ~20 s, brojač riječi i procjena vremena čitanja.
- **"Uređivanje fontova"** rješava se kao tipografija publikacije, ne po odlomku: u Postavkama 2–3 presetа para fontova (Lora/Spectral, Playfair/Source Serif, Newsreader/Inter) + veličina osnovnog teksta. Proizvoljni font po odlomku namjerno izbjegavamo — razbija tipografsku konzistentnost stranice; ovo treba dogovoriti s Lukom.

Alternativa (ako Luka traži pravi WYSIWYG): TipTap/ProseMirror, novi stupac `body_format ('md'|'html')`, sanitizacija na serveru preko `HTMLRewriter` s allowlistom. Cijena: ~7 dana, ~150 KB klijentskog JS-a, novi XSS-površina i dvostruki format u bazi.

### Faza 3 — Institucionalna naslovnica i dizajn (1,5 dan)

- Novo polje `publications.home_layout ('blog'|'institution')`.
- Institucionalni raspored: kratak uvod Savjeta → istaknuta Deklaracija → 3 najnovija teksta → nadolazeće aktivnosti → zadnji video → projekti.
- Logo/wordmark Savjeta, akcentna boja, footer s kontaktom i društvenim mrežama.
- Mobilna navigacija (hamburger) — 6 stavki više ne stane u današnji jednoredni izbornik.

### Faza 4 — Sadržaj, SEO i lansiranje (1 dan + Lukin unos)

- Unos: O nama, Deklaracija (+ PDF), Projekti, prve aktivnosti, video materijali.
- Uvoz 12 postojećih eseja s `tehnoetika.substack.com` (postojeći seed pipeline korišten za `lukademo`).
- `robots.txt`, OG slike, Cloudflare Web Analytics, provjera `sitemap.xml` s novim rutama.

**Ukupno: ~9 radnih dana** (Faza 2 opcijom WYSIWYG: ~13).

---

## 4. Odluke (Lukin feedback, 2026-08-14)

| Pitanje | Odluka | Posljedica za plan |
|---|---|---|
| Aktivnosti | **Samo najave** + bilješke o odrađenim aktivnostima | Nema RSVP-a ni prijava. Prošli događaj = ista objava s izvještajem i slikama; popis se dijeli na "nadolazeće" i "održano" |
| Deklaracija | **Tekst + PDF** | Nema prikupljanja potpisa ni popisa potpisnika. Stranica + gumb za preuzimanje PDF-a (upload kroz medijsku knjižnicu — treba dopustiti `application/pdf` u `src/routes/api.ts`) |
| Video materijali | **Samo YouTube embed** za MVP | Tip `video` + polje s YouTube URL-om; embed već postoji. Model se ipak radi dvoizvorno — vidi §3.1 |
| Video (ciljno) | **R2 + HTML5 player** čim MVP prođe | Besplatan egress, Range streaming već implementiran; ne ovisimo o YouTubeu. Zabilježeno, **ne implementira se sada** |
| Editor | **Ne treba WYSIWYG** — "kao na Substacku": stilovi, tipografija, slike | Potvrđuje Fazu 2 opciju A (nadograđeni markdown + plutajući toolbar na selekciji). TipTap se skida sa stola |
| Više admina | Poželjno **ubuduće**, nije prioritet | Ostaje backlog, ali shemu i guardove pišemo tako da `publication_members` kasnije uđe bez migracije postojećih ovlasti |

## 5. Backlog (svjesno izvan prve ruke)

Više admina po publikaciji (`publication_members` + role) · vlastito hostanje videa na R2 s HTML5 playerom (§3.1) · slanje newslettera pretplatnicima · prijave na događaje (RSVP) · prikupljanje potpisa za Deklaraciju · tražilica · engleska verzija Deklaracije.

## 6. Stanje implementacije (2026-09-23)

Otvorena pitanja su zatvorena ovako: stranica ide na postojeću publikaciju **`savjet`** (Lukin račun), a zona `domovina.ai` je u računu D.O.M., pa je `tehnoetika.domovina.ai` običan Worker `custom_domain` (bez Cloudflare for SaaS). Stranica je dostupna i na `savjet.tehnoetika.com`.

| Faza | Stanje | Gdje u kodu |
|---|---|---|
| 0 — domena | `tehnoetika.domovina.ai` → publikacija `savjet` | `wrangler.jsonc` routes, `publications.custom_domain` |
| 1 — tipovi sadržaja | `post_type` text/event/video/project; `/tekstovi` (+ `?rubrika=`), `/aktivnosti` (nadolazeće/održano, `.ics`), `/video`, `/projekti`, `/o-nama`, stranice na `/:slug`; stari URL-ovi 301 | `migrations/0003_institution.sql`, `src/routes/public.tsx`, `src/events.ts` |
| 1 — izbornik | tablica `nav_items`, dashboard **Izbornik** (naziv, redoslijed, vidljivost, preset od 6 rubrika); prazno = automatski izbornik | `src/routes/dashboard.tsx` |
| 1 — PDF | `media.kind = 'file'` (PDF do 25 MB), `posts.attachment_media_id`, `?download=1` | `src/routes/api.ts`, `src/routes/media.ts` |
| 2 — editor | toolbar u dva reda, plutajuća traka na označenom tekstu, dijalog za sliku (knjižnica/upload, opis, poravnanje), video dijalog, fusnote, istaknuti citat, tablica, pregled uživo, autosave u preglednik, brojač riječi; tipografski preseti + veličina teksta u Postavkama | `public/static/dashboard.js`, `src/markdown.ts`, `src/views/layout.tsx` |
| 3 — naslovnica | `home_layout = 'institution'`: uvod → istaknuto → tekstovi + nadolazeće aktivnosti → video → projekti; mobilni izbornik; podnožje (markdown) | `src/routes/public.tsx`, `public/static/style.css` |
| 4 — sadržaj | uvezeno 9 objava s `tehnoetika.substack.com` (8 tekstova + Deklaracija kao stranica s PDF-om); predstavljanje Savjeta → "O nama"; logo štita; robots.txt, canonical, OG | `scripts/substack-import/` |
| Više urednika | `publication_members` + dashboard **Urednici** (dodaje/uklanja vlasnik; urednik se mora prvo prijaviti) | `src/db.ts` `canEditPub` |

Postupak uvoza, zamke i otvorene stavke: [2026-09-23-institucionalna-stranica.md](2026-09-23-institucionalna-stranica.md).

Namjerno i dalje izvan opsega: R2 video player (§3.1, model spreman: `video_source`), RSVP, potpisnici, slanje newslettera.
