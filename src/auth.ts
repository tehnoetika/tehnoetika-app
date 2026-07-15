// Lozinke (PBKDF2-SHA-384 @ 100k — WebCrypto cap u Workers), sesije u D1, rate limit prijave.
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { newId, newToken, type Bindings, type User } from './db';

const PBKDF2_ITERATIONS = 100_000;
const SESSION_COOKIE = 'session';
const SESSION_DAYS = 30;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf as ArrayBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-384', salt: salt as BufferSource, iterations },
    key,
    384
  );
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha384$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltHex, expected] = stored.split('$');
  if (algo !== 'pbkdf2-sha384' || !iterStr || !saltHex || !expected) return false;
  const actual = await pbkdf2(password, fromHex(saltHex), parseInt(iterStr, 10));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

// --- Domovina SSO: verifikacija Supabase GoTrue JWT-a (HS256) ---
// Standardni 3-dijelni JWT potpisan projektnim JWT secretom (GOTRUE_JWT_SECRET).
// Verificira potpis i provjerava exp. Ne miješa se s internim cookie sesijama —
// koristi se samo u token-exchangeu (/api/auth/sso) da dokaže identitet korisnika.
export interface SupabaseJwt {
  sub?: string; // auth.users.id (uuid)
  email?: string;
  role?: string; // 'authenticated'
  exp?: number;
  aud?: string;
  user_metadata?: { full_name?: string; name?: string; [k: string]: unknown };
  [k: string]: unknown;
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const bin = atob(s + '='.repeat(pad));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export async function verifyJwtHS256(token: string, secret: string): Promise<SupabaseJwt | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h))) as { alg?: string };
    if (header.alg !== 'HS256') return null;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig) as BufferSource,
      new TextEncoder().encode(`${h}.${p}`)
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as SupabaseJwt;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<{ Bindings: Bindings; Variables: any }>;

export async function createSession(c: Ctx, userId: string): Promise<void> {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(newId(), userId, await sha256Hex(token), expires.toISOString())
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    expires,
  });
}

export async function currentUser(c: Ctx): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const now = new Date().toISOString();
  return c.env.DB.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
  )
    .bind(await sha256Hex(token), now)
    .first<User>();
}

export async function destroySession(c: Ctx): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

// Rate limit prijave: max 10 neuspjeha po emailu unutar 15 min.
const RL_WINDOW_MS = 15 * 60_000;
const RL_MAX = 10;

export async function loginRateLimited(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT window_start, count FROM login_attempts WHERE email = ?')
    .bind(email)
    .first<{ window_start: string; count: number }>();
  if (!row) return false;
  if (Date.now() - Date.parse(row.window_start) > RL_WINDOW_MS) return false;
  return row.count >= RL_MAX;
}

export async function recordLoginFailure(db: D1Database, email: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO login_attempts (email, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(email) DO UPDATE SET
         count = CASE WHEN (unixepoch('now') - unixepoch(window_start)) * 1000 > ${RL_WINDOW_MS} THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN (unixepoch('now') - unixepoch(window_start)) * 1000 > ${RL_WINDOW_MS} THEN ? ELSE window_start END`
    )
    .bind(email, now, now)
    .run();
}

export async function clearLoginFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
}
