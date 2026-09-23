// JSON API za dashboard: upload medija (raw body streaming na R2) i markdown preview.
import type { Hono } from 'hono';
import { currentUser } from '../auth';
import { canEditPub, newId, pubById } from '../db';
import { renderMarkdown } from '../markdown';
import type { AppEnv } from './public';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];
const FILE_TYPES = ['application/pdf'];
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;
// Zona limit tijela zahtjeva na Free/Pro je 100 MB — vidi docs/SPEC.md §8.
const MAX_VIDEO = 95 * 1024 * 1024;

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(-100);
  return cleaned || 'datoteka';
}

export function registerApiRoutes(app: Hono<AppEnv>) {
  app.post('/api/preview', async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: 'Niste prijavljeni' }, 401);
    const { md } = await c.req.json<{ md?: string }>();
    return c.json({ html: renderMarkdown(String(md ?? '')) });
  });

  app.post('/api/:pubId/upload', async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: 'Niste prijavljeni' }, 401);
    const pub = await pubById(c.env.DB, c.req.param('pubId'));
    if (!pub || !(await canEditPub(c.env.DB, pub, user.id))) return c.json({ error: 'Zabranjeno' }, 403);

    const mime = (c.req.header('content-type') ?? '').split(';')[0].trim();
    const kind = IMAGE_TYPES.includes(mime)
      ? 'image'
      : VIDEO_TYPES.includes(mime)
        ? 'video'
        : FILE_TYPES.includes(mime)
          ? 'file'
          : null;
    if (!kind) {
      return c.json({ error: 'Nepodržan tip. Slike: JPEG/PNG/GIF/WebP. Video: MP4/WebM. Dokumenti: PDF.' }, 415);
    }

    const size = parseInt(c.req.header('content-length') ?? '0', 10);
    const max = kind === 'image' ? MAX_IMAGE : kind === 'file' ? MAX_FILE : MAX_VIDEO;
    if (!size || !c.req.raw.body) return c.json({ error: 'Prazan upload' }, 400);
    if (size > max) {
      return c.json(
        { error: `Datoteka je prevelika (max ${Math.round(max / 1024 / 1024)} MB). Za veće videe koristite YouTube/Vimeo embed.` },
        413
      );
    }

    const filename = safeFilename(c.req.query('filename') ?? 'datoteka');
    const id = newId();
    const storageKey = `pub/${pub.id}/${id}/${filename}`;
    await c.env.MEDIA.put(storageKey, c.req.raw.body, { httpMetadata: { contentType: mime } });
    await c.env.DB.prepare(
      'INSERT INTO media (id, publication_id, kind, storage_key, filename, mime_type, byte_size) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, pub.id, kind, storageKey, filename, mime, size)
      .run();

    const url = `/media/${id}/${encodeURIComponent(filename)}`;
    return c.json({
      id,
      url,
      kind,
      filename,
      markdown: kind === 'image' ? `![](${url})` : kind === 'file' ? `[${filename}](${url})` : url,
    });
  });
}
