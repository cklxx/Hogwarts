/**
 * 2D 俯视渲染器 (Canvas 2D)。世界 (x, z) 直接映射屏幕 (x, y)，y 向下 = +z。
 * 用色块 + 字母占位绘制实体（sprite agent 后续替换为精美贴图）。
 */
import { ELEMENT_COLORS, type CreatureKind, type Element, type House } from '../src/shared/constants';
import { drawSprite } from './sprites.js';

// ------------------------------------------------------------------ snapshot types (mirror of World.snapshot, client/main.ts)
export interface SW { h: string; n: string; ho: House; x: number; z: number; f: number; hp: number; m: number; y: number; t: string; s: string; say?: string; mm?: string }
export interface SC { i: string; k: CreatureKind; x: number; z: number; f: number; hp: number; m: number; o?: string; s: string; b?: 1 }
export interface SP { i: string; k: string; x: number; z: number; e: Element }
export interface Fx { k: string; x: number; z: number; r?: number; e?: Element; h?: string; n?: number; pts?: number[] }
export interface Snap {
  t: number; hour: number; night: boolean; weather: string;
  term: { n: number; left: number };
  w: SW[]; c: SC[]; p: SP[]; fx: Fx[];
  elder: { x: number; z: number } | null;
  /** 大战周 wire (kernel/warweek.ts): day/total + 墓碑 */
  warweek?: { day: number; total: number; tombstones: { n: string; x: number; z: number }[] };
}

const css = (n: number) => '#' + n.toString(16).padStart(6, '0');

// ------------------------------------------------------------------ ground zones (fixed layout, matches src/shared/map.ts)
interface Zone { x0: number; z0: number; x1: number; z1: number; color: string; label: string }
const ZONES: Zone[] = [
  // castle keep + wings (stone)
  { x0: -62, z0: -112, x1: 62, z1: -40, color: '#8a8d94', label: '城堡' },
  // courtyard / lawn south of castle (grass)
  { x0: -80, z0: -40, x1: 80, z1: 40, color: '#5d8f4e', label: '' },
  // forbidden forest (dark green, west+north)
  { x0: -240, z0: -240, x1: -80, z1: 120, color: '#2f5b33', label: '禁林' },
  // deep forest pocket (east)
  { x0: 120, z0: -200, x1: 240, z1: -40, color: '#2f5b33', label: '' },
  // black lake (blue, south-east)
  { x0: 40, z0: 60, x1: 200, z1: 200, color: '#2c5f8a', label: '黑湖' },
  // quidditch pitch (light green oval -> box)
  { x0: -160, z0: 60, x1: -60, z1: 160, color: '#6aa356', label: '魁地奇球场' },
  // hogsmeade (tan, far south)
  { x0: -60, z0: 220, x1: 60, z1: 320, color: '#a08b62', label: '霍格莫德' },
];
// default ground color outside zones
const GROUND = '#557d46';


// ------------------------------------------------------------------ renderer
export interface Camera { x: number; z: number; zoom: number }

export function createRenderer2D(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const cam: Camera = { x: 0, z: -22, zoom: 1 };
  let snap: Snap | null = null;
  let myHandle = '';
  let follow = true;
  const keys = new Set<string>();

  // --- input: wheel zoom, WASD/arrows pan (pan breaks follow) ---
  canvas.tabIndex = 0;
  addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.zoom = Math.min(3, Math.max(0.5, cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    follow = false;
  }, { passive: false });
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k); follow = false; e.preventDefault();
    }
    if (k === 'f') follow = true; // F: resume follow
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
  };
  addEventListener('resize', resize);
  resize();

  function setSnap(s: Snap) { snap = s; }
  function setMe(h: string) { myHandle = h; }

  // world -> screen
  const w2s = (x: number, z: number): [number, number] => {
    const sx = canvas.width / devicePixelRatio, sy = canvas.height / devicePixelRatio;
    return [(x - cam.x) * cam.zoom + sx / 2, (z - cam.z) * cam.zoom + sy / 2];
  };
  const scale = (v: number) => v * cam.zoom;

  // cull: is world point inside view?
  const visible = (x: number, z: number, pad = 40): boolean => {
    const [sx, sy] = w2s(x, z);
    const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
    return sx > -pad && sx < w + pad && sy > -pad && sy < h + pad;
  };

  let lastT = 0;
  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
    lastT = now;

    // camera: follow me, or WASD pan
    if (snap) {
      const me = snap.w.find((w) => w.h === myHandle);
      if (follow && me) { cam.x = me.x; cam.z = me.z; }
    }
    const pan = 320 * dt / cam.zoom;
    if (keys.has('w') || keys.has('arrowup')) cam.z -= pan;
    if (keys.has('s') || keys.has('arrowdown')) cam.z += pan;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
    if (keys.has('d') || keys.has('arrowright')) cam.x += pan;

    draw();
  }

  function draw() {
    const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // --- ground ---
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    const night = snap?.night;
    for (const zn of ZONES) {
      if (!visible((zn.x0 + zn.x1) / 2, (zn.z0 + zn.z1) / 2, Math.max(zn.x1 - zn.x0, zn.z1 - zn.z0))) continue;
      const [sx, sy] = w2s(zn.x0, zn.z0);
      ctx.fillStyle = night ? shade(zn.color, 0.45) : zn.color;
      ctx.fillRect(sx, sy, scale(zn.x1 - zn.x0), scale(zn.z1 - zn.z0));
      if (zn.label && cam.zoom > 0.7) {
        ctx.fillStyle = night ? '#cfd4dc' : '#2c2c2c';
        ctx.font = `${Math.max(10, 12 * cam.zoom)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(zn.label, sx + scale(zn.x1 - zn.x0) / 2, sy + 16);
      }
    }

    if (!snap) {
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待快照…', W / 2, H / 2);
      return;
    }

    // --- chests / props as squares (from fx? no: props come via events; draw elder wand tomb) ---
    if (snap.elder && visible(snap.elder.x, snap.elder.z)) {
      const [sx, sy] = w2s(snap.elder.x, snap.elder.z);
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
      ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('E', sx, sy + 12);
    }

    // --- tombstones: 战后世界 (kernel/aftermath.ts) ---
    for (const t of snap.warweek?.tombstones ?? []) {
      if (!visible(t.x, t.z)) continue;
      const [sx, sy] = w2s(t.x, t.z);
      const size = Math.max(14, 22 * cam.zoom);
      drawSprite(ctx, 'tombstone', sx - size / 2, sy - size / 2, size, size);
      if (cam.zoom > 0.9) {
        ctx.fillStyle = '#c9c9d4'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(t.n.split(' ').pop() ?? t.n, sx, sy + size / 2 + 11);
      }
    }

    // --- projectiles ---
    for (const p of snap.p) {
      if (!visible(p.x, p.z)) continue;
      const [sx, sy] = w2s(p.x, p.z);
      ctx.fillStyle = css(ELEMENT_COLORS[p.e] ?? 0xffffff);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2, 3 * cam.zoom), 0, Math.PI * 2);
      ctx.fill();
    }

    // --- creatures: pixel sprite per kind, hp bar below ---
    for (const c of snap.c) {
      if (!visible(c.x, c.z)) continue;
      const [sx, sy] = w2s(c.x, c.z);
      const size = Math.max(12, 20 * cam.zoom);
      drawSprite(ctx, c.k, sx - size / 2, sy - size / 2, size, size);
      const hostile = c.s.includes('H') || ['dementor', 'spider', 'troll', 'basilisk', 'dragon', 'aragog', 'nundu', 'chimera', 'manticore', 'lethifold', 'werewolf'].includes(c.k);
      if (hostile) { ctx.strokeStyle = '#ff2a1a'; ctx.lineWidth = 2; ctx.strokeRect(sx - size / 2 - 1, sy - size / 2 - 1, size + 2, size + 2); }
      const r = size / 2;
      // hp bar
      if (c.hp < c.m) {
        ctx.fillStyle = '#222'; ctx.fillRect(sx - r, sy - r - 5, r * 2, 3);
        ctx.fillStyle = '#4dff4d'; ctx.fillRect(sx - r, sy - r - 5, (r * 2 * c.hp) / c.m, 3);
      }
      if (cam.zoom > 1.2) {
        ctx.fillStyle = '#fff'; ctx.font = `${Math.max(9, 10 * cam.zoom)}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(c.k[0].toUpperCase(), sx, sy + r + 11);
      }
    }

    // --- wizards: house sprite + hp bar + name ---
    for (const w of snap.w) {
      if (!visible(w.x, w.z)) continue;
      const [sx, sy] = w2s(w.x, w.z);
      const isMe = w.h === myHandle;
      const r = Math.max(5, 8 * cam.zoom);
      const size = r * 3;
      drawSprite(ctx, `wizard-${w.ho}`, sx - size / 2, sy - size / 2, size, size);
      if (isMe) { ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(sx - size / 2 - 1, sy - size / 2 - 1, size + 2, size + 2); }
      // facing tick
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(w.f) * (r + 4), sy + Math.sin(w.f) * (r + 4));
      ctx.stroke();
      // hp bar
      if (w.hp < w.m) {
        ctx.fillStyle = '#222'; ctx.fillRect(sx - r, sy - r - 6, r * 2, 3);
        ctx.fillStyle = w.hp / w.m > 0.4 ? '#4dff4d' : '#ff4d4d';
        ctx.fillRect(sx - r, sy - r - 6, (r * 2 * w.hp) / w.m, 3);
      }
      // name
      ctx.fillStyle = isMe ? '#ffd700' : '#fff';
      ctx.font = `${isMe ? 'bold ' : ''}${Math.max(10, 11 * cam.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(w.n, sx, sy + r + 13);
      // status letters (S shield / X stunned / J jailed)
      const flags = w.s.replace('N', '');
      if (flags && cam.zoom > 0.8) {
        ctx.fillStyle = '#ffec8a'; ctx.font = '10px sans-serif';
        ctx.fillText(flags, sx, sy - r - 8);
      }
      // speech
      if (w.say && cam.zoom > 0.9) {
        ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif';
        ctx.fillText(w.say.slice(0, 24), sx, sy - r - 20);
      }
    }

    // --- fx: expanding rings / flashes ---
    for (const f of snap.fx) {
      if (!visible(f.x, f.z)) continue;
      const [sx, sy] = w2s(f.x, f.z);
      const col = f.e ? css(ELEMENT_COLORS[f.e]) : '#ffffff';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, scale(f.r ?? 6), 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- HUD: term / time / zoom ---
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(8, 8, 250, 56);
    ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.textAlign = 'left';
    const mm = Math.floor(snap.term.left / 60), ss = snap.term.left % 60;
    ctx.fillText(`第 ${snap.term.n} 学期  ${mm}:${String(ss).padStart(2, '0')}`, 16, 28);
    ctx.fillText(`${snap.night ? '夜' : '昼'} · ${snap.weather} · 缩放 ${cam.zoom.toFixed(1)}x`, 16, 48);
    ctx.fillStyle = '#aaa'; ctx.font = '11px sans-serif';
    ctx.fillText('滚轮缩放 · WASD 移动视角 · F 回到跟随', 16, 62);
  }

  requestAnimationFrame(frame);
  return { setSnap, setMe, cam };
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

export type Renderer2D = ReturnType<typeof createRenderer2D>;
