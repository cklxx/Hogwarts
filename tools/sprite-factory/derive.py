"""manifest 派生驱动：工厂几何 + 精灵 alpha 实测 + manifest 设计值
→ client/assets2d/prerendered/derived.json（运行时唯一派生数据源）。

派生口径（全部公式只此一处实现）：
- 站姿占地 stance：工厂 deriveGeometryAll() 从 3D 模型地面带截面投影得出
  （替代全包围盒 footD：包围盒含尾/颈/翼等高位部件）。
- footOffsetPx = alpha 底行（alpha>200，PNG 实测） − (anchorY + stanceS × G × sin40°)
  飞行/漂浮（manifest fly）豁免为 null；|值| ≤ 2 不登记（null）。
- 绘制宽 drawW：live-height = (H·cos40 + D·sin40) × U_LIVE × 精灵宽高比；
  live-width = 设计宽 × U_LIVE；struct-width = 设计宽 × U_STRUCT；pin = 钉版值。
- 生物 wM / 人物 w,dh / 布局 FOOT 同公式族，见 manifest.json 三张消费表。
- 模型比例标记：实测 bbox 与设计值（doc 来源）任一维偏差 > 15% → flag。

用法：python3 tools/sprite-factory/derive.py [--write-audit PATH]
"""
import json, subprocess, sys, time
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

REPO = Path('/home/hatch/workspace/hogwarts/repo')
OUT = REPO / 'client/assets2d/prerendered'
CHROME = '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
BASE = 'http://127.0.0.1:5199/tools/sprite-factory/factory.html'

man = json.loads((REPO / 'tools/sprite-factory/manifest.json').read_text())
C = man['constants']
G, COS, SIN, U_LIVE, U_STRUCT = C['G'], C['cos40'], C['sin40'], C['U_LIVE'], C['U_STRUCT']
sprites_meta = json.loads((OUT / 'sprites.json').read_text())


def alpha_bottom(name: str, thresh: int = 200) -> int:
    im = Image.open(OUT / f'{name}.png').convert('RGBA')
    a = im.getchannel('A')
    w, h = im.size
    px = a.load()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            if px[x, y] > thresh:
                return y
    return -1


def proj_h(design) -> float:
    return design['h'] * COS + design['d'] * SIN


def draw_w(name: str, entry: dict, geo: dict) -> float | None:
    rule = entry.get('rule')
    if rule is None:
        return None
    if rule == 'pin':
        return float(entry['pin'])
    meta = sprites_meta[name]
    aspect = meta['w'] / meta['h']
    design = entry.get('design')
    if rule == 'live-width':
        w = design['w'] if design and design.get('w') else geo['bboxW']
        return round(w * U_LIVE, 2)
    if rule == 'live-height':
        h = design['h'] if design and design.get('h') is not None else geo['bboxH']
        d = design['d'] if design and design.get('d') is not None else geo['stanceD'] or geo['bboxD']
        return round(proj_h({'h': h, 'd': d}) * U_LIVE * aspect, 2)
    if rule == 'struct-width':
        w = design['w'] if design and design.get('w') else geo['bboxW']
        return round(w * U_STRUCT, 2)
    raise ValueError(f'{name}: unknown rule {rule}')


def main() -> None:
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
            geo = pg.evaluate('window.__factory.deriveGeometryAll()')
            b.close()
    finally:
        server.terminate()
    for e in errs[:8]:
        print('[pageerror]', e)
    missing = sorted(set(sprites_meta) - set(geo))
    if missing:
        print('GEOMETRY MISSING:', missing)
        sys.exit(1)
    print('geometry derived for', len(geo), 'sprites')

    derived_sprites = {}
    for name, entry in man['sprites'].items():
        g = geo[name]
        meta = sprites_meta[name]
        ab = alpha_bottom(name)
        fly = bool(entry.get('fly'))
        fo = None
        # footOffset 只被 renderer 的生物/人物绘制消费，其他类不派生
        if not fly and entry.get('cat') in ('creature', 'figure-frame') and g['stanceS'] is not None:
            raw = ab - (meta['anchorY'] + g['stanceS'] * G * SIN)
            if abs(raw) > 2:
                fo = round(raw, 1)
        flags = []
        design = entry.get('design')
        # 比例标记只比宽高比：模型按任意绝对尺度建模是常态（绘制宽由设计值
        # × 精灵宽高比导出，绝对尺度不进画面）；宽高比偏离设计 > 15% 才是
        # 模型比例缺陷（巨怪宽扁、商店矮胖属此类）。manifest 标
        # aspectExempt 的条目（特快：模型朝向使画面宽为长深混合投影）跳过。
        intent = entry.get('intent') or design
        if (intent and (entry.get('designFrom') == 'doc' or entry.get('intent')) and not entry.get('aspectExempt')
                and entry.get('cat') in ('creature', 'building', 'tree')):
            if intent.get('w') and intent.get('h') is not None and intent.get('d') is not None:
                design_aspect = intent['w'] / (intent['h'] * COS + intent['d'] * SIN)
                # 模型宽高比用几何包围盒（PNG 宽高比含烘焙阴影溢出，不作数）
                model_aspect = g['bboxW'] / (g['bboxH'] * COS + g['bboxD'] * SIN)
                if abs(model_aspect / design_aspect - 1) > 0.15:
                    flags.append(f"宽高比 几何实测 {model_aspect:.2f} vs 设计 {design_aspect:.2f}"
                                 f"（{model_aspect / design_aspect - 1:+.0%}）")
        derived_sprites[name] = {
            'cat': entry.get('cat'),
            'model': {'w': g['bboxW'], 'd': g['bboxD'], 'h': g['bboxH']},
            'stance': {'w': g['stanceW'], 'd': g['stanceD'], 's': g['stanceS'], 'n': g['stanceN'],
                       'contactS': g['contactS']},
            'footOffsetPx': fo,
            'drawW': draw_w(name, entry, g),
            'flag': '；'.join(flags) if flags else None,
        }

    # ---- 消费表：生物 ----
    creatures = {}
    for kind, c in man['creatures'].items():
        meta = sprites_meta[c['sprite']]
        aspect = meta['w'] / meta['h']
        d = c['design']
        wM = d['w'] * U_LIVE if c['anchor'] == 'width' else proj_h(d) * U_LIVE * aspect
        creatures[kind] = {'sprite': c['sprite'], 'wM': round(wM, 2)}

    # ---- 消费表：人物 ----
    figures = {}
    for base, f in man['figures'].items():
        meta = sprites_meta[f'{base}-down']
        aspect = meta['w'] / meta['h']
        d = f['design']
        dh = ((d['h'] + d['hat']) * COS + d['d'] * SIN) * U_LIVE
        figures[base] = {'w': round(dh * aspect, 2), 'dh': round(dh, 2), 'variant': f['variant']}

    # ---- 消费表：布局物件 ----
    def r05(x: float) -> float:
        return max(2.0, round(x * 2) / 2)

    layout_kinds = {}
    for kind, lk in man['layoutKinds'].items():
        sp = lk['sprite']
        ds = derived_sprites[sp]
        g = geo[sp]
        dw = float(lk['drawPin']) if 'drawPin' in lk else ds['drawW']
        if lk.get('footMode') == 'lot':
            foot = lk['lotFoot']
        else:
            k = dw / g['bboxW'] if g['bboxW'] else 0
            foot = [r05((g['stanceW'] or g['bboxW']) * k * 1.1),
                    r05((g['stanceD'] or g['bboxD']) * k * 1.1)]
        layout_kinds[kind] = {'sprite': sp, 'drawW': dw, 'foot': foot,
                              'footMode': lk.get('footMode', 'stance')}
        if 'variants' in lk:
            layout_kinds[kind]['variants'] = lk['variants']

    derived = {
        'version': 1,
        'source': 'tools/sprite-factory/manifest.json + derive.py（勿手改，改 manifest 后重跑 derive）',
        'constants': C,
        'sprites': derived_sprites,
        'creatures': creatures,
        'figures': figures,
        'layoutKinds': layout_kinds,
    }
    (OUT / 'derived.json').write_text(json.dumps(derived, ensure_ascii=False, indent=1))
    print('derived.json written:',
          len(derived_sprites), 'sprites,', len(creatures), 'creatures,',
          len(figures), 'figures,', len(layout_kinds), 'layout kinds')
    flagged = {n: d['flag'] for n, d in derived_sprites.items() if d['flag']}
    print('aspect flags:', len(flagged))
    for n, f in flagged.items():
        print('  FLAG', n, f)


if __name__ == '__main__':
    main()
