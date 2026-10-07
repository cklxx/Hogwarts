import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ELEMENT_COLORS, HOUSE_COLORS, type CreatureKind, type Element, type House } from '../src/shared/constants';
import { parseGlamourKey, type Glamour, type GlamourMaterial } from '../src/shared/glamour';
import { OVERLAY } from './layers';
import { STORYBOOK, rimLit, spriteTex } from './textures';

/** A canvas sprite used for name tags, hp bars and speech bubbles. */
/** Per-frame paint budget: at most this many Label.paint() executions per rAF frame (reset by labelFrameBegin). */
export const LABEL_PAINTS_PER_FRAME = 2;
let labelBudget = 0;
/** Call once per frame (from the main loop) to reopen the paint budget. */
export function labelFrameBegin() { labelBudget = LABEL_PAINTS_PER_FRAME; }
export class Label {
  sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private tex: THREE.CanvasTexture;
  private last: [string, string, number, string | undefined, string, string] | null = null;
  constructor(scale = 1) {
    this.canvas.width = 512;
    this.canvas.height = 160;
    this.tex = spriteTex(this.canvas);
    // (spriteTex: no mipmaps — nothing to regenerate on upload — LinearFilter, anisotropy 4, sRGB)
    // on the overlay (layers.ts): drawn at the screen's resolution, its colours as painted (not tone mapped)
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true, toneMapped: false }));
    this.sprite.scale.set(4.8 * scale, 1.5 * scale, 1);
    this.sprite.renderOrder = 10;
    this.sprite.layers.set(OVERLAY);
  }
  private pending: [string, string, number, string | undefined, string, string] | null = null;
  /**
   * Set what the tag says. Painting the canvas and uploading it (512 x 160 RGBA) is the costly part, so it
   * happens only when something changed, and for a hidden tag (far away, see main.ts) only once it is shown.
   */
  draw(name: string, color: string, hpFrac: number, say?: string, extra = '', tag = '') {
    // (compared field by field, not as one key string: every entity's tag is told what to say every snapshot)
    // hp quantized to 0.1: the bar is 98 px wide, so finer steps are invisible — this alone cuts combat repaints ~10x
    const was = this.last, hp = Math.round(hpFrac * 10) / 10;
    if (was && was[0] === name && was[1] === color && was[2] === hp && was[3] === say && was[4] === extra && was[5] === tag) { this.pending = null; return; }
    if (!this.sprite.visible) { this.pending = [name, color, hpFrac, say, extra, tag]; return; }
    // per-frame budget: the rest wait for a later draw() (last is untouched, so the next snapshot retries)
    if (labelBudget <= 0) return;
    labelBudget--;
    this.last = [name, color, hp, say, extra, tag];
    this.paint(name, color, hp, say, extra, tag);
  }
  private z = 1; private y0 = NaN;
  /**
   * Grow the tag by `k` (2.5D: main.ts keeps a name the same size on screen however far the camera hangs), its foot
   * where it was, so it rises off the head rather than into it.
   */
  zoom(k: number) {
    if (Math.abs(k - this.z) < 0.02) return;
    const sp = this.sprite;
    if (Number.isNaN(this.y0)) this.y0 = sp.position.y;
    sp.scale.x *= k / this.z; sp.scale.y *= k / this.z;
    sp.position.y = this.y0 + (sp.scale.y / k) * (k - 1) * 0.5;
    this.z = k;
  }
  /** Free the tag's texture and material (the sprite's geometry is three.js's shared quad). */
  dispose() { this.tex.dispose(); this.sprite.material.dispose(); }
  /** Show or hide the tag (painting what it was last told to say, if that changed while hidden). */
  show(on: boolean) {
    if (this.sprite.visible === on) return;
    this.sprite.visible = on;
    if (on && this.pending) { const p = this.pending; this.pending = null; this.draw(...p); }
  }
  private paint(name: string, color: string, hpFrac: number, say: string | undefined, extra: string, tag = '') {
    const c = this.ctx;
    c.clearRect(0, 0, 512, 160);
    if (say) {
      c.font = 'italic 28px Georgia';
      const w = Math.min(500, c.measureText(say).width + 24);
      c.fillStyle = 'rgba(255,250,235,0.92)';
      c.fillRect(256 - w / 2, 4, w, 42);
      c.fillStyle = '#2b1d0e';
      c.textAlign = 'center';
      c.fillText(say.length > 34 ? say.slice(0, 33) + '…' : say, 256, 35);
    }
    c.font = 'bold 30px Georgia';
    c.textAlign = 'center';
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(0,0,0,0.8)';
    const label = extra ? `${extra} ${name}` : name;
    c.strokeText(label, 256, 92);
    c.fillStyle = color;
    c.fillText(label, 256, 92);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(156, 106, 200, 14);
    c.fillStyle = hpFrac > 0.5 ? '#5bd15b' : hpFrac > 0.25 ? '#e0c040' : '#e04040';
    c.fillRect(158, 108, 196 * Math.max(0, Math.min(1, hpFrac)), 10);
    // 梗牌 (kernel/memetags.ts): a wax-red chip under the health bar
    if (tag) {
      c.font = 'bold 24px "Noto Sans SC", "PingFang SC", sans-serif';
      const w = c.measureText(tag).width + 22;
      c.fillStyle = 'rgba(150, 32, 36, 0.92)';
      c.beginPath(); c.roundRect?.(256 - w / 2, 124, w, 32, 10); if (!c.roundRect) c.rect(256 - w / 2, 124, w, 32); c.fill();
      c.fillStyle = '#fff4dc';
      c.fillText(tag, 256, 149);
    }
    this.tex.needsUpdate = true;
  }
}

export interface WizardModel {
  root: THREE.Group;
  /** Facing (rotation.y) and the stunned pose (rotation.z / position.y) are set from outside. */
  body: THREE.Group;
  label: Label;
  shield: THREE.Mesh;
  glow: THREE.PointLight;
  wandTip: THREE.Mesh;
  root2: THREE.Mesh;
  patronus: THREE.Mesh;
  elder: THREE.Mesh;
  /** Set when a 'cast' fx for this wizard arrives; pass it to update() and clear it. */
  castPending: boolean;
  /** The wand-tip colour at rest, or lit by Lumos (a glamour's :glow tints both). */
  tipHex(lit: boolean): number;
  /** The parts a glamour re-dresses (setWizardLook). */
  dress: Dress;
  /**
   * Animate: walk cycle scaled by ground speed (m/s), and the wand-arm cast gesture when `casting`
   * is true. Returns true on the frame the wand is thrust forward (the moment to flash the tip).
   */
  update(dt: number, speed: number, casting: boolean): boolean;
  /**
   * Middle distance (main.ts level of detail): leave out what is a pixel or two from there — the scarf
   * tails, the wand and its tip (unless it is lit or casting) — 5 of the ~17 draw calls.
   */
  setMid(mid: boolean): void;
}

// ---- wizard parts: geometry and materials are built once and shared by every wizard
const SCARF: Record<House, [string, string]> = {
  Gryffindor: ['#7f0909', '#e3a81d'],
  Hufflepuff: ['#e8b92c', '#26211d'],
  Ravenclaw: ['#1b2f6e', '#a8834e'],
  Slytherin: ['#1a4a2a', '#b9bec4'],
};
const SKIN = [0xf2cba8, 0xe6b48c, 0xc98f66, 0x9a6444, 0x6e4530, 0xf6dcc4];
/** School black. Storybook: a deep indigo charcoal, so robes read as painted cloth rather than holes. */
const CLOTH = STORYBOOK ? 0x2b2838 : 0x1c1c22, TROUSERS = STORYBOOK ? 0x2e2c38 : 0x24242a;
/** The hat's crown: a shade lighter than the school black, so its point reads from above. */
const HAT_CROWN = STORYBOOK ? 0x3a3550 : 0x2c2c38;
const ROBE_RGB = STORYBOOK ? [34, 31, 46] : [26, 26, 32];
const HAIR = [0x2b1a10, 0x4a2c17, 0x7a4a22, 0xa8561f, 0xd8b56a, 0x141414, 0x6b6b6b];
const WOOD = [0x4a2e19, 0x6b4526, 0x2d1d12, 0x8a6a45, 0x3a2418];

const cache = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * A surface of revolution from rings listed top to bottom. Each ring has its own centre, radius and
 * angular span, so the same builder makes an open-fronted robe (the span leaves a gap at the front,
 * -z) and a hat whose tip bends backwards.
 */
function rings(list: { x?: number; y: number; z?: number; r: number; gap?: number; pleat?: number }[], segs: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const top = list[0].y, bottom = list[list.length - 1].y;
  list.forEach((ring, j) => {
    const gap = ring.gap ?? 0;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const phi = Math.PI + gap / 2 + u * (Math.PI * 2 - gap);
      const r = ring.r * (1 + Math.cos(u * Math.PI * 2 * 7) * (ring.pleat ?? 0));
      pos.push((ring.x ?? 0) + Math.sin(phi) * r, ring.y, (ring.z ?? 0) + Math.cos(phi) * r);
      uv.push(u, (ring.y - bottom) / Math.max(1e-6, top - bottom));
    }
    if (j < list.length - 1)
      for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i, b = a + segs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const ROBE_TOP = 1.56;
const ROBE: [number, number][] = [[0.1, 1.56], [0.2, 1.51], [0.28, 1.45], [0.31, 1.36], [0.3, 1.2], [0.27, 1.02], [0.29, 0.84], [0.34, 0.62], [0.41, 0.42], [0.49, 0.22], [0.57, 0.04]];
function robeRadius(y: number) {
  for (let i = 0; i + 1 < ROBE.length; i++) {
    const [r0, y0] = ROBE[i], [r1, y1] = ROBE[i + 1];
    if (y <= y0 && y >= y1) return r0 + ((y0 - y) / (y0 - y1)) * (r1 - r0);
  }
  return ROBE[ROBE.length - 1][0];
}
/** A scarf tail draped over the robe, down the chest (side -1) or the back (+1), hung from the neck axis. */
function tailGeo(side: number) {
  return once(`tailGeo${side}`, () => {
    const g = new THREE.BoxGeometry(0.11, side < 0 ? 0.46 : 0.4, 0.028, 1, 8, 1);
    g.translate(0, side < 0 ? -0.23 : -0.2, 0);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = 1.5 + p.getY(i);
      p.setZ(i, side * (Math.max(0.17, robeRadius(y) + 0.018)) + p.getZ(i));
    }
    g.computeVertexNormals();
    return knitUV(g, 'v');
  });
}
function robeGeo() {
  return once('robeGeo', () => {
    const prof = ROBE;
    return rings(prof.map(([r, y]) => {
      const low = smooth(0.95, 0.04, y); // the robe opens wider toward the hem
      return { r, y, gap: 0.5 + 0.35 * smooth(1.25, 1.56, y) + 0.45 * low, pleat: 0.045 * low };
    }), 30);
  });
}
function hatGeo() {
  return once('hatGeo', () => {
    const H = 0.68, R = 0.225, n = 12;
    const list = [];
    for (let j = 0; j <= n; j++) {
      const t = 1 - j / n; // top first
      list.push({ y: H * t - 0.12 * t ** 4, z: 0.26 * t ** 2.6, x: -0.03 * t ** 3, r: Math.max(0.004, R * (1 - t) ** 0.9 * (1 + 0.07 * Math.sin(t * 11) * t)) });
    }
    return rings(list, 16);
  });
}
function brimGeo() {
  return once('brimGeo', () => {
    const g = new THREE.RingGeometry(0.17, 0.42, 28, 3);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      const a = Math.atan2(p.getX(i), p.getZ(i));
      p.setY(i, -0.035 * ((r - 0.17) / 0.25) ** 2 * (0.7 + 0.3 * Math.cos(a * 2)));
    }
    g.computeVertexNormals();
    return g;
  });
}
function headGeo() {
  return once('headGeo', () => {
    // a slightly oversized head (stylised proportions read better from the game camera)
    const head = new THREE.SphereGeometry(0.215, 22, 16);
    head.scale(1, 1.06, 0.98);
    head.translate(0, 0.21, 0);
    const nose = new THREE.SphereGeometry(0.034, 8, 6);
    nose.scale(0.85, 1, 1.15);
    nose.translate(0, 0.19, -0.212);
    const ears = [-1, 1].map((s) => { const e = new THREE.SphereGeometry(0.05, 8, 6); e.scale(0.45, 1, 0.8); e.translate(s * 0.21, 0.2, 0.01); return e; });
    const neck = new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10);
    neck.translate(0, 0.03, 0);
    const hands = new THREE.SphereGeometry(0.062, 10, 8);
    return { face: mergeGeometries([head, nose, ...ears, neck])!, hand: hands };
  });
}
function faceGeo() {
  return once('faceGeo', () => {
    const whites = [-1, 1].map((s) => { const e = new THREE.SphereGeometry(0.04, 10, 8); e.scale(0.9, 1, 0.5); e.translate(s * 0.078, 0.228, -0.188); return e; });
    const pupils = [-1, 1].map((s) => { const e = new THREE.SphereGeometry(0.022, 8, 6); e.scale(1, 1.1, 0.6); e.translate(s * 0.076, 0.224, -0.205); return e; });
    const brows = [-1, 1].map((s) => { const b = new THREE.BoxGeometry(0.075, 0.016, 0.02); b.rotateZ(s * -0.14); b.translate(s * 0.078, 0.284, -0.19); return b; });
    const mouth = new THREE.TorusGeometry(0.035, 0.008, 4, 10, Math.PI * 0.8);
    mouth.rotateZ(Math.PI * 1.1);
    mouth.translate(0, 0.13, -0.204);
    return { whites: mergeGeometries(whites)!, pupils: mergeGeometries(pupils)!, brows: mergeGeometries(brows)!, mouth };
  });
}

/**
 * Merge static parts that move together into one geometry (one draw call instead of one per part),
 * each part painted a flat colour through a vertex-colour attribute.
 */
export function painted(parts: [THREE.BufferGeometry, THREE.ColorRepresentation][]) {
  const c = new THREE.Color();
  return mergeGeometries(parts.map(([g, col]) => {
    const x = g.clone();
    c.set(col);
    const n = x.getAttribute('position').count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    x.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return x;
  }))!;
}
/** Scale a vertex-coloured material's emissive by the vertex colour: the faint self-light meant for skin stays on the skin. */
function emissiveByVertexColor<T extends THREE.MeshStandardMaterial>(m: T, key: string, prev?: T['onBeforeCompile']) {
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        totalEmissiveRadiance *= vColor.rgb;
      #endif`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/**
 * Knitwear for one house: the scarf's stripes run across u above v = KNIT_GREY, and below it is a
 * plain grey patch for the jumper, so the jumper, tie, scarf wrap and tails share one material.
 */
const KNIT_GREY = 0.25;
function knit(house: House) {
  return once(`knit:${house}`, () => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d')!;
    const [a, b] = SCARF[house];
    const n = 10, band = c.height * (1 - KNIT_GREY); // canvas rows top-down = v from 1 down
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * c.width) / n, 0, c.width / n + 1, band); }
    g.fillStyle = '#55565e'; // the jumper
    g.fillRect(0, band, c.width, c.height - band);
    // knitted texture
    for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 2); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
  });
}
/** Move a part's UVs into the knit atlas: stripes across its own u ('u') or down its own v ('v'), or the grey patch. */
function knitUV(g: THREE.BufferGeometry, mode: 'u' | 'v' | 'grey') {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (mode === 'grey') uv.setXY(i, u, KNIT_GREY * 0.4);
    else uv.setXY(i, mode === 'u' ? u : v, KNIT_GREY + 0.05 + (0.9 - KNIT_GREY) * (mode === 'u' ? v : u));
  }
  return g;
}

/** Black robe cloth with folds matching the pleats, house-coloured front edges and hem, gold piping. */
function robeTex(house: House) {
  return once(`robeTex:${house}`, () => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    for (let x = 0; x < S; x++) {
      const k = 0.78 + 0.22 * Math.cos((x / S) * Math.PI * 2 * 7);
      g.fillStyle = `rgb(${ROBE_RGB.map((c) => Math.round(c * k)).join(',')})`;
      g.fillRect(x, 0, 1, S);
    }
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * S, Math.random() * S, 1, 3); }
    const hc = '#' + new THREE.Color(HOUSE_COLORS[house]).getHexString();
    g.fillStyle = hc;
    g.fillRect(0, 0, S * 0.045, S);
    g.fillRect(S * 0.955, 0, S * 0.045, S);
    g.fillRect(0, S * 0.93, S, S * 0.07);
    g.fillStyle = '#c9a23a';
    g.fillRect(S * 0.045, 0, 2, S * 0.93);
    g.fillRect(S * 0.955 - 2, 0, 2, S * 0.93);
    g.fillRect(0, S * 0.93 - 2, S, 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/**
 * Cloth: double-sided, the inside shows the house lining (picked by gl_FrontFacing), and the
 * vertex shader swings the lower part by `sway` (x: sideways, z: trailing, y: flare).
 */
function clothMaterial(house: House, map: THREE.Texture | null, sway: { value: THREE.Vector3 }, vertexColors = false) {
  const m = new THREE.MeshStandardMaterial({ color: map || vertexColors ? 0xffffff : CLOTH, map, roughness: 0.82, side: THREE.DoubleSide, vertexColors });
  const lining = new THREE.Color(HOUSE_COLORS[house]).multiplyScalar(0.7);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = sway;
    sh.uniforms.uLining = { value: lining };
    sh.vertexShader = 'uniform vec3 uSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float swayW = pow(clamp(1.0 - position.y / ${(ROBE_TOP - 0.2).toFixed(2)}, 0.0, 1.0), 1.6);
      transformed.x += uSway.x * swayW;
      transformed.z += uSway.z * swayW;
      transformed.xz += normalize(position.xz + vec2(1e-4)) * uSway.y * swayW;`);
    sh.fragmentShader = 'uniform vec3 uLining;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (!gl_FrontFacing) diffuseColor.rgb = uLining;`);
  };
  m.customProgramCacheKey = () => 'wizard-cloth';
  if (vertexColors) {
    // sleeves carry the hands (skin-coloured vertices) with the faint skin self-light
    m.emissive.setScalar(0.12);
    emissiveByVertexColor(m, 'wizard-cloth-vc', m.onBeforeCompile);
  }
  return m;
}
const NO_SWAY = { value: new THREE.Vector3() };

/**
 * Storybook ink outline for a character part (shown at 'high'): the part's own geometry pushed out
 * along its normals and drawn back faces only, in ink. It thickens a little with distance so the
 * line stays one or two pixels wide; the robe's copy sways with the robe.
 */
function inkMaterial(sway: { value: THREE.Vector3 }) {
  const m = new THREE.MeshBasicMaterial({ color: 0x1c1018, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = sway;
    sh.vertexShader = 'uniform vec3 uSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float swayW = pow(clamp(1.0 - position.y / ${(ROBE_TOP - 0.2).toFixed(2)}, 0.0, 1.0), 1.6);
      transformed.x += uSway.x * swayW;
      transformed.z += uSway.z * swayW;
      transformed.xz += normalize(position.xz + vec2(1e-4)) * uSway.y * swayW;
      vec4 inkP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        inkP = instanceMatrix * inkP; // (drawn instanced by partbatch.ts)
      #endif
      float inkD = max(0.0, -(modelViewMatrix * inkP).z);
      transformed += normalize(normal) * (0.014 + inkD * 0.0016);`);
  };
  m.customProgramCacheKey = () => 'wizard-ink';
  return m;
}

const std = (key: string, p: THREE.MeshStandardMaterialParameters) => once(`mat:${key}`, () => new THREE.MeshStandardMaterial(p));

let _shieldMat: THREE.ShaderMaterial | null = null;
const shieldUniforms = { uTime: { value: 0 } };
function shieldMat() {
  return (_shieldMat ??= new THREE.ShaderMaterial({
    uniforms: { ...shieldUniforms, uColor: { value: new THREE.Color(0x9fd3ff) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; vP = position; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float bands = smoothstep(0.85, 1.0, sin(vP.y * 16.0 - uTime * 4.0)) * 0.5;
        float hex = smoothstep(0.92, 1.0, abs(sin(atan(vP.z, vP.x) * 9.0 + vP.y * 3.0))) * 0.25;
        gl_FragColor = vec4(uColor * (0.08 + f * 1.8 + (bands + hex) * (0.3 + f)), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

/** m/s: the walk cycle stops quickening here (a brisk 7 m/s walk is 1.45 strides a second). */
const GAIT_MAX = 9;
/**
 * m/s: faster than any walk, even at haste on a Firebolt (17.5 m/s) and with the jerk of 10 Hz
 * snapshots (up to ~1.7x the true speed for a frame): the model is gliding to a teleported target.
 */
const GLIDE = 35;
let detail: 'low' | 'high' = 'high';
/** Wizard detail follows the graphics quality: at 'low' the scarf tails are left out (2 of 15 draw calls). */
export function setWizardDetail(q: 'low' | 'high') { detail = q; }

export function makeWizard(house: House, isMe: boolean, seed = ''): WizardModel {
  const h = hash(seed || house);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const rig = new THREE.Group();
  body.add(rig);
  const shadow = (m: THREE.Mesh) => { m.castShadow = true; return m; };

  // Parts that move together are merged into one mesh (vertex-coloured where the colours differ), so a
  // wizard is 13 draw calls at 'low' and 15 at 'high' (the scarf tails): robe, knitwear, 2 legs, head,
  // hat, 2 arms, wand, tip, tip glow, name label, aura ring.
  const skinI = h % SKIN.length, hairI = (h >>> 4) % HAIR.length;
  const wood = std(`wood${(h >>> 8) % WOOD.length}`, { color: WOOD[(h >>> 8) % WOOD.length], roughness: 0.55 });
  const knitMat = knit(house);

  // ---- robe: open at the front over a grey jumper and a house tie, legs and shoes underneath
  const sway = { value: new THREE.Vector3() };
  const robe = shadow(new THREE.Mesh(robeGeo(), clothMaterial(house, robeTex(house), sway)));
  // jumper, tie and the scarf's neck wrap: one mesh in the knit atlas
  const torso = new THREE.Mesh(once('torsoGeo', () => {
    const jumper = new THREE.LatheGeometry([0.24, 0.26, 0.25, 0.23, 0.25, 0.27, 0.2, 0.08].map((r, i) => new THREE.Vector2(r, 0.78 + i * 0.1)), 14);
    const tie = new THREE.BoxGeometry(0.055, 0.3, 0.012); tie.rotateX(-0.08); tie.translate(0, 1.25, -0.268);
    const wrap = new THREE.TorusGeometry(0.135, 0.058, 8, 20); wrap.rotateX(Math.PI / 2); wrap.scale(1, 1, 0.92); wrap.translate(0, 1.52, 0);
    return mergeGeometries([knitUV(jumper.toNonIndexed(), 'grey'), knitUV(tie.toNonIndexed(), 'v'), knitUV(wrap.toNonIndexed(), 'u')])!;
  }), knitMat);
  rig.add(robe, torso);
  const legMat = once('legMat', () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    // the (darker) shoe vertices are polished leather
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n#ifdef USE_COLOR\n  if (vColor.r < 0.009) roughnessFactor = 0.35;\n#endif')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n#ifdef USE_COLOR\n  if (vColor.r < 0.009) metalnessFactor = 0.1;\n#endif');
    };
    m.customProgramCacheKey = () => 'wizard-legs';
    return m;
  });
  const legGeo = once('legGeo', () => {
    const shin = new THREE.CylinderGeometry(0.075, 0.065, 0.76, 8); shin.translate(0, -0.4, 0);
    const shoe = new THREE.SphereGeometry(0.085, 10, 6); shoe.scale(0.85, 0.55, 1.5); shoe.translate(0, -0.78, -0.05);
    return painted([[shin, TROUSERS], [shoe, 0x0e0d0c]]);
  });
  const legs = [-1, 1].map((s) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(s * 0.1, 0.82, 0);
    rig.add(leg);
    return leg;
  });

  // ---- scarf tails: one down the front and one over the shoulder (left out at 'low')
  const tailF = new THREE.Mesh(tailGeo(-1), knitMat);
  tailF.position.set(-0.09, 1.5, 0);
  const tailB = new THREE.Mesh(tailGeo(1), knitMat);
  tailB.position.set(0.1, 1.5, 0);
  rig.add(tailF, tailB);

  // ---- head: face, eyes, brows, mouth and hair in one mesh; a touch of emissive on the skin keeps
  // faces readable in the shade of the hat brim
  const head = new THREE.Group();
  head.position.y = 1.5;
  const hg = headGeo();
  const headMat = once('headMat', () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    m.emissive.setScalar(0.12);
    return emissiveByVertexColor(m, 'wizard-head');
  });
  const headMesh = head.add(shadow(new THREE.Mesh(once(`headGeo:${skinI}:${hairI}`, () => {
    const fg = faceGeo();
    const hair = new THREE.SphereGeometry(0.228, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62); hair.rotateX(0.85); hair.translate(0, 0.225, 0.014);
    return painted([[hg.face, SKIN[skinI]], [fg.whites, 0xf4f1ea], [fg.pupils, 0x1a120c], [fg.brows, HAIR[hairI]], [fg.mouth, 0x5a2a22], [hair, HAIR[hairI]]]);
  }), headMat))).children.at(-1) as THREE.Mesh;
  // the hat: crown, brim and house band in one mesh
  const hat = new THREE.Group();
  hat.position.set(0, 0.37, 0.03);
  hat.rotation.set(0.24, 0, 0.06); // pushed back so the brim does not hide the face
  const hatMat = once('hatMat', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  const hatMesh = hat.add(shadow(new THREE.Mesh(once(`hatGeo:${house}`, () => {
    const band = new THREE.CylinderGeometry(0.22, 0.227, 0.065, 18, 1, true); band.translate(0, 0.032, 0);
    // the brim in the house's colour: from above (a phone's top-down view) a wizard is a ring of house colour, not a black dot
    return painted([[hatGeo(), HAT_CROWN], [brimGeo(), new THREE.Color(HOUSE_COLORS[house]).multiplyScalar(0.72)], [band, new THREE.Color(HOUSE_COLORS[house]).multiplyScalar(0.45)]]);
  }), hatMat))).children.at(-1) as THREE.Mesh;
  head.add(hat);
  rig.add(head);

  // ---- arms: bell sleeves lined in house colour, each with its hand; the right hand holds the wand
  const sleeveMat = once(`sleeve:${house}`, () => clothMaterial(house, null, NO_SWAY, true));
  const armGeo = once(`armGeo:${skinI}`, () => {
    const sleeve = new THREE.CylinderGeometry(0.075, 0.15, 0.6, 12, 1, true); sleeve.translate(0, -0.3, 0);
    const hand = hg.hand.clone(); hand.translate(0, -0.6, 0);
    return painted([[sleeve, CLOTH], [hand, SKIN[skinI]]]);
  });
  const armMeshes: THREE.Mesh[] = [];
  const arm = (s: number) => {
    const a = new THREE.Group();
    a.position.set(s * 0.29, 1.41, 0);
    const m = shadow(new THREE.Mesh(armGeo, sleeveMat));
    armMeshes.push(m);
    a.add(m);
    rig.add(a);
    return a;
  };
  const armL = arm(-1), armR = arm(1);
  const wand = new THREE.Group();
  wand.position.set(0, -0.6, -0.02);
  wand.rotation.x = -(Math.PI - 1.0); // about 57° off the forearm, so it points ahead from a lowered arm
  armR.add(wand);
  const wandMesh = wand.add(new THREE.Mesh(once('wandGeo', () => {
    const shaft = new THREE.CylinderGeometry(0.007, 0.014, 0.4, 6); shaft.translate(0, 0.2, 0);
    const grip = new THREE.CylinderGeometry(0.02, 0.018, 0.11, 8); grip.translate(0, 0.01, 0);
    const knob = new THREE.SphereGeometry(0.024, 8, 6); knob.translate(0, -0.05, 0);
    return mergeGeometries([shaft, grip, knob])!;
  }), wood)).children.at(-1) as THREE.Mesh;
  const wandTip = new THREE.Mesh(once('tipGeo', () => new THREE.SphereGeometry(0.022, 8, 6)), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  wandTip.position.y = 0.41;
  wand.add(wandTip);
  const tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  tipGlow.scale.setScalar(0.16);
  wandTip.add(tipGlow);
  const glow = new THREE.PointLight(0xfff2c0, 0, 14);
  wandTip.add(glow);

  // ---- magic that shows on the wizard
  const shield = new THREE.Mesh(once('shieldGeo', () => new THREE.SphereGeometry(1.25, 28, 18)), shieldMat());
  shield.position.y = 1.05;
  shield.visible = false;
  root.add(shield);
  const root2 = new THREE.Mesh(once('rootGeo', () => new THREE.TorusGeometry(0.7, 0.07, 6, 28)), once('rootMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(2.5) })));
  root2.rotation.x = Math.PI / 2;
  root2.position.y = 0.2;
  root2.visible = false;
  root.add(root2);
  const patronus = new THREE.Mesh(once('patronusGeo', () => new THREE.SphereGeometry(0.3, 14, 10)), once('patronusMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfefff).multiplyScalar(3), transparent: true, opacity: 0.9 })));
  const pHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xbcdcff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  pHalo.scale.setScalar(2.6);
  patronus.add(pHalo);
  patronus.visible = false;
  root.add(patronus);
  const elder = new THREE.Mesh(once('elderGeo', () => new THREE.OctahedronGeometry(0.18)), once('elderMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe0c3ff).multiplyScalar(2) })));
  elder.position.y = 2.9;
  elder.visible = false;
  root.add(elder);
  const label = new Label(isMe ? 0.9 : 1);
  label.sprite.position.y = 3.1;
  root.add(label.sprite);
  if (isMe) {
    const ring = new THREE.Mesh(once('meRing', () => new THREE.RingGeometry(0.62, 0.72, 32)), once('meRingMat', () => new THREE.MeshBasicMaterial({ color: 0xd4af37, side: THREE.DoubleSide })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    root.add(ring);
  }

  // ---- storybook ink outlines round the robe, head and hat
  const inks: THREE.Mesh[] = [];
  let inkMat: THREE.Material | undefined;
  if (STORYBOOK) {
    inkMat = inkMaterial(sway);
    const still = once('inkStill', () => inkMaterial(NO_SWAY));
    for (const [part, mat] of [[robe, inkMat], [headMesh, still], [hatMesh, still]] as const) {
      const hull = new THREE.Mesh(part.geometry, mat);
      hull.name = 'ink';
      part.add(hull);
      inks.push(hull);
    }
    root.traverse((o) => { const mm = (o as THREE.Mesh).material; if (mm && !Array.isArray(mm)) rimLit(mm); });
  }
  // parts whose geometry and material are shared between wizards: drawn instanced across all near wizards
  // (partbatch.ts). The robe (its own sway), its outline and the wand tip (its own colour) are drawn one by one.
  for (const m of [torso, ...legs, tailF, tailB, headMesh, hatMesh, ...armMeshes, wandMesh, ...inks.slice(1)]) m.userData.batch = true;

  // ---- animation state
  const st = { speed: 0, phase: (h % 100) / 16, t: (h % 1000) / 100, cast: -1, flashed: true, detail: '', mid: false };
  const tipColor = new THREE.Color();
  const REST_R = 0.3;
  const dress: Dress = {
    house, skinI, hairI, robe, sway, torso, legs, tails: [tailF, tailB], arms: armMeshes, head: headMesh, hat: hatMesh, wand: wandMesh, glow,
    orig: new Map(), key: '', applied: '', held: [], own: [], tip: 0xffffff, lumos: 0xfff2c0, first: true, inks, inkMat,
  };
  return {
    root, body, label, shield, glow, wandTip, root2, patronus, elder, castPending: false, dress,
    tipHex: (lit) => (lit ? dress.lumos : dress.tip),
    setMid(mid) {
      if (mid === st.mid) return;
      st.mid = mid;
      tailF.visible = tailB.visible = detail === 'high' && !mid;
    },
    update(dt, speed, casting) {
      st.t += dt;
      if (dress.animated) glamTime.value = performance.now() / 1000;
      if (st.detail !== detail) { st.detail = detail; tailF.visible = tailB.visible = detail === 'high' && !st.mid; showInks(dress); }
      // The stride follows ground speed up to GAIT_MAX (beyond it the feet slide a little instead of the
      // legs blurring). Anything faster than GLIDE is not walking but the model catching up after an
      // apparition, a release from Azkaban or a knock-back: hold the standing pose through the glide.
      const gait = speed > GLIDE ? 0 : Math.min(speed, GAIT_MAX);
      st.speed += (gait - st.speed) * (1 - Math.exp(-dt * 10));
      const stunned = Math.abs(body.rotation.z) > 0.1;
      const w = stunned ? 0 : Math.min(1.25, st.speed / 7);
      st.phase += dt * st.speed * 1.3;
      const s = Math.sin(st.phase), c = Math.cos(st.phase);
      const breathe = Math.sin(st.t * 2.1);
      // body: bob twice per stride, lean into the walk, twist the shoulders against the legs
      rig.position.y = Math.abs(c) * 0.075 * w + breathe * 0.004;
      rig.rotation.x = -0.13 * w;
      rig.rotation.y = s * 0.07 * w;
      rig.rotation.z = s * 0.025 * w;
      legs[0].rotation.x = s * 0.6 * w;
      legs[1].rotation.x = -s * 0.6 * w;
      head.rotation.y = -rig.rotation.y * 0.7 + Math.sin(st.t * 0.37) * 0.18 * (1 - Math.min(1, w * 2));
      head.rotation.x = 0.1 * w + breathe * 0.01;
      // arms swing opposite to the legs; the wand arm swings less and stays ready
      armL.rotation.set(-s * 0.65 * w + 0.06, 0, -0.12 - 0.06 * w + breathe * 0.01);
      let rx = REST_R + s * 0.3 * w, rz = 0.1 + 0.04 * w;
      if (casting) { st.cast = 0; st.flashed = false; }
      let flare = 0, fire = false;
      if (st.cast >= 0) {
        const g = (st.cast += dt);
        let a: number;
        if (g < 0.12) a = REST_R + (2.3 - REST_R) * ease(g / 0.12);          // raise the wand high
        else if (g < 0.24) a = 2.3 + (0.95 - 2.3) * ease((g - 0.12) / 0.12);  // strike forward
        else a = 0.95 + (REST_R - 0.95) * ease(Math.min(1, (g - 0.24) / 0.36)); // recover
        const wt = g < 0.5 ? 1 : Math.max(0, 1 - (g - 0.5) / 0.1);
        rx = rx * (1 - wt) + a * wt;
        rz = rz * (1 - wt) + 0.25 * wt;
        flare = Math.max(0, 1 - Math.abs(g - 0.22) / 0.14);
        if (!st.flashed && g >= 0.2) { st.flashed = true; fire = true; }
        if (g > 0.6) st.cast = -1;
      }
      armR.rotation.set(rx, 0, rz);
      if (stunned) { armL.rotation.set(0.2, 0, -0.9); armR.rotation.set(0.2, 0, 0.9); legs[0].rotation.x = 0.2; legs[1].rotation.x = -0.1; }
      // the robe trails and flares, the scarf tails fly back
      sway.value.set(-s * 0.05 * w, 0.14 * w + 0.012 * breathe, (0.03 + 0.02 * Math.abs(s)) * w);
      tailF.rotation.set(0.03 * Math.abs(s) * w, 0, 0.04 * s * w);
      tailB.rotation.set(-w * (0.35 + 0.12 * Math.sin(st.phase * 2 + 1)), 0, 0.05 * s * w);
      // wand tip: follows whatever colour the snapshot gave it, blazes during the cast
      tipColor.copy((wandTip.material as THREE.MeshBasicMaterial).color);
      const lumos = glow.intensity > 0 ? 1 : 0;
      tipGlow.material.color.copy(tipColor).multiplyScalar(0.5 + 3 * flare + 1.5 * lumos);
      tipGlow.scale.setScalar(0.16 + 0.9 * flare + 0.5 * lumos);
      wand.visible = !st.mid || lumos > 0 || st.cast >= 0;
      if (shield.visible) { shield.scale.setScalar(1 + 0.02 * Math.sin(st.t * 5)); shieldUniforms.uTime.value = performance.now() / 1000; }
      if (root2.visible) root2.rotation.z += dt * 2;
      if (elder.visible) { elder.rotation.y += dt * 2; elder.position.y = 2.9 + Math.sin(st.t * 2) * 0.08; }
      return fire;
    },
  };
}

// ------------------------------------------------------------------ freeing models
/**
 * Free what a model owns on the GPU: its own materials and geometries, its name tag, its lights. What
 * models share (the once() cache, the glamour pool, the shield material, three.js's sprite quad) stays.
 */
function disposeOwned(root: THREE.Object3D, keep: Set<unknown>) {
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) { (o as THREE.Light).dispose(); return; }
    const x = o as THREE.Mesh;
    if (!x.material) return;
    for (const mat of [x.material].flat()) if (!keep.has(mat)) mat.dispose();
    if (!(o as THREE.Sprite).isSprite && x.geometry && !keep.has(x.geometry)) x.geometry.dispose();
  });
}
const sharedParts = () => new Set<unknown>([...cache.values(), ..._lamCache.values(), ..._auraMats.values(), _shieldMat]);
/** A wizard gone for good (see main.ts: models of wizards that merely walked out of view are kept a while). */
export function disposeWizard(m: WizardModel) {
  releaseWizardLook(m);
  m.label.dispose();
  disposeOwned(m.root, sharedParts());
}
/** A creature model no pool wants any more (every creature builds its own parts). */
export function disposeCreature(c: { root: THREE.Object3D; label: Label }) {
  c.label.dispose();
  disposeOwned(c.root, new Set<unknown>([glowTex(), ..._lamCache.values(), ..._auraMats.values()]));
}

// ------------------------------------------------------------------ the far wizard (crowd.ts)
/**
 * A wizard seen from afar, in one low-poly mesh in the rest pose (~230 triangles against ~9 000 up
 * close): closed robe and sleeves, head, pointed hat and brim, the scarf at the neck. It is drawn
 * instanced (crowd.ts), so every far wizard together costs one draw call (two with the ink outline).
 * `aTint` says what colours each vertex: 1 = the robe (per instance: the house black or a glamour's
 * robe), 2 = the trim (per instance: the house scarf colour or a glamour's trim), 0 = its own colour.
 */
export function farWizardGeometry() {
  return once('farWizardGeo', () => {
    const parts: [THREE.BufferGeometry, number, number][] = []; // geometry, own colour, tint
    const robe = rings(ROBE.map(([r, y]) => ({ r, y })), 10);
    robe.deleteAttribute('uv');
    parts.push([robe, 0xffffff, 1]);
    const hem = new THREE.CylinderGeometry(0.575, 0.585, 0.06, 10, 1, true); hem.translate(0, 0.06, 0);
    parts.push([hem, 0xffffff, 2]);
    const scarf = new THREE.TorusGeometry(0.135, 0.058, 4, 8); scarf.rotateX(Math.PI / 2); scarf.translate(0, 1.52, 0);
    parts.push([scarf, 0xffffff, 2]);
    const head = new THREE.SphereGeometry(0.215, 8, 6); head.scale(1, 1.06, 0.98); head.translate(0, 1.71, 0);
    parts.push([head, SKIN[1], 0]);
    const crown = new THREE.ConeGeometry(0.225, 0.68, 8, 1, true); crown.translate(0, 0.34, 0);
    const brim = new THREE.CylinderGeometry(0.42, 0.4, 0.03, 10); brim.translate(0, 0.01, 0);
    for (const g of [crown, brim]) { g.rotateZ(0.06); g.rotateX(0.24); g.translate(0, 1.87, 0.03); parts.push([g, 0xffffff, 1]); }
    for (const s of [-1, 1]) {
      const sleeve = new THREE.CylinderGeometry(0.075, 0.15, 0.6, 6, 1, true); sleeve.translate(0, -0.3, 0);
      sleeve.rotateZ(s < 0 ? -0.12 : 0.1); sleeve.rotateX(s < 0 ? 0.06 : 0.3); sleeve.translate(s * 0.29, 1.41, 0);
      parts.push([sleeve, 0xffffff, 1]);
    }
    const c = new THREE.Color();
    const geo = mergeGeometries(parts.map(([g0, col, tint]) => {
      const g = g0.index ? g0.toNonIndexed() : g0;
      g.deleteAttribute('uv');
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const n = g.getAttribute('position').count;
      c.set(col);
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? c.r : i % 3 === 1 ? c.g : c.b)), 3));
      g.setAttribute('aTint', new THREE.Float32BufferAttribute(new Array(n).fill(tint), 1));
      return g;
    }))!;
    geo.computeBoundingSphere();
    return geo;
  });
}
/** A far wizard's robe and trim: hex, and as colours in the working space (what the crowd's instances take). */
export type FarColors = { robe: number; trim: number; robeC: THREE.Color; trimC: THREE.Color };
const farCache = new Map<string, FarColors>();
/** Each far wizard's colours, looked up again only when their dress changes (farColors runs per far wizard per frame). */
const farOf = new WeakMap<WizardModel, { house: House; key: string; v: FarColors }>();
/** The colours a far wizard is drawn in: robe and trim, from the house and the glamour worn (if any). */
export function farColors(m: WizardModel): FarColors {
  const d = m.dress, mine = farOf.get(m);
  if (mine && mine.house === d.house && mine.key === d.key) return mine.v;
  const k = `${d.house}|${d.key}`;
  let v = farCache.get(k);
  if (!v) {
    const g = parseGlamourKey(d.key);
    const scarf = new THREE.Color(SCARF[d.house][0]).getHex();
    const robe = g?.robe ?? (g ? PRESET_CLOTH[g.mat] : undefined) ?? CLOTH, trim = g?.trim ?? scarf;
    v = { robe, trim, robeC: new THREE.Color(robe), trimC: new THREE.Color(trim) };
    farCache.set(k, v);
  }
  farOf.set(m, { house: d.house, key: d.key, v });
  return v;
}

// ------------------------------------------------------------------ transfiguration of self (glamour)
/**
 * A wizard's look comes from the snapshot entry's `g` (src/shared/glamour.ts glamourKey), set only by a
 * glamour spell. Everything a look needs is cached by what it depends on and reference-counted, so N
 * wizards with the same look share their textures, geometry and materials (the robe material is the
 * exception: it carries the wizard's own sway uniform, as before); replaced ones are disposed. At 'low'
 * every preset is a MeshStandardMaterial approximation (no sheen, clearcoat or iridescence).
 */
export interface Dress {
  house: House; skinI: number; hairI: number;
  robe: THREE.Mesh; sway: { value: THREE.Vector3 }; torso: THREE.Mesh; legs: THREE.Mesh[]; tails: THREE.Mesh[]; arms: THREE.Mesh[];
  head: THREE.Mesh; hat: THREE.Mesh; wand: THREE.Mesh; glow: THREE.PointLight;
  /** Each re-dressed mesh's own material and geometry, to put back for the house look. */
  orig: Map<THREE.Mesh, { material: THREE.Material; geometry: THREE.BufferGeometry }>;
  /** The look key worn, and `${key}|${detail}` as last built. */
  key: string; applied: string;
  /** Shared pool entries this wizard holds, and materials only it uses (the robe). */
  held: string[]; own: THREE.Material[];
  tip: number; lumos: number; first: boolean; animated?: boolean;
  /** Storybook ink outlines ('high' only, hidden on a ghost) and the robe outline's own material. */
  inks: THREE.Mesh[]; inkMat?: THREE.Material; ghost?: boolean;
}
const showInks = (d: Dress) => { for (const x of d.inks) x.visible = detail === 'high' && !d.ghost; };

/** One clock for every animated glamour (starlight, flame, ghost). */
const glamTime = { value: 0 };
const WHITE = new THREE.Color(0xffffff);
/** A preset's own robe (and hat) colour when the spell names none; unset = the black school robe. */
const PRESET_CLOTH: Partial<Record<GlamourMaterial, number>> = { scales: 0x2f6f5a, mirror: 0xc0c6cc, flame: 0x3a0c04, starlight: 0x0d1238, ghost: 0xdfeeff };
/** The light an animated preset adds (a :glow colour tints it). */
const PRESET_SPARK: Partial<Record<GlamourMaterial, number>> = { starlight: 0xfff3d6, flame: 0xff5a14, ghost: 0x9fd8ff };

const pool = new Map<string, { v: { dispose(): void }; n: number }>();
function take<T extends { dispose(): void }>(d: Dress, key: string, make: () => T): T {
  let e = pool.get(key);
  if (!e) { e = { v: make(), n: 0 }; pool.set(key, e); }
  e.n++;
  d.held.push(key);
  return e.v as T;
}
function drop(key: string) {
  const e = pool.get(key);
  if (e && --e.n <= 0) { e.v.dispose(); pool.delete(key); }
}
const hexStr = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** The robe cloth in any colour: the same folds, noise, front edges, hem and piping as robeTex; dragon scales for :scales. */
function glamRobeTex(house: House, robe: number | null, trim: number | null, scales: boolean) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const base = new THREE.Color(robe ?? (STORYBOOK ? 0x221f2e : 0x1a1a20));
  for (let x = 0; x < S; x++) {
    const k = 0.78 + 0.22 * Math.cos((x / S) * Math.PI * 2 * 7);
    g.fillStyle = '#' + base.clone().multiplyScalar(k).getHexString();
    g.fillRect(x, 0, 1, S);
  }
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * S, Math.random() * S, 1, 3); }
  if (scales) {
    const r = 9;
    for (let row = 0; row * r * 0.9 < S + r; row++) for (let col = -1; col * r * 2 < S + r; col++) {
      const cx = col * r * 2 + (row % 2) * r, cy = row * r * 0.9;
      const gr = g.createRadialGradient(cx, cy - r * 0.3, 1, cx, cy, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.75, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI); g.fill();
    }
  }
  const edge = trim ?? HOUSE_COLORS[house];
  g.fillStyle = hexStr(edge);
  g.fillRect(0, 0, S * 0.045, S);
  g.fillRect(S * 0.955, 0, S * 0.045, S);
  g.fillRect(0, S * 0.93, S, S * 0.07);
  g.fillStyle = trim === null ? '#c9a23a' : '#' + new THREE.Color(trim).lerp(WHITE, 0.45).getHexString();
  g.fillRect(S * 0.045, 0, 2, S * 0.93);
  g.fillRect(S * 0.955 - 2, 0, 2, S * 0.93);
  g.fillRect(0, S * 0.93 - 2, S, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The preset's surface: MeshPhysicalMaterial at 'high' where it has sheen, clearcoat, iridescence or metal. */
function surface(mat: GlamourMaterial, hi: boolean, p: THREE.MeshStandardMaterialParameters, tint: THREE.Color): THREE.MeshStandardMaterial {
  const P = (x: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial({ ...p, ...x });
  const S = (x: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ ...p, ...x });
  switch (mat) {
    case 'velvet': return hi ? P({ roughness: 0.95, sheen: 1, sheenRoughness: 0.4, sheenColor: tint.clone().lerp(WHITE, 0.4) }) : S({ roughness: 0.95 });
    case 'silk': return hi ? P({ roughness: 0.38, sheen: 0.6, sheenRoughness: 0.25, sheenColor: tint.clone().lerp(WHITE, 0.6), clearcoat: 0.7, clearcoatRoughness: 0.18 }) : S({ roughness: 0.38, metalness: 0.08 });
    // (a razor-sharp sun highlight blows out under bloom: mirror and scales stay a touch rough)
    case 'scales': return hi ? P({ roughness: 0.38, metalness: 0.35, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [220, 820] }) : S({ roughness: 0.4, metalness: 0.45 });
    case 'mirror': return hi ? P({ roughness: 0.2, metalness: 1, clearcoat: 0.3, clearcoatRoughness: 0.25 }) : S({ roughness: 0.24, metalness: 0.9 });
    case 'starlight': return S({ roughness: 0.75 });
    case 'flame': return S({ roughness: 0.85 });
    case 'ghost': return S({ roughness: 0.6, transparent: true, opacity: 0.38, depthWrite: false });
    default: return S({ roughness: 0.82 });
  }
}

/** Light added after shading by the animated presets (object-space position in vGlamPos, time in uGlamTime). */
const EFFECT_GLSL: Partial<Record<GlamourMaterial, string>> = {
  starlight: `{
    vec3 sp = vGlamPos * 34.0;
    float hh = fract(sin(dot(floor(sp), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float star = step(0.86, hh) * smoothstep(0.32, 0.0, length(fract(sp) - 0.5));
    float tw = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(uGlamTime * (1.5 + hh * 4.0) + hh * 60.0), 3.0);
    outgoingLight += uGlamSpark * (star * tw * 4.0 + 0.03);
  }`,
  flame: `{
    float hgt = clamp(1.0 - vGlamPos.y / 1.6, 0.0, 1.0);
    float an = atan(vGlamPos.z, vGlamPos.x);
    float lick = sin(an * 7.0 + uGlamTime * 3.1) * 0.5 + sin(an * 13.0 - uGlamTime * 4.3 + vGlamPos.y * 9.0) * 0.35;
    float wave = 0.5 + 0.5 * sin(vGlamPos.y * 18.0 - uGlamTime * 7.0 + lick * 3.0);
    float fl = clamp(hgt * 1.3 + lick * 0.25 - 0.25, 0.0, 1.0) * (0.55 + 0.45 * wave);
    outgoingLight += mix(uGlamSpark, vec3(1.0, 0.85, 0.35), fl * fl) * fl * 2.2;
  }`,
  ghost: `{
    float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
    float drift = 0.85 + 0.15 * sin(uGlamTime * 1.3 + vGlamPos.y * 6.0);
    outgoingLight = outgoingLight * 0.6 + uGlamSpark * (0.22 + rim * 1.4) * drift;
    diffuseColor.a = clamp(diffuseColor.a + rim * 0.5, 0.0, 0.85);
  }`,
};

/** Add a preset's animated light (if it has one); `then` runs after (the cloth sway and lining). */
function withEffect<T extends THREE.MeshStandardMaterial>(m: T, mat: GlamourMaterial, spark: THREE.Color, key: string, then?: (sh: THREE.WebGLProgramParametersWithUniforms) => void) {
  const glsl = EFFECT_GLSL[mat];
  m.onBeforeCompile = (sh) => {
    if (glsl) {
      sh.uniforms.uGlamTime = glamTime;
      sh.uniforms.uGlamSpark = { value: spark };
      sh.vertexShader = 'varying vec3 vGlamPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlamPos = position;');
      sh.fragmentShader = 'uniform float uGlamTime;\nuniform vec3 uGlamSpark;\nvarying vec3 vGlamPos;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `${glsl}\n#include <opaque_fragment>`);
    }
    then?.(sh);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/** clothMaterial in a preset: the robe (own sway, own map) or the sleeves (vertex colours, no sway). */
function glamCloth(mat: GlamourMaterial, map: THREE.Texture | null, lining: THREE.Color, sway: { value: THREE.Vector3 }, vc: boolean, tint: THREE.Color, spark: THREE.Color) {
  const m = surface(mat, detail === 'high', { color: 0xffffff, map, side: THREE.DoubleSide, vertexColors: vc }, tint);
  if (vc) m.emissive.setScalar(0.12);
  withEffect(m, mat, spark, `glam-cloth:${mat}:${vc ? 'vc' : 'map'}`, (sh) => {
    sh.uniforms.uSway = sway;
    sh.uniforms.uLining = { value: lining };
    sh.vertexShader = 'uniform vec3 uSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float swayW = pow(clamp(1.0 - position.y / ${(ROBE_TOP - 0.2).toFixed(2)}, 0.0, 1.0), 1.6);
      transformed.x += uSway.x * swayW;
      transformed.z += uSway.z * swayW;
      transformed.xz += normalize(position.xz + vec2(1e-4)) * uSway.y * swayW;`);
    sh.fragmentShader = 'uniform vec3 uLining;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (!gl_FrontFacing) diffuseColor.rgb = uLining;`);
    if (vc) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        totalEmissiveRadiance *= vColor.rgb;
      #endif`);
  });
  return m;
}

/** A translucent copy of a shared material for :ghost (bounded: one per base material). */
function ghostOf(m: THREE.Material): THREE.Material {
  return once(`ghost:${m.uuid}`, () => {
    const c = m.clone();
    c.onBeforeCompile = m.onBeforeCompile;
    c.customProgramCacheKey = m.customProgramCacheKey;
    c.transparent = true;
    c.opacity = 0.35;
    c.depthWrite = false;
    return c;
  });
}

/**
 * Dress a wizard in the look `key` (the snapshot's `g`; undefined = the house look). Cheap when nothing
 * changed. Returns true when a wizard already in view changed how they look (time for a shimmer).
 */
export function setWizardLook(m: WizardModel, key: string | undefined): boolean {
  const d = m.dress;
  const k = key ?? '';
  const want = `${k}|${detail}`;
  if (want === d.applied) return false;
  const changed = !d.first && k !== d.key;
  d.first = false;
  d.key = k;
  d.applied = want;
  const held = d.held, own = d.own;
  d.held = [];
  d.own = [];
  const g = parseGlamourKey(k);
  const meshes = [d.robe, d.torso, ...d.legs, ...d.tails, ...d.arms, d.head, d.hat, d.wand];
  for (const x of meshes) if (!d.orig.has(x)) d.orig.set(x, { material: x.material as THREE.Material, geometry: x.geometry });
  for (const [x, o] of d.orig) { x.material = o.material; x.geometry = o.geometry; }
  if (g) dressUp(d, g, k);
  else { d.tip = 0xffffff; d.lumos = 0xfff2a0; d.glow.color.setHex(0xfff2c0); d.animated = false; }
  d.ghost = g?.mat === 'ghost';
  showInks(d);
  if (STORYBOOK) for (const x of meshes) rimLit(x.material as THREE.Material);
  // take the new before dropping the old, so what both looks share is never rebuilt
  for (const x of held) drop(x);
  for (const x of own) x.dispose();
  return changed;
}

function dressUp(d: Dress, g: Glamour, key: string) {
  const mat = g.mat, hi = detail === 'high';
  const cloth = g.robe ?? PRESET_CLOTH[mat] ?? null;
  const trim = g.trim ?? null;
  const lining = trim !== null ? new THREE.Color(trim) : new THREE.Color(HOUSE_COLORS[d.house]).multiplyScalar(0.7);
  const tint = new THREE.Color(cloth ?? CLOTH);
  const spark = new THREE.Color(g.glow ?? PRESET_SPARK[mat] ?? 0xffffff);
  // robe: its own material (the sway uniform is per wizard) over a shared texture
  const map = take(d, `rt:${d.house}:${cloth}:${trim}:${mat === 'scales'}`, () => glamRobeTex(d.house, cloth, trim, mat === 'scales'));
  const robeMat = glamCloth(mat, map, lining, d.sway, false, tint, spark);
  d.own.push(robeMat);
  d.robe.material = robeMat;
  // sleeves + hands: shared by every wizard of this house in this look
  const skin = g.skin ?? SKIN[d.skinI];
  const sleeves = take(d, `sl:${d.house}:${key}:${detail}`, () => glamCloth(mat, null, lining, NO_SWAY, true, tint, spark));
  const armGeo = take(d, `ag:${cloth}:${skin}`, () => {
    const sleeve = new THREE.CylinderGeometry(0.075, 0.15, 0.6, 12, 1, true); sleeve.translate(0, -0.3, 0);
    const hand = headGeo().hand.clone(); hand.translate(0, -0.6, 0);
    return painted([[sleeve, cloth ?? CLOTH], [hand, skin]]);
  });
  for (const a of d.arms) { a.material = sleeves; a.geometry = armGeo; }
  if (g.skin !== undefined) {
    d.head.geometry = take(d, `hd:${g.skin}:${d.hairI}`, () => {
      const hg = headGeo(), fg = faceGeo();
      const hair = new THREE.SphereGeometry(0.228, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62); hair.rotateX(0.85); hair.translate(0, 0.225, 0.014);
      return painted([[hg.face, g.skin!], [fg.whites, 0xf4f1ea], [fg.pupils, 0x1a120c], [fg.brows, HAIR[d.hairI]], [fg.mouth, 0x5a2a22], [hair, HAIR[d.hairI]]]);
    });
  }
  // hat: crown and brim in the hat colour, the band in the trim; the preset's surface
  // (no hat of your own: the school hat, its brim in the house colour as makeWizard draws it)
  const own = g.hat ?? PRESET_CLOTH[mat];
  const hatCol = own ?? HAT_CROWN;
  const brimCol = own ?? new THREE.Color(HOUSE_COLORS[d.house]).multiplyScalar(0.72).getHex();
  const band = trim ?? new THREE.Color(HOUSE_COLORS[d.house]).multiplyScalar(own === undefined ? 0.45 : 0.6).getHex();
  d.hat.geometry = take(d, `hg:${hatCol}:${brimCol}:${band}`, () => {
    const b = new THREE.CylinderGeometry(0.22, 0.227, 0.065, 18, 1, true); b.translate(0, 0.032, 0);
    return painted([[hatGeo(), hatCol], [brimGeo(), brimCol], [b, band]]);
  });
  d.hat.material = take(d, `hm:${mat}:${spark.getHex()}:${detail}`, () =>
    withEffect(surface(mat, hi, { color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }, new THREE.Color(hatCol)), mat, spark, `glam-hat:${mat}`));
  if (mat === 'ghost') for (const x of [d.torso, ...d.legs, ...d.tails, d.head, d.wand]) x.material = ghostOf(d.orig.get(x)!.material);
  d.tip = g.glow ?? 0xffffff;
  d.lumos = g.glow ?? 0xfff2a0;
  d.glow.color.setHex(g.glow ?? 0xfff2c0);
  d.animated = !!EFFECT_GLSL[mat];
}

/** Give back what a wizard's look holds (call when the wizard leaves the scene). */
export function releaseWizardLook(m: WizardModel) {
  const d = m.dress;
  for (const x of d.held) drop(x);
  for (const x of d.own) x.dispose();
  d.inkMat?.dispose();
  d.held = [];
  d.own = [];
  d.applied = '';
}

/** House colour lifted toward white so it reads on dark backgrounds. */
const nameColors = new Map<House, string>();
/** A house's name-tag colour (made once per house: apply() asks for every wizard in every snapshot). */
export function wizardColor(h: House) {
  let c = nameColors.get(h);
  if (!c) nameColors.set(h, (c = '#' + new THREE.Color(HOUSE_COLORS[h]).lerp(new THREE.Color(0xffffff), 0.45).getHexString()));
  return c;
}

/** Shared creature materials by color+params (avoids per-instance material creation). */
const _lamCache = new Map<string, THREE.MeshStandardMaterial>();
const _lam = (c: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const key = c + '|' + JSON.stringify(extra);
  let m = _lamCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...extra }); _lamCache.set(key, m); }
  return m;
};
export function makeCreature(kind: CreatureKind): { root: THREE.Group; label: Label; anim: (t: number) => void } {
  const root = new THREE.Group();
  const label = new Label(0.7);
  let anim: (t: number) => void = () => {};
  const lam = _lam;
  switch (kind) {
    case 'pixie': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), lam(0x2a6bff, { emissive: 0x0a1a55 }));
      b.position.y = 1.3;
      root.add(b);
      const wingMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), wingMat);
      const w2 = w1.clone();
      w1.position.set(0.3, 1.4, 0);
      w2.position.set(-0.3, 1.4, 0);
      root.add(w1, w2);
      anim = (t) => { w1.rotation.y = Math.sin(t * 40) * 0.8; w2.rotation.y = -w1.rotation.y; b.position.y = 1.3 + Math.sin(t * 5) * 0.2; };
      label.sprite.position.y = 2.1;
      break;
    }
    case 'snare': {
      for (let i = 0; i < 9; i++) {
        const v = new THREE.Mesh(new THREE.ConeGeometry(0.18, 2.2, 5), lam(0x2e5a1c));
        v.position.set(Math.cos(i * 0.7) * 0.8, 1, Math.sin(i * 0.7) * 0.8);
        v.rotation.set(Math.sin(i) * 0.5, 0, Math.cos(i) * 0.5);
        root.add(v);
      }
      anim = (t) => { const ch = root.children; for (let i = 0; i < ch.length; i++) if (ch[i] !== label.sprite) ch[i].rotation.z = Math.cos(i) * 0.5 + Math.sin(t * 2 + i) * 0.2; };
      label.sprite.position.y = 2.8;
      break;
    }
    case 'spider': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), lam(0x111111));
      b.position.y = 0.8;
      b.scale.set(1, 0.7, 1.3);
      root.add(b);
      const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
      eyes.position.set(0, 0.95, -0.8);
      root.add(eyes);
      const legs: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4), lam(0x1a1a1a));
        const side = i < 4 ? 1 : -1;
        l.position.set(side * 0.9, 0.6, -0.6 + (i % 4) * 0.4);
        l.rotation.z = side * 1.0;
        root.add(l);
        legs.push(l);
      }
      anim = (t) => legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 12 + i) * 0.3; });
      label.sprite.position.y = 2;
      break;
    }
    case 'troll': {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 1.8, 6, 10), lam(0x7d7f6e));
      b.position.y = 2;
      root.add(b);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), lam(0x6d6f5e));
      h.position.y = 3.6;
      root.add(h);
      const club = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 2.6, 6), lam(0x5a3d22));
      club.position.set(1.3, 1.8, -0.2);
      root.add(club);
      anim = (t) => { club.rotation.x = Math.sin(t * 2) * 0.5; };
      label.sprite.position.y = 4.6;
      break;
    }
    case 'inferius': {
      const pale = lam(0xb9c2ae, { roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), pale);
      body.position.y = 1.1;
      body.rotation.x = 0.25;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), pale);
      head.position.set(0, 1.9, -0.25);
      const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(3) }));
      eyes.position.set(0, 1.93, -0.45);
      const arms: THREE.Mesh[] = [-0.3, 0.3].map((x) => {
        const a = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.9, 5), pale);
        a.position.set(x, 1.45, -0.45);
        a.rotation.x = -1.3;
        return a;
      });
      root.add(body, head, eyes, ...arms);
      anim = (t) => { arms.forEach((a, i) => { a.rotation.x = -1.3 + Math.sin(t * 3 + i) * 0.2; }); body.rotation.z = Math.sin(t * 1.5) * 0.08; };
      label.sprite.position.y = 2.7;
      break;
    }
    case 'unicorn': {
      const white = lam(0xf6f6ff, { roughness: 0.4, emissive: 0x303040 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.3, 6, 10), white);
      body.rotation.x = Math.PI / 2;
      body.position.y = 1.35;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.9, 8), white);
      neck.position.set(0, 1.9, -0.8);
      neck.rotation.x = 0.6;
      const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.45, 4, 8), white);
      head.position.set(0, 2.25, -1.15);
      head.rotation.x = 1.2;
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xffe9a0, metalness: 0.9, roughness: 0.2, emissive: 0xffd060, emissiveIntensity: 2 }));
      horn.position.set(0, 2.55, -1.3);
      horn.rotation.x = -0.5;
      const legs: THREE.Mesh[] = [];
      for (const [x, z] of [[-0.25, -0.55], [0.25, -0.55], [-0.25, 0.55], [0.25, 0.55]]) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 1.1, 6), white);
        l.position.set(x, 0.55, z);
        legs.push(l);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xeef4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(5);
      halo.position.y = 1.4;
      root.add(body, neck, head, horn, halo, ...legs);
      anim = (t) => { legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 6 + i * Math.PI / 2) * 0.35; }); halo.material.opacity = 0.35 + 0.15 * Math.sin(t * 2); };
      label.sprite.position.y = 3.1;
      break;
    }
    case 'phoenix': {
      const fire = new THREE.MeshStandardMaterial({ color: 0xc8261a, emissive: 0xff5a1a, emissiveIntensity: 2.5, roughness: 0.4 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc040, emissive: 0xffa020, emissiveIntensity: 3 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), fire);
      body.scale.set(1, 0.8, 1.6);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), fire);
      head.position.set(0, 0.25, -0.55);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), gold);
      beak.position.set(0, 0.22, -0.75);
      beak.rotation.x = -Math.PI / 2;
      const wingGeo = new THREE.PlaneGeometry(1.4, 0.6);
      wingGeo.translate(0.7, 0, 0);
      const wl = new THREE.Mesh(wingGeo, new THREE.MeshStandardMaterial({ color: 0xe0401a, emissive: 0xff6a20, emissiveIntensity: 2, side: THREE.DoubleSide }));
      const wr = wl.clone();
      wr.scale.x = -1;
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.4, 6), gold);
      tail.position.set(0, -0.05, 0.9);
      tail.rotation.x = Math.PI / 2 + 0.2;
      const g = new THREE.Group();
      g.add(body, head, beak, wl, wr, tail);
      g.position.y = 3.2;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(4);
      g.add(glow);
      root.add(g);
      anim = (t) => { wl.rotation.z = Math.sin(t * 7) * 0.7; wr.rotation.z = -wl.rotation.z; g.position.y = 3.2 + Math.sin(t * 2) * 0.4; };
      label.sprite.position.y = 4.4;
      break;
    }
    case 'serpent': {
      const scale = lam(0x2d6b2d, { roughness: 0.35 });
      const segs: THREE.Mesh[] = [];
      for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.2 - i * 0.012, 8, 6), scale);
        m.position.set(0, 0.2, i * 0.3);
        segs.push(m);
      }
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), scale);
      head.scale.set(1, 0.7, 1.4);
      head.position.set(0, 0.35, -0.3);
      root.add(head, ...segs);
      anim = (t) => { segs.forEach((m, i) => { m.position.x = Math.sin(t * 6 - i * 0.7) * 0.25; }); head.position.x = Math.sin(t * 6 + 0.7) * 0.2; };
      label.sprite.position.y = 1.3;
      break;
    }
    case 'birds': {
      const birds: THREE.Group[] = [];
      const feather = lam(0xf0e6c8, { roughness: 0.6 });
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Group();
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 6), feather);
        body.rotation.x = Math.PI / 2;
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), new THREE.MeshStandardMaterial({ color: 0xf0e6c8, side: THREE.DoubleSide }));
        b.add(body, w);
        birds.push(b);
        root.add(b);
      }
      anim = (t) => birds.forEach((b, i) => {
        const a = t * 3 + (i * Math.PI * 2) / birds.length;
        b.position.set(Math.cos(a) * 0.8, 1.6 + Math.sin(t * 5 + i) * 0.3, Math.sin(a) * 0.8);
        b.rotation.y = -a;
        (b.children[1] as THREE.Mesh).rotation.x = Math.sin(t * 20 + i) * 0.8;
      });
      label.sprite.position.y = 2.6;
      break;
    }
    case 'dementor': {
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      robe.position.y = 2.5;
      root.add(robe);
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), new THREE.MeshStandardMaterial({ color: 0x050507 }));
      hood.position.y = 4;
      root.add(hood);
      anim = (t) => { root.children[0].position.y = 2.5 + Math.sin(t * 1.5) * 0.3; hood.position.y = 4 + Math.sin(t * 1.5) * 0.3; };
      label.sprite.position.y = 4.9;
      break;
    }
  }
  root.add(label.sprite);
  if (STORYBOOK) root.traverse((o) => { const mm = (o as THREE.Mesh).material; if (mm && !Array.isArray(mm)) rimLit(mm); });
  return { root, label, anim };
}

let _glow: THREE.Texture | null = null;
/** A soft white radial glow (sprites, bolts.ts). */
export const glowTexture = () => glowTex();
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

/** A ring at the feet that shows the strongest aura: heal (green), venom, fire, frost, curse. */
const _auraMats = new Map<number, THREE.MeshBasicMaterial>();
export function makeAuraRing() {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.08;
  m.visible = false;
  return m;
}
/** Aura letters (World auraFlags). Jinxes come first so a hexed wizard is easy to spot: j Jelly-Legs (lilac), z Tarantallegra (magenta), b Furnunculus (yellow-green), t Bat-Bogey (grey). */
const AURA_COLORS: [string, number][] = [['j', 0xc9a8ff], ['z', 0xff3cc8], ['b', 0xb5e03a], ['t', 0x9a9aa6], ['c', 0x9b3cff], ['f', 0xff7a1a], ['v', 0x6cff3c], ['i', 0x8fe3ff], ['g', 0x7dffb0]];
export function setAuraRing(ring: THREE.Mesh, flags: string, t: number) {
  let hit: [string, number] | undefined;
  for (let i = 0; i < AURA_COLORS.length && !hit; i++) if (flags.includes(AURA_COLORS[i][0])) hit = AURA_COLORS[i];
  ring.visible = !!hit;
  if (hit) {
    let mat = _auraMats.get(hit[1]);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      mat.color.setHex(hit[1]).multiplyScalar(2);
      _auraMats.set(hit[1], mat);
    }
    ring.material = mat;
    ring.scale.setScalar(1 + 0.08 * Math.sin(t * 6));
  }
}

export const boltColor = (kind: string, e: Element) => (kind === 'disarm' ? 0xff3b3b : kind === 'root' ? 0x9fe8ff : ELEMENT_COLORS[e]);

/**
 * A spell in flight. Its white-hot core and two element-coloured glows are drawn for all bolts at once
 * (bolts.ts); this object carries the position, the colour and, for Rooting, the spinning ring.
 */
export function makeBolt(kind: string, e: Element): THREE.Object3D {
  const color = boltColor(kind, e);
  const g = new THREE.Group();
  g.name = 'bolt';
  if (kind === 'root') {
    const ring = new THREE.Mesh(once('boltRing', () => new THREE.TorusGeometry(0.42, 0.04, 6, 24)), once('boltRingMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(3) })));
    ring.name = 'spin';
    g.add(ring);
  }
  g.position.y = 1.3;
  g.userData.color = color;
  return g;
}
