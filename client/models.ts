import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ELEMENT_COLORS, HOUSE_COLORS, type CreatureKind, type Element, type House } from '../src/shared/constants';

/** A canvas sprite used for name tags, hp bars and speech bubbles. */
export class Label {
  sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private tex: THREE.CanvasTexture;
  private last = '';
  constructor(scale = 1) {
    this.canvas.width = 512;
    this.canvas.height = 160;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true }));
    this.sprite.scale.set(4.8 * scale, 1.5 * scale, 1);
    this.sprite.renderOrder = 10;
  }
  draw(name: string, color: string, hpFrac: number, say?: string, extra = '') {
    const key = `${name}|${color}|${hpFrac.toFixed(2)}|${say}|${extra}`;
    if (key === this.last) return;
    this.last = key;
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
  /**
   * Animate: walk cycle scaled by ground speed (m/s), and the wand-arm cast gesture when `casting`
   * is true. Returns true on the frame the wand is thrust forward (the moment to flash the tip).
   */
  update(dt: number, speed: number, casting: boolean): boolean;
}

// ---- wizard parts: geometry and materials are built once and shared by every wizard
const SCARF: Record<House, [string, string]> = {
  Gryffindor: ['#7f0909', '#e3a81d'],
  Hufflepuff: ['#e8b92c', '#26211d'],
  Ravenclaw: ['#1b2f6e', '#a8834e'],
  Slytherin: ['#1a4a2a', '#b9bec4'],
};
const SKIN = [0xf2cba8, 0xe6b48c, 0xc98f66, 0x9a6444, 0x6e4530, 0xf6dcc4];
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
function painted(parts: [THREE.BufferGeometry, THREE.ColorRepresentation][]) {
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
      const v = Math.round(26 * k);
      g.fillStyle = `rgb(${v},${v},${v + 6})`;
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
  const m = new THREE.MeshStandardMaterial({ color: map || vertexColors ? 0xffffff : 0x1c1c22, map, roughness: 0.82, side: THREE.DoubleSide, vertexColors });
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
    return painted([[shin, 0x24242a], [shoe, 0x0e0d0c]]);
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
  head.add(shadow(new THREE.Mesh(once(`headGeo:${skinI}:${hairI}`, () => {
    const fg = faceGeo();
    const hair = new THREE.SphereGeometry(0.228, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62); hair.rotateX(0.85); hair.translate(0, 0.225, 0.014);
    return painted([[hg.face, SKIN[skinI]], [fg.whites, 0xf4f1ea], [fg.pupils, 0x1a120c], [fg.brows, HAIR[hairI]], [fg.mouth, 0x5a2a22], [hair, HAIR[hairI]]]);
  }), headMat)));
  // the hat: crown, brim and house band in one mesh
  const hat = new THREE.Group();
  hat.position.set(0, 0.37, 0.03);
  hat.rotation.set(0.24, 0, 0.06); // pushed back so the brim does not hide the face
  const hatMat = once('hatMat', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  hat.add(shadow(new THREE.Mesh(once(`hatGeo:${house}`, () => {
    const band = new THREE.CylinderGeometry(0.22, 0.227, 0.065, 18, 1, true); band.translate(0, 0.032, 0);
    return painted([[hatGeo(), 0x17171e], [brimGeo(), 0x17171e], [band, new THREE.Color(HOUSE_COLORS[house]).multiplyScalar(0.6)]]);
  }), hatMat)));
  head.add(hat);
  rig.add(head);

  // ---- arms: bell sleeves lined in house colour, each with its hand; the right hand holds the wand
  const sleeveMat = once(`sleeve:${house}`, () => clothMaterial(house, null, NO_SWAY, true));
  const armGeo = once(`armGeo:${skinI}`, () => {
    const sleeve = new THREE.CylinderGeometry(0.075, 0.15, 0.6, 12, 1, true); sleeve.translate(0, -0.3, 0);
    const hand = hg.hand.clone(); hand.translate(0, -0.6, 0);
    return painted([[sleeve, 0x1c1c22], [hand, SKIN[skinI]]]);
  });
  const arm = (s: number) => {
    const a = new THREE.Group();
    a.position.set(s * 0.29, 1.41, 0);
    a.add(shadow(new THREE.Mesh(armGeo, sleeveMat)));
    rig.add(a);
    return a;
  };
  const armL = arm(-1), armR = arm(1);
  const wand = new THREE.Group();
  wand.position.set(0, -0.6, -0.02);
  wand.rotation.x = -(Math.PI - 1.0); // about 57° off the forearm, so it points ahead from a lowered arm
  armR.add(wand);
  wand.add(new THREE.Mesh(once('wandGeo', () => {
    const shaft = new THREE.CylinderGeometry(0.007, 0.014, 0.4, 6); shaft.translate(0, 0.2, 0);
    const grip = new THREE.CylinderGeometry(0.02, 0.018, 0.11, 8); grip.translate(0, 0.01, 0);
    const knob = new THREE.SphereGeometry(0.024, 8, 6); knob.translate(0, -0.05, 0);
    return mergeGeometries([shaft, grip, knob])!;
  }), wood));
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

  // ---- animation state
  const st = { speed: 0, phase: (h % 100) / 16, t: (h % 1000) / 100, cast: -1, flashed: true, detail: '' };
  const tipColor = new THREE.Color();
  const REST_R = 0.3;
  return {
    root, body, label, shield, glow, wandTip, root2, patronus, elder, castPending: false,
    update(dt, speed, casting) {
      st.t += dt;
      if (st.detail !== detail) { st.detail = detail; tailF.visible = tailB.visible = detail === 'high'; }
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
      if (shield.visible) { shield.scale.setScalar(1 + 0.02 * Math.sin(st.t * 5)); shieldUniforms.uTime.value = performance.now() / 1000; }
      if (root2.visible) root2.rotation.z += dt * 2;
      if (elder.visible) { elder.rotation.y += dt * 2; elder.position.y = 2.9 + Math.sin(st.t * 2) * 0.08; }
      return fire;
    },
  };
}

/** House colour lifted toward white so it reads on dark backgrounds. */
export function wizardColor(h: House) { return '#' + new THREE.Color(HOUSE_COLORS[h]).lerp(new THREE.Color(0xffffff), 0.45).getHexString(); }

export function makeCreature(kind: CreatureKind): { root: THREE.Group; label: Label; anim: (t: number) => void } {
  const root = new THREE.Group();
  const label = new Label(0.7);
  let anim: (t: number) => void = () => {};
  const lam = (c: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...extra });
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
      anim = (t) => { root.children.forEach((c, i) => { if (c !== label.sprite) c.rotation.z = Math.cos(i) * 0.5 + Math.sin(t * 2 + i) * 0.2; }); };
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
  return { root, label, anim };
}

let _glow: THREE.Texture | null = null;
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
export function makeAuraRing() {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.08;
  m.visible = false;
  return m;
}
const AURA_COLORS: [string, number][] = [['c', 0x9b3cff], ['f', 0xff7a1a], ['v', 0x6cff3c], ['i', 0x8fe3ff], ['g', 0x7dffb0]];
export function setAuraRing(ring: THREE.Mesh, flags: string, t: number) {
  const hit = AURA_COLORS.find(([f]) => flags.includes(f));
  ring.visible = !!hit;
  if (hit) {
    (ring.material as THREE.MeshBasicMaterial).color.setHex(hit[1]).multiplyScalar(2);
    ring.scale.setScalar(1 + 0.08 * Math.sin(t * 6));
  }
}

export const boltColor = (kind: string, e: Element) => (kind === 'disarm' ? 0xff3b3b : kind === 'root' ? 0x9fe8ff : ELEMENT_COLORS[e]);

/** A spell in flight: a white-hot core inside two element-coloured glows (the trail is GPU particles, see fx.ts). */
export function makeBolt(kind: string, e: Element): THREE.Object3D {
  const color = boltColor(kind, e);
  const g = new THREE.Group();
  // HDR colours (> 1) so the bloom pass makes spells glow
  const core = new THREE.Mesh(once('boltCore', () => new THREE.SphereGeometry(0.13, 10, 8)), once('boltCoreMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(8) })));
  const inner = new THREE.Sprite(once(`boltIn:${color}`, () => new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  inner.scale.setScalar(1.0);
  const outer = new THREE.Sprite(once(`boltOut:${color}`, () => new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })));
  outer.scale.setScalar(2.4);
  g.add(core, inner, outer);
  if (kind === 'root') {
    const ring = new THREE.Mesh(once('boltRing', () => new THREE.TorusGeometry(0.42, 0.04, 6, 24)), once('boltRingMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(3) })));
    ring.name = 'spin';
    g.add(ring);
  }
  g.position.y = 1.3;
  g.userData.color = color;
  return g;
}
