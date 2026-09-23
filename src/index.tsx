// Entry point: tenant rezolucija po hostu (subdomena / custom domena),
// zatim media + API + tenant + platformske rute. Vidi docs/SPEC.md §3 i §5.
import { Hono } from 'hono';
import { pubByDomain, pubBySlug } from './db';
import { registerApiRoutes } from './routes/api';
import { RESERVED_SLUGS, registerPlatformRoutes } from './routes/dashboard';
import { registerMediaRoutes } from './routes/media';
import { registerTenantRoutes, type AppEnv } from './routes/public';
import { registerSsoRoutes } from './routes/sso';

const app = new Hono<AppEnv>();

// Rezolucija tenanta iz Host headera. Bez PLATFORM_HOST (workers.dev, lokalni dev)
// sve ide path modom (/@slug), koji registerTenantRoutes ionako registrira.
app.use('*', async (c, next) => {
  c.set('tenant', null);
  const url = new URL(c.req.url);
  const hostname = url.hostname;
  const platformHost = c.env.PLATFORM_HOST;

  if (platformHost && hostname !== platformHost && hostname !== 'localhost') {
    if (hostname.endsWith(`.${platformHost}`)) {
      const sub = hostname.slice(0, -(platformHost.length + 1));
      if (sub && !sub.includes('.') && !RESERVED_SLUGS.includes(sub)) {
        const pub = await pubBySlug(c.env.DB, sub);
        if (!pub) return c.text('Publikacija ne postoji.', 404);
        // S vlastitom domenom kanonske adrese (canonical, RSS, sitemap) pokazuju na nju.
        const absBase = pub.custom_domain ? `https://${pub.custom_domain}` : `${url.protocol}//${url.host}`;
        c.set('tenant', { pub, base: '', absBase });
      } else {
        // Rezervirani/poseban subdomen (npr. www) može biti vezan na publikaciju preko custom_domain.
        const pub = await pubByDomain(c.env.DB, hostname);
        if (pub) c.set('tenant', { pub, base: '', absBase: `${url.protocol}//${url.host}` });
      }
    } else {
      const pub = await pubByDomain(c.env.DB, hostname);
      if (pub) c.set('tenant', { pub, base: '', absBase: `${url.protocol}//${url.host}` });
    }
  }
  await next();
});

registerMediaRoutes(app);
registerApiRoutes(app);
// Domovina SSO (login stranica + token-exchange) — ungated, prije platformskih ruta.
registerSsoRoutes(app);
// Tenant rute prije platformskih: handleri padaju na next() kad tenant nije razriješen,
// pa apex '/' završi na platformskom landingu.
registerTenantRoutes(app);
registerPlatformRoutes(app);

app.notFound((c) => c.text('404 — stranica ne postoji', 404));
app.onError((err, c) => {
  console.error(err);
  return c.text('Greška na poslužitelju', 500);
});

export default app;
