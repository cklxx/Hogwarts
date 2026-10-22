/**
 * client2d 入口：最小可运行版本。连 WebSocket，收快照，2D 俯视渲染。
 * 用法：npm run dev 后访问 /2d.html（见 client2d/index.html），或直接 node serve。
 */
import { WS_KEY_PREFIX, WS_PROTOCOL } from '../../src/shared/constants';
import { SnapDecoder } from '../../src/shared/snapwire';
import { createRenderer2D, type Snap } from './renderer';
import { mountHUD, updateHUD, showItemInfo } from './hud.js';
import { getLayout } from './layout.js';

// ------------------------------------------------------------------ 物品图鉴
// 图鉴 UI（点击/E 弹窗）的数据源。只收录 A 组重画的物品。
export const ITEM_INFO: Record<string, {name: string; desc: string; grade: '普通' | '稀有' | '传说'}> = {
  bush: {name: '灌木', desc: '低矮的叶丛，通常三五成簇长在草地上。', grade: '普通'},
  stone: {name: '石头', desc: '有含义的石头：边界石标示区域、石阵藏着符文、路缘石引导方向。', grade: '普通'},
  chest: {name: '宝箱', desc: '封印的木箱，铜色普通、银色稀有、金色传说。', grade: '稀有'},
  well: {name: '水井', desc: '村广场中央的老井，石台木架上垂着水桶。', grade: '普通'},
  dock: {name: '木码头', desc: '伸向黑湖的木板栈道，桩柱钉得牢固。', grade: '普通'},
  mooringpost: {name: '系船柱', desc: '拴小船的矮木桩，缠着一圈绳索。', grade: '普通'},
  boat: {name: '小船', desc: '黑湖上的小木船，一年级新生渡湖用的。', grade: '普通'},
  campfire: {name: '篝火', desc: '石圈围着的柴火堆，夜里生火驱寒照明。', grade: '普通'},
  web: {name: '蛛网', desc: '禁林树间挂着的蛛网，蛛丝沾着露水。', grade: '普通'},
  glowflower: {name: '发光花', desc: '禁林深处的稀有植物，花瓣夜里发出微光。', grade: '稀有'},
  signpost: {name: '告示牌', desc: '岔路口的木指示牌，箭头指向各个方向。', grade: '普通'},
  reed: {name: '芦苇丛', desc: '黑湖岸边的水生植物，成簇随风摇摆。', grade: '普通'},
  mushroom: {name: '蘑菇', desc: '只长在禁林深处的毒蝇伞，石阵周围最多。', grade: '普通'},
  lamp: {name: '路灯', desc: '铁质灯杆，罩着暖黄的玻璃灯，夜里照亮道路。', grade: '普通'},
  brazier: {name: '火盆', desc: '铁质三脚火盆，点燃后是传说级警戒火光。', grade: '传说'},
  fence: {name: '栅栏', desc: '木栅栏，三节以上成排，围出农田和庭院。', grade: '普通'},
  villagegate: {name: '村门', desc: '霍格莫德村口的木石牌坊，梁上钉着铁箍。', grade: '普通'},
  marketstall: {name: '集市摊位', desc: '木货台加条纹遮阳棚，摊上摆满各色货物。', grade: '普通'},
  greenhouse: {name: '温室', desc: '草药课的玻璃温室，木框里种着奇异植物。', grade: '稀有'},
  flowerbed: {name: '花坛', desc: '小方花圃，五朵小花开在深色土上。', grade: '普通'},
  bench: {name: '长椅', desc: '木质长椅，成对摆在建筑的呼吸空间里。', grade: '普通'},
  scarecrow: {name: '稻草人', desc: '木杆撑起的草帽南瓜头，守护农田。', grade: '普通'},
  beehive: {name: '蜂箱', desc: '三层叠木蜂箱，蜜满时是稀有采集点。', grade: '稀有'},
  gardenplot: {name: '苗圃', desc: '木框围出的种植床，两排幼苗刚发芽。', grade: '普通'},
  swing: {name: '秋千', desc: '木 A 架吊着的秋千，绳结系得很牢。', grade: '普通'},
  tent: {name: '帐篷', desc: '马人营地的圆锥帆布帐篷，顶上系着红带。', grade: '普通'},
  scoreboard: {name: '记分牌', desc: '魁地奇训练场的木记分牌，挂着当前比分。', grade: '普通'},
  traininghoop: {name: '训练球门', desc: '单门的训练用金环，杆比正式球门矮。', grade: '普通'},
  owlery: {name: '猫头鹰棚屋', desc: '高塔上的开放栖木层，住着送信的猫头鹰。', grade: '普通'},
  lighthouse: {name: '灯塔', desc: '黑湖码头的红白条纹小灯塔，指引归航。', grade: '普通'},
  station: {name: '车站', desc: '长条站楼带站台和大钟，霍格沃茨特快的起点。', grade: '普通'},
  library: {name: '图书馆', desc: '石柱三角楣的阅览馆，台阶拾级而上。', grade: '普通'},
  dormtower: {name: '宿舍塔楼', desc: '学院色的尖顶塔楼，竖排暖窗是宿舍灯光。', grade: '普通'},
  shop: {name: '商店', desc: '临街店铺，挂着招牌板和条纹雨棚。', grade: '普通'},
  pub: {name: '酒吧', desc: '三把扫帚酒吧，暖窗和悬挂扫帚招牌。', grade: '普通'},
};

const LS = 'hogwarts.token';
const loadToken = () => { try { return localStorage.getItem(LS); } catch { return null; } };

// token: #k=… / ?token=… / localStorage
function tokenFromUrl(href: string): string | null {
  const m = href.match(/[#?&](?:k|token)=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function gate(): Promise<string | null> {
  const fromUrl = tokenFromUrl(location.href);
  if (fromUrl) {
    try { localStorage.setItem(LS, fromUrl); } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname);
    return fromUrl;
  }
  return loadToken();
}

async function main() {
  // debug: #hour=21 / ?hour=21 — freeze the time of day for acceptance
  // screenshots (the server runs a 900 s day; waiting for night is slow).
  // NOTE: main() re-runs on ws reconnect and gate() strips the URL hash, so
  // the override is kept in sessionStorage for the life of the tab.
  const HOUR_LS = 'hogwarts.hourOverride';
  const hourOverride = (() => {
    const m = location.href.match(/[#?&]hour=(\d+(?:\.\d+)?)/);
    const h = m ? parseFloat(m[1]) : NaN;
    if (Number.isFinite(h)) {
      const hh = ((h % 24) + 24) % 24;
      try { sessionStorage.setItem(HOUR_LS, String(hh)); } catch { /* ignore */ }
      return hh;
    }
    try {
      const v = parseFloat(sessionStorage.getItem(HOUR_LS) ?? '');
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  })();
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#1a1a1a';
  // 重连会重跑 main(): 先移除上一次的 canvas, 避免旧 canvas 在 body 里堆积
  // (HUD 有 mountHUD 的 root 守卫, 不会重复挂载)
  document.querySelectorAll('canvas[data-2d]').forEach((el) => el.remove());
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-2d', 'game');
  document.body.appendChild(canvas);
  const ui = createRenderer2D(canvas);
  (canvas as any).__renderer = ui;
  // test hook: goto2d event for automated screenshots
  addEventListener('goto2d', (e: any) => {
    const { x, z } = e.detail ?? {};
    if (typeof x === 'number' && typeof z === 'number') { ui.cam.x = x; ui.cam.z = z; }
  });
  mountHUD(document.body);

  const token = await gate();
  if (!token) {
    document.body.innerHTML = '<div style="color:#fff;font:16px sans-serif;padding:40px">需要 token：用主客户端登录一次，或在地址后加 #k=你的token</div>';
    return;
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`, [WS_PROTOCOL, WS_KEY_PREFIX + token]);
  ws.binaryType = 'arraybuffer';
  const snaps = new SnapDecoder();

  ws.onclose = () => { setTimeout(main, 3000); };
  ws.onerror = (e) => console.warn('[2d] ws error', e);

  // --- player controls: WASD move, click cast, 1-9 hotbar ---
  const keys = new Set<string>();
  const sendInput = () => {
    if (ws.readyState !== 1) return;
    let dx = 0, dz = 0;
    if (keys.has('w')) dz -= 1;
    if (keys.has('s')) dz += 1;
    if (keys.has('a')) dx -= 1;
    if (keys.has('d')) dx += 1;
    ws.send(JSON.stringify({ t: 'input', dx, dz }));
  };
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ('wasd'.includes(k) && !keys.has(k)) { keys.add(k); sendInput(); }
    if (k >= '1' && k <= '9') {
      // hotbar cast: server findSpell resolves '1'-'6' to the hotbar slot
      ws.send(JSON.stringify({ t: 'cast', key: k }));
    }
    if (k === 'e') {
      // 物品图鉴：40 单位内最近的布局物品
      const px = (ui.cam as any).x, pz = (ui.cam as any).z;
      let best: { x: number; z: number; kind: string } | null = null, bd = 40;
      for (const it of getLayout().items) {
        const d = Math.hypot(it.x - px, it.z - pz);
        if (d < bd) { bd = d; best = it; }
      }
      if (best) {
        const info = (ITEM_INFO as Record<string, { name: string; desc: string; grade: string }>)[best.kind];
        if (info) showItemInfo(info.name, info.desc, info.grade);
      }
    }
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.delete(k)) sendInput();
  });
  // click-to-cast at world position
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    // convert screen -> world via renderer camera (exposed on ui)
    const wx = (ui as any).screenToWorld?.(e.clientX - r.left, e.clientY - r.top);
    if (wx && ws.readyState === 1) ws.send(JSON.stringify({ t: 'cast', key: '1', x: wx.x, z: wx.z }));
  });

  ws.onmessage = (m: MessageEvent) => {
    let msg: any;
    if (typeof m.data === 'string') {
      msg = JSON.parse(m.data);
    } else {
      const s = snaps.decode(new Uint8Array(m.data as ArrayBuffer));
      if (!s) { snaps.clear(); ws.send(JSON.stringify({ t: 'resync' })); return; }
      msg = { t: 'snap', s };
    }
    if (msg.t === 'welcome') {
      ui.setMe(msg.handle);
      (main as any)._me = msg.handle;
    } else if (msg.t === 'me') {
      // private state: hotbar + real mana (server fills new wizards' hotbar from the curriculum)
      (main as any)._meState = msg.s;
    } else if (msg.t === 'snap') {
      const s = msg.s as Snap;
      if (hourOverride !== null) { s.hour = hourOverride; s.night = hourOverride < 6 || hourOverride >= 20; }
      ui.setSnap(s);
      // feed HUD: map Snap -> HudSnapshot
      const myH = (main as any)._me as string | undefined;
      const me = (myH && s.w.find((w) => w.h === myH)) ?? s.w[0];
      const meState = (main as any)._meState as { hotbar?: ({ id: string; name: string; mana?: number | null; cd: number; kind?: 'harm' | 'help' | 'self' } | null)[]; mana?: number; maxMana?: number } | undefined;
      try {
        updateHUD({
          me: me ? { handle: me.h, x: me.x, z: me.z, hp: me.hp, maxHp: me.m, mana: meState?.mana ?? 100, maxMana: meState?.maxMana ?? 100 } : { handle: '?', x: 0, z: 0, hp: 1, maxHp: 1, mana: 1, maxMana: 1 },
          wizards: s.w.map((w) => ({ h: w.h, x: w.x, z: w.z })),
          creatures: s.c.map((c) => ({ x: c.x, z: c.z, hostile: c.s.includes('H') })),
          hotbar: meState?.hotbar ?? [],
          selected: 0,
          warweek: (s as any).warweek ?? { day: ((s.term.n - 1) % 7) + 1, total: 7 },
          fates: (s as any).fates ?? [],
        });
      } catch (e) { console.warn('[2d] hud', e); }
    }
    // 其他消息（evs/me/chest）先忽略：渲染器只关心快照
  };
}

main().catch((e) => console.error('[2d] fatal', e));
