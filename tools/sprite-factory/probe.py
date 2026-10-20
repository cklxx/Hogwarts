"""sprite-factory driver: serve repo, open factory page, run measure + piece renders."""
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright

CHROME = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
BASE = 'http://127.0.0.1:5199/tools/sprite-factory/factory.html'

server = subprocess.Popen(['node', 'tools/sprite-factory/serve.mjs', '5199'],
                          cwd='/home/hatch/workspace/hogwarts/repo',
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox', '--enable-unsafe-swiftshader'],
                              executable_path=CHROME)
        pg = b.new_page(viewport={'width': 1600, 'height': 1000})
        msgs = []
        pg.on('console', lambda m: msgs.append(m.text[:200]))
        pg.on('pageerror', lambda e: msgs.append('PAGEERR ' + str(e)[:200]))
        pg.goto(BASE, wait_until='domcontentloaded', timeout=30000)
        pg.wait_for_function('window.__factory && window.__factory.ready', timeout=30000)
        m = pg.evaluate('window.__factory.measure()')
        print(json.dumps(m, indent=1))
        pieces = sys.argv[1:] or ['wall', 'wall-doorway-square', 'wall-window-small', 'wall-corner',
                                  'wall-wood', 'roof', 'roof-left', 'roof-right', 'roof-gable-end',
                                  'roof-high', 'roof-high-left', 'roof-high-gable-end',
                                  'chimney', 'lantern', 'fence', 'tree_pineTallA', 'tree_tall']
        for name in pieces:
            r = pg.evaluate("""async (n) => {
              const r = await window.__factory.renderPiece(n);
              window.__factory.showSprite(n, r.canvas, 1);
              return r.meta;
            }""", name)
            print(name, r)
        pg.wait_for_timeout(600)
        pg.screenshot(path='/tmp/factory-pieces.png', full_page=True)
        for t in msgs[:15]:
            print('[console]', t)
        b.close()
finally:
    server.terminate()
print('done')
