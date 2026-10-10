/**
 * client2d 入口：最小可运行版本。连 WebSocket，收快照，2D 俯视渲染。
 * 用法：npm run dev 后访问 /2d.html（见 client2d/index.html），或直接 node serve。
 */
import { WS_KEY_PREFIX, WS_PROTOCOL } from '../../src/shared/constants';
import { SnapDecoder } from '../../src/shared/snapwire';
import { createRenderer2D, type Snap } from './renderer';
import { mountHUD, updateHUD } from './hud.js';

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
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#1a1a1a';
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const ui = createRenderer2D(canvas);
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

  ws.onopen = () => console.log('[2d] ws open');
  ws.onclose = () => console.log('[2d] ws closed, retry in 3s'), setTimeout(main, 3000);
  ws.onerror = (e) => console.warn('[2d] ws error', e);

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
      console.log('[2d] welcome as', msg.handle);
    } else if (msg.t === 'snap') {
      const s = msg.s as Snap;
      ui.setSnap(s);
      // feed HUD: map Snap -> HudSnapshot
      const myH = (main as any)._me as string | undefined;
      const me = (myH && s.w.find((w) => w.h === myH)) ?? s.w[0];
      try {
        updateHUD({
          me: me ? { handle: me.h, x: me.x, z: me.z, hp: me.hp, maxHp: me.m, mana: 100, maxMana: 100 } : { handle: '?', x: 0, z: 0, hp: 1, maxHp: 1, mana: 1, maxMana: 1 },
          wizards: s.w.map((w) => ({ h: w.h, x: w.x, z: w.z })),
          creatures: s.c.map((c) => ({ x: c.x, z: c.z, hostile: c.s.includes('H') })),
          hotbar: [],
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
