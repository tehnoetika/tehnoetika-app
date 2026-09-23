// Markdown render (marked) s escapeanim raw HTML-om i embed transformom,
// plus slugify s hrvatskom dijakritikom. Vidi docs/SPEC.md §3.
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: false, async: false });

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** ASCII slug iz hrvatskog naslova: "O ustavnoj zaštiti gotovine" → "o-ustavnoj-zastiti-gotovine" */
export function slugify(input: string): string {
  return input
    .replace(/[đĐ]/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** YouTube video ID iz bilo kojeg uobičajenog oblika linka, ili null. */
export function youtubeId(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return /^[\w-]{6,}$/.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v && /^[\w-]{6,}$/.test(v)) return v;
    return url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/)?.[1] ?? null;
  }
  return null;
}

/** Responsive YouTube player (nocookie domena). */
export function youtubeEmbedHtml(id: string): string {
  return `<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${escapeAttr(id)}" allowfullscreen loading="lazy" allow="encrypted-media; picture-in-picture" title="YouTube video"></iframe></div>`;
}

/** Redak koji je sam URL → embed HTML, ili null ako URL nije podržan za embed. */
function embedHtml(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./, '');
  const iframe = (src: string) =>
    `<div class="embed"><iframe src="${escapeAttr(src)}" allowfullscreen loading="lazy" allow="encrypted-media; picture-in-picture"></iframe></div>`;

  const yt = youtubeId(rawUrl);
  if (yt) return youtubeEmbedHtml(yt);
  if (host === 'vimeo.com') {
    const m = url.pathname.match(/^\/(\d+)/);
    if (m) return iframe(`https://player.vimeo.com/video/${m[1]}`);
  }
  if (host === 'fb.watch' || (host.endsWith('facebook.com') && /\/(videos|watch|reel)/.test(url.pathname + url.search))) {
    return iframe(`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(rawUrl)}&show_text=false`);
  }
  if (/\.(mp4|webm)(\?|$)/i.test(url.pathname)) {
    return `<div class="embed-video"><video controls preload="metadata" src="${escapeAttr(rawUrl)}"></video></div>`;
  }
  // Relativni /media/ video pokriva grana iznad tek uz apsolutni URL; relativne obrađuje caller.
  return null;
}

function relativeMediaEmbed(line: string): string | null {
  if (/^\/media\/[\w-]+\/[^\s]+\.(mp4|webm)$/i.test(line)) {
    return `<div class="embed-video"><video controls preload="metadata" src="${escapeAttr(line)}"></video></div>`;
  }
  return null;
}

function decodeEntities(s: string): string {
  const cp = (n: number) => String.fromCodePoint(n > 0 && n <= 0x10ffff ? n : 32);
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '');
}

const FIGURE_CLASSES = ['wide', 'center', 'left', 'right'];

/** Dopušteni URL slike: relativni /media/… ili http(s). */
function safeImageUrl(u: string): string | null {
  if (/^\/media\/[\w-]+\/\S+$/.test(u)) return u;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * Redak koji je samo slika → <figure>:
 *   ![alt](url "opis"){.wide}
 * Opis postaje <figcaption>, klasa iz whiteliste određuje poravnanje.
 */
function figureHtml(line: string): string | null {
  const m = line.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)(?:\{\.([a-z]+)\})?$/);
  if (!m) return null;
  const [, alt, rawUrl, caption, cls] = m;
  const url = safeImageUrl(rawUrl);
  if (!url) return null;
  const klass = cls && FIGURE_CLASSES.includes(cls) ? cls : 'center';
  const cap = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure class="fig fig-${klass}"><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" />${cap}</figure>`;
}

/**
 * Render markdowna u HTML:
 * - raw HTML u izvoru se escapea (XSS izolacija među tenantima)
 * - redak koji je sam URL (YouTube/Vimeo/Facebook/.mp4/.webm) postaje responsive embed
 * - redak koji je sama slika postaje <figure> s opisom i poravnanjem
 * - citat koji počinje s [!istaknuto] postaje istaknuti citat (pull quote)
 * - fusnote: [^1] u tekstu + "[^1]: tekst" u zasebnom retku
 */
export function renderMarkdown(md: string): string {
  const embeds: string[] = [];
  const footnotes: Array<{ id: string; text: string }> = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const fn = line.match(/^\[\^([\w-]{1,20})\]:\s+(.*)$/);
    if (fn) {
      footnotes.push({ id: fn[1], text: fn[2] });
      continue;
    }
    kept.push(line);
  }
  const fnIndex = new Map(footnotes.map((f, i) => [f.id, i + 1]));

  const prepared = kept
    .map((line) => {
      const trimmed = line.trim();
      if (/^https?:\/\/\S+$/.test(trimmed)) {
        const html = embedHtml(trimmed);
        if (html) {
          embeds.push(html);
          return `%%EMBED${embeds.length - 1}%%`;
        }
      }
      const rel = relativeMediaEmbed(trimmed);
      if (rel) {
        embeds.push(rel);
        return `%%EMBED${embeds.length - 1}%%`;
      }
      const fig = figureHtml(trimmed);
      if (fig) {
        embeds.push(fig);
        return `%%EMBED${embeds.length - 1}%%`;
      }
      return line;
    })
    .join('\n')
    // Escape raw HTML-a prije parsiranja — marked tako nikad ne emitira autorski HTML.
    .replace(/</g, '&lt;')
    // Reference fusnota → marker koji marked ne dira.
    .replace(/\[\^([\w-]{1,20})\]/g, (all, id) => (fnIndex.has(id) ? `%%FN${fnIndex.get(id)}%%` : all));

  let html = marked.parse(prepared) as string;
  // Samo http(s), mailto, tel, relativne i #sidra — javascript:/data:/vbscript: u href/src ne prolaze.
  html = html.replace(/(href|src)="([^"]*)"/g, (all, attr, val) =>
    /^(javascript|data|vbscript):/i.test(decodeEntities(val).replace(/[\s\x00-\x1f]/g, '')) ? `${attr}="#"` : all
  );
  html = html.replace(/<p>%%EMBED(\d+)%%<\/p>/g, (_, i) => embeds[Number(i)] ?? '');
  html = html.replace(/<blockquote>\s*<p>\[!istaknuto\]\s*/g, '<blockquote class="pullquote"><p>');
  html = html.replace(
    /%%FN(\d+)%%/g,
    (_, n) => `<sup class="fnref"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`
  );
  if (footnotes.length) {
    const items = footnotes
      .map((f, i) => {
        const body = marked.parseInline(f.text.replace(/</g, '&lt;')) as string;
        return `<li id="fn-${i + 1}">${body} <a href="#fnref-${i + 1}" class="fnback" aria-label="Natrag na tekst">↩</a></li>`;
      })
      .join('');
    html += `<section class="footnotes"><ol>${items}</ol></section>`;
  }
  return html;
}
