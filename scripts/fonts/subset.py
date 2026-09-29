#!/usr/bin/env python3
"""
Rebuild the UI fonts in client/public/fonts/ (the parchment-and-ink look, client/style.css).

    pip install fonttools brotli
    python3 scripts/fonts/subset.py <dir with the source fonts>

The source directory holds the upstream OFL fonts, one folder each (Google Fonts layout):
  lxgwwenkai/LXGWWenKai-Regular.ttf, lxgwwenkai/LXGWWenKai-Medium.ttf   (body, 霞鹜文楷)
  mashanzheng/MaShanZheng-Regular.ttf                                     (brush headings, 马善政)
  cormorantgaramond/CormorantGaramond[wght].ttf, ...-Italic[wght].ttf     (Latin spell names, numerals)
  courierprime/CourierPrime-Regular.ttf                                   (Runes code)

Which characters:
  body   = the 3500 common characters (scripts/fonts/common-3500.txt, so player names and chat mostly render
           in the same hand) + every CJK character in client/ and src/ (all the Chinese the game can show)
  brush  = every CJK character in client/ + the shared names (src/shared, src/lore/spells.ts, seals): the
           headings only ever show UI strings, template names, spell and seal names
Run it again whenever new Chinese text lands in the sources (a missing glyph falls back to the system font).
"""
import glob, os, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'client', 'public', 'fonts')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('FONT_SRC', '')
if not SRC or not os.path.isdir(SRC):
    sys.exit(__doc__)


def cjk_in(patterns):
    s = set()
    for p in patterns:
        for f in glob.glob(os.path.join(ROOT, p), recursive=True):
            s |= {c for c in open(f, encoding='utf8', errors='ignore').read() if 0x2e80 <= ord(c) <= 0x9fff or 0xf900 <= ord(c) <= 0xfaff or 0xff00 <= ord(c) <= 0xffef or 0x3000 <= ord(c) <= 0x303f}
    return s


PUNCT = set('，。、；：？！“”‘’（）《》〈〉【】—…·「」『』～％＋－×÷①②③④⑤⑥⑦⑧⑨⑩　•→←↑↓★☆◆◇○●☼☾✦✧✓✗')
LATIN = {chr(i) for i in range(0x20, 0x7f)} | {chr(i) for i in range(0xa0, 0x100)}
common = {c for c in open(os.path.join(ROOT, 'scripts', 'fonts', 'common-3500.txt'), encoding='utf8').read().split() if len(c) == 1}
game = cjk_in(['client/**/*.ts', 'client/index.html', 'src/**/*.ts'])
body = common | game | PUNCT | LATIN
brush = cjk_in(['client/**/*.ts', 'client/index.html', 'src/shared/*.ts', 'src/lore/spells.ts', 'src/kernel/seals.ts']) | PUNCT | LATIN

os.makedirs(OUT, exist_ok=True)


def subset(src, out, chars=None, unicodes=None):
    args = ['pyftsubset', os.path.join(SRC, src), '--flavor=woff2', '--layout-features=*', '--no-hinting', '--desubroutinize', f'--output-file={os.path.join(OUT, out)}']
    if chars is not None:
        tmp = os.path.join(OUT, '.chars.txt')
        open(tmp, 'w', encoding='utf8').write(''.join(sorted(chars)))
        args.append(f'--text-file={tmp}')
    else:
        args.append(f'--unicodes={unicodes}')
    subprocess.run(args, check=True)
    if chars is not None:
        os.remove(tmp)
    print(f'{out:34} {os.path.getsize(os.path.join(OUT, out)) / 1024:7.0f} KB')


print(f'body: {len(body)} characters ({len(game)} CJK from the sources), brush: {len(brush)}')
subset('lxgwwenkai/LXGWWenKai-Regular.ttf', 'LXGWWenKai-Regular.woff2', body)
subset('lxgwwenkai/LXGWWenKai-Medium.ttf', 'LXGWWenKai-Medium.woff2', body)
subset('mashanzheng/MaShanZheng-Regular.ttf', 'MaShanZheng-ui.woff2', brush)
LAT = 'U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2190-2193,U+2212,U+2215,U+2713'
subset('cormorantgaramond/CormorantGaramond[wght].ttf', 'CormorantGaramond.woff2', unicodes=LAT)
subset('cormorantgaramond/CormorantGaramond-Italic[wght].ttf', 'CormorantGaramond-Italic.woff2', unicodes=LAT)
subset('courierprime/CourierPrime-Regular.ttf', 'CourierPrime.woff2', unicodes=LAT)
