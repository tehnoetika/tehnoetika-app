-- Demo podaci za lokalni razvoj: korisnik luka@example.com / lozinka: sapereaude
INSERT OR IGNORE INTO users (id, email, password_hash, name) VALUES (
  'u0000000000000000000000000000001',
  'luka@example.com',
  'pbkdf2-sha384$100000$b6ed34e39bb22675b6fa6dc6030adbdd$b4ebb08705c0b515cbc4ae36b56bb42de3eaa621b4181fd4a8c08af35723a2ce5856fce3b4434e15c0946a5f3a72490a',
  'Luka Goleš Babić'
);

INSERT OR IGNORE INTO publications (id, owner_user_id, slug, name, tagline, about_md, about_html, accent_color) VALUES
(
  'p0000000000000000000000000000001',
  'u0000000000000000000000000000001',
  'tehnoetika',
  'Savjet za tehnoetiku i antitotalitarizam',
  'Istražujemo utjecaj digitalizacije i tehnokracije na čovjeka',
  'Savjet za tehnoetiku i antitotalitarizam istražuje utjecaj digitalizacije i tehnokracije na čovjeka te pruža proaktivnu i reaktivnu zaštitu ljudskog dostojanstva u hiperdigitaliziranom svijetu.',
  '<p>Savjet za tehnoetiku i antitotalitarizam istražuje utjecaj digitalizacije i tehnokracije na čovjeka te pruža proaktivnu i reaktivnu zaštitu ljudskog dostojanstva u hiperdigitaliziranom svijetu.</p>',
  '#1a5f7f'
),
(
  'p0000000000000000000000000000002',
  'u0000000000000000000000000000001',
  'sapereaude',
  'Sapere Aude',
  'Izazov silama koje ugrožavaju same temelje naše civilizacije',
  'Sapere Aude trebao bi poslužiti kao izazov silama koje ugrožavaju same temelje naše civilizacije.',
  '<p>Sapere Aude trebao bi poslužiti kao izazov silama koje ugrožavaju same temelje naše civilizacije.</p>',
  '#1d4ed8'
);

INSERT OR IGNORE INTO posts (id, publication_id, slug, title, subtitle, body_md, body_html, kind, status, published_at) VALUES
(
  'a0000000000000000000000000000001',
  'p0000000000000000000000000000001',
  'dobrodosli',
  'Dobrodošli na Tehnoetiku',
  'Prvi zapis na novoj platformi',
  '**Sažetak:** *Ovo je demo post na open-source platformi.*

---

## O čemu pišemo

Digitalni euro, ustavna zaštita gotovine, digitalni identitet i masovni nadzor.

1. Tehnoetika
2. Antitotalitarizam',
  '<p><strong>Sažetak:</strong> <em>Ovo je demo post na open-source platformi.</em></p><hr><h2>O čemu pišemo</h2><p>Digitalni euro, ustavna zaštita gotovine, digitalni identitet i masovni nadzor.</p><ol><li>Tehnoetika</li><li>Antitotalitarizam</li></ol>',
  'post', 'published', '2026-07-01T10:00:00Z'
),
(
  'a0000000000000000000000000000002',
  'p0000000000000000000000000000002',
  'sapere-aude-pocinje',
  'Sapere Aude počinje',
  'Usudi se znati',
  'Novi dom portala Sapere Aude.

https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  '<p>Novi dom portala Sapere Aude.</p><div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allowfullscreen loading="lazy"></iframe></div>',
  'post', 'published', '2026-07-05T10:00:00Z'
);
