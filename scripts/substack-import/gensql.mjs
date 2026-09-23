// Generira SQL za uvoz Substack sadržaja u publikaciju: node gensql.mjs <PUB_ID> <out.sql>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// md.mjs: npx esbuild src/markdown.ts --bundle --format=esm --platform=node --outfile=scripts/substack-import/md.mjs
import { renderMarkdown } from './md.mjs';

const [pubId, out] = process.argv.slice(2);
const dir = path.dirname(new URL(import.meta.url).pathname);
const data = JSON.parse(fs.readFileSync(path.join(dir, 'import.json'), 'utf8'));
const LOGO = 'eeafada61da4281cbfcb6bcf1927e495';
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const mime = (fn) => (/\.png$/i.test(fn) ? 'image/png' : /\.webp$/i.test(fn) ? 'image/webp' : /\.gif$/i.test(fn) ? 'image/gif' : 'image/jpeg');
const sql = [];
const uploads = [];

for (const [id, , fn] of data.images) {
  const file = path.join(dir, 'img', `${id}_${fn}`);
  const key = `pub/${pubId}/${id}/${fn}`;
  uploads.push({ key, file, mime: mime(fn) });
  sql.push(
    `INSERT OR IGNORE INTO media (id, publication_id, kind, storage_key, filename, mime_type, byte_size) VALUES (${q(id)}, ${q(pubId)}, 'image', ${q(key)}, ${q(fn)}, ${q(mime(fn))}, ${fs.statSync(file).size});`
  );
}

const pid = (slug) => 'ss' + crypto.createHash('sha1').update(pubId + '/' + slug).digest('hex').slice(0, 30);
for (const p of data.posts) {
  const html = renderMarkdown(p.md);
  const cover = p.cover && p.cover !== LOGO ? p.cover : null;
  if (p.src_slug === 'savjet-za-tehnoetiku-i-antitotalitarizam') {
    // Predstavljanje Savjeta → "O nama" i uvod institucionalne naslovnice.
    sql.push(`UPDATE publications SET about_md = ${q(p.md)}, about_html = ${q(html)} WHERE id = ${q(pubId)};`);
    continue;
  }
  const isDecl = p.src_slug === 'deklaracija-o-tehnoetici-i-antitotalitarizmu';
  const slug = isDecl ? 'deklaracija' : p.slug;
  const date = new Date(p.date).toISOString();
  sql.push(
    `INSERT OR IGNORE INTO posts (id, publication_id, slug, title, subtitle, body_md, body_html, cover_media_id, kind, status, pinned_nav, published_at, created_at, updated_at, post_type, featured) VALUES (` +
      [pid(slug), pubId, slug, p.title, p.subtitle, p.md, html, cover, isDecl ? 'page' : 'post', 'published', 0, date, date, date, 'text', isDecl ? 1 : 0].map(q).join(', ') +
      ');'
  );
}

// PDF Deklaracije (ispis stranice /deklaracija) kao prilog za preuzimanje.
const PDF = 'Deklaracija-o-tehnoetici-i-antitotalitarizmu.pdf';
const pdfId = crypto.createHash('sha1').update(pubId + '/pdf').digest('hex').slice(0, 32);
const pdfKey = `pub/${pubId}/${pdfId}/${PDF}`;
uploads.push({ key: pdfKey, file: path.join(dir, PDF), mime: 'application/pdf' });
sql.push(
  `INSERT OR IGNORE INTO media (id, publication_id, kind, storage_key, filename, mime_type, byte_size) VALUES (${q(pdfId)}, ${q(pubId)}, 'file', ${q(pdfKey)}, ${q(PDF)}, 'application/pdf', ${fs.statSync(path.join(dir, PDF)).size});`,
  `UPDATE posts SET attachment_media_id = ${q(pdfId)} WHERE publication_id = ${q(pubId)} AND slug = 'deklaracija' AND attachment_media_id IS NULL;`
);

// Publikacija: institucionalna naslovnica, logo, boja iz vizualnog identiteta Savjeta.
sql.push(`UPDATE publications SET home_layout = 'institution', logo_media_id = ${q(LOGO)}, accent_color = '#1f4e79' WHERE id = ${q(pubId)};`);
// Institucionalni izbornik (6 rubrika) — samo ako izbornik još nije uređivan.
const nav = [['Tekstovi', '/tekstovi'], ['Aktivnosti', '/aktivnosti'], ['Video materijali', '/video'], ['O nama', '/o-nama'], ['Projekti', '/projekti'], ['Deklaracija', '/deklaracija']];
nav.forEach(([label, target], i) =>
  sql.push(
    `INSERT OR IGNORE INTO nav_items (id, publication_id, label, target, position) SELECT ${q(pid('nav' + i))}, ${q(pubId)}, ${q(label)}, ${q(target)}, ${i} WHERE NOT EXISTS (SELECT 1 FROM nav_items WHERE publication_id = ${q(pubId)} AND id NOT LIKE 'ss%');`
  )
);
fs.writeFileSync(out, sql.join('\n') + '\n');
fs.writeFileSync(out.replace(/\.sql$/, '.uploads.json'), JSON.stringify(uploads, null, 1));
console.log(sql.length, 'statements;', uploads.length, 'uploads');
