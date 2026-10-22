"""sprite-factory targeted driver: render ONLY the named hw sprites with the
stored master palette (no palette drift), merge into prerendered/ + sprites.json.
Usage: python3 tools/sprite-factory/render-some.py name1 name2 ...
"""
import base64, json, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path('/home/hatch/workspace/hogwarts/repo')
OUT = REPO / 'client/assets2d/prerendered'
CHROME = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
BASE = 'http://127.0.0.1:5199/tools/sprite-factory/factory.html'

names = sys.argv[1:]
assert names, 'no sprite names given'
palette = json.loads((OUT / 'palette.json').read_text())['palette']
meta_path = OUT / 'sprites.json'
meta = json.loads(meta_path.read_text())

server = subprocess.Popen(['node', 'tools/sprite-factory/serve.mjs', '5199'],
                          cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader'],
                              executable_path=CHROME)
        pg = b.new_page(viewport={'width': 1500, 'height': 1050})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        pg.goto(BASE, wait_until='domcontentloaded', timeout=30000)
        pg.wait_for_function('window.__factory && window.__factory.ready', timeout=30000)
        res = pg.evaluate('window.__factory.renderSomePixelated(%s, %s)'
                          % (json.dumps(names), json.dumps(palette)))
        for n, r in res.items():
            if r is None:
                print('MISSING BUILDER:', n)
                continue
            data = base64.b64decode(r['dataUrl'].split(',', 1)[1])
            (OUT / f'{n}.png').write_bytes(data)
            meta[n] = r['meta']
            print(n, r['meta'])
        meta_path.write_text(json.dumps(meta, indent=1))
        for e in errs[:8]:
            print('[pageerror]', e)
        b.close()
finally:
    server.terminate()
print('merged into', meta_path, 'total sprites:', len(meta))
