// Serviranje medija iz R2 kroz Worker: ETag/304, Range (206) za video streaming.
// URL: /media/:id/:filename — filename je kozmetički, lookup ide po id-u.
import type { Hono } from 'hono';
import { mediaById } from '../db';
import type { AppEnv } from './public';

function parseRange(header: string | undefined, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === '' && endStr === '') return null;
  if (startStr === '') {
    // sufiks: zadnjih N bajtova
    const suffix = Math.min(parseInt(endStr, 10), size);
    return { offset: size - suffix, length: suffix };
  }
  const start = parseInt(startStr, 10);
  if (start >= size) return null;
  const end = endStr === '' ? size - 1 : Math.min(parseInt(endStr, 10), size - 1);
  if (end < start) return null;
  return { offset: start, length: end - start + 1 };
}

export function registerMediaRoutes(app: Hono<AppEnv>) {
  app.get('/media/:id/:filename', async (c) => {
    const media = await mediaById(c.env.DB, c.req.param('id'));
    if (!media) return c.notFound();

    const headers = new Headers({
      'Content-Type': media.mime_type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    // ?download=1 → preuzimanje (PDF Deklaracije) umjesto prikaza u pregledniku.
    if (c.req.query('download') === '1') {
      headers.set('Content-Disposition', `attachment; filename="${media.filename.replace(/["\\\r\n]/g, '')}"`);
    }

    const range = parseRange(c.req.header('range'), media.byte_size);
    if (range) {
      const obj = await c.env.MEDIA.get(media.storage_key, { range });
      if (!obj) return c.notFound();
      headers.set('ETag', obj.httpEtag);
      headers.set('Content-Length', String(range.length));
      headers.set(
        'Content-Range',
        `bytes ${range.offset}-${range.offset + range.length - 1}/${media.byte_size}`
      );
      return new Response(obj.body, { status: 206, headers });
    }

    // R2 onlyIf traži ETag bez navodnika i bez W/ prefiksa
    const ifNoneMatch = c.req.header('if-none-match')?.replace(/^W\//, '').replace(/^"|"$/g, '');
    const obj = ifNoneMatch
      ? await c.env.MEDIA.get(media.storage_key, { onlyIf: { etagDoesNotMatch: ifNoneMatch } })
      : await c.env.MEDIA.get(media.storage_key);
    if (!obj) return c.notFound();
    headers.set('ETag', obj.httpEtag);
    // get() s onlyIf vraća R2Object bez bodyja kad uvjet nije zadovoljen → 304
    const withBody = obj as R2ObjectBody;
    if (!withBody.body) return new Response(null, { status: 304, headers });
    headers.set('Content-Length', String(media.byte_size));
    return new Response(withBody.body, { status: 200, headers });
  });
}
