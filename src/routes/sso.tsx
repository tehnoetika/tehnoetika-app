// Domovina SSO (self-hosted Supabase GoTrue na api.domovina.ai): per-app login
// magic-link + Google, PKCE. Model 1 backend → N frontenda, token-exchange:
// frontend se prijavi na Supabase → dobije Supabase JWT → ovaj worker ga verificira
// (HS256, projektni secret) i izda VLASTITU cookie sesiju. venue_id ekvivalent ovdje
// ne postoji — tehnoetika je otvorena platforma, pa nepoznat email auto-kreira račun.
import type { Context, Hono } from 'hono';
import { createSession, currentUser, verifyJwtHS256 } from '../auth';
import { newId, type User } from '../db';
import { Flash, PlatformLayout } from '../views/layout';
import type { AppEnv } from './public';

// Uskladi s referentnom marketplace integracijom (@supabase/supabase-js ^2.110.5).
const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.110.5';

type C = Context<AppEnv>;

// Klijentski PKCE flow: kreira Supabase klijent, nudi magic-link + Google, i nakon
// povratka (?code=…) razmijeni Supabase sesiju za našu cookie sesiju preko /api/auth/sso.
function clientScript(url: string, anon: string): string {
  return `
import { createClient } from '${SUPABASE_JS}';
const sb = createClient(${JSON.stringify(url)}, ${JSON.stringify(anon)}, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});
const REDIRECT = location.origin + '/prijava';
const status = document.getElementById('sso-status');
const box = document.getElementById('sso-box');
const sent = document.getElementById('sso-sent');
const sentEmail = document.getElementById('sso-sent-email');
let busy = false;
function fail(msg) { busy = false; status.textContent = msg; status.hidden = false; }
async function exchange(access_token) {
  if (busy) return; busy = true;
  status.hidden = true;
  box.hidden = true; sent.hidden = true;
  const spin = document.getElementById('sso-spin'); if (spin) spin.hidden = false;
  try {
    const res = await fetch('/api/auth/sso', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Prijava nije uspjela');
    // Naša cookie sesija je izvor istine — očisti lokalnu Supabase sesiju da odjava
    // (koja briše samo naš cookie) ne bude poništena auto-re-loginom na /prijava.
    try { await sb.auth.signOut({ scope: 'local' }); } catch (_) {}
    history.replaceState({}, '', '/prijava');
    location.href = data.redirect || '/dashboard';
  } catch (e) {
    if (spin) spin.hidden = true;
    box.hidden = false;
    fail(String((e && e.message) || e));
  }
}
sb.auth.getSession().then(({ data }) => { if (data.session && data.session.access_token) exchange(data.session.access_token); });
sb.auth.onAuthStateChange((_e, session) => { if (session && session.access_token) exchange(session.access_token); });

document.getElementById('sso-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('sso-email').value.trim().toLowerCase();
  if (!email || busy) return;
  busy = true; status.hidden = true;
  const btn = document.getElementById('sso-magic'); btn.disabled = true; btn.textContent = 'Šaljem…';
  try {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: REDIRECT } });
    if (error) throw error;
    box.hidden = true; sentEmail.textContent = email; sent.hidden = false;
  } catch (e) {
    fail(String((e && e.message) || e));
  } finally {
    btn.disabled = false; btn.textContent = 'Pošalji link za prijavu';
  }
});
document.getElementById('sso-google').addEventListener('click', async () => {
  status.hidden = true;
  try {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: REDIRECT } });
    if (error) throw error;
  } catch (e) { fail(String((e && e.message) || e)); }
});
document.getElementById('sso-back').addEventListener('click', () => {
  document.getElementById('sso-sent').hidden = true;
  document.getElementById('sso-box').hidden = false;
});
`.trim();
}

const SsoLogin = ({ url, anon }: { url: string; anon: string }) => (
  <PlatformLayout title="Prijava">
    <div class="card narrow">
      <h1>Prijava</h1>
      <p class="muted">Prijavite se svojim Domovina računom.</p>
      <p id="sso-status" class="flash flash-err" hidden></p>

      <div id="sso-spin" class="muted" hidden>Prijava u tijeku…</div>

      <div id="sso-box">
        <form id="sso-form">
          <label>
            Email
            <input type="email" id="sso-email" required placeholder="vas@email.hr" autocomplete="email" />
          </label>
          <button type="submit" id="sso-magic">Pošalji link za prijavu</button>
        </form>
        <div class="sso-or"><span>ili</span></div>
        <button type="button" id="sso-google" class="btn-google">
          <svg class="g-logo" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
            <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" />
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
          </svg>
          <span>Nastavi s Google računom</span>
        </button>
      </div>

      <div id="sso-sent" hidden>
        <p>Poslali smo link za prijavu na <strong id="sso-sent-email"></strong>.</p>
        <p class="muted">Otvorite email i kliknite link — vratit će vas ovamo prijavljene.</p>
        <button type="button" id="sso-back" class="secondary">Natrag</button>
      </div>

      <p class="muted">
        Radije lozinkom? <a href="/auth/login">Klasična prijava</a>
      </p>
    </div>
    <script type="module" dangerouslySetInnerHTML={{ __html: clientScript(url, anon) }} />
  </PlatformLayout>
);

// Fallback kad SSO nije konfiguriran (nema Vite/env ključeva): uputi na klasičnu prijavu.
const SsoUnconfigured = () => (
  <PlatformLayout title="Prijava">
    <div class="card narrow">
      <h1>Prijava</h1>
      <Flash kind="err">Domovina SSO trenutno nije konfiguriran na ovoj instanci.</Flash>
      <p class="muted">
        Koristite <a href="/auth/login">klasičnu prijavu lozinkom</a>.
      </p>
    </div>
  </PlatformLayout>
);

export function registerSsoRoutes(app: Hono<AppEnv>) {
  // Login stranica (server-rendered) — PKCE flow radi klijentski, exchange na /api/auth/sso.
  app.get('/prijava', async (c: C) => {
    if (await currentUser(c)) return c.redirect('/dashboard');
    const url = c.env.SUPABASE_URL;
    const anon = c.env.SUPABASE_ANON_KEY;
    if (!url || !anon) return c.html(<SsoUnconfigured />);
    return c.html(<SsoLogin url={url} anon={anon} />);
  });

  // Token-exchange: Supabase JWT → verifikacija → tehnoetika korisnik → cookie sesija.
  // Ruta je ungated (nije iza dashboard guarda). Sesija (cookie) je izvor istine za app.
  app.post('/api/auth/sso', async (c: C) => {
    if (!c.env.SUPABASE_JWT_SECRET) {
      return c.json({ error: 'SSO nije konfiguriran (SUPABASE_JWT_SECRET)' }, 501);
    }
    const { access_token } = await c.req.json<{ access_token?: string }>().catch(() => ({ access_token: undefined }));
    if (!access_token) return c.json({ error: 'Nedostaje access_token' }, 400);

    const payload = await verifyJwtHS256(access_token, c.env.SUPABASE_JWT_SECRET);
    if (!payload) return c.json({ error: 'Neispravan ili istekao SSO token' }, 401);

    const email = (payload.email ?? '').trim().toLowerCase();
    if (!email) return c.json({ error: 'SSO token nema e-mail' }, 400);

    const name =
      (payload.user_metadata?.full_name ?? payload.user_metadata?.name ?? '').trim() ||
      email.split('@')[0];
    // Sentinel umjesto lozinke: verifyPassword ga nikad ne prihvaća (nije pbkdf2 format).
    const ssoRef = `sso:${payload.sub || email}`;

    let user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
    if (!user) {
      const id = newId();
      await c.env.DB.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
        .bind(id, email, ssoRef, name)
        .run();
      user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
    } else if (!user.name && name) {
      await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
    }
    if (!user) return c.json({ error: 'Greška pri kreiranju računa' }, 500);

    await createSession(c, user.id);
    return c.json({ ok: true, redirect: '/dashboard' });
  });
}
