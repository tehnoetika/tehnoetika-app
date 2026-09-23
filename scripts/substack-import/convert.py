# Substack (tehnoetika.substack.com) → markdown + popis slika za uvoz u publikaciju.
import json, glob, re, hashlib, os, sys, urllib.parse
from bs4 import BeautifulSoup
from markdownify import markdownify as md

OUT = {}
def mid(key): return hashlib.sha1(key.encode()).hexdigest()[:32]

def slugify(s):
    import unicodedata
    s = s.replace('đ','d').replace('Đ','d')
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r'[^a-z0-9]+','-',s).strip('-')[:80].rstrip('-')
    return s

def orig_url(img):
    try:
        a = json.loads(img.get('data-attrs') or '{}')
        if a.get('src'): return a['src']
    except Exception: pass
    src = img.get('src','')
    m = re.search(r'/(https%3A%2F%2F.*)$', src)
    return urllib.parse.unquote(m.group(1)) if m else src

images = []  # (media_id, url, filename)
def add_image(url):
    fn = re.sub(r'[^\w.-]+','-', urllib.parse.unquote(url).split('/')[-1].split('?')[0])[-80:] or 'slika.jpg'
    i = mid(url)
    if all(x[0] != i for x in images):
        images.append((i, url, fn))
    return f'/media/{i}/{fn}'

posts = []
for f in sorted(g for g in glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), '*.json')) if not g.endswith('import.json')):
    d = json.load(open(f))
    soup = BeautifulSoup(d['body_html'], 'html.parser')
    for w in soup.select('.subscription-widget-wrap-editor, .subscription-widget, .button-wrapper, .image-link-expand'):
        w.decompose()
    tokens = {}
    for n, cont in enumerate(soup.select('.captioned-image-container')):
        img = cont.find('img')
        if not img: cont.decompose(); continue
        url = orig_url(img)
        cap = cont.find('figcaption')
        cap = cap.get_text(' ', strip=True).replace('"', '”') if cap else ''
        alt = (img.get('alt') or '').strip()
        if alt.startswith('Može biti slika') or len(alt) > 150: alt = ''
        alt = alt.replace('[','').replace(']','')
        local = add_image(url)
        tok = f'IMGTOKEN{n}X'
        tokens[tok] = f'![{alt}]({local}' + (f' "{cap}"' if cap else '') + ')'
        new = soup.new_tag('p'); new.string = tok
        cont.replace_with(new)
    text = md(str(soup), heading_style='ATX', bullets='-', strip=['span'])
    for tok, rep in tokens.items():
        text = text.replace(tok, rep)
    text = re.sub(r'\n{3,}', '\n\n', text).strip() + '\n'
    cover = add_image(d['cover_image']) if d.get('cover_image') else None
    posts.append({
        'src_slug': d['slug'], 'title': d['title'].strip(), 'subtitle': (d.get('subtitle') or '').strip(),
        'date': d['post_date'], 'md': text, 'cover': cover.split('/')[2] if cover else None,
        'slug': slugify(d['title']),
    })

json.dump({'posts': posts, 'images': images}, open(os.path.join(os.path.dirname(__file__), 'import.json'), 'w'), ensure_ascii=False, indent=1)
for p in posts: print(p['date'][:10], p['slug'], len(p['md']), p['cover'] is not None)
print('images', len(images))
