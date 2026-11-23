"""Build the single-file browser editions from src/, app/ and vendor/: Japanese and English.
usage: python3 build.py            -> index.html, en/index.html (GitHub Pages)
       python3 build.py --dev      -> also dev/www/jizura.js + dev/www/test.html for the test tools"""
import glob, os, sys
from html import escape
from app.english import localize_body, localize_js
from app import i18n
from app import publication
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
read = lambda p: open(p, encoding='utf-8').read()
VERSION = read('VERSION').strip()
SITE_URL = os.environ.get('JIZURA_SITE_URL', 'https://posn973.github.io/JIZURA-Layer-Studio-Firefox-Compatible').strip().rstrip('/')
if SITE_URL and not SITE_URL.startswith('https://'):
    raise ValueError('JIZURA_SITE_URL must start with https://')
sources = sorted(glob.glob('src/*.js'))
js = '\n'.join(read(f) for f in sources)
# JIZURA改: MP4 files are written with Mediabunny (src/10b_mp4_writer.js); mp4-muxer is no longer embedded
mux = ''
demux = read('vendor/mediabunny.min.js')
# JIZURA改: x264（GPL-2.0-or-later）を WebAssembly にしたもの。ソースとビルド手順は vendor/x264/
import base64
_b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode('ascii')
x264 = '<script>window.JZ_X264_WASM={st:"%s",mt:"%s"};</script>' % (_b64('vendor/x264/x264.wasm'), _b64('vendor/x264/x264-mt.wasm'))

def build(lang):
    english = lang == 'en'
    title = publication.NAME + ' — cityedge fork'
    description = ('字幕フロントと二値・グレーマットを2本のMP4に。SRT・作業用背景・スペアナ合成に対応したJIZURAの非公式派生版。' if lang == 'ja' else 'Create subtitle front and binary or grayscale matte MP4 pairs. An unofficial JIZURA derivative with SRT import, preview backgrounds and spectrum compositing.')
    folder = dict((c, f) for c, f, _, _ in i18n.EDITIONS)[lang]
    canonical = SITE_URL + '/' + (folder + '/' if folder else '') if SITE_URL else ''
    language_nav = i18n.nav(lang)
    body = read('app/body.html').replace('@VERSION@', VERSION).replace('    <div class="acts">', '    ' + language_nav + '\n    <div class="acts">', 1)
    if english: body = localize_body(body)
    body = publication.body(body, lang, VERSION)
    if english: script = '\n'.join(localize_js(read(f), f) for f in sources)
    else: script = js
    script = script.replace('@VERSION@', VERSION)
    if english:
        marker = '/* ============================================================\n   JIZURA — editor UI'
        if marker not in script: raise ValueError('Could not find browser UI entry point')
        inject = read('app/english.js')
        script = script.replace(marker, inject + '\n' + marker, 1)
    site_meta = ''
    if SITE_URL:
        alternates = '\n'.join(f'<link rel="alternate" hreflang="{hl}" href="{escape(SITE_URL)}/{f + "/" if f else ""}">' for c, f, hl, _ in i18n.EDITIONS)
        site_meta = f'<link rel="canonical" href="{escape(canonical)}">\n<meta property="og:url" content="{escape(canonical)}">\n{alternates}'
    html_lang = dict((c, hl) for c, _, hl, _ in i18n.EDITIONS)[lang]
    up = '../' if folder else ''   # JIZURA改: manifest / icons はアプリの一番上にある
    html = f'''<!doctype html>
<html lang="{html_lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{description}">
{site_meta}
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta name="twitter:card" content="summary">
<link rel="manifest" href="{up}manifest.webmanifest">
<meta name="theme-color" content="#131316">
<link rel="icon" href="{up}icons/icon-192.png">
<link rel="apple-touch-icon" href="{up}icons/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>
{read('app/style.css')}
{read('app/mobile.css')}
</style>
</head>
<body>
{body}
{x264}
<script>
{demux}
</script>
<script>
{script}
</script>
</body>
</html>
'''
    target = (folder + '/' if folder else '') + 'index.html'
    os.makedirs(os.path.dirname(target) or '.', exist_ok=True)
    open(target, 'w', encoding='utf-8', newline='\n').write(html)   # Windows で作っても改行は LF（version.json のハッシュを GitHub と合わせる）
    print(target, len(html), 'bytes')
for code, _, _, _ in i18n.EDITIONS:
    build(code)

# JIZURA改: この端末への保存と更新の確認に使う version.json（ファイルごとの SHA-256）
import hashlib, json, datetime
def write_version_json():
    files = ['index.html'] + [f + '/index.html' for _, f, _, _ in i18n.EDITIONS if f] + ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']
    hashes = {f: hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in files}
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y.%m.%d-%H%M')
    old = None
    try: old = json.load(open('version.json', encoding='utf-8'))
    except Exception: pass
    if old and old.get('files') == hashes: return   # 中身が同じなら版も変えない
    man = {'version': VERSION + ' (' + stamp + ')', 'files': hashes}
    open('version.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(man, ensure_ascii=False, indent=1) + '\n')
    print('version.json', man['version'])
write_version_json()
if '--dev' in sys.argv:
    os.makedirs('dev/www', exist_ok=True)
    open('dev/www/jizura.js', 'w', encoding='utf-8').write(js)
    open('dev/www/test.html', 'w', encoding='utf-8').write(read('dev/test.html'))
    print('dev/www ready: cd dev/www && python3 -m http.server 8765')
