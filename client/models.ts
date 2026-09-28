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
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 10), new THREE.MeshLambertMaterial({ color: 0x1a1a22 }));
  robe.position.y = 0.8;
  body.add(robe);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 12), new THREE.MeshLambertMaterial({ color: HOUSE_COLORS[house] }));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 1.5;
  body.add(scarf);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshLambertMaterial({ color: 0xf0c9a0 }));
  head.position.y = 1.75;
  body.add(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), new THREE.MeshLambertMaterial({ color: 0x15151c }));
  hat.position.y = 2.2;
  hat.rotation.z = 0.12;
  body.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.03, 14), hat.material);
  brim.position.y = 1.92;
  body.add(brim);
  const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.55, 5), new THREE.MeshLambertMaterial({ color: 0x4a2e19 }));
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
  const lam = (c: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
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
    case 'dementor': {
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3, 8, 1, true), new THREE.MeshLambertMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      robe.position.y = 2.5;
      root.add(robe);
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), new THREE.MeshLambertMaterial({ color: 0x050507 }));
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

export function makeBolt(kind: string, e: Element): THREE.Object3D {
  const color = kind === 'disarm' ? 0xff3b3b : kind === 'root' ? 0x9fe8ff : ELEMENT_COLORS[e];
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(core, halo);
  g.position.y = 1.3;
  return g;
}
