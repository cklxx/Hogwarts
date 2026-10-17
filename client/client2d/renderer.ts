/**
 * 2D 俯视渲染器 (Canvas 2D)。世界 (x, z) 直接映射屏幕 (x, y)，y 向下 = +z。
 * 用色块 + 字母占位绘制实体（sprite agent 后续替换为精美贴图）。
 */
import { ELEMENT_COLORS, type CreatureKind, type Element, type House } from '../../src/shared/constants';
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
type ZoneTex = 'stone' | 'grass' | 'forest' | 'lake' | 'village';
interface Zone { x0: number; z0: number; x1: number; z1: number; color: string; label: string; tex: ZoneTex }
const ZONES: Zone[] = [
  // castle keep + wings (stone)
  { x0: -62, z0: -112, x1: 62, z1: -40, color: '#8a8d94', label: '城堡', tex: 'stone' },
  // courtyard / lawn south of castle (grass)
  { x0: -80, z0: -40, x1: 80, z1: 40, color: '#5d8f4e', label: '', tex: 'grass' },
  // forbidden forest (dark green, west+north)
  { x0: -240, z0: -240, x1: -80, z1: 120, color: '#2f5b33', label: '禁林', tex: 'forest' },
  // deep forest pocket (east)
  { x0: 120, z0: -200, x1: 240, z1: -40, color: '#2f5b33', label: '', tex: 'forest' },
  // black lake (blue, south-east)
  { x0: 40, z0: 60, x1: 200, z1: 200, color: '#2c5f8a', label: '黑湖', tex: 'lake' },
  // quidditch pitch (light green oval -> box)
  { x0: -160, z0: 60, x1: -60, z1: 160, color: '#6aa356', label: '魁地奇球场', tex: 'grass' },
  // hogsmeade (tan, far south)
  { x0: -60, z0: 220, x1: 60, z1: 320, color: '#a08b62', label: '霍格莫德', tex: 'village' },
];
// default ground color outside zones
const GROUND = '#557d46';

// ------------------------------------------------------------------ per-frame hot-path caches
// These avoid per-entity allocations and string work inside draw():
// - HOSTILE_KINDS: Set lookup instead of a per-creature array literal
// - elemCss: precomputed '#rrggbb' per Element (css() does toString(16) per call)
const HOSTILE_KINDS = new Set(['dementor', 'spider', 'troll', 'basilisk', 'dragon', 'aragog', 'nundu', 'chimera', 'manticore', 'lethifold', 'werewolf']);
const elemCssCache = new Map<Element, string>();
const elemCss = (e: Element): string => {
  let s = elemCssCache.get(e);
  if (!s) { s = css(ELEMENT_COLORS[e] ?? 0xffffff); elemCssCache.set(e, s); }
  return s;
};

// ------------------------------------------------------------------ terrain texture: pre-rendered once, blitted per frame
const TPX = 3; // texture px per world unit
const TB = { x0: -280, z0: -280, x1: 280, z1: 360 }; // texture world bounds
const TW = (TB.x1 - TB.x0) * TPX, TH = (TB.z1 - TB.z0) * TPX;
const w2tx = (x: number) => (x - TB.x0) * TPX;
const w2ty = (z: number) => (z - TB.z0) * TPX;

type Rnd = () => number;
function mulberry(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Painter = (g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, rnd: Rnd) => void;

const texGrass: Painter = (g, x0, y0, w, h, rnd) => {
  // grass blades: light/dark flecks
  const n = (w * h) / 110;
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h;
    g.fillStyle = rnd() < 0.55 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)';
    g.fillRect(x, y, 1 + rnd() * 2, 2 + rnd() * 3);
  }
  // clumps
  const m = (w * h) / 3200;
  for (let i = 0; i < m; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h, r = 3 + rnd() * 7;
    g.fillStyle = rnd() < 0.5 ? 'rgba(30,70,25,0.22)' : 'rgba(160,210,110,0.15)';
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
};

const texStone: Painter = (g, x0, y0, w, h, rnd) => {
  // flagstone grid
  const step = 9 * TPX;
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = Math.max(1, TPX * 0.45);
  g.beginPath();
  for (let x = x0 + step; x < x0 + w; x += step) { g.moveTo(x, y0); g.lineTo(x, y0 + h); }
  for (let y = y0 + step; y < y0 + h; y += step) { g.moveTo(x0, y); g.lineTo(x0 + w, y); }
  g.stroke();
  // per-stone tint jitter
  for (let y = y0; y < y0 + h; y += step) {
    for (let x = x0; x < x0 + w; x += step) {
      if (rnd() < 0.5) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
        g.fillRect(x + 1, y + 1, step - 2, step - 2);
      }
    }
  }
  // speckle
  const n = (w * h) / 300;
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
    g.fillRect(x0 + rnd() * w, y0 + rnd() * h, 2, 2);
  }
};

const texForest: Painter = (g, x0, y0, w, h, rnd) => {
  // canopy blobs: dark + light
  const cols = ['rgba(12,36,15,0.38)', 'rgba(60,110,60,0.22)', 'rgba(20,55,25,0.30)'];
  const n = (w * h) / 800;
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h, r = 4 + rnd() * 11;
    g.fillStyle = cols[i % 3]!;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // trunk dots
  const m = (w * h) / 5200;
  for (let i = 0; i < m; i++) {
    g.fillStyle = 'rgba(40,26,14,0.55)';
    g.fillRect(x0 + rnd() * w, y0 + rnd() * h, 3, 3);
  }
};

const texLake: Painter = (g, x0, y0, w, h, rnd) => {
  // depth patches
  const n = (w * h) / 2600;
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h, r = 8 + rnd() * 20;
    g.fillStyle = rnd() < 0.6 ? 'rgba(10,40,70,0.25)' : 'rgba(120,180,220,0.12)';
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // wave arcs
  const m = (w * h) / 1600;
  g.strokeStyle = 'rgba(190,225,255,0.28)';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < m; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h, r = 4 + rnd() * 8;
    g.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9);
  }
  g.stroke();
};

const texVillage: Painter = (g, x0, y0, w, h, rnd) => {
  // cobblestones: staggered rows
  const step = 4.5 * TPX;
  let row = 0;
  for (let y = y0 + step / 2; y < y0 + h; y += step, row++) {
    const off = (row % 2) * step / 2;
    for (let x = x0 + step / 2 + off; x < x0 + w; x += step) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.08)';
      g.beginPath(); g.arc(x, y, step * 0.34, 0, 7); g.fill();
    }
  }
};

const TEX_PAINT: Record<ZoneTex, Painter> = {
  grass: texGrass, stone: texStone, forest: texForest, lake: texLake, village: texVillage,
};

/** Build the full-world ground texture once. Zone edges are blurred for soft transitions. */
function buildGroundTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TW; c.height = TH;
  const g = c.getContext('2d')!;
  const rnd = mulberry(20261017);
  // base ground
  g.fillStyle = GROUND;
  g.fillRect(0, 0, TW, TH);
  const nb = (TW * TH) / 420;
  for (let i = 0; i < nb; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    g.fillRect(rnd() * TW, rnd() * TH, 2, 2);
  }
  // zone layer: color + detail, then blurred onto base for soft edges
  const layer = document.createElement('canvas');
  layer.width = TW; layer.height = TH;
  const lg = layer.getContext('2d')!;
  for (const zn of ZONES) {
    const x0 = w2tx(zn.x0), y0 = w2ty(zn.z0), w = (zn.x1 - zn.x0) * TPX, h = (zn.z1 - zn.z0) * TPX;
    lg.fillStyle = zn.color;
    lg.fillRect(x0, y0, w, h);
    lg.save();
    lg.beginPath(); lg.rect(x0, y0, w, h); lg.clip();
    TEX_PAINT[zn.tex](lg, x0, y0, w, h, rnd);
    lg.restore();
  }
  g.filter = 'blur(9px)';
  g.drawImage(layer, 0, 0);
  g.filter = 'none';
  return c;
}


// ------------------------------------------------------------------ renderer
export interface Camera { x: number; z: number; zoom: number }

export function createRenderer2D(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const cam: Camera = { x: 0, z: -22, zoom: 1 };
  let snap: Snap | null = null;
  let myHandle = '';
  let follow = true;
  const keys = new Set<string>();
  let groundTex: HTMLCanvasElement | null = null; // built lazily on first frame

  // --- perf sampler (opt-in via ?perf=1): collects draw() ms, exposed as window.__2dperf() ---
  const PERF = /[?&]perf=1/.test(location.search);
  const perfBuf: number[] = [];
  if (PERF) {
    (window as any).__2dperf = () => {
      const a = [...perfBuf].sort((x, y) => x - y);
      if (!a.length) return null;
      const sum = a.reduce((x, y) => x + y, 0);
      const q = (p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
      return { n: a.length, avg: sum / a.length, p50: q(0.5), p95: q(0.95), max: a[a.length - 1] };
    };
    (window as any).__2dzoom = () => cam.zoom;
    (window as any).__2dents = () => snap ? { w: snap.w.length, c: snap.c.length, p: snap.p.length, fx: snap.fx.length } : null;
  }
  const perfEnd = (t0: number) => { if (PERF) { perfBuf.push(performance.now() - t0); if (perfBuf.length > 600) perfBuf.shift(); } };

  // --- input: wheel zoom, arrows pan (pan breaks follow), WASD = player move (main.ts) ---
  canvas.tabIndex = 0;
  addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.zoom = Math.min(3, Math.max(0.5, cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  }, { passive: false });
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
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

  // view size in CSS px, refreshed each draw() (avoids recomputing per entity)
  let vw = 0, vh = 0;
  // canvas state caches: setting font/textAlign re-parses the string each time
  let curFont = '', curAlign = '';
  const setFont = (f: string) => { if (f !== curFont) { ctx.font = f; curFont = f; } };
  const setAlign = (a: CanvasTextAlign) => { if (a !== curAlign) { ctx.textAlign = a; curAlign = a; } };

  // world -> screen
  const w2s = (x: number, z: number): [number, number] => {
    return [(x - cam.x) * cam.zoom + vw / 2, (z - cam.z) * cam.zoom + vh / 2];
  };
  const s2w = (sx: number, sy: number): { x: number; z: number } => {
    const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
    return { x: (sx - w / 2) / cam.zoom + cam.x, z: (sy - h / 2) / cam.zoom + cam.z };
  };
  const scale = (v: number) => v * cam.zoom;

  // cull: is world point inside view?
  const visible = (x: number, z: number, pad = 40): boolean => {
    const [sx, sy] = w2s(x, z);
    return sx > -pad && sx < vw + pad && sy > -pad && sy < vh + pad;
  };

  // me lookup, cached per snapshot object (was: O(n) find with closure per frame)
  let lastSnapObj: Snap | null = null;
  let meCache: SW | null = null;
  const meOf = (): SW | null => {
    if (snap !== lastSnapObj) {
      lastSnapObj = snap;
      meCache = snap?.w.find((w) => w.h === myHandle) ?? null;
    }
    return meCache;
  };

  let lastT = 0;
  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
    lastT = now;

    // camera: follow me, or WASD pan
    if (snap) {
      const me = meOf();
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
    const t0 = PERF ? performance.now() : 0;
    const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    vw = W; vh = H;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // --- ground: single pre-rendered texture blit (culling = source-rect clamp) ---
    // drawSprite leaves imageSmoothingEnabled=false; ground wants smooth scaling.
    ctx.imageSmoothingEnabled = true;
    const tex = groundTex ?? (groundTex = buildGroundTexture());
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    const wA = s2w(0, 0), wB = s2w(W, H);
    const sx0 = Math.max(0, w2tx(wA.x)), sy0 = Math.max(0, w2ty(wA.z));
    const sx1 = Math.min(TW, w2tx(wB.x)), sy1 = Math.min(TH, w2ty(wB.z));
    if (sx1 > sx0 && sy1 > sy0) {
      const dx = (TB.x0 + sx0 / TPX - cam.x) * cam.zoom + W / 2;
      const dy = (TB.z0 + sy0 / TPX - cam.z) * cam.zoom + H / 2;
      ctx.drawImage(tex, sx0, sy0, sx1 - sx0, sy1 - sy0,
        dx, dy, ((sx1 - sx0) / TPX) * cam.zoom, ((sy1 - sy0) / TPX) * cam.zoom);
    }
    const night = snap?.night;
    if (night) {
      ctx.fillStyle = 'rgba(10,12,40,0.48)';
      ctx.fillRect(0, 0, W, H);
    }
    // zone labels (culled per zone)
    for (const zn of ZONES) {
      if (!visible((zn.x0 + zn.x1) / 2, (zn.z0 + zn.z1) / 2, Math.max(zn.x1 - zn.x0, zn.z1 - zn.z0))) continue;
      if (zn.label && cam.zoom > 0.7) {
        const [sx, sy] = w2s(zn.x0, zn.z0);
        ctx.fillStyle = night ? '#cfd4dc' : '#2c2c2c';
        setFont(`${Math.max(10, 12 * cam.zoom)}px sans-serif`);
        setAlign('center');
        ctx.fillText(zn.label, sx + scale(zn.x1 - zn.x0) / 2, sy + 16);
      }
    }

    if (!snap) {
      ctx.fillStyle = '#fff';
      setFont('16px sans-serif');
      setAlign('center');
      ctx.fillText('等待快照…', W / 2, H / 2);
      perfEnd(t0);
      return;
    }

    // --- chests / props as squares (from fx? no: props come via events; draw elder wand tomb) ---
    if (snap.elder && visible(snap.elder.x, snap.elder.z)) {
      const [sx, sy] = w2s(snap.elder.x, snap.elder.z);
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
      ctx.fillStyle = '#fff'; setFont('10px sans-serif'); setAlign('center');
      ctx.fillText('E', sx, sy + 12);
    }

    // --- tombstones: 战后世界 (kernel/aftermath.ts) ---
    for (const t of snap.warweek?.tombstones ?? []) {
      if (!visible(t.x, t.z)) continue;
      const [sx, sy] = w2s(t.x, t.z);
      const size = Math.max(14, 22 * cam.zoom);
      drawSprite(ctx, 'tombstone', sx - size / 2, sy - size / 2, size, size);
      if (cam.zoom > 0.9) {
        ctx.fillStyle = '#c9c9d4'; setFont('10px sans-serif'); setAlign('center');
        ctx.fillText(t.n.split(' ').pop() ?? t.n, sx, sy + size / 2 + 11);
      }
    }

    // --- projectiles ---
    for (const p of snap.p) {
      if (!visible(p.x, p.z)) continue;
      const [sx, sy] = w2s(p.x, p.z);
      ctx.fillStyle = elemCss(p.e);
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
      const hostile = c.s.includes('H') || HOSTILE_KINDS.has(c.k);
      if (hostile) { ctx.strokeStyle = '#ff2a1a'; ctx.lineWidth = 2; ctx.strokeRect(sx - size / 2 - 1, sy - size / 2 - 1, size + 2, size + 2); }
      const r = size / 2;
      // hp bar
      if (c.hp < c.m) {
        ctx.fillStyle = '#222'; ctx.fillRect(sx - r, sy - r - 5, r * 2, 3);
        ctx.fillStyle = '#4dff4d'; ctx.fillRect(sx - r, sy - r - 5, (r * 2 * c.hp) / c.m, 3);
      }
      if (cam.zoom > 1.2) {
        ctx.fillStyle = '#fff'; setFont(`${Math.max(9, 10 * cam.zoom)}px sans-serif`); setAlign('center');
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
      drawSprite(ctx, `wizard-${String(w.ho).toLowerCase()}`, sx - size / 2, sy - size / 2, size, size);
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
      setFont(`${isMe ? 'bold ' : ''}${Math.max(10, 11 * cam.zoom)}px sans-serif`);
      setAlign('center');
      ctx.fillText(w.n, sx, sy + r + 13);
      // status letters (S shield / X stunned / J jailed)
      const flags = w.s.replace('N', '');
      if (flags && cam.zoom > 0.8) {
        ctx.fillStyle = '#ffec8a'; setFont('10px sans-serif');
        ctx.fillText(flags, sx, sy - r - 8);
      }
      // speech
      if (w.say && cam.zoom > 0.9) {
        ctx.fillStyle = '#fff'; setFont('10px sans-serif');
        ctx.fillText(w.say.slice(0, 24), sx, sy - r - 20);
      }
    }

    // --- fx: expanding rings / flashes ---
    for (const f of snap.fx) {
      if (!visible(f.x, f.z)) continue;
      const [sx, sy] = w2s(f.x, f.z);
      const col = f.e ? elemCss(f.e) : '#ffffff';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, scale(f.r ?? 6), 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- HUD: term / time / zoom ---
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(8, 8, 250, 56);
    ctx.fillStyle = '#fff'; setFont('13px sans-serif'); setAlign('left');
    const mm = Math.floor(snap.term.left / 60), ss = snap.term.left % 60;
    ctx.fillText(`第 ${snap.term.n} 学期  ${mm}:${String(ss).padStart(2, '0')}`, 16, 28);
    ctx.fillText(`${snap.night ? '夜' : '昼'} · ${snap.weather} · 缩放 ${cam.zoom.toFixed(1)}x`, 16, 48);
    ctx.fillStyle = '#aaa'; setFont('11px sans-serif');
    ctx.fillText('WASD 移动 · 点击施法 · 方向键看地图 · F 跟随', 16, 62);
    perfEnd(t0);
  }

  requestAnimationFrame(frame);
  return { setSnap, setMe, cam, screenToWorld: s2w };
}

export type Renderer2D = ReturnType<typeof createRenderer2D>;
