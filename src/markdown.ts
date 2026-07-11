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

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    if (/^[\w-]{6,}$/.test(id)) return iframe(`https://www.youtube-nocookie.com/embed/${id}`);
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const v = url.searchParams.get('v');
    const shorts = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/);
    const id = v && /^[\w-]{6,}$/.test(v) ? v : shorts?.[1];
    if (id) return iframe(`https://www.youtube-nocookie.com/embed/${id}`);
  }
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

/**
 * Render markdowna u HTML:
 * - raw HTML u izvoru se escapea (XSS izolacija među tenantima)
 * - redak koji je sam URL (YouTube/Vimeo/Facebook/.mp4/.webm) postaje responsive embed
 */
export function renderMarkdown(md: string): string {
  const embeds: string[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const prepared = lines
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
      return line;
    })
    .join('\n')
    // Escape raw HTML-a prije parsiranja — marked tako nikad ne emitira autorski HTML.
    .replace(/</g, '&lt;');

  let html = marked.parse(prepared) as string;
  html = html.replace(/<p>%%EMBED(\d+)%%<\/p>/g, (_, i) => embeds[Number(i)] ?? '');
  return html;
}
