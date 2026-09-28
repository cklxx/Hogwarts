import * as THREE from 'three';
import { ELEMENT_COLORS, HOUSE_COLORS, type CreatureKind, type Element, type House } from '../src/shared/constants';
import { LANDMARKS, OBSTACLES } from '../src/shared/map';
import { buildWorld } from './scene';
import { makeBolt, makeCreature, makeWizard, wizardColor, type WizardModel } from './models';

// ------------------------------------------------------------------ protocol types (mirror of World.snapshot)
interface SW { h: string; n: string; ho: House; x: number; z: number; f: number; hp: number; m: number; y: number; s: string; say?: string }
interface SC { i: string; k: CreatureKind; x: number; z: number; f: number; hp: number; m: number }
interface SP { i: string; k: string; x: number; z: number; e: Element }
interface Fx { k: string; x: number; z: number; r?: number; e?: Element; h?: string }
interface Snap { t: number; hour: number; night: boolean; weather: string; term: { n: number; left: number }; w: SW[]; c: SC[]; p: SP[]; fx: Fx[]; elder: { x: number; z: number } | null; willowCalm: boolean }
interface Me {
  handle: string; name: string; house: House; year: number; xp: number; xpNext: number | null; reputation: number; galleons: number;
  hp: number; maxHp: number; mana: number; maxMana: number; hotbar: ({ id: string; name: string; cd: number } | null)[];
  stunned: number; jailed: number; decree: boolean; map: { name: string; registry: string; house: string; year: number; where: string; x: number; z: number }[] | null; proclamation: string;
}
interface Ev { id: number; type: string; text: string; to?: string }

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
      if (!r.ok) { err.textContent = j.error; return; }
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fb8d9, 60, 320);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3a4a2a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
scene.add(sun, sun.target);
const world = buildWorld(scene);
const stars = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 1500 * 3 }, (_, i) => (i % 3 === 1 ? 250 + Math.random() * 200 : (Math.random() - 0.5) * 1600)), 3)),
  new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0 }),
);
scene.add(stars);
const weatherPts = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 3000 * 3 }, (_, i) => (i % 3 === 1 ? Math.random() * 40 : (Math.random() - 0.5) * 120)), 3)),
  new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.8 }),
);
weatherPts.visible = false;
scene.add(weatherPts);
const elderGlint = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0xe0c3ff }));
scene.add(elderGlint);
const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 24), new THREE.MeshBasicMaterial({ color: 0xff5050, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false }));
aimRing.rotation.x = -Math.PI / 2;
aimRing.visible = false;
scene.add(aimRing);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ state
let snap: Snap | null = null;
let me: Me | null = null;
let myHandle = '';
let token = '';
let ws: WebSocket | null = null;
const wizards = new Map<string, WizardModel & { tx: number; tz: number; tf: number }>();
const creatures = new Map<string, ReturnType<typeof makeCreature> & { tx: number; tz: number; tf: number }>();
const bolts = new Map<string, THREE.Object3D & { tx?: number; tz?: number }>();
const effects: { obj: THREE.Object3D; t: number; life: number; update: (k: number, o: THREE.Object3D) => void }[] = [];
let camYaw = 0, camPitch = 0.45, camDist = 14;
const keys = new Set<string>();
const mouse = new THREE.Vector2(0, 0);
let mouseIn = false;
let aim = new THREE.Vector3();
let aimTarget: string | null = null;
let selected = 0;
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
    else if (msg.t === 'cast' && !msg.r.ok) toast(`✗ ${msg.r.spell}: ${msg.r.error}`);
    else if (msg.t === 'cast' && msg.r.notes?.length) toast(msg.r.notes.join(' · '));
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
      m = Object.assign(makeWizard(w.ho, w.h === myHandle), { tx: w.x, tz: w.z, tf: w.f });
      m.root.position.set(w.x, 0, w.z);
      scene.add(m.root);
      wizards.set(w.h, m);
    }
    m.tx = w.x; m.tz = w.z; m.tf = w.f;
    const extra = (w.s.includes('M') ? '⚖️' : '') + (w.s.includes('E') ? '🪄' : '');
    m.label.draw(`${w.n} · Y${w.y}`, wizardColor(w.ho), w.hp / w.m, w.say, extra);
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
      m = Object.assign(makeCreature(c.k), { tx: c.x, tz: c.z, tf: c.f });
      m.root.position.set(c.x, 0, c.z);
      scene.add(m.root);
      creatures.set(c.i, m);
    }
    m.tx = c.x; m.tz = c.z; m.tf = c.f;
    m.label.draw(NAMES[c.k], '#ffdddd', c.hp / c.m);
  }
  for (const [i, m] of creatures) if (!seenC.has(i)) { puff(m.root.position.x, m.root.position.z, 0x333333); scene.remove(m.root); creatures.delete(i); }

  const seenP = new Set<string>();
  for (const p of s.p) {
    seenP.add(p.i);
    let b = bolts.get(p.i);
    if (!b) { b = makeBolt(p.k, p.e); b.position.set(p.x, 1.3, p.z); scene.add(b); bolts.set(p.i, b); }
    b.tx = p.x; b.tz = p.z;
  }
  for (const [i, b] of bolts) if (!seenP.has(i)) { scene.remove(b); bolts.delete(i); }

  for (const f of s.fx) spawnFx(f);
  elderGlint.visible = !!s.elder;
  if (s.elder) elderGlint.position.set(s.elder.x, 2.6, s.elder.z);
}

const NAMES: Record<CreatureKind, string> = { pixie: 'Cornish Pixie', snare: "Devil's Snare", spider: 'Acromantula', troll: 'Mountain Troll', dementor: 'Dementor' };

// ------------------------------------------------------------------ effects
function addEffect(obj: THREE.Object3D, life: number, update: (k: number, o: THREE.Object3D) => void) {
  scene.add(obj);
  effects.push({ obj, t: 0, life, update });
}
function ring(x: number, z: number, color: number, r0: number, r1: number, life: number, y = 0.2) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  addEffect(m, life, (k, o) => { const s = r0 + (r1 - r0) * k; o.scale.set(s, s, s); ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - k; });
}
function puff(x: number, z: number, color: number, size = 1.5) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
  m.position.set(x, 1.2, z);
  addEffect(m, 0.5, (k, o) => { o.scale.setScalar(1 + k * size * 2); ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k); });
}
function column(x: number, z: number, color: number, life = 1.2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 8, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.set(x, 4, z);
  addEffect(m, life, (k, o) => { ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k); o.scale.x = o.scale.z = 1 + k; });
}
function spawnFx(f: Fx) {
  const col = f.e ? ELEMENT_COLORS[f.e] : 0xffffff;
  switch (f.k) {
    case 'hit': puff(f.x, f.z, col, 1); break;
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
  d.textContent = e.text;
  $('#feed').append(d);
  while ($('#feed').children.length > 14) $('#feed').firstChild!.remove();
  if (fresh && (e.type === 'decree' || e.type === 'term' || (e.type === 'egg' && e.to) || e.type === 'achievement' && e.text.includes(me?.name ?? '\u0000'))) banner(e.text);
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
  $('#me').innerHTML = `<div class="house" style="color:${wizardColor(me.house)}">${esc(me.name)} · ${me.house}</div>
    <div>Year ${me.year} · ⭐ ${me.reputation} reputation · 🪙 ${me.galleons} Galleons</div>${me.decree ? '<div style="color:#9fd3ff">⚖️ Minister for Magic — you hold an unspent decree (MCP: decree)</div>' : ''}`;
  const h = snap.hour;
  const hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
  $('#clock').innerHTML = `${snap.night ? '🌙' : '☀️'} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${snap.weather}<br/>Term ${snap.term.n} ends in ${fmtT(snap.term.left)}<br/><i style="opacity:.8">"${esc(me.proclamation)}"</i>`;
  bar('.hp', me.hp, me.maxHp, `${me.hp} / ${me.maxHp}`);
  bar('.mana', me.mana, me.maxMana, `${me.mana} / ${me.maxMana} mana`);
  bar('.xp', me.xpNext ? me.xp : 1, me.xpNext ?? 1, '');
  const hb = $('#hotbar');
  if (hb.children.length !== 6) hb.innerHTML = Array.from({ length: 6 }, () => '<div><span></span><b></b><i></i></div>').join('');
  me.hotbar.forEach((s, i) => {
    const el = hb.children[i] as HTMLElement;
    el.classList.toggle('sel', i === selected);
    (el.children[0] as HTMLElement).textContent = s?.name ?? '—';
    (el.children[1] as HTMLElement).textContent = String(i + 1);
    (el.children[2] as HTMLElement).style.height = s && s.cd > 0 ? `${Math.min(100, s.cd * 40)}%` : '0';
    el.onclick = () => { selected = i; };
  });
  const ov = $('#overlay');
  if (me.jailed) { ov.hidden = false; ov.innerHTML = `⛓️ Azkaban<br/><small>The Dementors will release you in ${me.jailed.toFixed(0)}s</small>`; }
  else if (me.stunned) { ov.hidden = false; ov.innerHTML = `💫 Stunned<br/><small>Madam Pomfrey is patching you up… ${me.stunned.toFixed(1)}s</small>`; }
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
  el.querySelector('ul')!.innerHTML = me!.map!.map((w) => `<li><b>${esc(w.name)}</b> (${w.house}, Y${w.year}) — ${esc(w.where)} — <code>${w.registry}</code></li>`).join('') +
    '<li style="list-style:none;margin-top:8px"><i>Say "Mischief managed" to wipe the map.</i></li>';
}

async function showBoard() {
  const b = $('#board');
  if (!b.hidden) { b.hidden = true; return; }
  const lb = await (await fetch('/api/leaderboard')).json();
  b.innerHTML = `<h2>Term ${lb.term.n} — ${fmtT(lb.term.secondsLeft)} left</h2>
    <p><b>House points:</b> ${Object.entries(lb.housePoints).map(([h, p]) => `${h} ${p}`).join(' · ')}</p>
    <p><b>Minister for Magic:</b> ${lb.minister ? esc(lb.minister.name) + (lb.minister.decreeUnspent ? ' (decree unspent)' : ' (decree spent)') : '—'}<br/><small>${esc(lb.ministerRule)}</small></p>
    <table><tr><th>#</th><th>Wizard</th><th>House</th><th>Year</th><th>Reputation</th></tr>
    ${lb.top.map((w: any) => `<tr><td>${w.rank}</td><td>${esc(w.name)}${w.online ? ' •' : ''}</td><td>${w.house}</td><td>${w.year}</td><td>${w.reputation}</td></tr>`).join('')}</table>
    ${lb.loopholeFirstFoundBy ? `<p>🎉 First to find the Weasley Loophole: <b>${esc(lb.loopholeFirstFoundBy)}</b></p>` : ''}`;
  b.hidden = false;
}

function menuInfo(mcpUrl: string) {
  $('#menu').innerHTML = `<h2>Owl Post</h2>
    <p>Your agent can play this wizard, forge spells as code, and forge items. Connect it to the MCP server:</p>
    <pre>claude mcp add --transport http hogwarts ${mcpUrl} \\\n  --header "Authorization: Bearer ${token}"</pre>
    <p>Or any MCP client: <code>${mcpUrl}</code> with header <code>Authorization: Bearer &lt;token&gt;</code>.<br/>Your secret Owl Post key (token):</p>
    <pre>${token}</pre>
    <p>Then ask your agent: <i>"Read the grimoire, then invent a spell that finishes off wounded enemies and put it on hotbar 6."</i></p>
    <p><button id="logout">Leave Hogwarts (forget key)</button> <button id="close-menu">Back to the castle</button></p>`;
  $('#logout').onclick = () => { localStorage.removeItem(LS); location.reload(); };
  $('#close-menu').onclick = () => { $('#menu').hidden = true; };
}

// ------------------------------------------------------------------ input
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
addEventListener('keydown', (e) => {
  const chat = $<HTMLInputElement>('#chat');
  if (document.activeElement === chat) {
    if (e.key === 'Enter') { if (chat.value.trim()) send({ t: 'chat', text: chat.value }); chat.value = ''; chat.blur(); }
    if (e.key === 'Escape') chat.blur();
    return;
  }
  if (document.activeElement?.tagName === 'INPUT') return;
  if (e.key === 'Enter') { chat.focus(); e.preventDefault(); return; }
  if (e.key === 'Tab') { e.preventDefault(); showBoard(); return; }
  if (e.key === 'Escape') { $('#menu').hidden = !$('#menu').hidden; $('#board').hidden = true; return; }
  if (/^[1-6]$/.test(e.key)) { selected = Number(e.key) - 1; castSelected(); return; }
  keys.add(e.key.toLowerCase());
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
let dragging = false;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2) dragging = true;
  if (e.button === 0) castSelected();
});
addEventListener('mouseup', (e) => { if (e.button === 2) dragging = false; });
addEventListener('mousemove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseIn = true;
  const ch = $('#crosshair');
  ch.style.left = `${e.clientX}px`;
  ch.style.top = `${e.clientY}px`;
  if (dragging) { camYaw -= e.movementX * 0.005; camPitch = Math.max(0.1, Math.min(1.3, camPitch + e.movementY * 0.004)); }
});
canvas.addEventListener('wheel', (e) => { camDist = Math.max(5, Math.min(40, camDist + e.deltaY * 0.01)); }, { passive: true });

function castSelected() {
  send({ t: 'cast', key: String(selected + 1), x: aim.x, z: aim.z, target: aimTarget ?? undefined });
}

function updateAim() {
  if (!mouseIn) return;
  raycaster.setFromCamera(mouse, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) aim.copy(hit);
  // soft lock: nearest creature or other wizard to the aim point
  let best: string | null = null, bd = 3;
  let bx = 0, bz = 0;
  for (const [i, c] of creatures) { const d = Math.hypot(c.root.position.x - aim.x, c.root.position.z - aim.z); if (d < bd) { bd = d; best = i; bx = c.root.position.x; bz = c.root.position.z; } }
  for (const [h, w] of wizards) {
    if (h === myHandle) continue;
    const d = Math.hypot(w.root.position.x - aim.x, w.root.position.z - aim.z);
    if (d < bd) { bd = d; best = h; bx = w.root.position.x; bz = w.root.position.z; }
  }
  aimTarget = best;
  aimRing.visible = !!best;
  if (best) aimRing.position.set(bx, 0.1, bz);
  $('#crosshair').classList.toggle('lock', !!best);
}

let lastInput = '';
let inputTimer = 0;
function sendInput(dt: number) {
  let fx = 0, fz = 0;
  if (keys.has('w') || keys.has('arrowup')) fz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) fz += 1;
  if (keys.has('a') || keys.has('arrowleft')) fx -= 1;
  if (keys.has('d') || keys.has('arrowright')) fx += 1;
  if (keys.has('q')) camYaw += dt * 1.8;
  if (keys.has('e')) camYaw -= dt * 1.8;
  // camera-relative
  const s = Math.sin(camYaw), c = Math.cos(camYaw);
  const dx = fx * c + fz * s;
  const dz = -fx * s + fz * c;
  const my = wizards.get(myHandle);
  const f = my ? Math.atan2(aim.x - my.root.position.x, -(aim.z - my.root.position.z)) : 0;
  const key = `${dx.toFixed(2)},${dz.toFixed(2)},${f.toFixed(1)}`;
  inputTimer -= dt;
  if (key !== lastInput || inputTimer <= 0) { send({ t: 'input', dx, dz, f }); lastInput = key; inputTimer = 0.25; }
}

// ------------------------------------------------------------------ frame
const sky = new THREE.Color();
let prev = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  clock += dt;
  const k = 1 - Math.exp(-dt * 12);
  for (const w of wizards.values()) {
    w.root.position.x += (w.tx - w.root.position.x) * k;
    w.root.position.z += (w.tz - w.root.position.z) * k;
    w.body.rotation.y = -w.tf;
    if (w.patronus.visible) w.patronus.position.set(Math.cos(clock * 3) * 2, 1.5, Math.sin(clock * 3) * 2);
  }
  for (const c of creatures.values()) {
    c.root.position.x += (c.tx - c.root.position.x) * k;
    c.root.position.z += (c.tz - c.root.position.z) * k;
    c.root.rotation.y = -c.tf;
    c.anim(clock);
  }
  for (const b of bolts.values()) {
    b.position.x += ((b.tx ?? b.position.x) - b.position.x) * Math.min(1, k * 2);
    b.position.z += ((b.tz ?? b.position.z) - b.position.z) * Math.min(1, k * 2);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    e.update(Math.min(1, e.t / e.life), e.obj);
    if (e.t >= e.life) { scene.remove(e.obj); effects.splice(i, 1); }
  }
  elderGlint.rotation.y += dt * 2;
  elderGlint.position.y = 2.6 + Math.sin(clock * 2) * 0.2;

  // camera follows me
  const my = wizards.get(myHandle);
  if (my) {
    const t = my.root.position;
    camera.position.set(t.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist, 1.5 + Math.sin(camPitch) * camDist, t.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist);
    camera.lookAt(t.x, 1.8, t.z);
    sun.position.set(t.x + 40, 80, t.z + 30);
    sun.target.position.set(t.x, 0, t.z);
    weatherPts.position.set(t.x, 0, t.z);
  }

  // sky from the hour (the Great Hall ceiling does the same)
  if (snap) {
    const h = snap.hour;
    const day = Math.max(0, Math.min(1, Math.sin(((h - 6) / 12) * Math.PI) * 1.6));
    const dusk = new THREE.Color(0xe08a5a), noon = new THREE.Color(0x8fb6e8), night = new THREE.Color(0x0b1026);
    sky.copy(night).lerp(h > 5 && h < 9 || h > 17 && h < 21 ? dusk : noon, day);
    if (snap.weather === 'fog') sky.lerp(new THREE.Color(0x8c8c8c), 0.6);
    if (snap.weather === 'rain') sky.multiplyScalar(0.7);
    scene.background = sky;
    (scene.fog as THREE.Fog).color.copy(sky);
    (scene.fog as THREE.Fog).far = snap.weather === 'fog' ? 90 : 320;
    sun.intensity = 0.15 + 1.5 * day;
    hemi.intensity = 0.25 + 0.7 * day;
    (stars.material as THREE.PointsMaterial).opacity = 1 - day;
    weatherPts.visible = snap.weather === 'rain' || snap.weather === 'snow';
    if (weatherPts.visible) {
      const pos = weatherPts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const fall = snap.weather === 'rain' ? 30 : 3;
      for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) - fall * dt; if (y < 0) y += 40; pos.setY(i, y); }
      pos.needsUpdate = true;
      (weatherPts.material as THREE.PointsMaterial).size = snap.weather === 'rain' ? 0.08 : 0.2;
    }
    world.tick(clock, !snap.willowCalm && [...wizards.values()].some((w) => Math.hypot(w.root.position.x - 45, w.root.position.z) < 9));
  }
  scene.traverse((o) => { if (o.name === 'candle') o.position.y += Math.sin(clock * 2 + o.id) * 0.002; });

  updateAim();
  sendInput(dt);
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('#banner').hidden = true; }
  renderer.render(scene, camera);
}

setInterval(hud, 100);

// ------------------------------------------------------------------ boot
(async () => {
  token = await gate();
  $('#gate').hidden = true;
  $('#hud').hidden = false;
  connect();
  frame();
})();

