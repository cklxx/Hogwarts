import * as THREE from 'three';
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
  body: THREE.Group;
  label: Label;
  shield: THREE.Mesh;
  glow: THREE.PointLight;
  wandTip: THREE.Mesh;
  root2: THREE.Mesh;
  patronus: THREE.Mesh;
  elder: THREE.Mesh;
}

export function makeWizard(house: House, isMe: boolean): WizardModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a22 }));
  robe.position.y = 0.8;
  body.add(robe);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 12), new THREE.MeshStandardMaterial({ color: HOUSE_COLORS[house] }));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 1.5;
  body.add(scarf);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf0c9a0 }));
  head.position.y = 1.75;
  body.add(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), new THREE.MeshStandardMaterial({ color: 0x15151c }));
  hat.position.y = 2.2;
  hat.rotation.z = 0.12;
  body.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.03, 14), hat.material);
  brim.position.y = 1.92;
  body.add(brim);
  const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.55, 5), new THREE.MeshStandardMaterial({ color: 0x4a2e19 }));
  wand.position.set(0.35, 1.25, -0.3);
  wand.rotation.x = -1.1;
  body.add(wand);
  const wandTip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  wandTip.position.set(0.35, 1.37, -0.55);
  body.add(wandTip);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.18, depthWrite: false }));
  shield.position.y = 1;
  shield.visible = false;
  root.add(shield);
  const glow = new THREE.PointLight(0xfff2c0, 0, 14);
  glow.position.set(0.35, 1.5, -0.6);
  body.add(glow);
  const root2 = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 6, 16), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
  root2.rotation.x = Math.PI / 2;
  root2.position.y = 0.2;
  root2.visible = false;
  root.add(root2);
  const patronus = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshBasicMaterial({ color: 0xdfefff, transparent: true, opacity: 0.8 }));
  patronus.visible = false;
  root.add(patronus);
  const elder = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: 0xe0c3ff }));
  elder.position.y = 2.9;
  elder.visible = false;
  root.add(elder);
  const label = new Label(isMe ? 0.9 : 1);
  label.sprite.position.y = 3.1;
  root.add(label.sprite);
  if (isMe) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.72, 24), new THREE.MeshBasicMaterial({ color: 0xd4af37, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    root.add(ring);
  }
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { root, body, label, shield, glow, wandTip, root2, patronus, elder };
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
/** Aura letters (World auraFlags). Jinxes come first so a hexed wizard is easy to spot: j Jelly-Legs (lilac), z Tarantallegra (magenta), b Furnunculus (yellow-green), t Bat-Bogey (grey). */
const AURA_COLORS: [string, number][] = [['j', 0xc9a8ff], ['z', 0xff3cc8], ['b', 0xb5e03a], ['t', 0x9a9aa6], ['c', 0x9b3cff], ['f', 0xff7a1a], ['v', 0x6cff3c], ['i', 0x8fe3ff], ['g', 0x7dffb0]];
export function setAuraRing(ring: THREE.Mesh, flags: string, t: number) {
  const hit = AURA_COLORS.find(([f]) => flags.includes(f));
  ring.visible = !!hit;
  if (hit) {
    (ring.material as THREE.MeshBasicMaterial).color.setHex(hit[1]).multiplyScalar(2);
    ring.scale.setScalar(1 + 0.08 * Math.sin(t * 6));
  }
}

export function makeBolt(kind: string, e: Element): THREE.Object3D {
  const color = kind === 'disarm' ? 0xff3b3b : kind === 'root' ? 0x9fe8ff : ELEMENT_COLORS[e];
  const g = new THREE.Group();
  // HDR colours (> 1) so the bloom pass makes spells glow
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(6) }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(core, halo);
  g.position.y = 1.3;
  return g;
}
