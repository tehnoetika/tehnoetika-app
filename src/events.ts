// Događaji (Aktivnosti): vrijeme se unosi i sprema kao lokalno Europe/Zagreb
// 'YYYY-MM-DDTHH:MM', pa je usporedba "nadolazeće / održano" obična usporedba stringova.
import type { Post } from './db';

const TZ = 'Europe/Zagreb';

/** Trenutno lokalno vrijeme u Zagrebu kao 'YYYY-MM-DDTHH:MM'. */
export function zagrebNowLocal(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Normalizira unos iz <input type="datetime-local"> ili vraća null. */
export function parseLocalDateTime(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!m) return null;
  return `${m[1]}T${m[2] ?? '00:00'}`;
}

const MONTHS = ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja', 'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca'];
const DAYS = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

function split(local: string) {
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  // Dan u tjednu za kalendarski datum (neovisno o zoni).
  const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
  return { y, mo, da, time: t ?? '00:00', dow };
}

/** "subota, 4. listopada 2026. u 18:00" ili raspon "4.–5. listopada 2026." */
export function formatEventWhen(start: string | null, end?: string | null): string {
  if (!start) return '';
  const a = split(start);
  const date = (x: ReturnType<typeof split>) => `${x.da}. ${MONTHS[x.mo - 1]} ${x.y}.`;
  const time = (x: ReturnType<typeof split>) => (x.time !== '00:00' ? x.time : '');
  let out = `${DAYS[a.dow]}, ${date(a)}`;
  if (!end) return time(a) ? `${out} u ${time(a)}` : out;
  const b = split(end);
  const sameDay = a.y === b.y && a.mo === b.mo && a.da === b.da;
  if (sameDay) {
    return time(a) ? `${out}, ${time(a)}–${time(b) || ''}`.replace(/–$/, '') : out;
  }
  out = `${date(a)}${time(a) ? ` u ${time(a)}` : ''} – ${date(b)}${time(b) ? ` u ${time(b)}` : ''}`;
  return out;
}

/** Kratki oblik za kartice: dan + mjesec (za "kalendarski list"). */
export function eventBadge(start: string | null): { day: string; month: string } | null {
  if (!start) return null;
  const a = split(start);
  return { day: String(a.da), month: MONTHS[a.mo - 1].slice(0, 3) };
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Presavija retke na 75 okteta (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (curLen + len > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Zagreb',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const icsLocal = (local: string) => local.replace(/-/g, '').replace(':', '') + '00';

/** iCalendar datoteka za jedan događaj. */
export function eventIcs(post: Post, url: string, host: string): string {
  const start = post.event_start!;
  // Bez kraja: 2 sata od početka, najkasnije do 23:59 istog dana.
  let end = post.event_end;
  if (!end) {
    const [h, mi] = split(start).time.split(':').map(Number);
    const m = Math.min(h * 60 + mi + 120, 23 * 60 + 59);
    end = `${start.slice(0, 10)}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tehnoetika platforma//HR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${post.id}@${host}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Zagreb:${icsLocal(start)}`,
    `DTEND;TZID=Europe/Zagreb:${icsLocal(end)}`,
    `SUMMARY:${icsEscape(post.title)}`,
    post.event_location ? `LOCATION:${icsEscape(post.event_location)}` : '',
    post.subtitle ? `DESCRIPTION:${icsEscape(post.subtitle + '\n\n' + url)}` : `DESCRIPTION:${icsEscape(url)}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}
