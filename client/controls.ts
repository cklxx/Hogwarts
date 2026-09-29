import * as THREE from 'three';
import type { CreatureKind, House } from '../src/shared/constants';
import { LANDMARKS, zonesAt } from '../src/shared/map';
import { L, creatureName, houseName, spellName } from './i18n';
import { heightAt, rayGround } from './terrain';

/**
 * Player controls: hover picking in screen space, a persistent target, smart casting, click-to-move,
 * a lazily following camera, the contextual action key (F), hotbar tooltips, the help panel,
 * first-run onboarding and touch input. main.ts owns the network, the scene and the panels; this
 * module only reads what it needs through ControlsDeps and speaks to the server through `send`.
 */

// ------------------------------------------------------------------ what we read (structural subsets of main.ts' protocol types)
export interface CWizard { h: string; n: string; ho: House; hp: number; m: number; t: string; s: string; y: number }
export interface CCreature { i: string; k: CreatureKind; hp: number; m: number; o?: string; s: string }
export interface CSnap { w: CWizard[]; c: CCreature[] }
/** What a spell is for (World.privateState reads it off Spell.effects): harm aims at a foe, help at a friend or you, self needs no target. */
export type SpellKind = 'harm' | 'help' | 'self';
export interface CSlot { id: string; name: string; cd: number; kind?: SpellKind }
export interface CMe { name: string; house: House; year: number; seals: number; ui: string[]; hotbar: (CSlot | null)[]; stunned: number; jailed: number }
type Model = { root: THREE.Object3D };
export type Rel = 'self' | 'ally' | 'hostile' | 'neutral';

export interface ControlsDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  ground: THREE.Object3D;
  /** Ring shown under whatever the cursor hovers (owned by main.ts' scene setup). */
  hoverRing: THREE.Mesh;
  wizards: Map<string, Model>;
  creatures: Map<string, Model>;
  snap: () => CSnap | null;
  me: () => CMe | null;
  myHandle: () => string;
  send: (o: unknown) => void;
  /** Live view of main.ts' camera orbit. */
  cam: { yaw: number; pitch: number; dist: number };
  toast: (text: string) => void;
  panels: { book: () => void; menu: () => void; owl: (force?: boolean) => void; trunk: () => void };
  /** The player's agent as the HUD sees it (me.agent), or null before the first 'me'. */
  agent: () => AgentView | null;
  /** Open the Owl Post and mint a pairing code (tutorial step 5). */
  pair: () => void;
}

// ------------------------------------------------------------------ Owl Post helpers (pure; docs/AGENT_LINK.md §A.2, §C.1, §C.6; test/controls.test.ts)
/** Where a line typed into the chat box goes: `@agent …` / `@a …` is a private owl to your agent; any other `@word …` asks first. */
export type ChatRoute = { to: 'public'; text: string } | { to: 'agent'; text: string } | { to: 'ask'; word: string; text: string; rest: string };
export function routeChat(raw: string): ChatRoute | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const mine = /^@(?:agent|a)(?=$|[\s:：,，])[\s:：,，]*/i.exec(text);
  if (mine) { const rest = text.slice(mine[0].length).trim(); return rest ? { to: 'agent', text: rest } : null; }
  const other = /^@([^\s:：,，]+)[\s:：,，]*/.exec(text);
  if (other) return { to: 'ask', word: other[1], text, rest: text.slice(other[0].length).trim() };
  return { to: 'public', text };
}

/**
 * A key handed over in the page address: `#k=<token>` (the fragment never reaches a server or a log) or the old
 * `?token=<token>`. Returns the token and the address to put back with both removed (other parameters such as
 * ?q=low stay), or clean = null when there was nothing to remove.
 */
export function tokenFromUrl(href: string): { token: string | null; clean: string | null } {
  let u: URL;
  try { u = new URL(href); } catch { return { token: null, clean: null }; }
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const fromHash = hash.get('k');
  const fromQuery = u.searchParams.get('token');
  if (!fromHash && !fromQuery && !hash.has('k') && !u.searchParams.has('token')) return { token: null, clean: null };
  hash.delete('k');
  u.searchParams.delete('token');
  const h = hash.toString();
  return { token: (fromHash || fromQuery || '').trim() || null, clean: u.pathname + u.search + (h ? `#${h}` : '') };
}

/** me.agent (World.agentState, plus the MCP session count the server may add). */
export interface AgentInfo {
  seen?: { client: string; tool: string; at: number } | null;
  goal?: string | null;
  paused?: boolean;
  sessions?: number;
  connected?: boolean;
}
export interface AgentView { connected: boolean; client: string; ago: number | null; tool: string | null; goal: string | null; paused: boolean }
/** An agent seen within this many seconds counts as connected when the server does not say how many MCP sessions there are. */
export const AGENT_LIVE_S = 300;
/** "claude-code" → "Claude Code". */
export function clientLabel(name: string | null | undefined): string {
  const n = String(name ?? '').trim();
  if (!n || n === 'agent') return 'Agent';
  if (/^claude[-_ ]?code$/i.test(n)) return 'Claude Code';
  return n.split(/[-_ ]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').slice(0, 32);
}
/** The HUD's view of the agent at world time `now` (seen.at is world time, rounded down to 5 s by the kernel). */
export function agentView(a: AgentInfo | null | undefined, now: number): AgentView {
  const seen = a?.seen ?? null;
  const ago = seen ? Math.max(0, Math.floor(now - seen.at)) : null;
  const connected = typeof a?.connected === 'boolean' ? a.connected
    : typeof a?.sessions === 'number' ? a.sessions > 0
    : ago !== null && ago < AGENT_LIVE_S;
  return { connected, client: clientLabel(seen?.client), ago, tool: seen?.tool || null, goal: a?.goal || null, paused: !!a?.paused };
}
/** "3 秒前" / "3s ago". */
export function agoText(s: number | null): string {
  if (s === null) return '';
  if (s < 5) return L('刚刚', 'just now');
  if (s < 60) return L(`${s} 秒前`, `${s}s ago`);
  if (s < 3600) return L(`${Math.floor(s / 60)} 分钟前`, `${Math.floor(s / 60)} min ago`);
  return L(`${Math.floor(s / 3600)} 小时前`, `${Math.floor(s / 3600)} h ago`);
}

/** me.hex (World.hexState). */
export interface HexState {
  auras: { k: string; mag: number; left: number }[];
  silenced: number;
  bound: { id: string; name: string; slot: string; left: number }[];
  respite: number;
  safe?: boolean;
  pvp?: boolean;
}
export const JINX_LABEL: Record<string, { zh: string; en: string }> = {
  jelly: { zh: '腿脚发软', en: 'Jelly-Legs' },
  dance: { zh: '塔朗泰拉舞', en: 'Tarantallegra' },
  boils: { zh: '火疖子', en: 'Furnunculus' },
  bats: { zh: '蝙蝠精咒', en: 'Bat-Bogey Hex' },
};
function jinxDetail(a: { k: string; mag: number }): string {
  switch (a.k) {
    case 'jelly': return L(`移速 −${Math.round(a.mag * 100)}%`, `−${Math.round(a.mag * 100)}% speed`);
    case 'dance': return L('脚步乱跳', 'your steps wander');
    case 'boils': return L(`每秒 −${a.mag} 生命，不会打晕你`, `−${a.mag} HP/s, never knocks you out`);
    case 'bats': return L(`每秒 −${a.mag} 生命，外加短暂沉默`, `−${a.mag} HP/s and a brief silence`);
    default: return '';
  }
}
/**
 * The curse banner's words (§C.6): what is on you, how to end it, how to find out who. `hexed` is false when only
 * the post-cleanse respite is left (the banner then shows a quiet line instead). Never names a sender.
 */
export function curseText(h: HexState | null | undefined): { hexed: boolean; head: string; parts: string[]; cure: string; who: string; resting: string | null; respite: string | null } | null {
  if (!h) return null;
  const parts: string[] = h.auras.map((a) => {
    const n = JINX_LABEL[a.k] ?? { zh: a.k, en: a.k };
    const d = jinxDetail(a);
    return `${L(n.zh, n.en)}${d ? L(`（${d}）`, ` (${d})`) : ''} ${L(`${a.left} 秒`, `${a.left}s`)}`;
  });
  if (h.silenced > 0) parts.push(L(`🤐 锁舌封喉：${h.silenced} 秒内不能施法、不能公开说话（猫头鹰照飞）`, `🤐 Langlock: no casting or speaking aloud for ${h.silenced}s (owls still fly)`));
  for (const b of h.bound) parts.push(L(`🔒 「${b.name}」粘在身上（剩 ${b.left} 秒）`, `🔒 "${b.name}" is stuck to you (${b.left}s)`));
  const hexed = parts.length > 0;
  const resting = hexed && h.auras.length && (h.safe || h.pvp === false)
    ? (h.safe ? L('你在安全区里，恶咒暂停中。', 'You are in a safe zone: the jinxes are resting.') : L('魔法部法令关闭了决斗，恶咒暂停中。', 'A decree has switched duelling off: the jinxes are resting.'))
    : null;
  return {
    hexed,
    head: L('⚠️ 有人给你下了黑魔法：', '⚠️ Someone has put Dark magic on you: '),
    parts,
    cure: L('解除：念「咒立停 Finite Incantatem」；进安全区会暂停；或者等它消退。', 'To end it: cast Finite Incantatem; a safe zone suspends it; or wait for it to wear off.'),
    who: L('想知道是谁？念「原形立现 Revelio」。', 'Want to know who? Cast Revelio.'),
    resting,
    respite: h.respite > 0 ? L(`🛡️ 喘息：${h.respite} 秒内不会再中恶咒。`, `🛡️ Respite: no new jinx can reach you for ${h.respite}s.`) : null,
  };
}

/**
 * One panel at a time: opening `el` closes every other big panel (the sheets). The small modal question
 * (#atask) and the Marauder's Map (a state of the world, not a panel) are left alone.
 */
export const PANELS = ['book', 'seals', 'board', 'menu', 'owl', 'trunk', 'helppanel'];
export function solo(el: HTMLElement) {
  for (const id of PANELS) { const p = document.getElementById(id); if (p && p !== el) p.hidden = true; }
}

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc =(s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const now = () => performance.now() / 1000;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const BENIGN = new Set<CreatureKind>(['unicorn', 'phoenix']);
const EN_CREATURE: Record<CreatureKind, string> = { pixie: 'Cornish Pixie', snare: "Devil's Snare", spider: 'Acromantula', troll: 'Mountain Troll', dementor: 'Dementor', inferius: 'Inferius', unicorn: 'Unicorn', phoenix: 'Fawkes', serpent: 'Serpent', birds: 'Birds' };
/** Rough body heights and footprints, for screen-space picking and the size of the target ring. */
const HEIGHT: Record<CreatureKind, number> = { pixie: 1.5, snare: 1.3, spider: 1.4, troll: 3.8, dementor: 3.2, inferius: 1.9, unicorn: 2.1, phoenix: 3, serpent: 0.7, birds: 2.4 };
const SIZE: Record<CreatureKind, number> = { pixie: 0.8, snare: 1.4, spider: 1.2, troll: 1.7, dementor: 1.1, inferius: 0.9, unicorn: 1.2, phoenix: 1, serpent: 0.9, birds: 1.2 };
const REL_COLOR: Record<Rel, number> = { self: 0x9fd3ff, ally: 0x6cff8a, hostile: 0xff4a4a, neutral: 0xffe08a };
const REL_CSS: Record<Rel, string> = { self: '#9fd3ff', ally: '#7dff9a', hostile: '#ff6b6b', neutral: '#ffe08a' };
const PICK_PX = 48;
const FRIEND_PX = 22;
const HARM_RANGE = 32;
const HELP_RANGE = 20;
const REVIVE_RANGE = 6;

export type Controls = ReturnType<typeof createControls>;

export function createControls(d: ControlsDeps) {
  // ------------------------------------------------------------------ state
  const aim = new THREE.Vector3();
  const keys = new Set<string>();
  const joy = { x: 0, y: 0 };
  let mx = -1e4, my = -1e4, mouseIn = false, overCanvas = false;
  let hovered: string | null = null;
  let target: string | null = null;
  let selected = 0;
  let dragging = false, lastDrag = -1e9;
  let dest: { x: number; z: number; t: number; pending: boolean; lastMove: number; px: number; pz: number } | null = null;
  let lastGoto = 0;
  const spellInfo = new Map<string, { incantation: string; effects: string[] }>();
  const fullCd = new Map<string, number>();
  const pendingCasts: { name: string; kind: SpellKind; target: string | null; targetKind: CreatureKind | 'wizard' | null }[] = [];
  let seals: { tier: number; zh: string; name: string; requiresYear?: number; pages: { page: number; where: string; collected: boolean }[] }[] | null = null;
  let sealsAsked = -1, lastRead = -1e9;
  let hotbarSig = '';
  /** A phone or tablet: no hover, a coarse pointer. (Touch laptops keep the mouse UI; their touches still work.) */
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const canTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // ------------------------------------------------------------------ the world, as the controls see it
  let snapRef: CSnap | null = null;
  const wIdx = new Map<string, CWizard>();
  const cIdx = new Map<string, CCreature>();
  function index() {
    const s = d.snap();
    if (!s || s === snapRef) return;
    snapRef = s;
    wIdx.clear(); cIdx.clear();
    for (const w of s.w) wIdx.set(w.h, w);
    for (const c of s.c) cIdx.set(c.i, c);
  }
  const model = (k: string) => d.wizards.get(k) ?? d.creatures.get(k);
  const myPos = () => d.wizards.get(d.myHandle())?.root.position ?? null;
  const distTo = (k: string) => { const p = myPos(), m = model(k); return p && m ? Math.hypot(m.root.position.x - p.x, m.root.position.z - p.z) : Infinity; };
  const isFallen = (k: string) => { const w = wIdx.get(k); return !!w && w.s.includes('X') && !w.s.includes('J'); };

  /**
   * Mirrors World.canHarm's intent for the default rules: other houses and wild beasts are foes; your house and its
   * summons are friends. NPC classmates of other houses only fight those who attack them, so they read as neutral:
   * never auto-targeted, but still attackable on purpose (target one, then press a spell key).
   */
  function relation(k: string): Rel {
    const me = d.me(), mh = d.myHandle();
    if (k === mh) return 'self';
    const w = wIdx.get(k);
    if (w) return me && w.ho === me.house ? 'ally' : w.s.includes('N') ? 'neutral' : 'hostile';
    const c = cIdx.get(k);
    if (!c) return 'neutral';
    if (c.o) {
      if (c.o === mh) return 'ally';
      const ow = wIdx.get(c.o);
      // harming a summon counts as attacking its owner, so an NPC's summon is as neutral as the NPC
      return ow && me && ow.ho === me.house ? 'ally' : ow?.s.includes('N') ? 'neutral' : 'hostile';
    }
    return BENIGN.has(c.k) ? 'neutral' : 'hostile';
  }
  /** Could a spell hurt it at all (explicitly targeted)? Other-house wizards and their summons, NPCs included, and anything hostile. */
  function attackable(k: string) {
    const rel = relation(k);
    if (rel !== 'hostile' && !(rel === 'neutral' && (wIdx.has(k) || !!cIdx.get(k)?.o))) return false;
    const e = wIdx.get(k) ?? cIdx.get(k), m = model(k);
    if (!e || !m || e.hp <= 0) return false;
    if (wIdx.has(k) && (e.s.includes('X') || e.s.includes('J'))) return false;
    return !zonesAt(m.root.position.x, m.root.position.z).includes('great_hall');
  }
  /** A foe: what clicks, Tab and smart casting go for without being told. */
  const harmable = (k: string) => relation(k) === 'hostile' && attackable(k);
  const heightOf = (k: string) => { const c = cIdx.get(k); return c ? HEIGHT[c.k] ?? 1.5 : 2.0; };
  const allKeys = () => [...d.wizards.keys(), ...d.creatures.keys()].filter((k) => k !== d.myHandle());

  // ------------------------------------------------------------------ screen-space picking
  const v3 = new THREE.Vector3();
  function screenOf(x: number, y: number, z: number): { x: number; y: number } | null {
    v3.set(x, y, z).project(d.camera);
    if (v3.z > 1 || v3.z < -1) return null;
    return { x: ((v3.x + 1) / 2) * d.canvas.clientWidth, y: ((1 - v3.y) / 2) * d.canvas.clientHeight };
  }
  function segDist(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }) {
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / l2)) : 0;
    return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
  }
  /** The entity whose body passes closest to the pointer on screen, within `radius` px (optionally only those passing `only`). */
  function pickNear(px: number, py: number, radius: number, only?: (k: string) => boolean): string | null {
    let best: string | null = null, bd = Infinity, bCam = Infinity;
    const cp = d.camera.position;
    for (const k of allKeys()) {
      if (only && !only(k)) continue;
      const p = model(k)!.root.position;
      const cam = p.distanceTo(cp);
      if (cam > 110) continue;
      const a = screenOf(p.x, p.y + 0.15, p.z), b = screenOf(p.x, p.y + heightOf(k), p.z);
      if (!a || !b) continue;
      const dd = segDist(px, py, a, b);
      if (dd > radius) continue;
      // the one nearest the pointer; on a near tie, the one nearer the camera (it is drawn in front)
      if (dd < bd - 6 || (Math.abs(dd - bd) <= 6 && cam < bCam)) { best = k; bd = dd; bCam = cam; }
    }
    return best;
  }
  /** Foes are generous to point at (PICK_PX); friends and bystanders need a closer aim, so clicking the ground beside them still walks. */
  const pickAt = (px: number, py: number) => pickNear(px, py, PICK_PX, harmable) ?? pickNear(px, py, FRIEND_PX);

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  function groundAt(px: number, py: number, out: THREE.Vector3) {
    ndc.set((px / d.canvas.clientWidth) * 2 - 1, -(py / d.canvas.clientHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, d.camera);
    if (rayGround(raycaster.ray, out)) return out;
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hit)) return out.copy(hit);
    return null;
  }
  /** Where a spell goes when it has no target: the cursor on the ground, else straight ahead of the camera. */
  function fallbackAim() {
    if (mouseIn && overCanvas) return { x: aim.x, z: aim.z };
    const p = myPos();
    if (!p) return { x: aim.x, z: aim.z };
    return { x: p.x - Math.sin(d.cam.yaw) * 14, z: p.z - Math.cos(d.cam.yaw) * 14 };
  }

  // ------------------------------------------------------------------ targets
  function setTarget(k: string | null) { target = k; }
  function clearTarget() { if (!target) return false; target = null; return true; }
  /**
   * Foes within `range` of you that the camera can see: inside its forward cone (apex at the camera, so something
   * just behind you but on screen still counts), plus anything within `closeAnyway` metres. Nearest first;
   * with `beastsFirst`, wild creatures come before wizards (so a stray key press does not start a duel).
   */
  function hostilesAhead(range: number, coneDeg: number, beastsFirst: boolean, closeAnyway = 5) {
    const p = myPos();
    if (!p) return [];
    const cp = d.camera.position;
    const fx = -Math.sin(d.cam.yaw), fz = -Math.cos(d.cam.yaw), cosMax = Math.cos((coneDeg * Math.PI) / 180);
    const out: { k: string; dist: number; wiz: number }[] = [];
    for (const k of allKeys()) {
      if (!harmable(k)) continue;
      const q = model(k)!.root.position;
      const dist = Math.hypot(q.x - p.x, q.z - p.z);
      if (dist > range) continue;
      const cx = q.x - cp.x, cz = q.z - cp.z, cl = Math.hypot(cx, cz);
      const cos = cl > 0.01 ? (cx * fx + cz * fz) / cl : 1;
      if (cos < cosMax && dist > closeAnyway) continue;
      out.push({ k, dist, wiz: beastsFirst && wIdx.has(k) ? 1 : 0 });
    }
    return out.sort((a, b) => a.wiz - b.wiz || a.dist - b.dist).map((x) => x.k);
  }
  let tabbed = new Set<string>(), lastTab = 0;
  function cycleTarget() {
    const t = now();
    if (t - lastTab > 4) tabbed = new Set();
    lastTab = t;
    const p = myPos();
    // wild creatures first: a newcomer's Tab should find the pixie, not a rival player
    const list = hostilesAhead(45, 42, true);
    if (!list.length || !p) { d.toast(L('前方没有可以攻击的目标。转动镜头（右键拖动 / Q E）再试试。', 'No foe ahead. Turn the camera (right-drag / Q E) and try again.')); return; }
    let next = list.find((k) => !tabbed.has(k) && k !== target);
    if (!next) { tabbed = new Set(); next = list.find((k) => k !== target) ?? list[0]; }
    tabbed.add(next);
    setTarget(next);
  }
  /** Fallen wizards within `range`, nearest first: only friends (your house, its NPCs included) unless `anyone`. */
  function fallenNear(range: number, anyone = false) {
    return [...wIdx.values()]
      .filter((w) => w.h !== d.myHandle() && isFallen(w.h) && (anyone || relation(w.h) === 'ally') && distTo(w.h) <= range)
      .sort((a, b) => distTo(a.h) - distTo(b.h)).map((w) => w.h);
  }
  /** The friend the F key and an untargeted Rennervate lift. A stunned rival is never picked for you. */
  const nearestFallen = (range: number) => fallenNear(range)[0] ?? null;

  // ------------------------------------------------------------------ casting
  const kindOf = (s: CSlot): SpellKind => s.kind ?? 'harm';
  const isRevive = (s: CSlot) => spellInfo.get(s.id)?.effects.includes('revive') ?? s.name === 'Rennervate';
  /** Choose what a spell should land on when the player gave no explicit instruction. */
  function chooseTarget(s: CSlot): string | null {
    const kind = kindOf(s);
    if (kind === 'harm') {
      if (target && attackable(target) && distTo(target) <= 45) return target;
      if (hovered && harmable(hovered) && distTo(hovered) <= 45) return hovered;
      const auto = hostilesAhead(HARM_RANGE, 42, true)[0] ?? null;
      if (auto) setTarget(auto);
      return auto;
    }
    if (kind === 'help') {
      if (isRevive(s)) {
        const down = (k: string | null): k is string => !!k && isFallen(k) && distTo(k) <= REVIVE_RANGE;
        // a friend first (the one you point at or target, else the nearest); a rival only if you point at or target them on purpose
        for (const k of [hovered, target]) if (down(k) && relation(k) === 'ally') return k;
        return nearestFallen(REVIVE_RANGE) ?? [hovered, target].find(down) ?? null;
      }
      const friend = (k: string | null) => !!k && wIdx.has(k) && relation(k) === 'ally' && !isFallen(k) && distTo(k) <= HELP_RANGE;
      if (friend(hovered)) return hovered;
      if (friend(target)) return target;
      return d.myHandle() || null;
    }
    return null;
  }
  function castSlot(i: number, opts: { at?: { x: number; z: number } } = {}) {
    const me = d.me();
    if (!me) return;
    const s = me.hotbar[i];
    if (!s) { d.toast(L(`快捷栏 ${i + 1} 是空的 —— 按 B 打开咒语书，把咒语放进来。`, `Hotbar slot ${i + 1} is empty — press B to put a spell there.`)); return; }
    const kind = kindOf(s);
    // a revive ignores where it is aimed (the server lifts its target, else whoever is nearest), so it always picks its own
    const revive = kind === 'help' && isRevive(s);
    const tgt = opts.at && !revive ? null : chooseTarget(s);
    // untargeted, the server's Rennervate lifts the nearest fallen wizard, rival or not: never hand a beaten foe back up by accident
    if (!tgt && revive && fallenNear(REVIVE_RANGE + 1, true).length) {
      d.toast(L('附近倒下的只有对手。真想扶起他，就先用鼠标指向或锁定他，再按这个键。', 'Only rivals are down nearby. To revive one anyway, point at or target them first, then press the key.'));
      return;
    }
    const m = tgt ? model(tgt) : null;
    const p = m ? { x: m.root.position.x, z: m.root.position.z } : opts.at ?? fallbackAim();
    d.send({ t: 'cast', key: String(i + 1), x: p.x, z: p.z, target: tgt ?? undefined });
    pendingCasts.push({ name: s.name, kind, target: tgt, targetKind: tgt ? (cIdx.get(tgt)?.k ?? (wIdx.has(tgt) ? 'wizard' : null)) : null });
    if (pendingCasts.length > 20) pendingCasts.shift();
    if (kind === 'harm') selected = i;
  }
  /** Cast a spell by name or id at the cursor / current target (the spellbook's Cast button). */
  function castKey(key: string) {
    const k = target ?? hovered;
    d.send({ t: 'cast', key, x: aim.x, z: aim.z, target: k ?? undefined });
    pendingCasts.push({ name: key, kind: 'self', target: k, targetKind: null });
  }
  /** Cast a spell by name on yourself (the trunk's and the curse banner's Finite Incantatem / Revelio buttons). */
  function castOnSelf(key: string) {
    const p = myPos();
    d.send({ t: 'cast', key, x: p?.x ?? aim.x, z: p?.z ?? aim.z, target: d.myHandle() || undefined });
    pendingCasts.push({ name: key, kind: 'self', target: null, targetKind: null });
  }
  /** Cast a spell by its key (name or id) at a given entity; used by the action key. */
  function castAt(key: string, k: string) {
    const m = model(k);
    if (!m) return;
    d.send({ t: 'cast', key, x: m.root.position.x, z: m.root.position.z, target: k });
    pendingCasts.push({ name: key, kind: 'help', target: k, targetKind: 'wizard' });
  }

  // ------------------------------------------------------------------ click-to-move
  const destMarker = makeDestMarker();
  d.scene.add(destMarker);
  function walkTo(x: number, z: number) {
    const t = now();
    if (t - lastGoto < 0.12) return;
    lastGoto = t;
    const p = myPos();
    dest = { x, z, t, pending: true, lastMove: t, px: p?.x ?? 0, pz: p?.z ?? 0 };
    d.send({ t: 'goto', x, z });
  }
  function clearDest() { dest = null; }

  // ------------------------------------------------------------------ target ring (persistent target)
  const targetRing = makeTargetRing();
  d.scene.add(targetRing);

  // ------------------------------------------------------------------ the action key (F)
  type Action = { label: string; x: number; z: number; y: number; act: () => void };
  let action: Action | null = null;
  function reviveKey(): string | null {
    const me = d.me();
    if (!me) return null;
    const slot = me.hotbar.findIndex((s) => s && isRevive(s));
    if (slot >= 0) return String(slot + 1);
    for (const [id, info] of spellInfo) if (info.effects.includes('revive')) return id;
    return me.year >= 3 ? 'Rennervate' : null;
  }
  function findAction(): Action | null {
    const me = d.me(), p = myPos();
    if (!me || !p || me.stunned || me.jailed) return null;
    const fallen = nearestFallen(REVIVE_RANGE);
    const rk = fallen ? reviveKey() : null;
    if (fallen && rk) {
      const w = wIdx.get(fallen)!, m = model(fallen)!.root.position;
      return { label: L(`按 F 扶起 ${esc(w.n)}（快快复苏）`, `F — revive ${esc(w.n)} (Rennervate)`), x: m.x, z: m.z, y: m.y + 2.6, act: () => castAt(rk, fallen) };
    }
    if (seals) {
      for (const s of seals) {
        if (s.tier <= me.seals) continue;
        // a seal below its year will not even speak to you: no prompt at the spawn for a first-year
        if (me.year < (s.requiresYear ?? 1)) continue;
        for (const pg of s.pages) {
          if (pg.collected) continue;
          const l = LANDMARKS.find((x) => x.name === pg.where);
          if (!l || Math.hypot(l.x - p.x, l.z - p.z) > 9.5) continue;
          return {
            label: L(`按 F 阅读书页 ·「${esc(s.zh)}」第 ${pg.page} 页`, `F — read the page (${esc(s.name.split('—')[0].trim())}, page ${pg.page})`),
            x: l.x, z: l.z, y: heightAt(l.x, l.z) + 3.8,
            act: () => { lastRead = now(); d.send({ t: 'readpage', tier: s.tier }); },
          };
        }
      }
    }
    return null;
  }
  function doAction() {
    const a = findAction();
    if (a) a.act();
  }

  // ------------------------------------------------------------------ input: keyboard
  /** Game keys that main.ts did not claim (panels, chat and Esc stay in main.ts). Returns true when handled. */
  function keydown(e: KeyboardEvent): boolean {
    const k = e.key;
    if (!d.me()) return false;
    if (k === 'Tab') { e.preventDefault(); if (!e.repeat) cycleTarget(); return true; }
    if (/^[1-6]$/.test(k)) { castSlot(Number(k) - 1); return true; }
    if (k === 'f' || k === 'F') { if (!e.repeat) doAction(); return true; }
    if (k === 'h' || k === 'H' || k === '?') { if (!e.repeat) toggleHelp(); return true; }
    keys.add(k.toLowerCase());
    return false;
  }
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); dragging = false; });

  // ------------------------------------------------------------------ input: mouse
  d.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  d.canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { dragging = true; return; }
    if (e.button !== 0) return;
    mx = e.clientX; my = e.clientY; mouseIn = true; overCanvas = true;
    primaryAt(e.clientX, e.clientY, e.shiftKey);
  });
  addEventListener('mouseup', (e) => { if (e.button === 2) dragging = false; });
  addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY; mouseIn = true;
    overCanvas = e.target === d.canvas;
    const ch = $('#crosshair');
    ch.style.left = `${e.clientX}px`;
    ch.style.top = `${e.clientY}px`;
    if (dragging) {
      d.cam.yaw -= e.movementX * 0.005;
      d.cam.pitch = Math.max(0.1, Math.min(1.3, d.cam.pitch + e.movementY * 0.004));
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) lastDrag = now();
    }
  });
  addEventListener('mouseout', (e) => { if (!e.relatedTarget) mouseIn = false; });
  d.canvas.addEventListener('wheel', (e) => { d.cam.dist = Math.max(5, Math.min(40, d.cam.dist + e.deltaY * 0.01)); }, { passive: true });

  /** Left click / tap: a foe → target it and cast the attack spell; a friend → target it; the ground → walk there. Shift: cast at the ground. */
  function primaryAt(px: number, py: number, shift = false) {
    if (!d.me()) return;
    groundAt(px, py, aim);
    if (shift) { castSlot(selected, { at: { x: aim.x, z: aim.z } }); return; }
    const k = pickAt(px, py);
    if (k) {
      setTarget(k);
      if (harmable(k)) castSlot(selected);
      return;
    }
    walkTo(aim.x, aim.z);
  }

  // ------------------------------------------------------------------ input: touch (virtual joystick, tap, drag to look, pinch to zoom)
  function setupTouch() {
    if (touch) document.body.classList.add('touch');
    if (!canTouch) return;
    const stick = $('#stick'), knob = stick.querySelector('i') as HTMLElement;
    let stickId: number | null = null, sx = 0, sy = 0;
    let lookId: number | null = null, lx = 0, ly = 0, lx0 = 0, ly0 = 0, lt0 = 0, lookMoved = false;
    let pinch = 0;
    const R = 55;
    d.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (stickId === null && t.clientX < innerWidth * 0.42 && t.clientY > innerHeight * 0.3) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = `${sx}px`; stick.style.top = `${sy}px`; stick.classList.add('on');
          knob.style.transform = 'translate(-50%, -50%)';
        } else if (lookId === null) {
          lookId = t.identifier; lx = lx0 = t.clientX; ly = ly0 = t.clientY; lt0 = e.timeStamp; lookMoved = false;
        }
      }
      if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }, { passive: false });
    d.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 2 && stickId === null) {
        const p = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinch) d.cam.dist = Math.max(5, Math.min(40, d.cam.dist - (p - pinch) * 0.05));
        pinch = p; lookMoved = true;
        return;
      }
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stickId) {
          let x = t.clientX - sx, y = t.clientY - sy;
          const l = Math.hypot(x, y);
          if (l > R) { x = (x / l) * R; y = (y / l) * R; }
          joy.x = x / R; joy.y = y / R;
          knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
        } else if (t.identifier === lookId) {
          const dx = t.clientX - lx, dy = t.clientY - ly;
          lx = t.clientX; ly = t.clientY;
          if (Math.hypot(t.clientX - lx0, t.clientY - ly0) > 12) lookMoved = true;
          if (lookMoved) {
            d.cam.yaw -= dx * 0.006;
            d.cam.pitch = Math.max(0.1, Math.min(1.3, d.cam.pitch + dy * 0.004));
            lastDrag = now();
          }
        }
      }
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stickId) { stickId = null; joy.x = joy.y = 0; stick.classList.remove('on'); }
        else if (t.identifier === lookId) {
          lookId = null;
          if (!lookMoved && e.timeStamp - lt0 < 450) primaryAt(t.clientX, t.clientY);
        }
      }
      if (e.touches.length < 2) pinch = 0;
    };
    d.canvas.addEventListener('touchend', end);
    d.canvas.addEventListener('touchcancel', end);
    $('#tb-menu').onclick = () => { d.panels.menu(); tutorial.notify('menu'); };
    $('#tb-book').onclick = () => d.panels.book();
    $('#tb-tab').onclick = () => cycleTarget();
    $('#tb-act').onclick = () => doAction();
    $('#tb-help').onclick = () => toggleHelp();
    $('#tb-owl').onclick = () => d.panels.owl();
    $('#tb-trunk').onclick = () => d.panels.trunk();
  }

  // ------------------------------------------------------------------ per-frame update (called from main.ts' frame loop)
  let lastInput = '', inputTimer = 0, facing = 0;
  /**
   * Keyboard movement is read relative to the camera as it was when the current key combination began (plus any
   * turning the player does by hand). The automatic drift below turns only the camera, not that basis, so it can swing
   * in behind a strafe or a diagonal run without bending the run into a circle. Pressing another key combination
   * re-reads the keys against the camera you now see; the joystick is always read against the live camera.
   */
  let moveSig = '', moveSince = 0, driftOff = 0, promptW = 0;
  function update(dt: number) {
    index();
    d.camera.updateMatrixWorld();
    const t = now();
    const me = d.me();
    // camera turn keys (turning by hand pauses the drift, like a right-drag)
    if (keys.has('q')) { d.cam.yaw += dt * 1.8; lastDrag = t; }
    if (keys.has('e')) { d.cam.yaw -= dt * 1.8; lastDrag = t; }
    // movement: WASD / arrows / joystick, camera-relative
    let kx = 0, kz = 0;
    if (keys.has('w') || keys.has('arrowup')) kz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) kz += 1;
    if (keys.has('a') || keys.has('arrowleft')) kx -= 1;
    if (keys.has('d') || keys.has('arrowright')) kx += 1;
    const stick = Math.hypot(joy.x, joy.y) >= 0.05;
    const sig = stick ? 'stick' : `${kx},${kz}`;
    if (sig !== moveSig) { moveSig = sig; moveSince = t; driftOff = 0; }
    const fx = joy.x + kx, fz = joy.y + kz;
    const base = d.cam.yaw - driftOff;
    const s = Math.sin(base), c = Math.cos(base);
    let dx = fx * c + fz * s, dz = -fx * s + fz * c;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    if (len < 0.05) dx = dz = 0;
    const moving = len >= 0.05;
    if (moving && dest) clearDest();
    // after a moment on the same keys the camera drifts in behind the way you run; never while backing up, never for
    // a quick sidestep, never soon after you turned it yourself, and never for the joystick (the other thumb looks)
    if (moving && !stick && kz <= 0 && t - moveSince > 0.7 && !dragging && t - lastDrag > 3) {
      const step = wrap(Math.atan2(-dx, -dz) - d.cam.yaw) * Math.min(1, dt * 0.55);
      d.cam.yaw += step;
      driftOff += step;
    }

    // hover + aim
    if (mouseIn && overCanvas) {
      groundAt(mx, my, aim);
      hovered = pickAt(mx, my);
    } else hovered = null;
    if (target && (!model(target) || distTo(target) > 80)) target = null;
    if (hovered && !model(hovered)) hovered = null;

    // facing: where you run, else your target, else the cursor
    const p = myPos();
    if (p) {
      if (moving) facing = Math.atan2(dx, -dz);
      else if (dest) facing = Math.atan2(dest.x - p.x, -(dest.z - p.z));
      else if (target) { const q = model(target)!.root.position; facing = Math.atan2(q.x - p.x, -(q.z - p.z)); }
      else if (mouseIn && overCanvas) facing = Math.atan2(aim.x - p.x, -(aim.z - p.z));
    }
    const key = `${dx.toFixed(2)},${dz.toFixed(2)},${facing.toFixed(1)}`;
    inputTimer -= dt;
    if (key !== lastInput || inputTimer <= 0) { d.send({ t: 'input', dx, dz, f: facing }); lastInput = key; inputTimer = 0.25; }

    // destination: arrive, get stuck, or get knocked out
    if (dest && p) {
      if (Math.hypot(p.x - dest.px, p.z - dest.pz) > 0.08) { dest.lastMove = t; dest.px = p.x; dest.pz = p.z; }
      if (Math.hypot(p.x - dest.x, p.z - dest.z) < 1.1 || (!dest.pending && t - dest.lastMove > 1.6) || me?.stunned || me?.jailed) clearDest();
    }
    destMarker.visible = !!dest;
    if (dest) {
      destMarker.position.set(dest.x, heightAt(dest.x, dest.z) + 0.08, dest.z);
      const k = (t * 1.6) % 1;
      const pulse = destMarker.children[1];
      pulse.scale.setScalar(0.6 + k * 1.2);
      ((pulse as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      destMarker.children[2].position.y = 1.1 + Math.sin(t * 4) * 0.15;
    }

    // rings
    const ring = (mesh: THREE.Object3D, k: string | null, scale: number) => {
      const m = k ? model(k) : null;
      mesh.visible = !!m;
      if (!m || !k) return;
      const q = m.root.position;
      mesh.position.set(q.x, heightAt(q.x, q.z) + 0.1, q.z);
      const ck = cIdx.get(k)?.k;
      // grow with distance so a far-off pixie's ring stays readable
      const far = Math.max(1, d.camera.position.distanceTo(q) / 28);
      mesh.scale.setScalar(scale * (ck ? SIZE[ck] ?? 1 : 1) * far);
      const col = REL_COLOR[relation(k)];
      mesh.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (mm?.color) mm.color.setHex(col); });
    };
    ring(d.hoverRing, hovered && hovered !== target ? hovered : null, 1);
    ring(targetRing, target, 1);
    if (target && targetRing.visible) {
      targetRing.rotation.y = t * 1.2;
      const chevron = targetRing.children[1];
      chevron.position.y = heightOf(target) / Math.max(0.5, targetRing.scale.y) + 0.9 + Math.sin(t * 3) * 0.12;
    }
    const ch = $('#crosshair');
    const hr = hovered ? relation(hovered) : null;
    ch.classList.toggle('lock', hr === 'hostile');
    ch.classList.toggle('ally', hr === 'ally' || hr === 'neutral');

    // floating action prompt follows its anchor
    const pr = $('#prompt');
    if (action) {
      const sp = screenOf(action.x, action.y, action.z);
      const W = d.canvas.clientWidth, H = d.canvas.clientHeight;
      // (its width is measured once per label, not every frame: reading it forces a layout)
      if (!promptW) promptW = pr.offsetWidth || 240;
      const hw = Math.min(W / 2, promptW / 2 + 8);
      const x = sp ? Math.max(hw, Math.min(W - hw, sp.x)) : W / 2;
      const y = sp ? Math.max(60, Math.min(H - 190, sp.y)) : H - 190;
      const left = `${Math.round(x)}px`, top = `${Math.round(y)}px`;
      if (pr.style.left !== left) pr.style.left = left;
      if (pr.style.top !== top) pr.style.top = top;
    }
  }

  // ------------------------------------------------------------------ HUD (called from main.ts' 10 Hz hud())
  function hud() {
    index();
    const me = d.me();
    if (!me) return;
    // cache what the hotbar spells are (incantation, effects) from the armory whenever the hotbar changes
    const sig = me.hotbar.map((s) => s?.id ?? '').join('|');
    if (sig !== hotbarSig) { hotbarSig = sig; d.send({ t: 'book' }); }
    for (const s of me.hotbar) if (s && s.cd > (fullCd.get(s.id) ?? 0) + 0.05) fullCd.set(s.id, s.cd);
    if (sealsAsked !== me.seals) { sealsAsked = me.seals; d.send({ t: 'seals' }); }
    // keep the hotbar's click spell an attack spell if there is one
    const sel = me.hotbar[selected];
    if (!sel || kindOf(sel) !== 'harm') { const h = me.hotbar.findIndex((s) => s && kindOf(s) === 'harm'); if (h >= 0) selected = h; }
    renderTargetFrame();
    action = findAction();
    const pr = $('#prompt');
    pr.hidden = !action;
    if (action && pr.dataset.label !== action.label) { pr.dataset.label = action.label; pr.innerHTML = `<kbd>F</kbd> ${action.label.replace(/^按 F |^F — /, '')}`; promptW = 0; }
    const tip = $('#tip');
    if (!tip.hidden && tipSlot >= 0) renderTip(tipSlot);
    tutorial.tick();
    const full = tutorial.active();
    const help = $('#help');
    if (help.classList.contains('full') !== full) help.classList.toggle('full', full);
  }

  function renderTargetFrame() {
    const el = $('#target');
    const k = target ?? hovered;
    const e = k ? wIdx.get(k) ?? cIdx.get(k) : null;
    if (!k || !e || !model(k)) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('hover', !target);
    const rel = relation(k);
    const w = wIdx.get(k), c = cIdx.get(k);
    const relText = { self: L('你自己', 'You'), ally: L('友方', 'Friend'), hostile: L('敌对', 'Foe'), neutral: L('中立', 'Neutral') }[rel];
    let name: string, sub: string;
    if (w) {
      name = `${w.t ? `<span class="tf-title">[${esc(w.t)}]</span> ` : ''}${esc(w.n)}`;
      sub = `${houseName(w.ho)} · ${L(`${w.y} 年级`, `Year ${w.y}`)}${w.s.includes('N') ? (rel === 'neutral' ? L(' · NPC 同学：你不招惹，它不动手', ' · NPC classmate: leaves you alone unless attacked') : ' · NPC') : ''}`;
    } else {
      name = esc(creatureName(c!.k, EN_CREATURE[c!.k]));
      const ow = c!.o ? wIdx.get(c!.o) : null;
      sub = c!.o ? (c!.o === d.myHandle() ? L('你的召唤物', 'your summon') : L(`${ow ? esc(ow.n) : '某人'} 的召唤物`, `${ow ? esc(ow.n) : 'someone'}'s summon`)) : BENIGN.has(c!.k) ? L('友善魔物 —— 别伤害它', 'benign — do not harm it') : L('野生魔物', 'wild creature');
    }
    const status: string[] = [];
    if (w?.s.includes('X')) status.push(L('💫 被击晕', '💫 stunned'));
    if (w?.s.includes('S')) status.push(L('🛡️ 护盾', '🛡️ shielded'));
    if (e.s.includes('R')) status.push(L('🌿 定身', '🌿 rooted'));
    if (w?.s.includes('Q')) status.push(L('🤐 沉默', '🤐 silenced'));
    const jinx = [['j', 'jelly'], ['z', 'dance'], ['b', 'boils'], ['t', 'bats']].filter(([f]) => e.s.includes(f)).map(([, k]) => L(JINX_LABEL[k].zh, JINX_LABEL[k].en));
    if (jinx.length) status.push(`🕸️ ${jinx.join('、')}`);
    const m = model(k)!.root.position;
    if (zonesAt(m.x, m.z).includes('great_hall')) status.push(L('🕊️ 安全区', '🕊️ safe zone'));
    const dist = distTo(k);
    const frac = Math.max(0, Math.min(1, e.hp / Math.max(1, e.m)));
    if (!el.firstElementChild) {
      el.innerHTML = '<div class="tf-top"><span class="tf-rel"></span><b class="tf-name"></b><button class="tf-x" title="Esc">×</button></div><div class="tf-bar"><i></i><span></span></div><div class="tf-sub"></div>';
      (el.querySelector('.tf-x') as HTMLElement).onclick = () => { target = null; renderTargetFrame(); };
    }
    const set = (sel: string, html: string) => { const n = el.querySelector(sel) as HTMLElement; if (n.innerHTML !== html) n.innerHTML = html; };
    if (el.style.getPropertyValue('--rel') !== REL_CSS[rel]) el.style.setProperty('--rel', REL_CSS[rel]);
    set('.tf-rel', relText);
    set('.tf-name', name);
    (el.querySelector('.tf-x') as HTMLElement).hidden = !target;
    const bw = `${(frac * 100).toFixed(1)}%`, bi = el.querySelector('.tf-bar i') as HTMLElement;
    if (bi.style.width !== bw) bi.style.width = bw;
    set('.tf-bar span', `${Math.round(e.hp)} / ${Math.round(e.m)}`);
    set('.tf-sub', `${sub} · ${Number.isFinite(dist) ? L(`${dist.toFixed(0)} 米`, `${dist.toFixed(0)} m`) : ''}${status.length ? ' · ' + status.join(' ') : ''}`);
  }

  // ------------------------------------------------------------------ hotbar tooltips
  let tipSlot = -1;
  const hb = $('#hotbar');
  hb.addEventListener('mouseover', (e) => {
    const slot = (e.target as HTMLElement).closest('#hotbar > div') as HTMLElement | null;
    if (!slot) return;
    tipSlot = Array.prototype.indexOf.call(hb.children, slot);
    renderTip(tipSlot);
  });
  hb.addEventListener('mouseleave', () => { tipSlot = -1; $('#tip').hidden = true; });
  function renderTip(i: number) {
    const tip = $('#tip');
    const s = d.me()?.hotbar[i];
    const el = hb.children[i] as HTMLElement | undefined;
    if (!el) { tip.hidden = true; return; }
    if (!s) {
      tip.innerHTML = `<b>${L('空', 'Empty')}</b><div class="hint">${L('按 B 打开咒语书，铸造或选择一个咒语放到这里。', 'Press B to open the spellbook and put a spell here.')}</div>`;
    } else {
      const kind = kindOf(s);
      const info = spellInfo.get(s.id);
      const kindText = { harm: L('⚔️ 攻击咒语 —— 自动瞄准前方最近的敌人', '⚔️ Attack — auto-aims at the nearest foe ahead'), help: isRevive(s) ? L('✚ 复苏 —— 扶起身边倒下的同伴', '✚ Revive — lifts a fallen friend nearby') : L('✚ 辅助咒语 —— 作用于指向的队友或你自己', '✚ Support — lands on the friend you point at, or you'), self: L('✦ 自身咒语 —— 无需目标', '✦ Self — needs no target') }[kind];
      const cd = s.cd > 0 ? L(`冷却中：${s.cd.toFixed(1)} 秒`, `Recharging: ${s.cd.toFixed(1)}s`) : fullCd.has(s.id) ? L(`冷却 ${fullCd.get(s.id)!.toFixed(1)} 秒`, `Cooldown ${fullCd.get(s.id)!.toFixed(1)}s`) : L('冷却：约 0.3 秒 + 法力÷60', 'Cooldown: ~0.3s + mana/60');
      tip.innerHTML = `<b>${esc(spellName(s.name))}</b>${spellName(s.name) !== s.name ? ` <span class="en">${esc(s.name)}</span>` : ''}` +
        `<div class="inc">“${esc(info?.incantation ?? `${s.name}!`)}”</div>` +
        `<div>${kindText}</div><div class="hint">${cd} · ${L(`按 ${i + 1} 施放`, `press ${i + 1}`)}${i === selected ? L(' · 左键点击敌人时使用', ' · used when you click a foe') : ''}</div>`;
    }
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(innerWidth - 268, r.left + r.width / 2 - 130))}px`;
    tip.style.bottom = `${innerHeight - r.top + 8}px`;
  }

  // ------------------------------------------------------------------ help panel (H / ?)
  function toggleHelp(force?: boolean) {
    const el = $('#helppanel');
    const show = force ?? el.hidden;
    if (show) { renderHelp(); solo(el); }
    el.hidden = !show;
  }
  function renderHelp() {
    const row = (k: string, v: string) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`;
    $('#helppanel').innerHTML = `<h2><span>${L('操作说明', 'Controls')} <small><kbd>H</kbd></small></span> <button class="x" data-close="helppanel" title="Esc"><svg class="ic"><use href="#i-x"/></svg></button></h2>
      <div class="cols"><div>
      <h3>${L('移动', 'Moving')}</h3><table>
      ${row('W A S D', L('移动（相对镜头方向）；跑动时镜头会慢慢转到你身后', 'Move (relative to the camera); the camera drifts in behind you'))}
      ${row(L('左键 地面', 'Click ground'), L('自动寻路走过去（地上会出现金色标记；按 WASD 取消）', 'Walk there by the shortest path (gold marker; WASD cancels)'))}
      ${row(L('右键拖动', 'Right-drag'), L('转动视角（之后几秒镜头不会自动跟随）', 'Turn the camera (auto-follow pauses for a few seconds)'))}
      ${row('Q / E', L('向左 / 向右转镜头', 'Turn the camera left / right'))}
      ${row(L('滚轮', 'Wheel'), L('拉近 / 拉远', 'Zoom'))}
      </table>
      <h3>${L('战斗', 'Fighting')}</h3><table>
      ${row(L('指向', 'Hover'), L('鼠标靠近谁，谁就会被高亮（红 = 敌对，绿 = 友方，黄 = 中立）。NPC 同学是黄色的：不招惹它就不会动手；想和它决斗就先锁定再按数字键', 'Whatever the cursor is near lights up (red foe, green friend, yellow neutral). NPC classmates are yellow: they leave you alone unless attacked; to duel one, target it and press a spell key'))}
      ${row(L('左键 敌人', 'Click foe'), L('锁定它并施放当前的攻击咒语（高亮的快捷栏格子）', 'Target it and cast your current attack spell (the highlighted slot)'))}
      ${row('1 – 6', L('施放快捷栏咒语。没有目标时自动挑选：攻击咒语 → 前方最近的敌人；治疗 / 护盾 → 你指向的队友或你自己；快快复苏 → 最近倒下的同伴', 'Cast a hotbar spell. With no target it picks one: attacks → nearest foe ahead; heals/shields → the friend you point at, or you; Rennervate → the nearest fallen friend'))}
      ${row('Tab', L('在前方的敌人之间切换目标（先魔物、后巫师，由近及远）', 'Cycle through foes ahead: creatures first, then wizards, nearest first'))}
      ${row('Esc', L('取消目标（没有目标时打开菜单）', 'Clear the target (opens the menu when there is none)'))}
      ${row(L('Shift + 左键', 'Shift + click'), L('对鼠标所指的地面施放当前咒语', 'Cast your current spell at the ground under the cursor'))}
      </table></div><div>
      <h3>${L('交互与界面', 'Things & panels')}</h3><table>
      ${row('F', L('交互：在地标旁阅读禁书区的书页、扶起身边倒下的同伴（屏幕上会出现提示）', 'Interact: read a Restricted Section page at its landmark, revive a fallen friend (a prompt appears)'))}
      ${row('B', L('咒语书：阅读、修改、铸造咒语（咒语就是 Runes 程序）', 'Spellbook: read, edit and forge spells (spells are Runes programs)'))}
      ${row('R', L('禁书区：四道封印谜题', 'Restricted Section: four seal puzzles'))}
      ${row('O', L('猫头鹰面板：和你自己的 Agent 私聊、回答它的提问（聊天框里以 @agent 或 @a 开头也行）', 'Owl panel: talk privately with your own agent and answer its questions (or start a chat line with @agent / @a)'))}
      ${row('T', L('行囊：穿上、卸下、销毁物品；解除被诅咒物品的粘身', 'Trunk: equip, unequip and destroy items; break a cursed binding'))}
      ${row('L', L('排行榜与学院杯', 'Leaderboard and House Cup'))}
      ${row(L('回车', 'Enter'), L('聊天（有些话在这里有魔力）', 'Chat (some words have power here)'))}
      ${row('Esc', L('猫头鹰邮递：生成配对码把你的 AI Agent 连进来、管理密钥、切换语言', 'Owl Post: a pairing code to connect your AI agent, your key, the language'))}
      ${row('H / ?', L('打开 / 关闭本帮助', 'This help'))}
      </table>
      <h3>${L('手机 / 平板', 'Phones & tablets')}</h3><p>${L('左下角按住拖动是摇杆；点一下敌人 = 锁定并攻击，点地面 = 走过去；在右侧拖动转视角，双指缩放。', 'Hold and drag on the lower left for a joystick; tap a foe to attack it, tap the ground to walk; drag on the right to look, pinch to zoom.')}</p>
      </div></div>
      <p class="row"><button id="help-goal" class="ghost">${L('显示「下一步」提示', 'Show the next-goal line')}</button> <button id="help-tutorial" class="ghost">${L('重新开始新手引导', 'Restart the tutorial')}</button> <button id="help-close">${L('关闭', 'Close')}</button></p>`;
    $('#help-close').onclick = () => toggleHelp(false);
    $('#help-tutorial').onclick = () => { toggleHelp(false); tutorial.restart(); };
  }

  // ------------------------------------------------------------------ first-run onboarding
  const tutorial = createTutorial({
    me: d.me, myPos, touch,
    creatures: () => [...cIdx.values()],
    creaturePos: (i) => d.creatures.get(i)?.root.position ?? null,
    yaw: () => d.cam.yaw,
    slotOf: (name) => (d.me()?.hotbar.findIndex((s) => s?.name === name) ?? -1),
    openMenu: () => d.panels.menu(),
    openBook: () => d.panels.book(),
    openOwl: () => d.panels.owl(true),
    pair: () => d.pair(),
    agent: d.agent,
    walkTo: (x, z) => { lastGoto = 0; walkTo(x, z); },
    panelOpen: () => PANELS.some((id) => !document.getElementById(id)?.hidden),
  });

  // ------------------------------------------------------------------ server replies (routed from main.ts)
  function onCast(r: { ok: boolean }) {
    const c = pendingCasts.shift();
    if (r.ok && c) tutorial.notify('cast', c);
  }
  function onGoto(goal: { x: number; z: number } | null) {
    if (!dest) return;
    if (!goal) { clearDest(); return; }
    dest.x = goal.x; dest.z = goal.z; dest.pending = false; dest.lastMove = now();
  }
  function onError() {
    if (dest?.pending && now() - dest.t < 3) clearDest();
    // a page read that failed means our copy of the Restricted Section is stale (an agent may have read it over MCP)
    if (now() - lastRead < 3) sealsAsked = -1;
  }
  function onArmory(spells: { id: string; incantation: string; effects: string[] }[]) {
    spellInfo.clear();
    for (const s of spells) spellInfo.set(s.id, { incantation: s.incantation, effects: s.effects });
  }
  function onSeals(section: { seals: { tier: number; zh: string; name: string; requiresYear?: number; pages: { page: number; where: string; collected: boolean }[] }[] }) {
    seals = section.seals;
  }

  setupTouch();
  $('#prompt').onclick = () => doAction();

  return {
    aim,
    get selected() { return selected; },
    /** What the spellbook's Simulate/Cast buttons should aim at. */
    targetKey: () => target ?? hovered,
    keydown, update, hud, castSlot, castKey, castOnSelf, clearTarget, toggleHelp,
    helpOpen: () => !$('#helppanel').hidden,
    notify: (ev: 'book' | 'menu' | 'owl') => tutorial.notify(ev),
    /** The tutorial (or its closing word) is on screen. */
    tutorialActive: () => tutorial.active(),
    onCast, onGoto, onError, onArmory, onSeals,
  };
}

// ------------------------------------------------------------------ 3D markers (UI only: rings under things, not models)
function makeDestMarker() {
  const g = new THREE.Group();
  const mat = (c: number, o = 0.9) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), mat(0xffd65c));
  ring.rotation.x = -Math.PI / 2;
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.9, 32), mat(0xffd65c));
  pulse.rotation.x = -Math.PI / 2;
  const gem = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 4), mat(0xffe9a0, 0.95));
  gem.rotation.x = Math.PI;
  for (const m of [ring, pulse, gem]) m.renderOrder = 15;
  g.add(ring, pulse, gem);
  g.visible = false;
  return g;
}
function makeTargetRing() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  // a broken ring (four arcs) reads as "locked on" and differs from the plain hover ring
  const arcs = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.32, 20, 1, i * (Math.PI / 2) + 0.18, Math.PI / 2 - 0.36), mat);
    a.rotation.x = -Math.PI / 2;
    arcs.add(a);
  }
  const chevron = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 3), mat);
  chevron.rotation.x = Math.PI;
  for (const m of [...arcs.children, chevron]) m.renderOrder = 16;
  g.add(arcs, chevron);
  g.visible = false;
  return g;
}

// ------------------------------------------------------------------ onboarding (7 steps, skippable, remembered; the 7th only with an agent connected)
type CastInfo = { name: string; kind: SpellKind; target: string | null; targetKind: CreatureKind | 'wizard' | null };
interface TutorialDeps {
  me: () => CMe | null;
  myPos: () => THREE.Vector3 | null;
  touch: boolean;
  creatures: () => CCreature[];
  creaturePos: (id: string) => THREE.Vector3 | null;
  yaw: () => number;
  slotOf: (spellName: string) => number;
  openMenu: () => void;
  openBook: () => void;
  openOwl: () => void;
  pair: () => void;
  agent: () => AgentView | null;
  walkTo: (x: number, z: number) => void;
  /** A big panel is open (the coach mark then moves above it instead of hiding behind it). */
  panelOpen: () => boolean;
}
/** The door of the Great Hall faces the courtyard; walking to just inside it (shared/map.ts ZONES great_hall). */
const HALL = { x: 0, z: -50 };
function createTutorial(t: TutorialDeps) {
  const KEY = 'hogwarts.tutorial';
  const load = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };
  const saved = load();
  let step = saved === 'done' ? -1 : Math.max(0, Math.min(6, Number(saved) || 0));
  let start: { x: number; z: number } | null = null;
  let doneUntil = 0;
  let lastHtml = '';
  const el = $('#tutorial');
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.act === 'skip') finish(false);
    if (b.dataset.act === 'menu') { t.openMenu(); notify('menu'); }
    if (b.dataset.act === 'book') t.openBook();
    if (b.dataset.act === 'hall') t.walkTo(HALL.x, HALL.z);
    if (b.dataset.act === 'pair') t.pair();
    if (b.dataset.act === 'owl') t.openOwl();
    if (b.dataset.act === 'later') finish(true);
    if (b.dataset.act === 'close') { doneUntil = 0; el.hidden = true; }
  });

  const key = (k: string) => `<kbd>${k}</kbd>`;
  function pixieHint(): string {
    const p = t.myPos();
    if (!p) return '';
    let best: { d: number; a: number } | null = null;
    for (const c of t.creatures()) {
      if (c.k !== 'pixie' || c.o) continue;
      const q = t.creaturePos(c.i);
      if (!q) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (!best || d < best.d) best = { d, a: Math.atan2(q.x - p.x, -(q.z - p.z)) };
    }
    if (!best) return `<span class="dir">${L('附近没有小精灵，任何野生魔物都行', 'no pixie near: any wild creature will do')}</span>`;
    return `<span class="dir"><span class="arrow" style="transform:rotate(${(best.a + t.yaw()).toFixed(2)}rad)">↑</span>${L(`小精灵 ${Math.round(best.d)} 米`, `pixie ${Math.round(best.d)} m`)}</span>`;
  }
  function hallHint(): string {
    const p = t.myPos();
    if (!p) return '';
    const d = Math.hypot(HALL.x - p.x, HALL.z - p.z), a = Math.atan2(HALL.x - p.x, -(HALL.z - p.z));
    return `<span class="dir"><span class="arrow" style="transform:rotate(${(a + t.yaw()).toFixed(2)}rad)">↑</span>${L(`大礼堂 ${Math.round(d)} 米`, `Great Hall ${Math.round(d)} m`)}</span>`;
  }
  /** One short line per step, placed beside the control it talks about (`at`); the help panel (H) has the long version. */
  type Step = { at: 'bottom' | 'topleft' | 'topright'; line: () => string; acts?: () => string; live?: () => string };
  const STEPS: Step[] = [
    {
      at: 'bottom',
      line: () => t.touch
        ? L('按住<b>左下方</b>拖动行走，或<b>点一下地面</b>走过去', 'Drag on the <b>lower left</b> to walk, or <b>tap the ground</b>')
        : L(`${key('W')}${key('A')}${key('S')}${key('D')} 行走，或<b>左键点地面</b>走过去 · 右键拖动转视角`, `${key('W')}${key('A')}${key('S')}${key('D')} to walk, or <b>click the ground</b> · right-drag to look`),
    },
    {
      at: 'bottom',
      line: () => {
        const s = t.slotOf('Stupefy');
        const k = key(s >= 0 ? String(s + 1) : '1');
        return t.touch
          ? L('<b>点一下康沃尔郡小精灵</b>，锁定它并施放昏昏倒地', '<b>Tap a Cornish Pixie</b> to target it and cast Stupefy')
          : L(`<b>点击</b>一只康沃尔郡小精灵（或 ${key('Tab')}），再按 ${k} 施放<b>昏昏倒地</b>`, `<b>Click</b> a Cornish Pixie (or ${key('Tab')}), then ${k} for <b>Stupefy</b>`);
      },
      live: pixieHint,
    },
    {
      at: 'bottom',
      line: () => L('走进<b>大礼堂（安全区）</b>再学写咒语：那里没有魔物，也不能决斗', 'Walk into the <b>Great Hall (safe zone)</b> before you learn to write spells: no creatures, no duels'),
      acts: () => `<button data-act="hall">${L('带我去', 'Take me there')}</button>`,
      live: hallHint,
    },
    {
      at: 'bottom',
      line: () => L(`按 ${key('B')} 打开<b>咒语书</b>：咒语就是 Runes 程序（也能用模板拼）`, `${key('B')} opens the <b>spellbook</b>: every spell is a Runes program (or start from a template)`),
      acts: () => `<button data-act="book">${L('打开', 'Open')}</button>`,
    },
    {
      at: 'topright',
      line: () => {
        const s = t.slotOf('Tempus');
        return s >= 0
          ? L(`右上角还暗着 —— 按 ${key(String(s + 1))} 施放<b>时间显现</b>点亮它`, `The top-right corner is dark: ${key(String(s + 1))} casts <b>Tempus</b> to light it`)
          : L('右上角还暗着 —— 在咒语书里施放<b>时间显现</b>点亮它', 'The top-right corner is dark: cast <b>Tempus</b> from the spellbook');
      },
    },
    {
      at: 'topleft',
      line: () => L(`连接你的 AI Agent：${t.touch ? '点 <b>信封</b>' : `按 ${key('Esc')}`} 生成配对码，对它说「连上霍格沃茨，配对码 …」`, `Connect your AI agent: ${t.touch ? 'tap the <b>letter</b>' : key('Esc')} for a pairing code, then tell it "Connect to Hogwarts, pairing code …"`),
      acts: () => `<button data-act="pair">${L('生成配对码', 'Get a code')}</button> <button data-act="later" class="ghost">${L('以后再说', 'Later')}</button>`,
      live: () => { const a = t.agent(); return a?.connected ? `<span class="dir">✓ ${L(`${esc(a.client)} 已连接`, `${esc(a.client)} connected`)}</span>` : ''; },
    },
    {
      at: 'topleft',
      line: () => L(`按 ${key('O')} 给你的 Agent 写一句话（只有你们俩看得见）`, `${key('O')} to write your agent a line (only the two of you see it)`),
      acts: () => `<button data-act="owl">${L('写信', 'Write')}</button> <button data-act="later" class="ghost">${L('跳过', 'Skip')}</button>`,
    },
  ];

  const X = `<button class="tut-skip" data-act="skip" title="${L('跳过新手引导', 'Skip the tutorial')}" aria-label="${L('跳过新手引导', 'Skip the tutorial')}"><svg class="ic"><use href="#i-x"/></svg></button>`;
  function render() {
    if (step < 0) {
      if (doneUntil > now()) {
        const html = `<span class="tut-n">✦</span><span class="tut-line">${L(`引导完成。随时按 ${key('H')} 查看全部操作，祝你玩得开心！`, `You know the basics. ${key('H')} shows every control. Enjoy Hogwarts!`)}</span><span class="tut-acts"><button class="tut-skip" data-act="close" aria-label="×"><svg class="ic"><use href="#i-x"/></svg></button></span>`;
        if (html !== lastHtml) { el.innerHTML = html; lastHtml = html; }
        el.dataset.at = 'bottom';
        if (t.panelOpen()) el.dataset.over = '1'; else delete el.dataset.over;
        el.hidden = false;
      } else el.hidden = true;
      return;
    }
    // the last step (talk to your agent) only appears while an agent is connected
    if (step === 6 && !t.agent()?.connected) { el.hidden = true; return; }
    const s = STEPS[step];
    const html = `<span class="tut-n" title="${L('新手引导', 'Tutorial')}">${step + 1}/${STEPS.length}</span><span class="tut-line">${s.line()}<span class="tut-live"></span></span><span class="tut-acts">${s.acts?.() ?? ''}${X}</span>`;
    if (html !== lastHtml) { el.innerHTML = html; lastHtml = html; }
    el.dataset.at = s.at;
    // never behind an open panel: above it instead
    if (t.panelOpen()) el.dataset.over = '1'; else delete el.dataset.over;
    const live = el.querySelector('.tut-live') as HTMLElement;
    const lv = s.live?.() ?? '';
    if (live.innerHTML !== lv) live.innerHTML = lv;
    el.hidden = false;
  }
  function advance() {
    step++;
    start = null;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    if (step >= STEPS.length) { finish(true); return; }
    save(String(step));
    render();
  }
  function finish(completed: boolean) {
    step = -1;
    save('done');
    doneUntil = completed ? now() + 12 : 0;
    render();
  }
  function tick() {
    const me = t.me();
    if (step < 0 || !me) { render(); return; }
    if (step === 0) {
      const p = t.myPos();
      if (p && !start) start = { x: p.x, z: p.z };
      if (p && start && Math.hypot(p.x - start.x, p.z - start.z) > 3) { advance(); return; }
    }
    if (step === 2) {
      const p = t.myPos();
      if (p && zonesAt(p.x, p.z).includes('great_hall')) { advance(); return; }
    }
    if (step === 4 && me.ui.includes('tempus')) { advance(); return; }
    if (step === 5 && t.agent()?.connected) { advance(); return; }
    render();
  }
  function notify(ev: 'cast' | 'book' | 'menu' | 'owl', c?: CastInfo) {
    if (step < 0) return;
    if (ev === 'cast' && step === 1 && c && c.kind === 'harm' && c.targetKind && c.targetKind !== 'wizard') advance();
    else if (ev === 'book' && step === 3) advance();
    // opened the spellbook before walking to the hall: that is what the hall was for, move on
    else if (ev === 'book' && step === 2) { step = 3; advance(); }
    else if (ev === 'owl' && step === 6) advance();
  }
  function restart() { step = 0; start = null; doneUntil = 0; save('0'); render(); }
  /** Still teaching (a step, or the closing word): the full key line stays up meanwhile. */
  const active = () => step >= 0 || doneUntil > now();
  return { tick, notify, restart, active };
}
