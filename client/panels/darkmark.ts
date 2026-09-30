import * as THREE from 'three';
import type { ClientFeatureFactory } from '../feature';
import { L, placeName } from '../i18n';
import { ic } from '../ink';
import { bearing, esc, fmtDist } from './logic';
import type { DarkLordPin } from './types';

/**
 * 黑魔标记: the skull-and-serpent over the Dark Lord's head, drawn from the ink set's own symbol (index.html
 * #i-darkmark, one Path2D per element) into a canvas sprite like the name tags (models.ts Label): green ink with
 * a glow, depth test off so it shows through the canopy, hung on the wizard's root so it follows them (and is
 * gone with them when they leave your area; the HUD compass then points the way). Nothing in the 3D art changes.
 *
 * darkLordFeature (the end of this file) is the Dark Lord in the browser (src/kernel/unfair.ts): the mark, the compass
 * to them under the clock (snapshot `dl`), your own ribbon when you wear it (me.darkLord), ☠ by their name, the
 * leaderboard's line.
 */
const INK: Record<string, { fill?: string; stroke?: string; width?: number }> = {
  s: { stroke: '#8dffa6', width: 2.6 },
  f: { fill: 'rgba(8, 42, 20, .82)' },
  f2: { fill: '#46e878' },
  t: { stroke: '#a8ffbb', width: 1.9 },
  p: { fill: '#07140b' },
};

export function paint(c: CanvasRenderingContext2D) {
  const sym = document.getElementById('i-darkmark');
  c.clearRect(0, 0, 256, 256);
  if (!sym) return;
  c.save();
  c.translate(12, 12);
  c.scale(232 / 48, 232 / 48);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.shadowColor = 'rgba(90, 255, 150, .95)';
  c.shadowBlur = 16;
  for (const el of Array.from(sym.children)) {
    const d = el.getAttribute('d');
    if (!d) continue;
    const cls = (el.getAttribute('class') ?? '').split(/\s+/);
    const ink = INK[cls[0]];
    if (!ink) continue;
    const p = new Path2D(d);
    if (ink.fill) { c.fillStyle = ink.fill; c.fill(p); }
    if (ink.stroke) {
      c.strokeStyle = ink.stroke;
      c.lineWidth = (ink.width ?? 2) * (cls.includes('w2') ? 2.2 : cls.includes('w') ? 1.5 : 1);
      c.stroke(p);
    }
  }
  c.restore();
}

export function createDarkMark() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // not tone mapped and not fogged: the mark glows the same green by day, by night and through the forest's mist
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  sprite.name = 'darkmark';
  sprite.scale.set(1.9, 1.9, 1);
  sprite.renderOrder = 11;
  let painted = false;
  let host: THREE.Object3D | null = null;
  return {
    /** Hang the mark over `root` (the Dark Lord's model, or null for nobody in view); `t` seconds for its drift. */
    update(root: THREE.Object3D | null, t: number) {
      if (root !== host) {
        sprite.removeFromParent();
        if (root) root.add(sprite);
        host = root;
      }
      if (!root) return;
      if (!painted) { paint(ctx); tex.needsUpdate = true; painted = true; }
      sprite.position.y = 4.5 + Math.sin(t * 1.3) * 0.15;
      mat.opacity = 0.82 + 0.18 * Math.sin(t * 2.1);
    },
  };
}

/** The Dark Lord as a client feature (client/features.ts). */
export const darkLordFeature: ClientFeatureFactory = (d) => {
  const mark3d = createDarkMark();
  const dl = () => d.wire<DarkLordPin | null>('dl') ?? null;
  const you = () => !!d.me()?.darkLord;
  let t = 0;
  /** Under the clock: which way, and how far, to You-Know-Who. */
  function compass() {
    const clock = document.getElementById('clock');
    if (!clock) return;
    let el = document.getElementById('dl-compass');
    if (!el) { el = document.createElement('div'); el.id = 'dl-compass'; el.hidden = true; clock.after(el); }
    const pin = dl(), p = d.myPos();
    if (!pin || !d.me() || !p || pin.h === d.myHandle()) { el.hidden = true; return; }
    const { dist, rot } = bearing(p, pin, d.camYaw());
    const html = `${ic('darkmark')}<span class="dc-t"><b>${L('那个人', 'You-Know-Who')}</b> ${esc(pin.n)}<small>${esc(placeName(pin.p))}</small></span><span class="dc-d"><span class="arrow" style="transform:rotate(${rot.toFixed(2)}rad)">↑</span><span class="num">${fmtDist(dist)}</span></span>`;
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
    el.title = L('黑魔王的位置向全服公开：击晕 TA 夺走 30% 声望', "The Dark Lord's whereabouts are public: stunning them steals 30% of their reputation");
    el.hidden = false;
  }
  return {
    id: 'darkLord',
    widgets: [{ id: 'dl-compass', zh: '黑魔王罗盘', en: 'Dark Lord compass' }],
    hud: compass,
    top: () => (you() ? `<div class="dl-ribbon">${ic('darkmark')}<span><b>${L('你是黑魔王', 'You are the Dark Lord')}</b> · ${L('位置已向全服公开', 'your whereabouts are public')} · ${L('伤害 <b class="num">+15%</b>', 'damage <b class="num">+15%</b>')} · <small>${L('被击晕会被夺走 30% 声望', 'a stun steals 30% of your reputation')}</small></span></div>` : ''),
    /** Every frame: the Dark Mark follows its wizard. */
    frame(dt) { t += dt; const pin = dl(); mark3d.update(pin ? d.rootOf(pin.h) : null, t); },
    badge: (h, html) => (dl()?.h === h ? (html ? `${ic('darkmark')} ` : '☠') : ''),
    goal: () => ({ darkLord: you() }),
    board(lb) {
      const x = lb.darkLord as { name: string; place: string; placeZh?: string; reputation: number } | null | undefined;
      return `<p class="pn-dl"><b>${ic('darkmark')}${L('黑魔王（那个人）', 'The Dark Lord (You-Know-Who)')}:</b> ${x ? `${esc(x.name)} · ${esc(L(x.placeZh ?? placeName(x.place), x.place))} · ${L(`声望 ${x.reputation}`, `${x.reputation} reputation`)}` : L('无人戴着黑魔标记', 'nobody wears the Dark Mark')}<br/><small>${L('声望 ≥150 的第一名戴上黑魔标记：伤害 +15%，位置每 60 秒向全服公开；击晕 TA 夺走 30% 声望。挑战者要达到 TA 的 110% 才能夺走标记。', esc(String(lb.darkLordRule ?? '')))}</small></p>`;
    },
  };
};
