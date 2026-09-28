import * as THREE from 'three';
import { ELEMENT_COLORS, HOUSE_COLORS, type CreatureKind, type Element, type House } from '../src/shared/constants';
import { LANDMARKS, OBSTACLES } from '../src/shared/map';
import { createDecor, type Look } from './decor';
import { createFx } from './fx';
import { L, applyStatic, creatureName, houseName, lang, placeName, setLang, spellName, tr } from './i18n';
import { createRenderer } from './render';
import { buildWorld } from './scene';
import { heightAt } from './terrain';
import { makeAuraRing, makeBolt, makeCreature, makeWizard, setAuraRing, wizardColor, type WizardModel } from './models';
import { agentView, agoText, createControls, curseText, routeChat, tokenFromUrl, type AgentInfo, type AgentView, type HexState } from './controls';

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
  /** What is hexing you (World.hexState), or null. */
  hex?: HexState | null;
  /** Your agent (World.agentState, plus the MCP session count the server may add). */
  agent?: AgentInfo | null;
  agents?: { sessions?: number } | null;
}
/** Owl Post events carry `from` and `owl` (docs/AGENT_LINK.md §C.2). */
interface Ev { id: number; type: string; text: string; zh?: string; to?: string; t?: number; from?: 'player' | 'agent'; owl?: { id: number; options?: string[]; expiresAt?: number; re?: number } }
/** An item as World.armory lists it. */
interface TrunkItem {
  id: string; name: string; slot: string; mods: Record<string, number>; lore?: string; charm?: unknown; unique?: string; equipped: boolean;
  cursed?: boolean; anon?: boolean; bound?: boolean; boundSecondsLeft?: number; jinx?: { kind: string; mag: number; seconds: number } | null; forgedByName?: string;
}

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const LS = 'hogwarts.token';
const loadToken = () => { try { return localStorage.getItem(LS); } catch { return null; } };
const saveToken = (t: string) => { try { localStorage.setItem(LS, t); } catch { /* private mode: this tab still plays */ } };
const dropToken = () => { try { localStorage.removeItem(LS); } catch { /* ignore */ } };
/** The key goes in a header, never in a URL (URLs end up in logs and histories). */
const fetchMe = (t: string) => fetch('/api/me', { headers: { authorization: `Bearer ${t}` } }).catch(() => null);
/** Public facts about you from /api/me (never the key). */
let account: { registry: string; mcpUrl: string } = { registry: '', mcpUrl: '' };
async function readAccount(r: Response | null) {
  const j = await r?.json().catch(() => null);
  if (j) account = { registry: String(j.registry ?? ''), mcpUrl: String(j.mcpUrl ?? '') };
}

// ------------------------------------------------------------------ the gate (login)
async function gate(): Promise<string> {
  // a key handed over in the address (#k=… from an agent's enrol link, or the old ?token=…) is taken, then wiped from it
  const { token: fromUrl, clean } = tokenFromUrl(location.href);
  if (clean !== null) history.replaceState(null, '', clean);
  if (fromUrl) {
    const r = await fetchMe(fromUrl);
    if (r?.ok) { saveToken(fromUrl); await readAccount(r); return fromUrl; }
  }
  const saved = loadToken();
  if (saved) {
    const r = await fetchMe(saved);
    if (r?.ok) { await readAccount(r); return saved; }
    if (r && r.status === 401) dropToken();
  }
  return new Promise((done) => {
    const err = $('#gate-err');
    $('#gate-go').onclick = async () => {
      const r = await fetch('/api/enroll', { method: 'POST', body: JSON.stringify({ name: $<HTMLInputElement>('#gate-name').value, house: $<HTMLSelectElement>('#gate-house').value }) });
      const j = await r.json().catch(() => ({ error: 'The owl got lost. Try again.' }));
      if (!r.ok) { err.textContent = tr(j.error); return; }
      saveToken(j.token);
      await readAccount(await fetchMe(j.token));
      done(j.token);
    };
    $('#gate-login').onclick = async () => {
      const raw = $<HTMLInputElement>('#gate-token').value.trim();
      // a pasted play link works too
      const t = (/^https?:/.test(raw) ? tokenFromUrl(raw).token : null) ?? raw;
      const r = t ? await fetchMe(t) : null;
      if (!r?.ok) { err.textContent = L('猫头鹰不认识这把密钥。', 'The owl does not recognise that key.'); return; }
      saveToken(t);
      await readAccount(r);
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
let wsFails = 0;
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
    if (msg.t === 'welcome') {
      myHandle = msg.handle;
      if (Array.isArray(msg.owls)) for (const o of msg.owls) owlFromMsg(o);
      for (const e of msg.events ?? []) feed(e, false);
      menuInfo(msg.mcpUrl);
      if (msg.pair?.code) onPairCode(msg.pair);
    }
    else if (msg.t === 'snap') apply(msg.s);
    else if (msg.t === 'me') me = msg.s;
    else if (msg.t === 'event') feed(msg.e, true);
    else if (msg.t === 'cast') {
      ctl.onCast(msg.r);
      if (!msg.r.ok) toast(`✗ ${spellName(msg.r.spell)}：${tr(msg.r.error)}`);
      else if (msg.r.notes?.length) toast(msg.r.notes.join(' · '));
      if (!$('#trunk').hidden) send({ t: 'book' }); // Finite Incantatem / Revelio change what the trunk shows
    }
    else if (msg.t === 'book') { ctl.onArmory(msg.armory.spells); renderBook(msg.armory, msg.grimoire); onArmory(msg.armory); }
    else if (msg.t === 'paircode') onPairCode(msg.r ?? msg);
    else if (msg.t === 'token') onToken(String(msg.token ?? ''));
    else if (msg.t === 'owls' && Array.isArray(msg.owls)) { for (const o of msg.owls) owlFromMsg(o); renderOwl(); }
    else if (msg.t === 'seals') { ctl.onSeals(msg.section); renderSeals(msg.section, msg.current); }
    else if (msg.t === 'goto') ctl.onGoto(msg.goal);
    else if (msg.t === 'sealmsg') { const r = msg.r; toast(r.runes ? L(`📜 第 ${r.tier} 道封印的第 ${r.page}/${r.of} 页已抄进你的笔记。`, `📜 Page ${r.page}/${r.of} of seal ${r.tier} copied into your notes.`) : r.opened ? L(`📕 封印打开了！`, `📕 The seal opens! ${r.reward}`) : `✗ ${L('ALGIZ 没有出现。封印纹丝不动，还反咬了你一口（-15 生命）。', r.message)}`); }
    else if (msg.t === 'sim') showSim(msg.r);
    else if (msg.t === 'forged') { bookOut(`✓ ${L('已铸造', 'Forged')} ${msg.name}.${msg.notes.length ? '\n' + msg.notes.join('\n') : ''}`, 'good'); }
    else if (msg.t === 'err') {
      ctl.onError();
      const text = `✗ ${tr(String(msg.error ?? ''))}`;
      if (!$('#book').hidden) bookOut(text, 'bad');
      else if (onOwlError(text) || onTrunkError(text) || onMenuError(text)) { /* shown in the open panel */ }
      else toast(text);
    }
  };
  let opened = false;
  ws.onopen = () => { opened = true; wsFails = 0; };
  ws.onclose = () => {
    // a key that stopped working (changed elsewhere) never reconnects: back to the gate instead of retrying forever
    if (!opened && ++wsFails >= 3) void fetchMe(token).then((r) => { if (r?.status === 401) { dropToken(); location.reload(); } });
    setTimeout(connect, 1500);
  };
}
const send = (o: unknown) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };

function apply(s: Snap) {
  snap = s;
  const seenW = new Set<string>();
  for (const w of s.w) {
    seenW.add(w.h);
    let m = wizards.get(w.h);
    if (!m) {
      m = Object.assign(makeWizard(w.ho, w.h === myHandle, w.h), { tx: w.x, tz: w.z, tf: w.f, aura: makeAuraRing() });
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
  for (const [i, m] of creatures) if (!seenC.has(i)) {
    puff(m.root.position.x, m.root.position.z, 0x333333);
    particles.puff(m.root.position.x, m.root.position.y + 1, m.root.position.z, { count: 14, color: 0x2a282c, speed: 2, up: 0.8, size: 1, life: 1.4, drag: 2.5, grow: 2.5, radius: 0.6 });
    scene.remove(m.root); creatures.delete(i);
  }

  const seenP = new Set<string>();
  for (const p of s.p) {
    seenP.add(p.i);
    let b = bolts.get(p.i);
    if (!b) { b = makeBolt(p.k, p.e); b.position.set(p.x, 1.3, p.z); b.userData.color = p.k === 'disarm' ? 0xff3b3b : p.k === 'root' ? 0x9fe8ff : ELEMENT_COLORS[p.e]; scene.add(b); bolts.set(p.i, b); }
    b.tx = p.x; b.tz = p.z;
  }
  for (const [i, b] of bolts) if (!seenP.has(i)) {
    particles.burst(b.position.x, b.position.y, b.position.z, { count: 14, color: b.userData.color ?? 0xffffff, intensity: 4, whiten: 0.5, speed: 3.5, size: 0.18, life: 0.4, gravity: 4, drag: 2.5 });
    particles.forget(b);
    scene.remove(b); bolts.delete(i);
  }

  for (const f of s.fx) spawnFx(f);
  elderGlint.visible = !!s.elder;
  if (s.elder) elderGlint.position.set(s.elder.x, 2.6 + heightAt(s.elder.x, s.elder.z), s.elder.z);
}

const NAMES: Record<CreatureKind, string> = { pixie: 'Cornish Pixie', snare: "Devil's Snare", spider: 'Acromantula', troll: 'Mountain Troll', dementor: 'Dementor', inferius: 'Inferius', unicorn: 'Unicorn', phoenix: 'Fawkes', serpent: 'Serpent', birds: 'Birds' };

// ------------------------------------------------------------------ effects
const particles = createFx(scene, world.chimneys);
const tmpTip = new THREE.Vector3();
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
/** A pillar of light that fades out upward (alpha gradient), widening as it dies. */
let columnFade: THREE.Texture | null = null;
function column(x: number, z: number, color: number, life = 1.2) {
  if (!columnFade) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgb(0,0,0)'); gr.addColorStop(0.55, 'rgb(40,40,40)'); gr.addColorStop(0.9, 'rgb(200,200,200)'); gr.addColorStop(1, 'rgb(255,255,255)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
    columnFade = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 8, 20, 1, true), new THREE.MeshBasicMaterial({ color, alphaMap: columnFade, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.set(x, 4 + heightAt(x, z), z);
  addEffect(m, life, (k, o) => { ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.28 * (1 - k) * Math.min(1, k * 8); o.scale.x = o.scale.z = 1 + k * 0.6; });
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
  const gy = heightAt(f.x, f.z);
  const P = particles;
  switch (f.k) {
    case 'hit': P.sparks(f.x, gy + 1.2, f.z, col, 16 + Math.min(40, (f.n ?? 4) * 2)); if (f.n) floatText(f.x, f.z, String(f.n), f.h === myHandle ? '#ff6b6b' : '#' + col.toString(16).padStart(6, '0')); break;
    case 'nova': ring(f.x, f.z, col, 0.5, f.r ?? 5, 0.6); ring(f.x, f.z, 0xffffff, 0.2, (f.r ?? 5) * 0.7, 0.4, 1); P.shockwave(f.x, gy, f.z, f.r ?? 5, col); break;
    case 'heal': column(f.x, f.z, 0x6cff8a, 0.9); P.motes(f.x, gy, f.z, 0x6cff8a); break;
    case 'shield': ring(f.x, f.z, 0x9fd3ff, 1.5, 1.2, 0.5, 1); P.burst(f.x, gy + 1.05, f.z, { count: 40, color: 0x9fd3ff, intensity: 3, whiten: 0.4, radius: 1.2, speed: 0.6, size: 0.14, life: 0.8, drag: 1.5 }); break;
    case 'apparate':
      puff(f.x, f.z, 0x111111, 2);
      P.puff(f.x, gy + 1, f.z, { count: 22, color: 0x1c1a20, speed: 3.2, size: 1.3, life: 1.3, drag: 3, grow: 2.6, radius: 0.5 });
      P.burst(f.x, gy + 1, f.z, { count: 24, color: 0xffffff, intensity: 3, speed: 7, size: 0.1, life: 0.3, drag: 4 });
      break;
    case 'patronus': ring(f.x, f.z, 0xdfefff, 1, f.r ?? 10, 1.2, 0.5); P.burst(f.x, gy + 1.3, f.z, { count: 110, color: 0xdfefff, intensity: 3, whiten: 0.6, speed: (f.r ?? 10) * 1.6, speedJitter: 0.3, size: 0.22, life: 1.2, drag: 2, gravity: -0.4 }); break;
    case 'fizzle': puff(f.x, f.z, 0x777777, 0.4); P.puff(f.x, gy + 1.4, f.z, { count: 6, color: 0x77777a, speed: 0.6, up: 0.6, size: 0.5, life: 0.9, grow: 2.5, drag: 1 }); break;
    case 'stun': ring(f.x, f.z, 0xff4040, 0.5, 3, 0.6, 0.3); P.burst(f.x, gy + 1.6, f.z, { count: 30, color: 0xff4a4a, intensity: 4, whiten: 0.3, speed: 3, up: 2.5, size: 0.18, life: 0.8, gravity: 5, drag: 1.5 }); break;
    case 'levelup': column(f.x, f.z, 0xffd65c, 2); ring(f.x, f.z, 0xffd65c, 0.5, 6, 1.2); P.fountain(f.x, gy, f.z, 0xffd65c); break;
    case 'willow': ring(f.x, f.z, 0x6b4a2b, 2, 8, 0.4, 1.5); P.puff(f.x, gy + 1.5, f.z, { count: 26, color: 0x6b5a3b, speed: 6, size: 0.8, life: 1.2, drag: 2.5, grow: 2, gravity: 2, radius: 1 }); break;
    case 'cast': break;
    case 'azkaban': column(f.x, f.z, 0x000000, 1.5); P.puff(f.x, gy + 0.5, f.z, { count: 40, color: 0x101014, dir: new THREE.Vector3(0, 1, 0), cone: 0.35, speed: 5, size: 1.4, life: 2, drag: 1, grow: 3, radius: 0.8 }); break;
    case 'chain':
      if (f.pts) {
        lightning(f.pts, col);
        const v: THREE.Vector3[] = [];
        for (let i = 0; i + 1 < f.pts.length; i += 2) v.push(new THREE.Vector3(f.pts[i], heightAt(f.pts[i], f.pts[i + 1]) + 1.3, f.pts[i + 1]));
        P.zap(v, col);
      }
      break;
    case 'storm': ring(f.x, f.z, 0x9fb8ff, f.r ?? 6, (f.r ?? 6) * 0.2, 1.5, 0.3); column(f.x, f.z, 0x5a6aff, 1.5); P.burst(f.x, gy + 9, f.z, { count: 70, color: 0x9fb8ff, intensity: 3, radius: f.r ?? 6, flat: true, speed: 1, size: 0.3, life: 1.5, gravity: 3, drag: 0.5 }); break;
    case 'stormhit':
      ring(f.x, f.z, col, 0.5, f.r ?? 6, 0.7);
      for (let i = 0; i < 4; i++) lightning([f.x + (Math.random() - 0.5) * (f.r ?? 6), f.z + (Math.random() - 0.5) * (f.r ?? 6), f.x, f.z], col, 40);
      P.shockwave(f.x, gy, f.z, f.r ?? 6, col);
      P.sparks(f.x, gy + 0.5, f.z, col, 50);
      break;
    case 'reveal': ring(f.x, f.z, 0xffe9a0, 0.3, 3, 0.8, 1.2); P.motes(f.x, gy, f.z, 0xffe9a0, 30); break;
    case 'seal': column(f.x, f.z, 0xd4af37, 2); ring(f.x, f.z, 0xd4af37, 0.5, 5, 1.5); P.fountain(f.x, gy, f.z, 0xd4af37, 120); break;
  }
  // the caster's wand arm rises and strikes; the tip flashes at the strike (see frame)
  if (f.k === 'cast' && f.h) {
    const w = wizards.get(f.h);
    if (w) w.castPending = true;
  }
}

// ------------------------------------------------------------------ HUD
function feed(e: Ev, fresh: boolean) {
  // the private Owl Post lives in its own panel, never in the public feed
  if (e.type === 'owl' || e.type === 'ask') { onOwlEvent(e, fresh); return; }
  const d = document.createElement('div');
  d.className = `${e.type} ${e.to ? 'private' : ''}`;
  const text = lang === 'zh' && e.zh ? e.zh : e.text;
  d.textContent = text;
  $('#feed').append(d);
  while ($('#feed').children.length > 14) $('#feed').firstChild!.remove();
  if (fresh && (e.type === 'decree' || e.type === 'term' || (e.type === 'egg' && e.to) || (e.type === 'curse' && e.to) || e.type === 'achievement' && e.text.includes(me?.name ?? '\u0000'))) banner(text);
  if (fresh && e.type === 'curse' && !$('#trunk').hidden) send({ t: 'book' });
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
  linkHud();
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

// ------------------------------------------------------------------ Owl Post menu (Esc): pairing code, connect commands, your key (docs/AGENT_LINK.md §A, §C.6)
let mcpUrl = '';
/** When each panel last asked the server for something: an 'err' right after belongs to that panel. */
const lastSent = { owl: -1e9, trunk: -1e9, menu: -1e9 };
const mark = (k: keyof typeof lastSent) => { lastSent[k] = performance.now(); };
const recent = (k: keyof typeof lastSent) => performance.now() - lastSent[k] < 3000;
/** The pairing code on screen: `until` is performance.now() ms; `worldT` the world time it was minted at. */
let pairing: { code: string; until: number; worldT: number; wasConnected: boolean } | null = null;
let pairExpired = false;
let pairedWith: string | null = null;
let pairAsked = -1e9;
let keyShown = false;
let rotateArmed = false;
let menuMsg = '';
const PAIR_SAY = (code: string) => L(`连上霍格沃茨，配对码 ${code}`, `Connect to Hogwarts, pairing code ${code}`);
const worldNow = () => snap?.t ?? 0;
function agentNow(): AgentView | null {
  if (!me) return null;
  const a: AgentInfo = { ...(me.agent ?? {}) };
  if (typeof a.sessions !== 'number' && typeof me.agents?.sessions === 'number') a.sessions = me.agents.sessions;
  return agentView(a, worldNow());
}

function menuInfo(url?: string) {
  if (url) mcpUrl = url;
  else if (!mcpUrl) mcpUrl = account.mcpUrl || `${location.origin}/mcp`;
  // "$PWD" is expanded by the shell when the command is added, so the saved entry holds an absolute path and works from any directory
  const bridge = `claude mcp add -s user hogwarts -- npx tsx "$PWD/src/mcp/stdio-bridge.ts" ${mcpUrl}`;
  const header = `claude mcp add -s user --transport http hogwarts ${mcpUrl} -H 'Authorization: Bearer \${HOGWARTS_TOKEN}'`;
  $('#menu').innerHTML = `<h2>${L('猫头鹰邮递', 'Owl Post')} <small>${L('—— 按 Esc 关闭', '— Esc to close')}</small></h2>
    <section class="op-first">
      <h3>${L('连接你的 Agent', 'Connect your agent')}</h3>
      <div id="op-pair"></div>
      <div id="op-agent" class="hint"></div>
    </section>
    <h3>${L('或者用命令行接入', 'Or connect from a terminal')}</h3>
    <p>${L('<b>推荐：stdio 桥</b>（先 <code>cd</code> 到你的霍格沃茨仓库目录，在那里运行一次；命令会记下仓库的完整路径，之后在任何目录启动 Claude Code 都能用。第一次配对后密钥存进 <code>~/.hogwarts/credentials.json</code>，以后每个新会话自动回来）：', '<b>Recommended: the stdio bridge</b> (<code>cd</code> into your Hogwarts checkout and run it there once; it records the checkout\'s full path, so Claude Code finds it from any directory. After the first pairing it keeps the key in <code>~/.hogwarts/credentials.json</code> and every new session comes back on its own):')}</p>
    <div class="op-cmd"><pre id="op-bridge">${esc(bridge)}</pre><button class="ghost" data-copy="op-bridge">${L('复制', 'Copy')}</button></div>
    <p>${L('<b>HTTP 直连 + 配置头</b>（命令里是字面的 <code>${HOGWARTS_TOKEN}</code>，要用单引号；再在 shell profile 里 <code>export HOGWARTS_TOKEN=你的密钥</code>）：', '<b>Direct HTTP with a header</b> (the command holds a literal <code>${HOGWARTS_TOKEN}</code> in single quotes; put <code>export HOGWARTS_TOKEN=&lt;your key&gt;</code> in your shell profile):')}</p>
    <div class="op-cmd"><pre id="op-header">${esc(header)}</pre><button class="ghost" data-copy="op-header">${L('复制', 'Copy')}</button></div>
    <h3>${L('你的猫头鹰邮递密钥', 'Your Owl Post key')}</h3>
    <div id="op-key"></div>
    <p class="op-registry">${L('你的登记号', 'Your registry number')}: <code>${esc(account.registry || '—')}</code><br/><span class="hint">${L('登记号是魔法部的公开记录，猫头鹰凭它投递包裹。', 'Your registry number is a public Ministry record: owls deliver parcels by it.')}</span></p>
    <p id="op-msg" class="hint"></p>
    <p>${L('语言 Language：', 'Language 语言: ')}<button id="lang-zh">中文</button> <button id="lang-en">English</button></p>
    <p><button id="logout" class="ghost">${L('离开霍格沃茨（忘记密钥）', 'Leave Hogwarts (forget key)')}</button> <button id="close-menu">${L('回到城堡', 'Back to the castle')}</button></p>`;
  $('#lang-zh').onclick = () => setLang('zh');
  $('#lang-en').onclick = () => setLang('en');
  $('#logout').onclick = () => { dropToken(); location.reload(); };
  $('#close-menu').onclick = () => { $('#menu').hidden = true; };
  lastPairHtml = lastKeyHtml = '';
  renderMenuLive();
}
$('#menu').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b) return;
  if (b.dataset.copy) copyText(b.dataset.copy === 'op-say' && pairing ? PAIR_SAY(pairing.code) : ($('#' + b.dataset.copy)?.textContent ?? ''), b);
  const act = b.dataset.act;
  if (act === 'pair') requestPairCode();
  if (act === 'showkey') { keyShown = !keyShown; renderMenuLive(); }
  if (act === 'rotate') { rotateArmed = true; renderMenuLive(); }
  if (act === 'rotate-no') { rotateArmed = false; renderMenuLive(); }
  if (act === 'rotate-yes') { rotateArmed = false; menuMsg = L('正在更换密钥……', 'Changing your key…'); mark('menu'); send({ t: 'rotate' }); renderMenuLive(); }
});
function copyText(text: string, b: HTMLElement) {
  const o = b.textContent;
  navigator.clipboard?.writeText(text).then(() => { b.textContent = L('已复制 ✓', 'Copied ✓'); setTimeout(() => { b.textContent = o; }, 1200); }, () => { /* no clipboard: select it by hand */ });
}
function requestPairCode() {
  if (performance.now() - pairAsked < 1500) return;
  pairAsked = performance.now();
  pairedWith = null;
  menuMsg = '';
  mark('menu');
  send({ t: 'paircode' });
}
/** Tutorial step 5 and the Owl Post's first button: open the Owl Post and mint a pairing code. */
function pairNow() {
  if ($('#menu').hidden) toggleMenu();
  requestPairCode();
}
function onPairCode(r: { code?: string; expiresIn?: number }) {
  if (!r?.code) return;
  pairing = { code: String(r.code), until: performance.now() + 1000 * Math.max(1, Number(r.expiresIn) || 180), worldT: worldNow(), wasConnected: !!agentNow()?.connected };
  pairExpired = false;
  pairedWith = null;
  renderMenuLive();
}
function onToken(t: string) {
  if (!t) return;
  token = t;
  saveToken(t);
  keyShown = false;
  rotateArmed = false;
  // only a rotation this tab asked for cuts the agent off; an agent's own rotate_key keeps its session (docs/AGENT_LINK.md §A.3)
  menuMsg = recent('menu')
    ? L('🔑 密钥已更换：旧密钥立即失效，这个浏览器已经换上了新密钥。已连接的 Agent 需要重新配对。', '🔑 Key changed: the old one stopped working at once and this browser now holds the new one. Connected agents need to pair again.')
    : L('🔑 密钥已更换：旧密钥立即失效，这个浏览器已经换上了新密钥。', '🔑 Key changed: the old one stopped working at once and this browser now holds the new one.');
  pairing = null;
  renderMenuLive();
  toast(menuMsg);
}
function onMenuError(text: string) {
  if (!recent('menu') || $('#menu').hidden) return false;
  menuMsg = text;
  renderMenuLive();
  return true;
}
let lastPairHtml = '', lastKeyHtml = '';
/** The live parts of the Owl Post: pairing code with its countdown, the agent line, the key. */
function renderMenuLive() {
  if ($('#menu').hidden || !$('#op-pair')) return;
  const a = agentNow();
  // the pairing is done once the agent that redeemed the code shows up
  if (pairing && a && ((a.tool === 'pair' && (me?.agent?.seen?.at ?? -1) >= pairing.worldT - 5) || (!pairing.wasConnected && a.connected))) { pairedWith = a.client; pairing = null; }
  let left = pairing ? Math.max(0, Math.ceil((pairing.until - performance.now()) / 1000)) : 0;
  if (pairing && left <= 0) { pairing = null; pairExpired = true; left = 0; }
  let html: string;
  if (pairedWith) {
    html = `<p class="op-ok">✅ ${L(`${esc(pairedWith)} 已连接`, `${esc(pairedWith)} is connected`)}</p><p class="hint">${L('现在可以按 <kbd>O</kbd> 和它说话。', 'Press <kbd>O</kbd> to talk to it.')}</p>`;
  } else if (pairing) {
    html = `<div class="op-code">${esc(pairing.code)}</div>
      <p>${L('对你的 Agent 说：', 'Tell your agent:')}<br/><b class="op-say">${L(`「${esc(PAIR_SAY(pairing.code))}」`, `"${esc(PAIR_SAY(pairing.code))}"`)}</b></p>
      <p><button class="ghost" data-copy="op-say">${L('复制这句话', 'Copy the sentence')}</button> <button class="ghost" data-act="pair">${L('换一个', 'New code')}</button> <span class="hint">${L('有效期', 'Valid for')} <span id="op-count"></span> · ${L('只能用一次', 'single use')}</span></p>`;
  } else {
    html = `<p><button data-act="pair" class="op-big">🦉 ${L('生成配对码', 'Get a pairing code')}</button></p>
      <p class="hint">${pairExpired ? L('配对码过期了，再生成一个吧。', 'That code expired; get a new one.') : L('得到一个 6 位配对码（3 分钟内有效，只能用一次），然后对你的 Agent 说：「连上霍格沃茨，配对码 XXX-XXX」。不用复制任何长密钥。', 'You get a 6-character code (3 minutes, single use); then tell your agent: "Connect to Hogwarts, pairing code XXX-XXX". No long key to copy.')}</p>`;
  }
  if (html !== lastPairHtml) { $('#op-pair').innerHTML = html; lastPairHtml = html; }
  const cnt = document.getElementById('op-count');
  if (cnt) cnt.textContent = fmtT(left);
  const agentLine = a?.connected
    ? `🤖 ${esc(a.client)} ${L('已连接', 'connected')}${a.ago !== null ? ` · ${agoText(a.ago)}${a.tool ? `：${esc(a.tool)}` : ''}` : ''}${a.paused ? L(' · ⏸ 已暂停', ' · ⏸ paused') : ''}`
    : L('🤖 还没有 Agent 连接。', '🤖 No agent connected yet.');
  const al = $('#op-agent');
  if (al.innerHTML !== agentLine) al.innerHTML = agentLine;
  const keyHtml = (keyShown
    ? `<div class="op-cmd"><pre id="op-token">${esc(token)}</pre><button class="ghost" data-copy="op-token">${L('复制', 'Copy')}</button></div><p><button class="ghost" data-act="showkey">${L('隐藏密钥', 'Hide the key')}</button> `
    : `<p class="hint">${L('密钥就像你的魔杖：谁拿到它谁就能扮成你。别贴到公开的地方。', 'Your key is like your wand: whoever holds it can play as you. Never paste it anywhere public.')}</p><p><button class="ghost" data-act="showkey">${L('显示密钥', 'Show the key')}</button> `)
    + (rotateArmed
      ? `<b>${L('确定更换？旧密钥会立即失效。', 'Change it? The old key stops working at once.')}</b> <button data-act="rotate-yes">${L('确定更换', 'Change it')}</button> <button class="ghost" data-act="rotate-no">${L('取消', 'Cancel')}</button></p>`
      : `<button class="ghost" data-act="rotate">${L('更换密钥', 'Change the key')}</button> <span class="hint">${L('（泄露了就换：旧密钥立即失效）', '(leaked? change it: the old key dies at once)')}</span></p>`);
  if (keyHtml !== lastKeyHtml) { $('#op-key').innerHTML = keyHtml; lastKeyHtml = keyHtml; }
  const msg = $('#op-msg');
  if (msg.textContent !== menuMsg) msg.textContent = menuMsg;
}

// ------------------------------------------------------------------ the Owl panel (O): you and your own agent, privately (§C.1)
type OwlLine = { id: number; from: 'player' | 'agent'; text: string; t: number; ask?: { options: string[]; expiresAt: number }; answer?: string | null; re?: number; lost?: number };
const owlLog: OwlLine[] = [];
const owlIds = new Set<number>();
const askPending = new Map<number, string>();
let owlUnread = 0;
let owlStatus = '';
let owlDirty = true;
let owlPopUntil = 0;
function addOwl(l: OwlLine, fresh: boolean) {
  if (owlIds.has(l.id)) return;
  owlIds.add(l.id);
  if (l.re !== undefined) {
    const q = owlLog.find((x) => x.id === l.re);
    if (q) q.answer = l.text;
    askPending.delete(l.re);
  }
  owlLog.push(l);
  owlLog.sort((a, b) => a.id - b.id);
  while (owlLog.length > 120) owlIds.delete(owlLog.shift()!.id);
  owlDirty = true;
  if (fresh && l.from === 'agent') {
    if ($('#owl').hidden) { owlUnread++; owlPop(l); }
  }
  renderOwl();
}
function onOwlEvent(e: Ev, fresh: boolean) {
  const from = e.from === 'agent' ? 'agent' : 'player';
  const text = String((lang === 'zh' && e.zh) || e.text || '');
  const id = typeof e.owl?.id === 'number' ? e.owl.id : -e.id;
  const ask = e.type === 'ask' && e.owl?.options?.length ? { options: e.owl.options, expiresAt: Number(e.owl.expiresAt ?? 0) } : undefined;
  addOwl({ id, from, text, t: Number(e.t ?? worldNow()), ask, re: e.owl?.re }, fresh);
}
/** An OwlMsg (World.owlsFor shape), if the server sends the owlbox itself. */
function owlFromMsg(o: { id: number; from: 'player' | 'agent'; text: string; t: number; ask?: { options: string[]; expiresAt: number }; answered?: boolean; answer?: string; re?: number; lost?: number }) {
  if (!o || typeof o.id !== 'number') return;
  addOwl({ id: o.id, from: o.from === 'agent' ? 'agent' : 'player', text: String(o.text ?? ''), t: Number(o.t ?? 0), ask: o.ask, answer: o.answered ? o.answer ?? null : undefined, re: o.re, lost: o.lost }, false);
}
function sendOwl(text: string) {
  const t = text.trim();
  if (!t) return;
  mark('owl');
  send({ t: 'owl', text: t });
  owlStatus = '';
  owlDirty = true;
  ctl.notify('owl');
}
function answerAsk(id: number, choice: string) {
  if (askPending.has(id)) return;
  askPending.set(id, choice);
  mark('owl');
  send({ t: 'answer', id, choice });
  owlDirty = true;
  renderOwl();
}
function onOwlError(text: string) {
  if (!recent('owl')) return false;
  askPending.clear();
  owlStatus = text;
  owlDirty = true;
  renderOwl();
  return !$('#owl').hidden;
}
/** A question's state at world time `now`. */
const askStateOf = (l: OwlLine, now: number) => l.answer === '(expired)' ? 'expired' : l.answer != null ? 'answered' : l.ask && now >= l.ask.expiresAt ? 'expired' : askPending.has(l.id) ? 'pending' : 'open';
function askHtml(l: OwlLine, now: number) {
  if (!l.ask) return '';
  const st = askStateOf(l, now);
  if (st === 'answered') return `<div class="ow-ans">✓ ${L('你选了', 'You chose')}: <b>${esc(l.answer ?? '')}</b></div>`;
  if (st === 'expired') return `<div class="ow-ans hint">${L('（提问已过期）', '(the question expired)')}</div>`;
  return `<div class="ow-opts">${l.ask.options.map((o) => `<button data-ask="${l.id}" data-choice="${esc(o)}"${st === 'pending' ? ' disabled' : ''}>${esc(o)}</button>`).join('')}<span class="hint" data-left="${l.id}"></span></div>`;
}
let owlStates = '';
function renderOwl() {
  const panel = $('#owl');
  const now = worldNow();
  // a question that just expired (or was answered) redraws its buttons
  const states = owlLog.filter((l) => l.ask).map((l) => askStateOf(l, now)).join();
  if (states !== owlStates) { owlStates = states; owlDirty = true; }
  if (!panel.hidden && owlDirty) {
    owlDirty = false;
    const a = agentNow();
    $('#owl-who').innerHTML = a?.connected ? `🤖 ${esc(a.client)}${a.paused ? L(' · ⏸ 已暂停', ' · ⏸ paused') : ''}` : `<span class="hint">${L('Agent 未连接：信会留在信箱里，它连上后用 listen 收。', 'No agent connected: owls wait in the owlbox until it listens.')}</span>`;
    const log = $('#owl-log');
    log.innerHTML = owlLog.length
      ? owlLog.map((l) => `<div class="ow ${l.from}"><span class="ow-from">${l.from === 'agent' ? '🤖 Agent' : L('🧙 你', '🧙 You')}</span>${l.re !== undefined ? `<span class="hint">${L('（回答）', ' (answer)')}</span>` : ''}<div class="ow-text">${esc(l.text)}</div>${askHtml(l, now)}</div>`).join('')
      : `<div class="hint">${L('这里只有你和你的 Agent。写一句话，按回车寄出。', 'Only you and your agent see this. Write a line and press Enter.')}</div>`;
    log.scrollTop = log.scrollHeight;
    $('#owl-status').textContent = owlStatus;
  }
  // question countdowns, without rebuilding the buttons under the pointer
  document.querySelectorAll<HTMLElement>('[data-left]').forEach((el) => {
    const l = owlLog.find((x) => x.id === Number(el.dataset.left));
    if (l?.ask) el.textContent = L(` ${Math.max(0, Math.ceil(l.ask.expiresAt - now))} 秒内回答`, ` answer within ${Math.max(0, Math.ceil(l.ask.expiresAt - now))}s`);
  });
  const pop = $('#owlpop');
  if (!pop.hidden && (performance.now() > owlPopUntil || !panel.hidden)) pop.hidden = true;
}
function owlPop(l: OwlLine) {
  const pop = $('#owlpop');
  pop.innerHTML = `<div class="op-head">🦉 ${L('你的 Agent 说', 'Your agent says')} <span class="hint">${L('（按 O 回复）', '(O to reply)')}</span></div><div class="ow-text">${esc(l.text)}</div>${askHtml(l, worldNow())}`;
  pop.hidden = false;
  owlPopUntil = performance.now() + (l.ask ? Math.max(4, l.ask.expiresAt - worldNow()) * 1000 : 9000);
}
function toggleOwl(force?: boolean) {
  const p = $('#owl');
  p.hidden = !(force ?? p.hidden);
  if (!p.hidden) {
    owlUnread = 0;
    owlDirty = true;
    $('#owlpop').hidden = true;
    renderOwl();
    $<HTMLInputElement>('#owl-input').focus();
  }
}
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-ask]') as HTMLButtonElement | null;
  if (b) { if (!b.disabled) answerAsk(Number(b.dataset.ask), b.dataset.choice ?? ''); }
  else if ((e.target as HTMLElement).closest('#owlpop')) toggleOwl(true);
});
$<HTMLInputElement>('#owl-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const i = e.target as HTMLInputElement; sendOwl(i.value); i.value = ''; }
});
$('#owl-send').onclick = () => { const i = $<HTMLInputElement>('#owl-input'); sendOwl(i.value); i.value = ''; i.focus(); };
$('#owl-close').onclick = () => toggleOwl(false);

/** A chat line starting with an @word that is not @agent: ask where it goes before anyone else can read it. */
let atPending: { text: string; rest: string } | null = null;
function askWhere(word: string, text: string, rest: string) {
  atPending = { text, rest };
  const el = $('#atask');
  el.innerHTML = `<p>${L(`「@${esc(word)}」不是你的 Agent。这句话要发到哪里？`, `"@${esc(word)}" is not your agent. Where should this go?`)}</p><p class="hint">${esc(text)}</p>
    <p><button data-at="public">${L('发到公共频道', 'Public chat')}</button> <button data-at="agent">${L('给我的 Agent（私密）', 'My agent (private)')}</button> <button class="ghost" data-at="cancel">${L('取消', 'Cancel')}</button></p>`;
  el.hidden = false;
}
$('#atask').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b || !atPending) return;
  if (b.dataset.at === 'public') send({ t: 'chat', text: atPending.text });
  if (b.dataset.at === 'agent') sendOwl(atPending.rest || atPending.text);
  atPending = null;
  $('#atask').hidden = true;
});
/** The chat box: public by default, `@agent …` / `@a …` is a private owl, any other `@word …` asks first. */
function sendChat(raw: string) {
  const r = routeChat(raw);
  if (!r) return;
  if (r.to === 'public') send({ t: 'chat', text: r.text });
  else if (r.to === 'agent') sendOwl(r.text);
  else askWhere(r.word, r.text, r.rest);
}

// ------------------------------------------------------------------ agent presence widget (HUD, from me.agent)
let lastAgentHtml = '';
function renderAgentBox() {
  const el = $('#agentbox');
  const a = agentNow();
  let html = '';
  if (a && (a.connected || a.paused)) {
    const act = a.ago !== null ? ` · ${agoText(a.ago)}${a.tool ? `：<code>${esc(a.tool)}</code>` : ''}` : '';
    html = `<div>🤖 <b>${esc(a.client)}</b> ${a.paused ? L('已暂停', 'paused') : L('已连接', 'connected')}${act}</div>`
      + (a.goal ? `<div class="ab-goal">🎯 ${L('目标', 'Goal')}: ${esc(a.goal)}</div>` : '')
      + `<div class="ab-row"><button data-act="pause" class="${a.paused ? '' : 'ghost'}">${a.paused ? L('▶ 继续 Agent', '▶ Resume agent') : L('⏸ 暂停 Agent', '⏸ Pause agent')}</button> <button data-act="owl" class="ghost">🦉 O${owlUnread ? ` <b class="ab-n">${owlUnread}</b>` : ''}</button></div>`;
  } else if (owlUnread) {
    html = `<div class="ab-row"><button data-act="owl" class="ghost">🦉 ${L('新猫头鹰', 'New owls')} <b class="ab-n">${owlUnread}</b></button></div>`;
  } else if (me) {
    html = `<div class="hint">🤖 ${L('Agent 未连接 · Esc → 生成配对码', 'No agent · Esc → pairing code')}</div>`;
  }
  if (html !== lastAgentHtml) {
    el.innerHTML = html; lastAgentHtml = html; el.hidden = !html;
    el.classList.toggle('ab-idle', !!html && !(a && (a.connected || a.paused)) && !owlUnread);
  }
}
// short (landscape phone) screens put the chat box right under the top-left stack, which grows with the agent widget
new ResizeObserver(() => {
  const r = $('#topleft').getBoundingClientRect();
  document.documentElement.style.setProperty('--tl-bottom', `${Math.round(r.bottom)}px`);
}).observe($('#topleft'));
$('#agentbox').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b) return;
  if (b.dataset.act === 'pause') send({ t: 'pause', on: !me?.agent?.paused });
  if (b.dataset.act === 'owl') toggleOwl(true);
});

// ------------------------------------------------------------------ curse banner (from me.hex)
function renderCurseBar() {
  const el = $('#cursebar');
  const c = curseText(me?.hex);
  if (!c || (!c.hexed && !c.respite)) { el.hidden = true; return; }
  if (!el.firstElementChild) {
    el.innerHTML = `<div class="cb-text"></div><div class="cb-acts"><button data-act="finite">✨ ${L('咒立停', 'Finite Incantatem')}</button> <button class="ghost" data-act="revelio">👁️ ${L('原形立现', 'Revelio')}</button> <button class="ghost" data-act="trunk">🧳 ${L('行囊', 'Trunk')} (T)</button></div>`;
  }
  el.classList.toggle('quiet', !c.hexed);
  const text = c.hexed
    ? `<b>${esc(c.head)}</b>${c.parts.map(esc).join(' · ')}${L('。', '.')}<br/>${esc(c.cure)} ${esc(c.who)}${c.resting ? `<br/><i>${esc(c.resting)}</i>` : ''}`
    : esc(c.respite ?? '');
  const t = el.querySelector('.cb-text') as HTMLElement;
  if (t.innerHTML !== text) t.innerHTML = text;
  (el.querySelector('.cb-acts') as HTMLElement).hidden = !c.hexed;
  const fin = el.querySelector('[data-act="finite"]') as HTMLButtonElement;
  const why = finiteBlocked();
  fin.disabled = !!why;
  fin.title = why ?? '';
  el.hidden = false;
}
$('#cursebar').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b || b.disabled) return;
  if (b.dataset.act === 'finite') ctl.castOnSelf('Finite Incantatem');
  if (b.dataset.act === 'revelio') ctl.castOnSelf('Revelio');
  if (b.dataset.act === 'trunk') toggleTrunk(true);
});

// ------------------------------------------------------------------ the trunk (T): equip, unequip, destroy; break a cursed binding (§C.6)
let trunkItems: TrunkItem[] = [];
let trunkAt = 0;
let knownSpells: Set<string> | null = null;
let trunkMsg = '';
let destroyArmed: string | null = null;
let trunkRefetch = 0;
const SLOT_ICON: Record<string, string> = { wand: '🪄', robe: '🥻', amulet: '📿', trinket: '💍', broom: '🧹' };
const SLOT_ZH: Record<string, string> = { wand: '魔杖', robe: '长袍', amulet: '护身符', trinket: '小饰物', broom: '扫帚' };
const MOD_ZH: Record<string, string> = { maxHp: '生命上限', maxMana: '法力上限', manaRegen: '回蓝', speed: '移速', power: '威力', ward: '护甲' };
function onArmory(armory: { items?: TrunkItem[]; spells?: { name: string }[] }) {
  if (Array.isArray(armory.items)) { trunkItems = armory.items; trunkAt = performance.now(); }
  if (Array.isArray(armory.spells)) knownSpells = new Set(armory.spells.map((s) => s.name));
  renderTrunk(true);
}
const knows = (name: string, year: number) => knownSpells ? knownSpells.has(name) : (me?.year ?? 1) >= year;
/** Why Finite Incantatem cannot be cast from the trunk or the banner, or null. */
function finiteBlocked(): string | null {
  return knows('Finite Incantatem', 2) ? null : L('你还不会「咒立停」：需 2 年级', 'You do not know Finite Incantatem yet: needs year 2');
}
function boundLeft(it: TrunkItem): number {
  const live = me?.hex?.bound?.find((b) => b.id === it.id);
  if (live) return live.left;
  if (!it.bound) return 0;
  return Math.max(0, Math.ceil((it.boundSecondsLeft ?? 0) - (performance.now() - trunkAt) / 1000));
}
function modsText(m: Record<string, number>) {
  return Object.entries(m ?? {}).filter(([, v]) => v).map(([k, v]) => `<span class="${v < 0 ? 'neg' : 'pos'}">${esc(L(MOD_ZH[k] ?? k, k))} ${v > 0 ? '+' : ''}${v}</span>`).join(' ');
}
function renderTrunk(rebuild = false) {
  const el = $('#trunk');
  if (el.hidden) return;
  if (rebuild) {
    const fin = finiteBlocked(), rev = knows('Revelio', 1) ? null : L('你还不会「原形立现」', 'You do not know Revelio yet');
    $('#trunk-cure').innerHTML = `<button data-act="finite"${fin ? ` disabled title="${esc(fin)}"` : ''}>✨ ${L('念咒立停解咒', 'Cast Finite Incantatem to break curses')}</button>${fin ? ` <span class="hint">${esc(fin)}</span>` : ''}
      <button class="ghost" data-act="revelio"${rev ? ` disabled title="${esc(rev)}"` : ''}>👁️ ${L('念原形立现，看看是谁', 'Cast Revelio: who sent it?')}</button>`;
    $('#trunk-list').innerHTML = trunkItems.length ? trunkItems.map((it) => {
      const bound = boundLeft(it) > 0;
      const badges = [
        it.equipped ? `<span class="tb eq">${L('已穿戴', 'equipped')}</span>` : '',
        it.cursed ? (bound ? `<span class="tb curse">🔒 ${L('被诅咒（粘身，剩', 'cursed (stuck,')} <b data-bound="${esc(it.id)}">${boundLeft(it)}</b> ${L('秒）', 's left)')}</span>` : `<span class="tb curse">☠️ ${L('被诅咒', 'cursed')}</span>`) : '',
        it.jinx ? `<span class="tb curse">🕸️ ${L('带恶咒', 'jinxed')}</span>` : '',
        it.anon ? `<span class="tb anon">✉️ ${L('匿名寄来', 'anonymous')}</span>` : it.forgedByName && it.forgedByName !== me?.name && it.forgedByName !== 'Legend' ? `<span class="tb">${L('寄件人', 'from')} ${esc(it.forgedByName)}</span>` : '',
      ].join(' ');
      const stuck = bound ? ` disabled title="${esc(L('粘身中：先念咒立停，或等它消退', 'Stuck: cast Finite Incantatem first, or wait'))}"` : '';
      const wear = it.equipped ? `<button class="ghost" data-act="unequip" data-slot="${esc(it.slot)}"${stuck}>${L('卸下', 'Unequip')}</button>` : `<button class="ghost" data-act="equip" data-id="${esc(it.id)}">${L('穿上', 'Equip')}</button>`;
      const del = it.unique === 'elder_wand' ? '' : destroyArmed === it.id
        ? `<button data-act="destroy-yes" data-id="${esc(it.id)}">${L('确定销毁', 'Destroy it')}</button> <button class="ghost" data-act="destroy-no">${L('取消', 'Cancel')}</button>`
        : `<button class="ghost" data-act="destroy" data-id="${esc(it.id)}"${stuck}>${L('销毁', 'Destroy')}</button>`;
      return `<li class="${it.cursed ? 'cursed' : ''}"><div class="ti-name">${SLOT_ICON[it.slot] ?? '📦'} <b>${esc(it.name)}</b> <span class="hint">${esc(L(SLOT_ZH[it.slot] ?? it.slot, it.slot))}</span> ${badges}</div>
        <div class="ti-mods">${modsText(it.mods)}${it.lore ? ` <i class="hint">“${esc(it.lore)}”</i>` : ''}</div><div class="ti-acts">${wear} ${del}</div></li>`;
    }).join('') : `<li class="hint">${L('箱子是空的。让你的 Agent 用 forge_item 给你锻造点东西吧。', 'Your trunk is empty. Ask your agent to forge you something (forge_item).')}</li>`;
    $('#trunk-msg').textContent = trunkMsg;
  }
  // live countdowns; once a binding wears off, ask for a fresh list
  document.querySelectorAll<HTMLElement>('#trunk-list [data-bound]').forEach((b) => {
    const it = trunkItems.find((x) => x.id === b.dataset.bound);
    const left = it ? boundLeft(it) : 0;
    b.textContent = String(left);
    if (left <= 0 && performance.now() - trunkRefetch > 2000) { trunkRefetch = performance.now(); send({ t: 'book' }); }
  });
}
function toggleTrunk(force?: boolean) {
  const t = $('#trunk');
  t.hidden = !(force ?? t.hidden);
  if (!t.hidden) { trunkMsg = ''; destroyArmed = null; send({ t: 'book' }); renderTrunk(true); }
}
function onTrunkError(text: string) {
  if (!recent('trunk') || $('#trunk').hidden) return false;
  trunkMsg = text;
  send({ t: 'book' });
  return true;
}
$('#trunk').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  trunkMsg = '';
  mark('trunk');
  if (act === 'close') { toggleTrunk(false); return; }
  if (act === 'finite') { ctl.castOnSelf('Finite Incantatem'); return; }
  if (act === 'revelio') { ctl.castOnSelf('Revelio'); return; }
  if (act === 'equip') send({ t: 'equip', item: b.dataset.id });
  else if (act === 'unequip') send({ t: 'unequip', slot: b.dataset.slot });
  else if (act === 'destroy') { destroyArmed = b.dataset.id ?? null; renderTrunk(true); return; }
  else if (act === 'destroy-no') { destroyArmed = null; renderTrunk(true); return; }
  else if (act === 'destroy-yes') { destroyArmed = null; send({ t: 'destroy', item: b.dataset.id }); }
  else return;
  send({ t: 'book' }); // the server does not answer equip / unequip / destroy: read the trunk again
});

/** The Owl Post parts of the 10 Hz HUD. */
function linkHud() {
  renderAgentBox();
  renderCurseBar();
  renderMenuLive();
  renderOwl();
  renderTrunk();
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
  keyShown = false; // the key is hidden again every time the Owl Post opens or closes
  rotateArmed = false;
  if (!m.hidden) { ctl.notify('menu'); if (!$('#op-pair')) menuInfo(); renderMenuLive(); }
}
const ctl = createControls({
  canvas, camera, scene, ground: world.ground, hoverRing: aimRing, wizards, creatures,
  snap: () => snap, me: () => me, myHandle: () => myHandle, send, toast,
  cam: {
    get yaw() { return camYaw; }, set yaw(v: number) { camYaw = v; },
    get pitch() { return camPitch; }, set pitch(v: number) { camPitch = v; },
    get dist() { return camDist; }, set dist(v: number) { camDist = v; },
  },
  panels: { book: toggleBook, menu: toggleMenu, owl: () => toggleOwl(), trunk: () => toggleTrunk() },
  agent: agentNow,
  pair: pairNow,
});
addEventListener('keydown', (e) => {
  const chat = $<HTMLInputElement>('#chat');
  if (document.activeElement === chat) {
    if (e.key === 'Enter') { sendChat(chat.value); chat.value = ''; chat.blur(); }
    if (e.key === 'Escape') chat.blur();
    return;
  }
  // typing never triggers game keys (O and T included)
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')) {
    if (e.key === 'Escape') { if (document.activeElement === $('#owl-input')) toggleOwl(false); (document.activeElement as HTMLElement).blur(); }
    return;
  }
  if (e.key === 'b' || e.key === 'B') { toggleBook(); return; }
  if (e.key === 'r' || e.key === 'R') { toggleSeals(); return; }
  if (e.key === 'l' || e.key === 'L') { showBoard(); return; }
  if (e.key === 'o' || e.key === 'O') { if (!e.repeat) toggleOwl(); e.preventDefault(); return; }
  if (e.key === 't' || e.key === 'T') { if (!e.repeat) toggleTrunk(); return; }
  if (e.key === 'Enter') { chat.focus(); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    // close the topmost panel, then drop the target, then open the Owl Post
    if (!$('#atask').hidden) { $('#atask').hidden = true; atPending = null; return; }
    if (!$('#book').hidden) { $('#book').hidden = true; return; }
    if (!$('#owl').hidden) { toggleOwl(false); return; }
    if (!$('#trunk').hidden) { toggleTrunk(false); return; }
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
    const px = w.root.position.x, pz = w.root.position.z;
    w.root.position.x += (w.tx - w.root.position.x) * k;
    w.root.position.z += (w.tz - w.root.position.z) * k;
    w.root.position.y = heightAt(w.root.position.x, w.root.position.z);
    const turn = Math.atan2(Math.sin(-w.tf - w.body.rotation.y), Math.cos(-w.tf - w.body.rotation.y));
    w.body.rotation.y += turn * Math.min(1, dt * 14);
    const speed = dt > 0 ? Math.hypot(w.root.position.x - px, w.root.position.z - pz) / dt : 0;
    if (w.update(dt, speed, w.castPending)) particles.flash(w.wandTip.getWorldPosition(tmpTip), 0xfff2c0);
    w.castPending = false;
    if (w.patronus.visible) {
      w.patronus.position.set(Math.cos(clock * 3) * 2, 1.5, Math.sin(clock * 3) * 2);
      particles.trail(w.patronus, w.patronus.getWorldPosition(tmpTip), 0xcfe4ff, 0.35);
    }
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
    particles.trail(b, b.position, b.userData.color ?? 0xffffff);
    const spin = b.getObjectByName('spin');
    if (spin) spin.rotation.set(clock * 7, clock * 5, 0);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    e.update(Math.min(1, e.t / e.life), e.obj);
    if (e.t >= e.life) {
      scene.remove(e.obj);
      effects.splice(i, 1);
      // every effect mesh owns its geometry and material: free them (sprites share one geometry: keep it)
      const o = e.obj as THREE.Mesh;
      if (!(e.obj as THREE.Sprite).isSprite) o.geometry?.dispose();
      (o.material as THREE.Material | undefined)?.dispose();
    }
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
    world.tick(clock, dt, !snap.willowCalm && [...wizards.values()].some((w) => Math.hypot(w.root.position.x - 45, w.root.position.z) < 9), R.sunDir,
      { hour: snap.hour, banner: look.banner, focus: my?.root.position });
  }
  particles.setQuality(quality);
  particles.update(dt, camera, R.renderer, R.day);
  // spells light up their surroundings: the pool goes to the bolts nearest the camera
  const lit = [...bolts.values()]
    .map((b) => ({ x: b.position.x, y: b.position.y + 0.2, z: b.position.z, color: (b.userData.color as number) ?? 0xffffff, d: b.position.distanceToSquared(camera.position) }))
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

