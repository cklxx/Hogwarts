import * as THREE from 'three';
import { ELEMENT_COLORS, HOUSE_COLORS, type CreatureKind, type Element, type House } from '../src/shared/constants';
import { LANDMARKS, OBSTACLES } from '../src/shared/map';
import { createDecor, type Look } from './decor';
import { L, applyStatic, creatureName, houseName, lang, placeName, setLang, spellName, tr } from './i18n';
import { createRenderer } from './render';
import { buildWorld } from './scene';
import { heightAt } from './terrain';
import { makeAuraRing, makeBolt, makeCreature, makeWizard, setAuraRing, wizardColor, type WizardModel } from './models';
import { createControls } from './controls';

// ------------------------------------------------------------------ protocol types (mirror of World.snapshot)
interface SW { h: string; n: string; ho: House; x: number; z: number; f: number; hp: number; m: number; y: number; t: string; s: string; say?: string }
interface SC { i: string; k: CreatureKind; x: number; z: number; f: number; hp: number; m: number; o?: string; s: string }
interface SP { i: string; k: string; x: number; z: number; e: Element }
interface Fx { k: string; x: number; z: number; r?: number; e?: Element; h?: string; n?: number; pts?: number[] }
interface Snap { t: number; hour: number; night: boolean; weather: string; term: { n: number; left: number }; w: SW[]; c: SC[]; p: SP[]; fx: Fx[]; elder: { x: number; z: number } | null; willowCalm: boolean; look?: Look }
interface Me {
  handle: string; name: string; house: House; year: number; xp: number; xpNext: number | null; reputation: number; galleons: number;
  hp: number; maxHp: number; mana: number; maxMana: number; hotbar: ({ id: string; name: string; cd: number; kind?: 'harm' | 'help' | 'self' } | null)[];
  stunned: number; jailed: number; decree: boolean; title: { zh: string; en: string; next: { zh: string; en: string; how: string } | null }; ui: string[]; seals: number; map: { name: string; registry: string; house: string; year: number; where: string; x: number; z: number }[] | null; proclamation: string;
}
interface Ev { id: number; type: string; text: string; zh?: string; to?: string }

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const LS = 'hogwarts.token';

// ------------------------------------------------------------------ the gate (login)
async function gate(): Promise<string> {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) { localStorage.setItem(LS, fromUrl); history.replaceState(null, '', location.pathname); }
  const saved = localStorage.getItem(LS);
  if (saved) {
    const r = await fetch(`/api/me?token=${encodeURIComponent(saved)}`).catch(() => null);
    if (r?.ok) return saved;
    localStorage.removeItem(LS);
  }
  return new Promise((done) => {
    const err = $('#gate-err');
    $('#gate-go').onclick = async () => {
      const r = await fetch('/api/enroll', { method: 'POST', body: JSON.stringify({ name: $<HTMLInputElement>('#gate-name').value, house: $<HTMLSelectElement>('#gate-house').value }) });
      const j = await r.json();
      if (!r.ok) { err.textContent = tr(j.error); return; }
      localStorage.setItem(LS, j.token);
      done(j.token);
    };
    $('#gate-login').onclick = async () => {
      const t = $<HTMLInputElement>('#gate-token').value.trim();
      const r = await fetch(`/api/me?token=${encodeURIComponent(t)}`);
      if (!r.ok) { err.textContent = 'The owl does not recognise that key.'; return; }
      localStorage.setItem(LS, t);
      done(t);
    };
    $<HTMLInputElement>('#gate-name').onkeydown = (e) => { if (e.key === 'Enter') $('#gate-go').click(); };
  });
}

// ------------------------------------------------------------------ rendering setup
const canvas = $<HTMLCanvasElement>('#view');
const R = createRenderer(canvas);
const { scene, camera } = R;
const world = buildWorld(scene);
const decor = createDecor(scene, world.bannerSpots);
// Quality: ?q=low|high forces it; otherwise measure the first seconds and drop to low if slow.
const forcedQ = new URLSearchParams(location.search).get('q');
let quality: 'low' | 'high' = forcedQ === 'low' ? 'low' : 'high';
const applyQuality = (q: 'low' | 'high') => { quality = q; R.setQuality(q); world.setQuality(q); };
applyQuality(quality);
const perf = { frames: 0, time: 0, done: !!forcedQ };
const DEFAULT_LOOK: Look = { skyTint: '#ffffff', sunIntensity: 1, fogDensity: 1, glow: 1, lanterns: false, fireworks: false, aurora: false, banner: null, cupHouse: null, statues: [] };
const weatherPts = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 3000 * 3 }, (_, i) => (i % 3 === 1 ? Math.random() * 40 : (Math.random() - 0.5) * 120)), 3)),
  new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.8 }),
);
weatherPts.visible = false;
scene.add(weatherPts);
const elderGlint = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshStandardMaterial({ color: 0xe0c3ff, emissive: 0xc9a0ff, emissiveIntensity: 4 }));
scene.add(elderGlint);
const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 24), new THREE.MeshBasicMaterial({ color: 0xff5050, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false }));
aimRing.rotation.x = -Math.PI / 2;
aimRing.visible = false;
scene.add(aimRing);

addEventListener('resize', R.resize);
R.resize();

// ------------------------------------------------------------------ state
let snap: Snap | null = null;
let me: Me | null = null;
let myHandle = '';
let token = '';
let ws: WebSocket | null = null;
const wizards = new Map<string, WizardModel & { tx: number; tz: number; tf: number; aura: THREE.Mesh }>();
const creatures = new Map<string, ReturnType<typeof makeCreature> & { tx: number; tz: number; tf: number; aura: THREE.Mesh }>();
const bolts = new Map<string, THREE.Object3D & { tx?: number; tz?: number }>();
const effects: { obj: THREE.Object3D; t: number; life: number; update: (k: number, o: THREE.Object3D) => void }[] = [];
let camYaw = 0, camPitch = 0.45, camDist = 14;
let clock = 0;

// ------------------------------------------------------------------ network
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.t === 'welcome') { myHandle = msg.handle; for (const e of msg.events) feed(e, false); menuInfo(msg.mcpUrl); }
    else if (msg.t === 'snap') apply(msg.s);
    else if (msg.t === 'me') me = msg.s;
    else if (msg.t === 'event') feed(msg.e, true);
    else if (msg.t === 'cast') {
      ctl.onCast(msg.r);
      if (!msg.r.ok) toast(`✗ ${spellName(msg.r.spell)}：${tr(msg.r.error)}`);
      else if (msg.r.notes?.length) toast(msg.r.notes.join(' · '));
    }
    else if (msg.t === 'book') { ctl.onArmory(msg.armory.spells); renderBook(msg.armory, msg.grimoire); }
    else if (msg.t === 'seals') { ctl.onSeals(msg.section); renderSeals(msg.section, msg.current); }
    else if (msg.t === 'goto') ctl.onGoto(msg.goal);
    else if (msg.t === 'sealmsg') { const r = msg.r; toast(r.runes ? L(`📜 第 ${r.tier} 道封印的第 ${r.page}/${r.of} 页已抄进你的笔记。`, `📜 Page ${r.page}/${r.of} of seal ${r.tier} copied into your notes.`) : r.opened ? L(`📕 封印打开了！`, `📕 The seal opens! ${r.reward}`) : `✗ ${L('ALGIZ 没有出现。封印纹丝不动，还反咬了你一口（-15 生命）。', r.message)}`); }
    else if (msg.t === 'sim') showSim(msg.r);
    else if (msg.t === 'forged') { bookOut(`✓ ${L('已铸造', 'Forged')} ${msg.name}.${msg.notes.length ? '\n' + msg.notes.join('\n') : ''}`, 'good'); }
    else if (msg.t === 'err') { ctl.onError(); if (!$('#book').hidden) bookOut(`✗ ${tr(msg.error)}`, 'bad'); else toast(`✗ ${tr(msg.error)}`); }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}
const send = (o: unknown) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };

function apply(s: Snap) {
  snap = s;
  const seenW = new Set<string>();
  for (const w of s.w) {
    seenW.add(w.h);
    let m = wizards.get(w.h);
    if (!m) {
      m = Object.assign(makeWizard(w.ho, w.h === myHandle), { tx: w.x, tz: w.z, tf: w.f, aura: makeAuraRing() });
      m.root.add(m.aura);
      m.root.position.set(w.x, 0, w.z);
      scene.add(m.root);
      wizards.set(w.h, m);
    }
    m.tx = w.x; m.tz = w.z; m.tf = w.f;
    const extra = (w.s.includes('M') ? '⚖️' : '') + (w.s.includes('E') ? '🪄' : '') + (w.s.includes('N') ? '🤖' : '');
    m.label.draw(`[${w.t}] ${w.n}`, wizardColor(w.ho), w.hp / w.m, w.say, extra);
    setAuraRing(m.aura, w.s, clock);
    m.shield.visible = w.s.includes('S');
    m.glow.intensity = w.s.includes('L') ? 30 : 0;
    m.root2.visible = w.s.includes('R');
    m.patronus.visible = w.s.includes('P');
    m.elder.visible = w.s.includes('E');
    m.body.rotation.z = w.s.includes('X') ? Math.PI / 2 : 0;
    m.body.position.y = w.s.includes('X') ? 0.3 : 0;
    (m.wandTip.material as THREE.MeshBasicMaterial).color.setHex(w.s.includes('D') ? 0x444444 : w.s.includes('L') ? 0xfff2a0 : 0xffffff);
  }
  for (const [h, m] of wizards) if (!seenW.has(h)) { scene.remove(m.root); wizards.delete(h); }

  const seenC = new Set<string>();
  for (const c of s.c) {
    seenC.add(c.i);
    let m = creatures.get(c.i);
    if (!m) {
      m = Object.assign(makeCreature(c.k), { tx: c.x, tz: c.z, tf: c.f, aura: makeAuraRing() });
      m.root.add(m.aura);
      m.root.position.set(c.x, 0, c.z);
      scene.add(m.root);
      creatures.set(c.i, m);
    }
    m.tx = c.x; m.tz = c.z; m.tf = c.f;
    const mine = c.o === myHandle;
    const benign = c.k === 'unicorn' || c.k === 'phoenix';
    m.label.draw(c.o ? `${creatureName(c.k, NAMES[c.k])} (${mine ? L('你的', 'yours') : L('召唤物', 'conjured')})` : creatureName(c.k, NAMES[c.k]), mine ? '#b8ffb8' : c.o ? '#ffd9a0' : benign ? '#ffffff' : '#ffdddd', c.hp / c.m);
    setAuraRing(m.aura, c.s + (mine ? 'g' : ''), clock);
  }
  for (const [i, m] of creatures) if (!seenC.has(i)) { puff(m.root.position.x, m.root.position.z, 0x333333); scene.remove(m.root); creatures.delete(i); }

  const seenP = new Set<string>();
  for (const p of s.p) {
    seenP.add(p.i);
    let b = bolts.get(p.i);
    if (!b) { b = makeBolt(p.k, p.e); b.position.set(p.x, 1.3, p.z); b.userData.color = p.k === 'disarm' ? 0xff3b3b : p.k === 'root' ? 0x9fe8ff : ELEMENT_COLORS[p.e]; scene.add(b); bolts.set(p.i, b); }
    b.tx = p.x; b.tz = p.z;
  }
  for (const [i, b] of bolts) if (!seenP.has(i)) { scene.remove(b); bolts.delete(i); }

  for (const f of s.fx) spawnFx(f);
  elderGlint.visible = !!s.elder;
  if (s.elder) elderGlint.position.set(s.elder.x, 2.6 + heightAt(s.elder.x, s.elder.z), s.elder.z);
}

const NAMES: Record<CreatureKind, string> = { pixie: 'Cornish Pixie', snare: "Devil's Snare", spider: 'Acromantula', troll: 'Mountain Troll', dementor: 'Dementor', inferius: 'Inferius', unicorn: 'Unicorn', phoenix: 'Fawkes', serpent: 'Serpent', birds: 'Birds' };

// ------------------------------------------------------------------ effects
function addEffect(obj: THREE.Object3D, life: number, update: (k: number, o: THREE.Object3D) => void) {
  scene.add(obj);
  effects.push({ obj, t: 0, life, update });
}
function ring(x: number, z: number, color: number, r0: number, r1: number, life: number, y = 0.2) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + heightAt(x, z), z);
  addEffect(m, life, (k, o) => { const s = r0 + (r1 - r0) * k; o.scale.set(s, s, s); ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - k; });
}
function puff(x: number, z: number, color: number, size = 1.5) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
  m.position.set(x, 1.2 + heightAt(x, z), z);
  addEffect(m, 0.5, (k, o) => { o.scale.setScalar(1 + k * size * 2); ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k); });
}
function column(x: number, z: number, color: number, life = 1.2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 8, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.set(x, 4 + heightAt(x, z), z);
  addEffect(m, life, (k, o) => { ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k); o.scale.x = o.scale.z = 1 + k; });
}
function floatText(x: number, z: number, text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 44px Georgia'; g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 64, 48);
  g.fillStyle = color; g.fillText(text, 64, 48);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.6, 0.8, 1);
  sp.renderOrder = 20;
  const jx = (Math.random() - 0.5) * 0.8;
  const gy = heightAt(x, z);
  sp.position.set(x + jx, 2.4 + gy, z);
  addEffect(sp, 1.1, (k, o) => { o.position.y = gy + 2.4 + k * 1.8; (o as THREE.Sprite).material.opacity = 1 - k * k; if (k >= 1) tex.dispose(); });
}

/** A jagged bolt through the given x,z points (at chest height, or from the sky when `sky` > 0). */
function lightning(pts: number[], color: number, sky = 0) {
  const v: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) v.push(new THREE.Vector3(pts[i], heightAt(pts[i], pts[i + 1]) + (i === 0 && sky ? sky : 1.3), pts[i + 1]));
  const jag: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < v.length; i++) for (let k = 0; k < 6; k++) jag.push(v[i].clone().lerp(v[i + 1], k / 6).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6)));
  jag.push(v[v.length - 1]);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(jag), new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), transparent: true }));
  addEffect(line, 0.35, (k, o) => { ((o as THREE.Line).material as THREE.LineBasicMaterial).opacity = 1 - k; });
}

function spawnFx(f: Fx) {
  const col = f.e ? ELEMENT_COLORS[f.e] : 0xffffff;
  switch (f.k) {
    case 'hit': puff(f.x, f.z, col, 1); if (f.n) floatText(f.x, f.z, String(f.n), f.h === myHandle ? '#ff6b6b' : '#' + col.toString(16).padStart(6, '0')); break;
    case 'nova': ring(f.x, f.z, col, 0.5, f.r ?? 5, 0.6); ring(f.x, f.z, 0xffffff, 0.2, (f.r ?? 5) * 0.7, 0.4, 1); break;
    case 'heal': column(f.x, f.z, 0x6cff8a, 0.9); break;
    case 'shield': ring(f.x, f.z, 0x9fd3ff, 1.5, 1.2, 0.5, 1); break;
    case 'apparate': puff(f.x, f.z, 0x111111, 2); break;
    case 'patronus': ring(f.x, f.z, 0xdfefff, 1, f.r ?? 10, 1.2, 0.5); break;
    case 'fizzle': puff(f.x, f.z, 0x777777, 0.4); break;
    case 'stun': ring(f.x, f.z, 0xff4040, 0.5, 3, 0.6, 0.3); break;
    case 'levelup': column(f.x, f.z, 0xffd65c, 2); ring(f.x, f.z, 0xffd65c, 0.5, 6, 1.2); break;
    case 'willow': ring(f.x, f.z, 0x6b4a2b, 2, 8, 0.4, 1.5); break;
    case 'cast': break;
    case 'azkaban': column(f.x, f.z, 0x000000, 1.5); break;
    case 'chain': if (f.pts) lightning(f.pts, col); break;
    case 'storm': ring(f.x, f.z, 0x9fb8ff, f.r ?? 6, (f.r ?? 6) * 0.2, 1.5, 0.3); column(f.x, f.z, 0x5a6aff, 1.5); break;
    case 'stormhit': ring(f.x, f.z, col, 0.5, f.r ?? 6, 0.7); for (let i = 0; i < 4; i++) lightning([f.x + (Math.random() - 0.5) * (f.r ?? 6), f.z + (Math.random() - 0.5) * (f.r ?? 6), f.x, f.z], col, 40); break;
    case 'reveal': ring(f.x, f.z, 0xffe9a0, 0.3, 3, 0.8, 1.2); break;
    case 'seal': column(f.x, f.z, 0xd4af37, 2); ring(f.x, f.z, 0xd4af37, 0.5, 5, 1.5); break;
  }
  if (f.k === 'cast' && f.h) {
    const w = wizards.get(f.h);
    if (w) puff(w.root.position.x + Math.sin(w.tf) * 0.6, w.root.position.z - Math.cos(w.tf) * 0.6, 0xffffff, 0.3);
  }
}

// ------------------------------------------------------------------ HUD
function feed(e: Ev, fresh: boolean) {
  const d = document.createElement('div');
  d.className = `${e.type} ${e.to ? 'private' : ''}`;
  const text = lang === 'zh' && e.zh ? e.zh : e.text;
  d.textContent = text;
  $('#feed').append(d);
  while ($('#feed').children.length > 14) $('#feed').firstChild!.remove();
  if (fresh && (e.type === 'decree' || e.type === 'term' || (e.type === 'egg' && e.to) || e.type === 'achievement' && e.text.includes(me?.name ?? '\u0000'))) banner(text);
}
let bannerT = 0;
function banner(text: string) {
  const b = $('#banner');
  b.textContent = text;
  b.hidden = false;
  bannerT = 8;
}
function toast(text: string) { feed({ id: 0, type: 'system', text, to: 'me' }, false); }

function hud() {
  if (!me || !snap) return;
  const has = (k: string) => me!.ui.includes(k);
  // top-left: always your title and name; Revelio reveals your own measure
  $('#me').innerHTML = `<div class="house" style="color:${wizardColor(me.house)}"><span class="title">${esc(L(me.title.zh, `${me.title.zh} ${me.title.en}`))}</span> ${esc(me.name)} · ${houseName(me.house)}</div>` +
    (has('revelio')
      ? L(`<div>${me.year} 年级 · ⭐ 声望 ${me.reputation} · 🪙 ${me.galleons} 加隆 · 📕 封印 ${me.seals}/4</div>`, `<div>Year ${me.year} · ⭐ ${me.reputation} reputation · 🪙 ${me.galleons} Galleons · 📕 ${me.seals}/4 seals</div>`) + (me.title.next ? `<div class="hint">${L('下一级', 'Next')}: ${esc(me.title.next.zh)} ${esc(me.title.next.en)} — ${esc(me.title.next.how)}</div>` : '')
      : L('<div class="locked">✨ 施放 <b>原形立现 Revelio</b> 才能看清自己的斤两</div>', '<div class="locked">✨ Cast <b>Revelio</b> to see your own measure</div>')) +
    (me.decree ? L('<div style="color:#9fd3ff">⚖️ 魔法部长 —— 你手握一道未颁布的法令（MCP: decree）</div>', '<div style="color:#9fd3ff">⚖️ Minister for Magic — you hold an unspent decree (MCP: decree)</div>') : '');
  // top-right: Tempus
  const h = snap.hour;
  const hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
  $('#clock').innerHTML = has('tempus')
    ? `${snap.night ? '🌙' : '☀️'} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${L(({ clear: '晴', rain: '雨', snow: '雪', fog: '雾' } as Record<string, string>)[snap.weather] ?? snap.weather, snap.weather)}<br/>${L(`第 ${snap.term.n} 学期 · 剩余 ${fmtT(snap.term.left)}`, `Term ${snap.term.n} ends in ${fmtT(snap.term.left)}`)}<br/><i style="opacity:.8">"${esc(me.proclamation)}"</i>`
    : `<span class="locked">${L('🕰️ 施放 <b>时间显现 Tempus</b> 才知道现在几点', '🕰️ Cast <b>Tempus</b> to know the hour')}</span><br/><i style="opacity:.8">"${esc(me.proclamation)}"</i>`;
  // bottom-right: Homenum Revelio
  const pres = $('#presence');
  if (has('homenum')) {
    const my = wizards.get(myHandle);
    const near = snap.w.filter((x) => x.h !== myHandle && my && Math.hypot(x.x - my.root.position.x, x.z - my.root.position.z) < 60)
      .map((x) => ({ x, d: Math.hypot(x.x - my!.root.position.x, x.z - my!.root.position.z), a: Math.atan2(x.x - my!.root.position.x, -(x.z - my!.root.position.z)) }))
      .sort((a, b) => a.d - b.d).slice(0, 6);
    pres.innerHTML = `<b>${L('人形显身', 'Homenum Revelio')}</b>` + (near.length ? near.map(({ x, d, a }) => `<div><span class="arrow" style="transform:rotate(${a + camYaw}rad)">↑</span> <span style="color:${wizardColor(x.ho)}">[${esc(x.t)}] ${esc(x.n)}</span> ${Math.round(d)}m${x.s.includes('X') ? ' 💫' : ''}</div>`).join('') : `<div class="hint">${L('60 米内没有人。', 'No one within 60m.')}</div>`);
  } else pres.innerHTML = L('<span class="locked">👁️ 三年级：施放 <b>人形显身</b> 感知身边的人</span>', '<span class="locked">👁️ Year 3: cast <b>Homenum Revelio</b> to sense who is near</span>');
  bar('.hp', me.hp, me.maxHp, `${me.hp} / ${me.maxHp}`);
  bar('.mana', me.mana, me.maxMana, `${me.mana} / ${me.maxMana} ${L('法力', 'mana')}`);
  bar('.xp', me.xpNext ? me.xp : 1, me.xpNext ?? 1, '');
  const hb = $('#hotbar');
  if (hb.children.length !== 6) hb.innerHTML = Array.from({ length: 6 }, () => '<div><span></span><b></b><i></i></div>').join('');
  me.hotbar.forEach((s, i) => {
    const el = hb.children[i] as HTMLElement;
    el.classList.toggle('sel', i === ctl.selected);
    el.dataset.kind = s?.kind ?? '';
    (el.children[0] as HTMLElement).textContent = s ? spellName(s.name) : '—';
    (el.children[1] as HTMLElement).textContent = String(i + 1);
    (el.children[2] as HTMLElement).style.height = s && s.cd > 0 ? `${Math.min(100, s.cd * 40)}%` : '0';
    el.onclick = () => ctl.castSlot(i);
  });
  ctl.hud();
  const ov = $('#overlay');
  if (me.jailed) { ov.hidden = false; ov.innerHTML = L(`⛓️ 阿兹卡班<br/><small>摄魂怪会在 ${me.jailed.toFixed(0)} 秒后放你出去</small>`, `⛓️ Azkaban<br/><small>The Dementors will release you in ${me.jailed.toFixed(0)}s</small>`); }
  else if (me.stunned) { ov.hidden = false; ov.innerHTML = L(`💫 被击晕了<br/><small>庞弗雷夫人正在给你治疗…… ${me.stunned.toFixed(1)} 秒</small>`, `💫 Stunned<br/><small>Madam Pomfrey is patching you up… ${me.stunned.toFixed(1)}s</small>`); }
  else ov.hidden = true;
  drawMinimap();
  drawMarauder();
}
const bar = (sel: string, v: number, max: number, text: string) => {
  const b = $(`#bars ${sel}`);
  (b.children[0] as HTMLElement).style.width = `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%`;
  (b.children[1] as HTMLElement).textContent = text;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function drawMinimap() {
  const c = $<HTMLCanvasElement>('#minimap');
  const g = c.getContext('2d')!;
  const my = wizards.get(myHandle);
  if (!my || !snap) return;
  if (!me?.ui.includes('point-me')) {
    // bottom-left stays dark until the Four-Point Spell
    g.clearRect(0, 0, 220, 220);
    g.fillStyle = 'rgba(10,10,20,.7)'; g.beginPath(); g.arc(110, 110, 108, 0, 7); g.fill();
    g.fillStyle = '#d4af37'; g.font = 'italic 15px Georgia'; g.textAlign = 'center';
    g.fillText(L('二年级：施放', 'Year 2: cast'), 110, 100); g.fillText(L('给我指路', 'Point Me'), 110, 122); g.textAlign = 'left';
    return;
  }
  const cx = my.root.position.x, cz = my.root.position.z, S = 1.1;
  g.clearRect(0, 0, 220, 220);
  g.save();
  g.beginPath(); g.arc(110, 110, 108, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(40,60,30,.6)'; g.fillRect(0, 0, 220, 220);
  const P = (x: number, z: number) => [110 + (x - cx) * S, 110 + (z - cz) * S] as const;
  for (const o of OBSTACLES) {
    if (o.style === 'tree') continue;
    g.fillStyle = o.style === 'water' ? '#1d3f5c' : '#9a9a9a';
    if (o.kind === 'box') { const [a, b] = P(o.x0, o.z0); g.fillRect(a, b, (o.x1 - o.x0) * S, (o.z1 - o.z0) * S); }
    else { const [a, b] = P(o.x, o.z); g.beginPath(); g.arc(a, b, Math.max(1, o.r * S), 0, 7); g.fill(); }
  }
  for (const c2 of snap.c) { const [a, b] = P(c2.x, c2.z); g.fillStyle = '#ff5050'; g.fillRect(a - 1.5, b - 1.5, 3, 3); }
  for (const w of snap.w) { const [a, b] = P(w.x, w.z); g.fillStyle = w.h === myHandle ? '#ffffff' : '#' + HOUSE_COLORS[w.ho].toString(16).padStart(6, '0'); g.beginPath(); g.arc(a, b, w.h === myHandle ? 4 : 3, 0, 7); g.fill(); }
  g.fillStyle = '#fff'; g.font = '10px Georgia';
  for (const l of LANDMARKS) { const [a, b] = P(l.x, l.z); if (a > 0 && a < 220 && b > 0 && b < 220) g.fillText(l.name, a + 3, b); }
  g.restore();
}

let mapShown = false;
function drawMarauder() {
  const el = $('#map');
  const active = !!me?.map;
  if (active && !mapShown) { el.hidden = false; mapShown = true; }
  if (!active) { el.hidden = true; mapShown = false; return; }
  const c = el.querySelector('canvas')!;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f1e3c0'; g.fillRect(0, 0, 640, 640);
  const P = (x: number, z: number) => [320 + x * 1.3, 320 + z * 1.3] as const;
  g.strokeStyle = '#5b3a1a'; g.lineWidth = 1;
  for (const o of OBSTACLES) {
    if (o.style === 'tree') continue;
    if (o.kind === 'box') { const [a, b] = P(o.x0, o.z0); g.strokeRect(a, b, (o.x1 - o.x0) * 1.3, (o.z1 - o.z0) * 1.3); }
    else { const [a, b] = P(o.x, o.z); g.beginPath(); g.arc(a, b, o.r * 1.3, 0, 7); g.stroke(); }
  }
  g.fillStyle = '#2b1d0e'; g.font = 'italic 13px Georgia';
  for (const w of me!.map!) { const [a, b] = P(w.x, w.z); g.fillText('👣 ' + w.name, a - 10, b); }
  el.querySelector('ul')!.innerHTML = me!.map!.map((w) => `<li><b>${esc(w.name)}</b> (${houseName(w.house)}, Y${w.year}) — ${esc(placeName(w.where))} — <code>${w.registry}</code></li>`).join('') +
    `<li style="list-style:none;margin-top:8px"><i>${L('说「恶作剧完毕」（Mischief managed）擦掉地图。', 'Say "Mischief managed" to wipe the map.')}</i></li>`;
}

async function showBoard() {
  const b = $('#board');
  if (!b.hidden) { b.hidden = true; return; }
  const lb = await (await fetch('/api/leaderboard')).json();
  b.innerHTML = `<h2>${L(`第 ${lb.term.n} 学期 —— 剩余 ${fmtT(lb.term.secondsLeft)}`, `Term ${lb.term.n} — ${fmtT(lb.term.secondsLeft)} left`)}</h2>
    <p><b>${L('学院分', 'House points')}:</b> ${Object.entries(lb.housePoints).map(([h, p]) => `${houseName(h)} ${p}`).join(' · ')}</p>
    <p><b>${L('魔法部长', 'Minister for Magic')}:</b> ${lb.minister ? esc(lb.minister.name) + (lb.minister.decreeUnspent ? L('（法令未颁布）', ' (decree unspent)') : L('（法令已颁布）', ' (decree spent)')) : '—'}<br/><small>${L('每学期结束时，声望最高（至少 100）的玩家成为魔法部长，可以颁布一道法令改写世界规则。', esc(lb.ministerRule))}</small></p>
    <table><tr><th>#</th><th>${L('巫师', 'Wizard')}</th><th>${L('称号', 'Title')}</th><th>${L('学院', 'House')}</th><th>${L('年级', 'Year')}</th><th>${L('声望', 'Reputation')}</th></tr>
    ${lb.top.map((w: any) => `<tr><td>${w.rank}</td><td>${esc(w.name)}${w.npc ? ' 🤖' : ''}${w.online ? ' •' : ''}</td><td>${esc(w.title ?? '')}</td><td>${houseName(w.house)}</td><td>${w.year}</td><td>${w.reputation}</td></tr>`).join('')}</table>
    ${lb.loopholeFirstFoundBy ? `<p>🎉 ${L('第一个发现韦斯莱漏洞的人', 'First to find the Weasley Loophole')}: <b>${esc(lb.loopholeFirstFoundBy)}</b></p>` : ''}`;
  b.hidden = false;
}

function menuInfo(mcpUrl: string) {
  $('#menu').innerHTML = `<h2>${L('猫头鹰邮递', 'Owl Post')}</h2>
    <p>${L('语言 Language：', 'Language 语言: ')}<button id="lang-zh">中文</button> <button id="lang-en">English</button></p>
    <p>${L('你的 Agent 可以操控这个巫师、用代码铸造咒语和魔法道具。把它连到 MCP 服务器：', 'Your agent can play this wizard, forge spells as code, and forge items. Connect it to the MCP server:')}</p>
    <pre>claude mcp add --transport http hogwarts ${mcpUrl} \\\n  --header "Authorization: Bearer ${token}"</pre>
    <p>${L('或任意 MCP 客户端', 'Or any MCP client')}: <code>${mcpUrl}</code> + header <code>Authorization: Bearer &lt;token&gt;</code>.<br/>${L('你的秘密猫头鹰邮递密钥（token）：', 'Your secret Owl Post key (token):')}</p>
    <pre>${token}</pre>
    <p>${L('然后对你的 Agent 说：<i>「读一下 grimoire，写一个专门收割残血敌人的咒语，放到 6 号快捷栏。」</i>', 'Then ask your agent: <i>"Read the grimoire, then invent a spell that finishes off wounded enemies and put it on hotbar 6."</i>')}</p>
    <p><button id="logout">${L('离开霍格沃茨（忘记密钥）', 'Leave Hogwarts (forget key)')}</button> <button id="close-menu">${L('回到城堡', 'Back to the castle')}</button></p>`;
  $('#lang-zh').onclick = () => setLang('zh');
  $('#lang-en').onclick = () => setLang('en');
  $('#logout').onclick = () => { localStorage.removeItem(LS); location.reload(); };
  $('#close-menu').onclick = () => { $('#menu').hidden = true; };
}

// ------------------------------------------------------------------ spellbook (in-browser Runes editor)
type ArmorySpell = { id: string; name: string; incantation: string; builtin: boolean; minYear: number; nodes: number; effects: string[]; source: string };
let bookSpells: ArmorySpell[] = [];
let bookSel: string | null = null;
function toggleBook() {
  const b = $('#book');
  b.hidden = !b.hidden;
  if (!b.hidden) { send({ t: 'book' }); ctl.notify('book'); }
}
function bookOut(text: string, cls = '') { const o = $('#sp-out'); o.textContent = text; o.className = cls; }
function renderBook(armory: { spells: ArmorySpell[]; hotbar: { slot: number; spell: string | null }[] }, grimoireText: string) {
  bookSpells = armory.spells;
  $('#grimoire').textContent = grimoireText;
  const slotOf = (name: string) => armory.hotbar.find((h) => h.spell === name)?.slot;
  $('#book-list').innerHTML = `<li data-id="">＋ <b>${L('新咒语', 'New spell')}</b><small>${L('自己写一个', 'write your own')}</small></li>` + bookSpells.map((s) =>
    `<li data-id="${s.id}" class="${s.id === bookSel ? 'sel' : ''}">${s.builtin ? '📖' : '✒️'} <b>${esc(s.builtin ? L(`${spellName(s.name)} ${s.name}`, s.name) : s.name)}</b>${slotOf(s.name) ? ` <i>[${slotOf(s.name)}]</i>` : ''}<small>y${s.minYear} · ${s.nodes} nodes · ${esc(s.effects.join(', ') || '—')}</small></li>`).join('');
  $('#book-list').querySelectorAll('li').forEach((li) => { (li as HTMLElement).onclick = () => loadSpell((li as HTMLElement).dataset.id || null); });
}
function loadSpell(id: string | null) {
  bookSel = id;
  const s = bookSpells.find((x) => x.id === id);
  $<HTMLInputElement>('#sp-name').value = s ? (s.builtin ? `${s.name} II` : s.name) : '';
  $<HTMLInputElement>('#sp-inc').value = s && !s.builtin ? s.incantation : '';
  $<HTMLTextAreaElement>('#sp-src').value = s?.source ?? '';
  $('#book-list').querySelectorAll('li').forEach((li) => li.classList.toggle('sel', (li as HTMLElement).dataset.id === (id ?? '')));
  bookOut(s?.builtin ? L(`${spellName(s.name)}（${s.name}）是标准课程的一部分。改一改，用新名字铸造，它就是你的了。`, `${s.name} is part of the standard curriculum. Edit it and forge it under a new name to make it yours.`) : s ? L('修改后点「铸造」来改良它（同名会覆盖）。', 'Edit and Forge to rework it (same name replaces it).') : L('写一段 Runes 程序。下面的魔法书里有你能用的每一个词。', 'Write a Runes program. Open the Grimoire below for every word you can use.'));
}
function showSim(r: { ok: boolean; mana: number; effects: string[]; notes: string[]; gas: number; error?: string; nodes?: number }) {
  bookOut(r.ok
    ? `✓ ${L(`会消耗 ${r.mana} 法力`, `Would cast for ${r.mana} mana`)} (${r.gas} gas${r.nodes ? `, ${r.nodes} nodes` : ''}).\n${r.effects.map((e) => '  • ' + e).join('\n') || L('  （无效果）', '  (no effects)')}${r.notes.length ? '\n' + r.notes.map((n) => '  ! ' + n).join('\n') : ''}`
    : `✗ ${L('失效', 'Fizzles')}: ${tr(r.error ?? '')}${r.gas ? ` (after ${r.gas} gas)` : ''}`, r.ok ? 'good' : 'bad');
}
$('#sp-sim').onclick = () => send({ t: 'simulate', source: $<HTMLTextAreaElement>('#sp-src').value, x: ctl.aim.x, z: ctl.aim.z, target: ctl.targetKey() ?? undefined });
$('#sp-forge').onclick = () => {
  const slot = Number($<HTMLSelectElement>('#sp-slot').value) || undefined;
  send({ t: 'forge', name: $<HTMLInputElement>('#sp-name').value, incantation: $<HTMLInputElement>('#sp-inc').value || undefined, source: $<HTMLTextAreaElement>('#sp-src').value, slot });
};
$('#sp-cast').onclick = () => { if (bookSel) ctl.castKey(bookSel); };

// ------------------------------------------------------------------ the Restricted Section (seals)
let sealTier = 1;
const sealState = (st: string) => lang !== 'zh' ? st : st === 'broken' ? '已破解' : st === 'open to you' ? '向你敞开' : st.startsWith('needs year') ? `需要 ${st.slice(-1)} 年级` : '先破解上一道封印';
function toggleSeals() { const s = $('#seals'); s.hidden = !s.hidden; if (!s.hidden) send({ t: 'seals' }); }
type SealInfo = { tier: number; name: string; zh: string; rewardZh: string; requiresYear: number; inputWords: number; reward: string; state: string; pages: { page: number; where: string; collected: boolean }[] };
function renderSeals(section: { progress: string; seals: SealInfo[]; codex: string[] }, current: { tier: number; name: string; zh: string; inputWords: number; pagesCollected: string; runes: string; broken: boolean }) {
  sealTier = current.tier;
  $('#seal-list').innerHTML = section.seals.map((x) => `<div class="${x.state === 'broken' ? 'broken' : ''}"><b>${esc(L(x.zh, x.name))}</b><br/>${esc(sealState(x.state))} · ${L(`${x.requiresYear} 年级`, `year ${x.requiresYear}`)} · ${L(`${x.inputWords} 个字`, `${x.inputWords} word(s)`)}<br/><i>${esc(L(x.rewardZh, x.reward))}</i><br/>${x.pages.map((p) => `${p.collected ? '📜' : '▫️'} ${esc(placeName(p.where))}`).join('<br/>')}</div>`).join('');
  $('#seal-title').textContent = L(`${current.zh} —— 已收集 ${current.pagesCollected} 页${current.broken ? '（已破解）' : ''}`, `${current.name} — ${current.pagesCollected} pages${current.broken ? ' (broken)' : ''}`);
  $('#seal-runes').textContent = current.runes;
  $('#seal-codex').textContent = section.codex.join('\n');
}
$('#seal-read').onclick = () => send({ t: 'readpage', tier: sealTier });
$('#seal-break').onclick = () => send({ t: 'breakseal', tier: sealTier, words: $<HTMLInputElement>('#seal-words').value.split(/[\s,]+/).filter(Boolean) });

$('#sp-forget').onclick = () => { const n = $<HTMLInputElement>('#sp-name').value; if (n) send({ t: 'unlearn', spell: n }); };

// ------------------------------------------------------------------ input (targeting, smart casting, click-to-move, camera, help, onboarding: controls.ts)
function toggleMenu() {
  const m = $('#menu');
  m.hidden = !m.hidden;
  $('#board').hidden = true;
  if (!m.hidden) ctl.notify('menu');
}
const ctl = createControls({
  canvas, camera, scene, ground: world.ground, hoverRing: aimRing, wizards, creatures,
  snap: () => snap, me: () => me, myHandle: () => myHandle, send, toast,
  cam: {
    get yaw() { return camYaw; }, set yaw(v: number) { camYaw = v; },
    get pitch() { return camPitch; }, set pitch(v: number) { camPitch = v; },
    get dist() { return camDist; }, set dist(v: number) { camDist = v; },
  },
  panels: { book: toggleBook, menu: toggleMenu },
});
addEventListener('keydown', (e) => {
  const chat = $<HTMLInputElement>('#chat');
  if (document.activeElement === chat) {
    if (e.key === 'Enter') { if (chat.value.trim()) send({ t: 'chat', text: chat.value }); chat.value = ''; chat.blur(); }
    if (e.key === 'Escape') chat.blur();
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')) {
    if (e.key === 'Escape') (document.activeElement as HTMLElement).blur();
    return;
  }
  if (e.key === 'b' || e.key === 'B') { toggleBook(); return; }
  if (e.key === 'r' || e.key === 'R') { toggleSeals(); return; }
  if (e.key === 'l' || e.key === 'L') { showBoard(); return; }
  if (e.key === 'Enter') { chat.focus(); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    // close the topmost panel, then drop the target, then open the Owl Post
    if (!$('#book').hidden) { $('#book').hidden = true; return; }
    if (!$('#seals').hidden) { $('#seals').hidden = true; return; }
    if (ctl.helpOpen()) { ctl.toggleHelp(false); return; }
    if (!$('#board').hidden) { $('#board').hidden = true; return; }
    if (!$('#menu').hidden) { $('#menu').hidden = true; return; }
    if (ctl.clearTarget()) return;
    toggleMenu();
    return;
  }
  ctl.keydown(e);
});

// ------------------------------------------------------------------ frame
let prev = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  clock += dt;
  if (!perf.done && snap) {
    perf.frames++; perf.time += dt;
    if (perf.time > 3) {
      perf.done = true;
      if (perf.time / perf.frames > 0.045 && quality === 'high') { applyQuality('low'); toast('Graphics quality lowered for smoother play (add ?q=high to force).'); }
    }
  }
  const k = 1 - Math.exp(-dt * 12);
  for (const w of wizards.values()) {
    w.root.position.x += (w.tx - w.root.position.x) * k;
    w.root.position.z += (w.tz - w.root.position.z) * k;
    w.root.position.y = heightAt(w.root.position.x, w.root.position.z);
    w.body.rotation.y = -w.tf;
    if (w.patronus.visible) w.patronus.position.set(Math.cos(clock * 3) * 2, 1.5, Math.sin(clock * 3) * 2);
  }
  for (const c of creatures.values()) {
    c.root.position.x += (c.tx - c.root.position.x) * k;
    c.root.position.z += (c.tz - c.root.position.z) * k;
    c.root.position.y = heightAt(c.root.position.x, c.root.position.z);
    c.root.rotation.y = -c.tf;
    c.anim(clock);
  }
  for (const b of bolts.values()) {
    b.position.x += ((b.tx ?? b.position.x) - b.position.x) * Math.min(1, k * 2);
    b.position.z += ((b.tz ?? b.position.z) - b.position.z) * Math.min(1, k * 2);
    b.position.y = 1.3 + heightAt(b.position.x, b.position.z);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    e.update(Math.min(1, e.t / e.life), e.obj);
    if (e.t >= e.life) { scene.remove(e.obj); effects.splice(i, 1); }
  }
  elderGlint.rotation.y += dt * 2;
  elderGlint.position.y = 2.6 + heightAt(elderGlint.position.x, elderGlint.position.z) + Math.sin(clock * 2) * 0.2;

  // camera follows me
  const my = wizards.get(myHandle);
  if (my) {
    const t = my.root.position;
    camera.position.set(t.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist, 1.5 + Math.sin(camPitch) * camDist, t.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist);
    camera.position.y += t.y;
    camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 1.5);
    camera.lookAt(t.x, t.y + 1.8, t.z);
    weatherPts.position.set(t.x, 0, t.z);
  }

  // lighting, sky and decorations from the hour, the weather and whatever the last Minister decreed
  if (snap) {
    const look: Look = snap.look ?? DEFAULT_LOOK;
    R.update(snap.hour, snap.weather, look, my ? my.root.position : new THREE.Vector3());
    const night = 1 - R.day;
    for (const m of world.nightGlow) m.emissiveIntensity = (0.35 + 3.2 * night) * look.glow;
    decor.update(look, R.day, clock, dt);
    weatherPts.visible = snap.weather === 'rain' || snap.weather === 'snow';
    if (weatherPts.visible) {
      const pos = weatherPts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const fall = snap.weather === 'rain' ? 30 : 3;
      for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) - fall * dt; if (y < 0) y += 40; pos.setY(i, y); }
      pos.needsUpdate = true;
      (weatherPts.material as THREE.PointsMaterial).size = snap.weather === 'rain' ? 0.08 : 0.2;
    }
    world.tick(clock, dt, !snap.willowCalm && [...wizards.values()].some((w) => Math.hypot(w.root.position.x - 45, w.root.position.z) < 9), R.sunDir);
  }
  // spells light up their surroundings: the pool goes to the bolts nearest the camera
  const lit = [...bolts.values()]
    .map((b) => ({ x: b.position.x, z: b.position.z, color: (b.userData.color as number) ?? 0xffffff, d: b.position.distanceToSquared(camera.position) }))
    .sort((a, b) => a.d - b.d);
  R.setBoltLights(lit);

  ctl.update(dt);
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('#banner').hidden = true; }
  R.render();
}

setInterval(hud, 100);

// ------------------------------------------------------------------ boot
(async () => {
  applyStatic();
  token = await gate();
  $('#gate').hidden = true;
  $('#hud').hidden = false;
  connect();
  frame();
})();

