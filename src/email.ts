// EmailProvider: Resend ako je RESEND_API_KEY postavljen, inače noop.
// Bez providera subscriberi se odmah potvrđuju (nema double opt-ina).
import type { Bindings } from './db';

export function emailEnabled(env: Bindings): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export async function sendEmail(
  env: Bindings,
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  if (!emailEnabled(env)) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    return false;
  }
  return true;
}
