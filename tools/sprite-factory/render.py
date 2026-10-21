"""sprite-factory driver: render all sprites → client/assets2d/prerendered/ + sprites.json.
Also screenshots the factory contact sheet to /tmp/factory-sheet.png.
Usage: python3 tools/sprite-factory/render.py
"""
import base64, json, subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path('/home/hatch/workspace/hogwarts/repo')
OUT = REPO / 'client/assets2d/prerendered'
CHROME = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
BASE = 'http://127.0.0.1:5199/tools/sprite-factory/factory.html'

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
        out = pg.evaluate('window.__factory.renderAll()')
        info = pg.evaluate('window.__factory.pixelInfo()')
        if info:
            (OUT / 'palette.json').write_text(json.dumps(info, indent=1))
            print('palette:', len(info['palette']), 'colors,', info['perMeter'], 'px/m')
        OUT.mkdir(parents=True, exist_ok=True)
        meta = {}
        for name, r in out.items():
            data = base64.b64decode(r['dataUrl'].split(',', 1)[1])
            (OUT / f'{name}.png').write_bytes(data)
            meta[name] = r['meta']
            print(name, r['meta'])
        (OUT / 'sprites.json').write_text(json.dumps(meta, indent=1))
        pg.wait_for_timeout(700)
        pg.screenshot(path='/tmp/factory-sheet.png', full_page=True)
        for e in errs[:8]:
            print('[pageerror]', e)
        b.close()
finally:
    server.terminate()
print('saved to', OUT)
