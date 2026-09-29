import * as THREE from 'three';
import { ELEMENT_COLORS, HOUSE_COLORS, type CreatureKind, type Element, type House } from '../src/shared/constants';
import { LANDMARKS, OBSTACLES } from '../src/shared/map';
import { createDecor, type Look } from './decor';
import { createFx, createWeather } from './fx';
import { L, applyStatic, creatureName, houseName, lang, placeName, setLang, spellName, tr } from './i18n';
import { createRenderer } from './render';
import { buildWorld } from './scene';
import { createView } from './view';
import { heightAt } from './terrain';
import { disposeCreature, disposeWizard, farColors, makeAuraRing, makeBolt, makeCreature, makeWizard, setAuraRing, setWizardLook, wizardColor, type WizardModel } from './models';
import { createLightBudget } from './lights';
import { createCrowd } from './crowd';
import { mergeStatic } from './batch';
import { createEffects } from './effects';
import { createBoltBatch } from './bolts';
import { createHerd } from './herd';
import { createDynRes } from './dynres';
import { instanceAlike } from './instancer';
import { createPartBatcher } from './partbatch';
import { captureFocus } from './capture';
import { PANELS, agentView, agoText, createControls, curseText, routeChat, solo, tokenFromUrl, type AgentInfo, type AgentView, type HexState } from './controls';
import { SHOP, TEMPLATES, agentAsk, agentPrompt, downAdvice, nextGoal, optionLock, optionOpen, shopPrice, tplClamp, tplDefaults, type Down, type Goal, type TplValue } from './play';
import { PAIR_TTL_S } from '../src/shared/constants';
import { TIPS } from '../src/lore/memes';
import { ELEMENT_ICON, feedIcon, houseIcon, ic, isLatin, itemIcon, spellIcon } from './ink';
import * as probe from './perf';
import { createMarket } from './market';
import { createPanels, type FamiliarState, type UnfairState } from './panels';
import { createFun } from './panels/fun';
import { createFunWorld } from './funworld';
import type { CupSnap, EvSnap, FunMe } from './funlogic';

// ------------------------------------------------------------------ protocol types (mirror of World.snapshot)
interface SW { h: string; n: string; ho: House; x: number; z: number; f: number; hp: number; m: number; y: number; t: string; s: string; say?: string; g?: string }
interface SC { i: string; k: CreatureKind; x: number; z: number; f: number; hp: number; m: number; o?: string; s: string; b?: 1 }
interface SP { i: string; k: string; x: number; z: number; e: Element }
interface Fx { k: string; x: number; z: number; r?: number; e?: Element; h?: string; n?: number; pts?: number[] }
interface Snap { t: number; hour: number; night: boolean; weather: string; term: { n: number; left: number }; cup?: CupSnap; ev?: EvSnap | null; w: SW[]; c: SC[]; p: SP[]; fx: Fx[]; elder: { x: number; z: number } | null; willowCalm: boolean; look?: Look }
interface Me {
  handle: string; name: string; house: House; year: number; xp: number; xpNext: number | null; reputation: number; galleons: number;
  hp: number; maxHp: number; mana: number; maxMana: number; hotbar: ({ id: string; name: string; cd: number; kind?: 'harm' | 'help' | 'self' } | null)[];
  stunned: number; jailed: number; decree: boolean; title: { zh: string; en: string; next: { zh: string; en: string; how: string } | null }; ui: string[]; seals: number; map: { name: string; registry: string; house: string; year: number; where: string; x: number; z: number }[] | null; proclamation: string;
  /** What is hexing you (World.hexState), or null. */
  hex?: HexState | null;
  /** Your agent (World.agentState, plus the MCP session count the server may add). */
  agent?: (AgentInfo & { familiar?: FamiliarState | null }) | null;
  agents?: { sessions?: number } | null;
  /** 不公平，但好玩 (World.unfairState): the Dark Lord, the DA, 偷师, concentration, the lawless zone (client/panels). */
  unfair?: UnfairState | null;
  /** While stunned: what put you down (World.knockedOutBy). */
  down?: Down | null;
  /** 学院杯 / 巧克力蛙画片 (World.funState): your house points this term, your album, the curfew grace. */
  fun?: FunMe | null;
}
/** Owl Post events carry `from` and `owl` (docs/AGENT_LINK.md §C.2). */
interface Ev { id: number; type: string; text: string; zh?: string; to?: string; t?: number; from?: 'player' | 'agent'; owl?: { id: number; options?: string[]; expiresAt?: number; re?: number }; card?: string }
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
  veil(false);
  $('#gate').hidden = false;
  const stopTips = rotateTips($('#gate-tip'), 8000);
  return new Promise<string>((done) => {
    const err = $('#gate-err');
    let house = '';
    $('#gate-house').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      house = b.dataset.house ?? '';
      $('#gate-house').querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    });
    try { if (sessionStorage.getItem('hogwarts.keyChanged')) { sessionStorage.removeItem('hogwarts.keyChanged'); err.textContent = L('你的猫头鹰邮递密钥已在别处更换（比如你的 Agent 调用了 rotate_key）。请用新密钥登录：用 stdio 桥的话它在 ~/.hogwarts/credentials.json。', 'Your Owl Post key was changed elsewhere (for example your agent called rotate_key). Log in with the new key; with the stdio bridge it is in ~/.hogwarts/credentials.json.'); } } catch { /* ignore */ }
    $('#gate-go').onclick = async () => {
      const r = await fetch('/api/enroll', { method: 'POST', body: JSON.stringify({ name: $<HTMLInputElement>('#gate-name').value, house }) });
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
    $<HTMLInputElement>('#gate-token').onkeydown = (e) => { if (e.key === 'Enter') $('#gate-login').click(); };
    setTimeout(() => $<HTMLInputElement>('#gate-name').focus(), 50);
  }).finally(stopTips);
}

// ------------------------------------------------------------------ the loading veil (before the gate, and until the first snapshot)
let stopVeilTips: (() => void) | null = null;
function veil(on: boolean) {
  const v = $('#veil');
  if (on) {
    v.hidden = false; v.classList.remove('gone');
    stopVeilTips ??= rotateTips(v.querySelector('.lore') as HTMLElement, 6000);
  } else if (!v.hidden) {
    v.classList.add('gone');
    stopVeilTips?.(); stopVeilTips = null;
    setTimeout(() => { if (v.classList.contains('gone')) v.hidden = true; }, 1000);
  }
}

// ------------------------------------------------------------------ lore: one line at a time (src/lore/memes.ts TIPS)
let tipBag: number[] = [];
function nextTip(): string {
  if (!TIPS.length) return '';
  if (!tipBag.length) tipBag = TIPS.map((_, i) => i).sort(() => Math.random() - 0.5);
  const t = TIPS[tipBag.pop()!];
  return L(t.zh, t.en);
}
/** Show a tip in `el` now and every `ms`, crossfading; returns a stop function that hides it. */
function rotateTips(el: HTMLElement, ms: number): () => void {
  const show = () => { const t = nextTip(); el.hidden = !t; el.style.opacity = '0'; setTimeout(() => { el.textContent = t; el.style.opacity = ''; }, 350); };
  show();
  const id = setInterval(show, ms);
  return () => { clearInterval(id); el.hidden = true; };
}

// ------------------------------------------------------------------ rendering setup
const canvas = $<HTMLCanvasElement>('#view');
probe.mark('script');
const R = await createRenderer(canvas);
probe.attach(R.renderer, R.scene, { backend: R.backend, fallback: R.fallbackReason, particles: () => particles, grass: () => world.grass });
// On http://<LAN IP> the browser offers no WebGPU (secure contexts only): a quiet link to the one-step fix (/tls).
if (R.backend === 'webgl' && location.protocol === 'http:' && !/^(localhost|127\.|\[::1\])/.test(location.hostname) && !('gpu' in navigator)) {
  let dismissed = false;
  try { dismissed = localStorage.getItem('hogwarts.gpuHint') === '0'; } catch { /* private mode */ }
  if (!dismissed) {
    const a = document.createElement('div');
    a.id = 'gpu-hint';
    a.innerHTML = `<a href="/tls" target="_blank" rel="noopener">${L('当前 WebGL 2 · 开启 WebGPU →', 'WebGL 2 · enable WebGPU →')}</a> <button type="button" aria-label="close">×</button>`;
    a.querySelector('button')!.onclick = () => { a.remove(); try { localStorage.setItem('hogwarts.gpuHint', '0'); } catch { /* ignore */ } };
    document.body.appendChild(a);
  }
}
probe.mark('renderer');
// Shader errors are checked in development only: the check reads the compile status back from the GPU,
// which waits for every command queued before it (a stall per program, and it defeats parallel compiling).
R.renderer.debug.checkShaderErrors = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
// The sun's shadow map is redrawn every other frame (see frame(): R.shadowFrame): the light's shadow matrix is
// only updated with it, so what is drawn always matches the map; a moving wizard's shadow lags one frame.
const { scene, camera } = R;
const sceneBefore = new Set(scene.children);
const world = buildWorld(scene);
/** What buildWorld added (decor.ts animates its own things from the Minister's look: never batched). */
const worldRoots = scene.children.filter((o) => !sceneBefore.has(o));
const decor = createDecor(scene, world.bannerSpots);
// the world's static meshes, merged per material (batch.ts): exercise the world's own animation to find what moves
{
  const sun = new THREE.Vector3(0.4, 0.6, 0.3).normalize(), at = new THREE.Vector3();
  const b = mergeStatic(scene, worldRoots, (step) => {
    for (const [t, hour, x, z] of [[0, 3.2, 0, -56], [6.1, 9.7, 0, 0], [13.9, 15.1, 120, 90], [27.3, 21.4, -110, 40]]) {
      world.tick(t, 0.05, t > 10, sun, { hour, banner: t > 10 ? 'Gryffindor' : null, focus: at.set(x, 0, z) });
      step();
    }
    world.setQuality('low'); step();
    world.setQuality('high'); step();
  }, { exclude: [world.ground.parent ?? world.ground] });
  probe.mark('batched');
  if (probe.PERF) console.log(`[perf] static batching: ${b.merged} of ${b.candidates} meshes into ${b.meshes} (${b.moving} move)`);
}
// the Great Hall's floating candles (animated by scene.ts): instanced (instancer.ts)
const candles = instanceAlike(scene, scene.children.filter((o) => o.name === 'candle'));
// UI scale: boxes (--u) follow the window (1600x900 = 1), text (--t) shrinks half as much so it stays readable;
// phones keep their own layout (1). The 界面大小 setting in the Owl Post multiplies it (小 0.85 / 标准 1 / 大 1.15).
const UI_KEY = 'hogwarts.ui';
const uiSizes = { s: 0.85, m: 1, l: 1.15 } as const;
let uiSize: keyof typeof uiSizes = (() => { try { const v = localStorage.getItem(UI_KEY); return v === 's' || v === 'l' ? v : 'm'; } catch { return 'm'; } })();
function applyUiScale() {
  const phone = innerWidth < 820 || innerHeight < 500;
  const base = phone ? 1 : Math.max(0.66, Math.min(1.1, Math.min(innerWidth / 1600, innerHeight / 900)));
  const u = base * uiSizes[uiSize];
  document.documentElement.style.setProperty('--u', u.toFixed(3));
  document.documentElement.style.setProperty('--t', (0.5 + 0.5 * u).toFixed(3));
}
applyUiScale();
addEventListener('resize', applyUiScale);

// Quality: ?q=low|high forces it; phones and tablets (a coarse pointer on a small screen) start at 'low';
// otherwise the first seconds are measured and a slow machine drops to 'low' (see frame()).
const forcedQ = new URLSearchParams(location.search).get('q');
const handheld = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.max(screen.width, screen.height) < 1100;
const startQuality: 'low' | 'high' = forcedQ === 'low' || (forcedQ !== 'high' && handheld) ? 'low' : 'high';
// every point light in the world is shown through a fixed number of real lights (lights.ts). The count is
// part of every lit shader, so it is fixed at start (4 when starting at 'low'): the automatic switch to
// 'low' then recompiles nothing.
const lights = createLightBudget(scene, startQuality === 'low' ? 4 : 6);
lights.adopt(scene);
// far wizards: one instanced crowd instead of full models (crowd.ts)
const crowd = createCrowd(scene);
// near wizards' shared parts (legs, arms, heads, hats, ...): instanced across all of them (partbatch.ts)
const parts = createPartBatcher(scene);
// far creatures: one instanced statue per kind (herd.ts)
const herd = createHerd(scene);
/**
 * Level of detail, in metres from the camera: full wizard models nearer than `wizard` (without the scarf
 * tails and the unlit wand beyond `mid`; the instanced crowd
 * beyond, with a few metres of hysteresis), name tags nearer than `label` (and always on your target),
 * creatures drawn nearer than `creature` and animated nearer than `anim`.
 */
const LOD = { high: { mid: 22, wizard: 42, label: 45, creature: 170, anim: 70 }, low: { mid: 14, wizard: 24, label: 30, creature: 110, anim: 45 } };
// ?lod=0 (comparisons) and the offline promo renderer (?capture=1 without the ?perf=1 probe, which only steers
// the camera) draw every model in full, as does the lake's mirror and the shadow map every frame
const fullDetail = new URLSearchParams(location.search).get('lod') === '0' || (new URLSearchParams(location.search).get('capture') === '1' && !probe.PERF);
if (fullDetail) for (const l of Object.values(LOD)) Object.assign(l, { mid: 1e9, wizard: 1e9, label: 1e9, creature: 1e9, anim: 1e9 });
probe.mark('world');
if (/[?&]debug=colliders\b/.test(location.search)) void import('./debug').then((d) => d.showColliders(scene, () => snap?.look?.statues.length ?? 0));
let quality: 'low' | 'high' = startQuality;
const params = new URLSearchParams(location.search);
const capturing = params.get('capture') === '1';
/**
 * Dynamic resolution (dynres.ts) within each quality's range: 'high' renders at up to the screen's pixel
 * ratio (at most 2) and may go down to 60 % of 1x; 'low' between 0.5 and 0.75. ?dyn=0 (and the promo
 * capture) keep the fixed ratio.
 */
const ratioRange = (q: 'low' | 'high'): [number, number] => (q === 'low' ? [0.5, 0.75] : [0.6 * Math.min(1, devicePixelRatio), Math.min(2, devicePixelRatio)]);
const dyn = params.get('dyn') === '0' || capturing ? null : createDynRes({
  min: ratioRange(quality)[0], max: ratioRange(quality)[1],
  apply: (r) => R.setPixelRatio(r),
});
const applyQuality = (q: 'low' | 'high') => {
  quality = q; R.setQuality(q); world.setQuality(q); lighterLake(); dyn?.range(...ratioRange(q));
  // multisampling: 4x at 'high', 2x at 'low' (half the resolve bandwidth; weak GPUs are fill-bound)
  R.setSamples(q === 'low' ? 2 : 4);
};
/**
 * The lake's mirror re-renders the scene from below the water every frame. Wrap whatever scene.ts installed
 * (it swaps the hook with the quality): leave wizards, creatures and spells out of the mirror (the instanced
 * far crowd still shows), and refresh it every other frame (the ripples hide the difference).
 */
function lighterLake() {
  const lake = world.lake;
  if (!lake || lakeLight) return;
  lakeLight = true;
  let n = 0;
  lake.wrap((render) => {
    if (n++ % 2 && !fullDetail) return;
    const was = actors.visible;
    actors.visible = false;
    render();
    actors.visible = was;
  });
}
let lakeLight = false;
applyQuality(quality);
probe.mark('quality');
const perf = { frames: 0, time: 0, done: !!forcedQ || startQuality === 'low' };
const DEFAULT_LOOK: Look = { skyTint: '#ffffff', sunIntensity: 1, fogDensity: 1, glow: 1, lanterns: false, fireworks: false, aurora: false, banner: null, cupHouse: null, statues: [] };
// rain and snow round the player, placed by the GPU (fx.ts)
const weather = createWeather(scene);
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
const wizards = new Map<string, WizardEntry>();
const creatures = new Map<string, CreatureEntry>();
/** Wizards, creatures and spells in flight (left out of the lake's reflection). */
const actors = new THREE.Group();
actors.name = 'actors';
scene.add(actors);
const bolts = new Map<string, THREE.Object3D & { tx?: number; tz?: number }>();
let camYaw = 0, camPitch = 0.34, camDist = 8.5; // closer third-person framing: the wizard fills about a fifth of the screen height
let clock = 0;

// ------------------------------------------------------------------ network
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // area-of-interest snapshots (what is near you, see apply); ?aoi=0 asks for the whole world instead
  const aoi = new URLSearchParams(location.search).get('aoi') === '0' ? '' : '&aoi=1';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}${aoi}`);
  ws.onmessage = (m) => {
    const tm = probe.begin();
    onMessage(m);
    probe.end('msg', tm);
  };
  const onMessage = (m: MessageEvent) => {
    const tp = probe.begin();
    const msg = JSON.parse(m.data);
    probe.end('parse', tp);
    probe.wsMessage(m.data.length, msg.t === 'snap');
    if (pn.onMessage(msg)) return; // the panels' own replies (client/panels)
    if (msg.t === 'welcome') {
      myHandle = msg.handle;
      if (Array.isArray(msg.owls)) for (const o of msg.owls) owlFromMsg(o);
      const hist: Ev[] = msg.events ?? [];
      for (const e of hist) if (e.type === 'owl' || e.type === 'ask') feed(e, false);
      for (const e of hist.filter((x) => x.type !== 'owl' && x.type !== 'ask' && !x.to).slice(-2)) feed(e, false);
      menuInfo(msg.mcpUrl);
      if (msg.pair?.code) onPairCode(msg.pair);
    }
    else if (msg.t === 'snap') { if (!snap) { setTimeout(() => veil(false), 600); probe.mark('firstSnap'); } const ta = probe.begin(); apply(msg.s); probe.end('apply', ta); }
    else if (msg.t === 'me') me = msg.s;
    else if (msg.t === 'event') { pn.onEvent(msg.e); fun.onEvent(msg.e); feed(msg.e, true); }
    else if (msg.t === 'chest') onChest(msg.r);
    else if (msg.t === 'cast') {
      if (msg.r.ok && msg.r.mana > 0) manaCost.set(msg.r.spell, Math.round(msg.r.mana));
      ctl.onCast(msg.r);
      if (!msg.r.ok) toast(`✗ ${spellName(msg.r.spell)}：${tr(msg.r.error)}`);
      else if (msg.r.notes?.length) toast(msg.r.notes.map(tr).join(' · '));
      if (!$('#trunk').hidden) send({ t: 'book' }); // Finite Incantatem / Revelio change what the trunk shows
    }
    else if (msg.t === 'book') { ctl.onArmory(msg.armory.spells); renderBook(msg.armory, msg.grimoire); onArmory(msg.armory); market.onBook(); }
    else if (msg.t === 'market') market.onMessage(msg); // 咒语集市 (client/market.ts)
    else if (msg.t === 'paircode') onPairCode(msg.r ?? msg);
    else if (msg.t === 'token') onToken(String(msg.token ?? ''));
    else if (msg.t === 'owls' && Array.isArray(msg.owls)) { for (const o of msg.owls) owlFromMsg(o); renderOwl(); }
    else if (msg.t === 'seals') { ctl.onSeals(msg.section); renderSeals(msg.section, msg.current); }
    else if (msg.t === 'goto') ctl.onGoto(msg.goal);
    else if (msg.t === 'sealmsg') { const r = msg.r; toast(r.runes ? L(`📜 第 ${r.tier} 道封印的第 ${r.page}/${r.of} 页已抄进你的笔记。`, `📜 Page ${r.page}/${r.of} of seal ${r.tier} copied into your notes.`) : r.opened ? L(`📕 封印打开了！`, `📕 The seal opens! ${r.reward}`) : `✗ ${L('ALGIZ 没有出现。封印纹丝不动，还反咬了你一口（-15 生命）。', r.message)}`); }
    else if (msg.t === 'sim') showSim(msg.r);
    else if (msg.t === 'forged') { bookOut(`✓ ${L('已铸造', 'Forged')} ${msg.name}${L('。', '.')}${msg.notes.length ? '\n' + msg.notes.map(tr).join('\n') : ''}`, 'good'); }
    else if (msg.t === 'bought') onBought(msg.r);
    else if (msg.t === 'err') {
      ctl.onError();
      const text = `✗ ${tr(String(msg.error ?? ''))}`;
      if (market.onError(text)) { /* shown on the market page */ }
      else if (!$('#book').hidden) bookOut(text, 'bad');
      else if (pn.onError(text) || onOwlError(text) || onTrunkError(text) || onMenuError(text)) { /* shown in the open panel */ }
      else toast(text);
    }
  };
  let opened = false;
  ws.onopen = () => { opened = true; wsFails = 0; probe.mark('wsOpen'); };
  ws.onclose = (ev) => {
    if (ev.code === 4001) { // the key was changed elsewhere
      const t = loadToken();
      if (t && t !== token) { token = t; setTimeout(connect, 300); return; } // another tab of this browser saved the new key
      try { sessionStorage.setItem('hogwarts.keyChanged', '1'); } catch { /* ignore */ }
      dropToken(); location.reload(); return;
    }
    // a key that stopped working (changed elsewhere) never reconnects: back to the gate instead of retrying forever
    if (!opened && ++wsFails >= 3) void fetchMe(token).then((r) => { if (r?.status === 401) { if (loadToken() === token) dropToken(); location.reload(); } /* another tab may have saved a rotated key */ });
    setTimeout(connect, 1500);
  };
}
const send = (o: unknown) => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };

/**
 * Snapshots are area-of-interest (the server sends what is within ~120-200 m of you, fanout.ts), so things
 * leave and come back as you travel. Nothing is rebuilt for that: a wizard who leaves is parked (kept, out of
 * the scene) and comes back as the same model; a creature's model goes back to a pool of its kind; only a
 * creature or spell that vanishes near you (inside the always-sent 120 m) died or struck, and gets its puff
 * or burst. Parked wizards not seen for a while, and pooled models beyond what a pool keeps, are freed.
 */
type WizardEntry = WizardModel & { tx: number; tz: number; tf: number; aura: THREE.Mesh; far?: boolean; bob?: number; seen?: number };
type CreatureEntry = ReturnType<typeof makeCreature> & { k: CreatureKind; tx: number; tz: number; tf: number; aura: THREE.Mesh; seen?: number };
const parked = new Map<string, { m: WizardEntry; at: number }>();
const herdPool = new Map<CreatureKind, CreatureEntry[]>();
/** Things that vanish nearer than this (m) to you vanished for real (the server always sends everything within 120 m). */
const GONE_NEAR = 100;
const PARK_S = 90, PARK_MAX = 96, POOL_MAX = 24;
let gen = 0;
const nearMe = (x: number, z: number) => { const me = wizards.get(myHandle)?.root.position; return !me || Math.hypot(x - me.x, z - me.z) < GONE_NEAR; };

function apply(s: Snap) {
  snap = s;
  const g = ++gen;
  for (const w of s.w) {
    let m = wizards.get(w.h);
    if (!m) {
      const p = parked.get(w.h);
      if (p) { parked.delete(w.h); m = p.m; }
      else {
        m = Object.assign(makeWizard(w.ho, w.h === myHandle, w.h), { tx: w.x, tz: w.z, tf: w.f, aura: makeAuraRing() }) as WizardEntry;
        m.root.add(m.aura);
        m.root.name = 'wizard';
        m.label.sprite.visible = false; // (the frame's level of detail shows it when near)
      }
      m.root.position.set(w.x, heightAt(w.x, w.z), w.z);
      m.far = undefined;
      lights.add(m.glow);
      actors.add(m.root);
      wizards.set(w.h, m);
    }
    m.seen = g;
    m.tx = w.x; m.tz = w.z; m.tf = w.f;
    const extra = (w.s.includes('V') ? '☠' : '') + (w.s.includes('M') ? '⚖️' : '') + (w.s.includes('E') ? '🪄' : '') + (w.s.includes('N') ? '🤖' : '');
    m.label.draw(`[${w.t}] ${w.n}`, wizardColor(w.ho), w.hp / w.m, w.say, extra);
    setAuraRing(m.aura, w.s, clock);
    m.shield.visible = w.s.includes('S');
    m.glow.intensity = w.s.includes('L') ? 30 : 0;
    m.root2.visible = w.s.includes('R');
    m.patronus.visible = w.s.includes('P');
    m.elder.visible = w.s.includes('E');
    m.body.rotation.z = w.s.includes('X') ? Math.PI / 2 : 0;
    m.body.position.y = w.s.includes('X') ? 0.3 : 0;
    // the look a glamour spell gave them (shimmering when it changes in view)
    if (setWizardLook(m, w.g)) { const p = m.root.position; particles.burst(p.x, p.y + 1.1, p.z, { count: 60, color: m.tipHex(false), intensity: 3, whiten: 0.5, radius: 0.8, speed: 1.2, up: 1.4, size: 0.12, life: 0.9, drag: 1.5 }); particles.motes(p.x, p.y, p.z, m.tipHex(false), 30); }
    (m.wandTip.material as THREE.MeshBasicMaterial).color.setHex(w.s.includes('D') ? 0x444444 : m.tipHex(w.s.includes('L')));
  }
  const now = performance.now() / 1000;
  for (const [h, m] of wizards) if (m.seen !== g) {
    lights.remove(m.glow);
    actors.remove(m.root);
    wizards.delete(h);
    parked.set(h, { m, at: now });
  }
  if (parked.size) for (const [h, p] of parked) if (now - p.at > PARK_S || parked.size > PARK_MAX) { parked.delete(h); disposeWizard(p.m); }

  for (const c of s.c) {
    let m = creatures.get(c.i);
    if (!m) {
      m = herdPool.get(c.k)?.pop();
      if (!m) {
        m = Object.assign(makeCreature(c.k), { k: c.k, tx: c.x, tz: c.z, tf: c.f, aura: makeAuraRing() }) as CreatureEntry;
        m.root.add(m.aura);
        m.root.name = 'creature';
        m.label.sprite.visible = false;
      }
      m.root.position.set(c.x, heightAt(c.x, c.z), c.z);
      m.root.rotation.y = -c.f;
      actors.add(m.root);
      creatures.set(c.i, m);
      m.root.scale.setScalar(c.b ? 1.35 : 1); // 地下教室有巨怪: the event's troll is a head taller (and pooled models reset)
    }
    m.seen = g;
    m.tx = c.x; m.tz = c.z; m.tf = c.f;
    const mine = c.o === myHandle;
    const benign = c.k === 'unicorn' || c.k === 'phoenix';
    m.label.draw(c.o ? `${creatureName(c.k, NAMES[c.k])} (${mine ? L('你的', 'yours') : L('召唤物', 'conjured')})` : creatureName(c.k, NAMES[c.k]), mine ? '#b8ffb8' : c.o ? '#ffd9a0' : benign ? '#ffffff' : '#ffdddd', c.hp / c.m);
    setAuraRing(m.aura, c.s + (mine ? 'g' : ''), clock);
  }
  for (const [i, m] of creatures) if (m.seen !== g) {
    const p = m.root.position;
    if (nearMe(p.x, p.z)) {
      puff(p.x, p.z, 0x333333);
      particles.puff(p.x, p.y + 1, p.z, { count: 14, color: 0x2a282c, speed: 2, up: 0.8, size: 1, life: 1.4, drag: 2.5, grow: 2.5, radius: 0.6 });
    }
    actors.remove(m.root);
    creatures.delete(i);
    let pool = herdPool.get(m.k);
    if (!pool) herdPool.set(m.k, (pool = []));
    if (pool.length < POOL_MAX) { m.label.show(false); pool.push(m); } else disposeCreature(m);
  }

  for (const p of s.p) {
    let b = bolts.get(p.i);
    if (!b) { b = makeBolt(p.k, p.e); b.position.set(p.x, 1.3, p.z); b.userData.color = p.k === 'disarm' ? 0xff3b3b : p.k === 'root' ? 0x9fe8ff : ELEMENT_COLORS[p.e]; actors.add(b); bolts.set(p.i, b); }
    b.userData.seen = g;
    b.tx = p.x; b.tz = p.z;
  }
  for (const [i, b] of bolts) if (b.userData.seen !== g) {
    if (nearMe(b.position.x, b.position.z)) particles.burst(b.position.x, b.position.y, b.position.z, { count: 14, color: b.userData.color ?? 0xffffff, intensity: 4, whiten: 0.5, speed: 3.5, size: 0.18, life: 0.4, gravity: 4, drag: 2.5 });
    particles.forget(b);
    actors.remove(b); bolts.delete(i);
  }

  for (const f of s.fx) spawnFx(f);
  elderGlint.visible = !!s.elder;
  if (s.elder) elderGlint.position.set(s.elder.x, 2.6 + heightAt(s.elder.x, s.elder.z), s.elder.z);
}

const NAMES: Record<CreatureKind, string> = { pixie: 'Cornish Pixie', snare: "Devil's Snare", spider: 'Acromantula', troll: 'Mountain Troll', dementor: 'Dementor', inferius: 'Inferius', unicorn: 'Unicorn', phoenix: 'Fawkes', serpent: 'Serpent', birds: 'Birds' };

// ------------------------------------------------------------------ effects
const particles = createFx(scene, world.chimneys);
particles.setQuality(quality); // (sized for the starting quality before the shader warm-up, not re-made after it)
const tmpTip = new THREE.Vector3();
// pooled spell effects (effects.ts)
const fxm = createEffects(scene);
const { ring, puff, column, floatText, lightning } = fxm;
const boltBatch = createBoltBatch(scene);

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
/**
 * Everything the world says lands in exactly one place: the private Owl Post in its panel, a curse in the curse banner,
 * big news (decree, term, your own egg or achievement) in the centre banner, your own errors as a toast; the feed keeps
 * the rest, at most FEED_MAX lines, each fading after FEED_S seconds.
 */
const FEED_MAX = 4;
const FEED_S = 6;
function feed(e: Ev, fresh: boolean) {
  // the private Owl Post lives in its own panel, never in the public feed
  if (e.type === 'owl' || e.type === 'ask') { onOwlEvent(e, fresh); return; }
  const text = lang === 'zh' && e.zh ? e.zh : e.text;
  // a curse addressed to you belongs to the curse banner (and the trunk), not to the feed
  if (e.type === 'curse' && e.to) {
    if (fresh) { curseNews = { text, until: performance.now() + 12000 }; if (!$('#trunk').hidden) send({ t: 'book' }); }
    return;
  }
  if (fresh && (e.type === 'decree' || e.type === 'term' || (e.type === 'wheel' && !e.to) || (e.type === 'egg' && e.to) || (e.type === 'achievement' && e.text.includes(me?.name ?? '\u0000')))) { banner(text, e.type); return; }
  // history from before you arrived: only the last couple of public lines, and they fade like the rest
  feedLine(text, `${e.type}${e.to ? ' private' : ''}`);
}
function feedLine(text: string, cls: string) {
  const box = $('#feed');
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = `${ic(feedIcon(cls.split(' ')[0]))}<span>${esc(text)}</span>`;
  box.append(d);
  while (box.children.length > FEED_MAX) box.firstChild!.remove();
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 1300); }, FEED_S * 1000 + Math.min(4000, text.length * 40));
}
let bannerT = 0;
function banner(text: string, type = 'system') {
  // one big thing in the centre at a time: while the House Cup ceremony or a card reveal holds it, news goes to the feed
  if (fun.claimsCentre()) { feedLine(text, type); return; }
  const b = $('#banner');
  b.textContent = text;
  b.classList.remove('out');
  b.hidden = false;
  bannerT = 7;
}
/** A line for you alone (an error, a note from a cast): one at a time, above the hotbar, then gone. */
let toastTimer = 0;
function toast(text: string) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('out');
  t.hidden = false;
  t.classList.add('veiled');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.classList.add('out'); toastTimer = window.setTimeout(() => { t.hidden = true; }, 800); }, 3500 + Math.min(4000, text.length * 45));
  lastLore = performance.now(); // a toast and an idle tip never share the space
  $('#lore').classList.remove('show');
}
/** Private news of a curse (arrival, Finite, Revelio, wearing off), shown in the curse banner for a few seconds. */
let curseNews: { text: string; until: number } | null = null;

/** A dark corner of the HUD: a faint rune whose tooltip says which spell lights it. */
const rune = (icon: string, tip: string, cls = '', cast = '') => `<button type="button" class="rune ${cls}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"${cast ? ` data-cast="${esc(cast)}"` : ''}><svg class="ic"><use href="#i-${icon}"/></svg></button>`;
/** A dark corner's rune casts the charm that lights it, once you are old enough (Revelio is not on the hotbar). */
document.addEventListener('click', (e) => {
  const r = (e.target as HTMLElement).closest('.rune[data-cast]') as HTMLElement | null;
  if (r) ctl.castOnSelf(r.dataset.cast!);
});
const setHtml = (el: HTMLElement, html: string) => { if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };
const setText = (el: { textContent: string | null }, t: string) => { if (el.textContent !== t) el.textContent = t; };
const setStyle = (el: HTMLElement, k: string, v: string) => { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); };
/** Longest cooldown seen per hotbar spell since it was last ready: the sweep's full circle. */
const cdMax = new Map<string, number>();

function hud() {
  if (!me || !snap) return;
  const has = (k: string) => me!.ui.includes(k);
  // top-left: one quiet line (title · name · house); Revelio reveals your own measure
  const stats = has('revelio')
    ? `<div class="stats">${L(`声望 <span class="num">${me.reputation}</span> · 封印 <span class="num">${me.seals}</span>/4`, `<span class="num">${me.reputation}</span> reputation · <span class="num">${me.seals}</span>/4 seals`)}${me.title.next ? ` · <span title="${esc(tr(me.title.next.how))}">${L('下一级', 'next')}: ${esc(L(me.title.next.zh, me.title.next.en))}</span>` : ''}</div>`
    : '';
  setHtml($('#me'), meCard(me, has('revelio')) + stats +
    (me.decree ? `<div class="decree">${L('魔法部长 —— 你手握一道未颁布的法令（MCP: decree）', 'Minister for Magic — you hold an unspent decree (MCP: decree)')}</div>` : ''));
  $('#me').classList.add('veiled');
  // top-right: Tempus
  const h = snap.hour;
  const hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
  const weather = L(({ clear: '晴', rain: '雨', snow: '雪', fog: '雾' } as Record<string, string>)[snap.weather] ?? snap.weather, snap.weather);
  const procl = me.proclamation ? `<div class="procl" title="${esc(me.proclamation)}">${esc(me.proclamation)}</div>` : '';
  setHtml($('#clock'), has('tempus')
    ? `<div class="time veiled">${ic(snap.night ? 'moon' : 'light')}<span><span class="num">${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</span> · ${weather} · ${L(`第 ${snap.term.n} 学期 剩 <span class="num">${fmtT(snap.term.left)}</span>`, `term ${snap.term.n} · <span class="num">${fmtT(snap.term.left)}</span> left`)}</span></div>${procl}`
    : rune('hourglass', L('点一下施放「时间显现 Tempus」，才知道现在几点', 'Click to cast Tempus and know the hour'), 'tip-r', 'Tempus') + procl);
  // bottom-right: Homenum Revelio
  const pres = $('#presence');
  if (has('homenum')) {
    const my = wizards.get(myHandle);
    const near = snap.w.filter((x) => x.h !== myHandle && my && Math.hypot(x.x - my.root.position.x, x.z - my.root.position.z) < 60)
      .map((x) => ({ x, d: Math.hypot(x.x - my!.root.position.x, x.z - my!.root.position.z), a: Math.atan2(x.x - my!.root.position.x, -(x.z - my!.root.position.z)) }))
      .sort((a, b) => a.d - b.d).slice(0, 5);
    setHtml(pres, `<div class="pl veiled"><b>${L('人形显身', 'Homenum Revelio')}</b>` + (near.length ? near.map(({ x, d, a }) => `<div><span class="arrow" style="transform:rotate(${(a + camYaw).toFixed(2)}rad)">↑</span> <span class="hn" data-house="${x.ho}">${esc(x.n)}</span> <span class="num">${Math.round(d)}</span>m${x.s.includes('X') ? ' ✧' : ''}</div>`).join('') : `<div class="hint">${L('60 米内没有人。', 'No one within 60m.')}</div>`) + '</div>');
  } else setHtml(pres, me.year >= 3
    ? rune('figures', L('点一下施放「人形显身」，感知身边的人', 'Click to cast Homenum Revelio and sense who is near'), 'tip-r tip-up', 'Homenum Revelio')
    : rune('figures', L('三年级：施放「人形显身」，感知身边的人', 'Year 3: cast Homenum Revelio to sense who is near'), 'tip-r tip-up'));
  // bottom-left: Point Me lights the minimap
  $('#minimap').hidden = !has('point-me');
  setHtml($('#pointme'), me.year >= 2
    ? rune('compass', L('点一下施放「给我指路」，点亮小地图', 'Click to cast Point Me and light the minimap'), 'tip-up', 'Point Me')
    : rune('compass', L('二年级：施放「给我指路」，点亮这一角', 'Year 2: cast Point Me to light this corner'), 'tip-up'));
  bar('.hp', me.hp, me.maxHp, `${Math.round(me.hp)}/${me.maxHp}`);
  bar('.mana', me.mana, me.maxMana, `${Math.round(me.mana)}/${me.maxMana}`);
  bar('.xp', me.xpNext ? me.xp : 1, me.xpNext ?? 1, '');
  const hb = $('#hotbar');
  if (hb.children.length !== 6) hb.innerHTML = Array.from({ length: 6 }, () => `<div><span></span><b></b><i></i><em></em>${ic('wand')}<u class="cost"></u></div>`).join('');
  me.hotbar.forEach((s, i) => {
    const el = hb.children[i] as HTMLElement;
    // (10 Hz: every write only when the value changed, so an idle HUD costs no style or layout work)
    el.classList.toggle('sel', i === ctl.selected);
    el.classList.toggle('empty', !s);
    const kind = s?.kind ?? '';
    if (el.dataset.kind !== kind) el.dataset.kind = kind;
    setText(el.children[0], s ? spellName(s.name) : '·');
    setText(el.children[1], String(i + 1));
    const cd = s && s.cd > 0 ? s.cd : 0;
    if (s) { if (cd > 0) cdMax.set(s.id, Math.max(cdMax.get(s.id) ?? 0, cd)); else cdMax.delete(s.id); }
    setStyle(el.children[2] as HTMLElement, '--cd', s && cd > 0 ? (cd / Math.max(cd, cdMax.get(s.id) ?? cd)).toFixed(3) : '0');
    setText(el.children[3], cd >= 1 ? String(Math.ceil(cd)) : '');
    // the tile's drawing (a written spell by what it does, once the armory has said) and its last mana cost
    const info = s ? bookSpells.find((x) => x.id === s.id) : null;
    const icon = `#i-${s ? spellIcon(s.name, info?.effects, info?.source) : 'wand'}`;
    const use = el.children[4].firstElementChild as SVGUseElement;
    if (use.getAttribute('href') !== icon) use.setAttribute('href', icon);
    setText(el.children[5], s && manaCost.has(s.name) ? String(manaCost.get(s.name)) : '');
    el.onclick ??= () => ctl.castSlot(i);
  });
  ctl.hud();
  const ov = $('#overlay');
  if (me.jailed) { ov.hidden = false; setHtml(ov, L(`<div>阿兹卡班<small>摄魂怪会在 <span class="num">${me.jailed.toFixed(0)}</span> 秒后放你出去</small></div>`, `<div>Azkaban<small>The Dementors will release you in <span class="num">${me.jailed.toFixed(0)}</span>s</small></div>`)); }
  else if (me.stunned) {
    ov.hidden = false;
    const slotKey = (n: string) => me!.hotbar.findIndex((s) => s?.name === n) + 1;
    const adv = `<small class="adv">${esc(downAdvice(me.down, slotKey, me.year))}</small>`;
    setHtml(ov, L(`<div>被击晕了<small>庞弗雷夫人正在给你治疗…… <span class="num">${me.stunned.toFixed(1)}</span> 秒</small>${adv}</div>`, `<div>Stunned<small>Madam Pomfrey is patching you up… <span class="num">${me.stunned.toFixed(1)}</span>s</small>${adv}</div>`));
  }
  else ov.hidden = true;
  drawMinimap();
  drawMarauder();
  linkHud();
  renderGoal();
  pn.hud();
  fun.hud();
  trackBars();
}
/** The identity card: a wax crest in your house's colour, your title and name, then house (and, once Revelio has shown you, year and Galleons). */
function meCard(me: Me, revealed: boolean) {
  const title = L(me.title.zh, me.title.en);
  const measure = revealed
    ? ` · ${L(`${YEAR_ZH[me.year] ?? me.year + ' '}年级`, `Year ${me.year}`)} · ${L(`<span class="num">${me.galleons}</span> 加隆`, `<span class="num">${me.galleons}</span> Galleons`)}`
    : rune('eye', L('点一下施放「原形立现 Revelio」，看清自己的斤两', 'Click to cast Revelio and see your own measure'), '', 'Revelio');
  return `<span class="crest" data-house="${esc(me.house)}" aria-hidden="true">${ic(houseIcon(me.house))}</span>`
    + `<div class="who" title="${esc(houseName(me.house))}">${title ? `<span class="rank">${esc(title)}</span>` : ''}<b class="name${isLatin(me.name) ? ' lat' : ''}">${esc(me.name)}</b></div>`
    + `<div class="meta"><span class="house" data-house="${esc(me.house)}">${houseName(me.house)}</span>${measure}</div>`;
}
const YEAR_ZH: Record<number, string> = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七' };
/** The last mana each spell cost (from your own cast reports), shown on its hotbar tile. */
const manaCost = new Map<string, number>();
const bar = (sel: string, v: number, max: number, text: string) => {
  const b = $(`#bars ${sel}`);
  setStyle(b.children[0] as HTMLElement, 'width', `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100)).toFixed(2)}%`);
  setText(b.children[1], text);
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function drawMinimap() {
  const c = $<HTMLCanvasElement>('#minimap');
  const g = c.getContext('2d')!;
  const my = wizards.get(myHandle);
  if (!my || !snap) return;
  // bottom-left stays dark (a faint rune, see hud) until the Four-Point Spell
  if (!me?.ui.includes('point-me')) return;
  const cx = my.root.position.x, cz = my.root.position.z, S = 1.1;
  g.clearRect(0, 0, 220, 220);
  g.save();
  g.beginPath(); g.arc(110, 110, 108, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(238,224,192,.95)'; g.fillRect(0, 0, 220, 220);
  const P = (x: number, z: number) => [110 + (x - cx) * S, 110 + (z - cz) * S] as const;
  for (const o of OBSTACLES) {
    if (o.style === 'tree') continue;
    g.fillStyle = o.style === 'water' ? '#6f93b3' : '#8f7a5c';
    if (o.kind === 'box') { const [a, b] = P(o.x0, o.z0); g.fillRect(a, b, (o.x1 - o.x0) * S, (o.z1 - o.z0) * S); }
    else { const [a, b] = P(o.x, o.z); g.beginPath(); g.arc(a, b, Math.max(1, o.r * S), 0, 7); g.fill(); }
  }
  for (const c2 of snap.c) { const [a, b] = P(c2.x, c2.z); g.fillStyle = '#a3262a'; g.fillRect(a - 1.5, b - 1.5, 3, 3); }
  for (const w of snap.w) { const [a, b] = P(w.x, w.z); g.fillStyle = w.h === myHandle ? '#2a1b0f' : '#' + HOUSE_COLORS[w.ho].toString(16).padStart(6, '0'); g.beginPath(); g.arc(a, b, w.h === myHandle ? 4 : 3, 0, 7); g.fill(); }
  g.fillStyle = '#3a2716'; g.font = '600 13px "LXGW WenKai", Georgia, serif';
  for (const l of LANDMARKS) { const [a, b] = P(l.x, l.z); if (a > 0 && a < 220 && b > 0 && b < 220) g.fillText(l.name, a + 3, b); }
  fun.drawMinimap(g, P); // the event's marker (and Filch's round)
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
  solo(b);
  b.innerHTML = `<h2>${ic('cup')}<span>${L('排行榜', 'Leaderboard')} <small>${L(`第 ${lb.term.n} 学期 · 剩余 <span class="num">${fmtT(lb.term.secondsLeft)}</span>`, `term ${lb.term.n} · <span class="num">${fmtT(lb.term.secondsLeft)}</span> left`)} · <kbd>L</kbd></small></span> <button class="x" data-close="board" title="Esc"><svg class="ic"><use href="#i-x"/></svg></button></h2>
    <p class="hp-line"><b>${L('学院分', 'House points')}:</b> ${Object.entries(lb.housePoints).map(([h, p]) => `<span>${ic(houseIcon(h))}${houseName(h)} <span class="num">${p}</span></span>`).join('')}</p>
    ${pn.boardHtml(lb)}
    <p><b>${L('魔法部长', 'Minister for Magic')}:</b> ${lb.minister ? esc(lb.minister.name) + (lb.minister.decreeUnspent ? L('（法令未颁布）', ' (decree unspent)') : L('（法令已颁布）', ' (decree spent)')) : '—'}<br/><small>${L('每学期结束时，声望最高（至少 100）的玩家成为魔法部长，可以颁布一道法令改写世界规则。', esc(lb.ministerRule))}</small></p>
    <table><tr><th>#</th><th>${L('巫师', 'Wizard')}</th><th>${L('称号', 'Title')}</th><th>${L('学院', 'House')}</th><th>${L('年级', 'Year')}</th><th>${L('声望', 'Reputation')}</th></tr>
    ${lb.top.map((w: any) => `<tr><td>${w.rank}</td><td>${lb.darkLord?.name === w.name ? `${ic('darkmark')} ` : ''}${esc(w.name)}${w.npc ? ' 🤖' : ''}${w.online ? ' •' : ''}</td><td>${esc(w.title ?? '')}</td><td>${houseName(w.house)}</td><td>${w.year}</td><td>${w.reputation}</td></tr>`).join('')}</table>
    ${lb.loopholeFirstFoundBy ? `<p>${ic('star')} ${L('第一个发现韦斯莱漏洞的人', 'First to find the Weasley Loophole')}: <b>${esc(lb.loopholeFirstFoundBy)}</b></p>` : ''}`;
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
  $('#menu').innerHTML = `<h2>${ic('letter')}<span>${L('猫头鹰邮递', 'Owl Post')} <small><kbd>Esc</kbd></small></span> <button class="x" data-close="menu" title="Esc"><svg class="ic"><use href="#i-x"/></svg></button></h2>
    <section class="op-first">
      <h3>${ic('owl')}${L('连接你的 Agent', 'Connect your agent')}</h3>
      <div id="op-pair"></div>
      <div id="op-agent" class="hint"></div>
      ${pn.menuHtml()}
    </section>
    ${pn.menuLinks()}
    <h3>${L('或者用命令行接入', 'Or connect from a terminal')}</h3>
    <p>${L('<b>推荐：stdio 桥</b>（先 <code>cd</code> 到你的霍格沃茨仓库目录，在那里运行一次；命令会记下仓库的完整路径，之后在任何目录启动 Claude Code 都能用。第一次配对后密钥存进 <code>~/.hogwarts/credentials.json</code>，以后每个新会话自动回来）：', '<b>Recommended: the stdio bridge</b> (<code>cd</code> into your Hogwarts checkout and run it there once; it records the checkout\'s full path, so Claude Code finds it from any directory. After the first pairing it keeps the key in <code>~/.hogwarts/credentials.json</code> and every new session comes back on its own):')}</p>
    <div class="op-cmd"><pre id="op-bridge">${esc(bridge)}</pre><button class="ghost" data-copy="op-bridge">${L('复制', 'Copy')}</button></div>
    <p>${L('<b>HTTP 直连 + 配置头</b>（命令里是字面的 <code>${HOGWARTS_TOKEN}</code>，要用单引号；再在 shell profile 里 <code>export HOGWARTS_TOKEN=你的密钥</code>）：', '<b>Direct HTTP with a header</b> (the command holds a literal <code>${HOGWARTS_TOKEN}</code> in single quotes; put <code>export HOGWARTS_TOKEN=&lt;your key&gt;</code> in your shell profile):')}</p>
    <div class="op-cmd"><pre id="op-header">${esc(header)}</pre><button class="ghost" data-copy="op-header">${L('复制', 'Copy')}</button></div>
    <h3>${ic('key')}${L('你的猫头鹰邮递密钥', 'Your Owl Post key')}</h3>
    <div id="op-key"></div>
    <p class="op-registry">${L('你的登记号', 'Your registry number')}: <code>${esc(account.registry || '—')}</code><br/><span class="hint">${L('登记号是魔法部的公开记录，猫头鹰凭它投递包裹。', 'Your registry number is a public Ministry record: owls deliver parcels by it.')}</span></p>
    <p id="op-msg" class="hint"></p>
    <div class="op-foot"><span>${L('语言 Language', 'Language 语言')} <button id="lang-zh" class="${lang === 'zh' ? '' : 'ghost'}">中文</button> <button id="lang-en" class="${lang === 'en' ? '' : 'ghost'}">English</button></span>
    <span>${L('界面大小', 'UI size')} ${(['s', 'm', 'l'] as const).map((k) => `<button data-ui="${k}" class="${uiSize === k ? '' : 'ghost'}">${L({ s: '小', m: '标准', l: '大' }[k], { s: 'Small', m: 'Normal', l: 'Large' }[k])}</button>`).join(' ')}</span>
    <span><button id="logout" class="ghost quiet">${L('离开霍格沃茨（忘记密钥）', 'Leave Hogwarts (forget key)')}</button> <button id="close-menu">${L('回到城堡', 'Back to the castle')}</button></span></div>`;
  $('#lang-zh').onclick = () => setLang('zh');
  $('#lang-en').onclick = () => setLang('en');
  document.querySelectorAll<HTMLButtonElement>('#menu [data-ui]').forEach((b) => { b.onclick = () => {
    uiSize = b.dataset.ui as keyof typeof uiSizes;
    try { localStorage.setItem(UI_KEY, uiSize); } catch { /* private mode */ }
    applyUiScale();
    document.querySelectorAll<HTMLButtonElement>('#menu [data-ui]').forEach((x) => x.classList.toggle('ghost', x !== b));
  }; });
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
  if (!$('#sp-agent').hidden) renderAgentBlock();
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
    html = `<p class="op-ok">${ic('check')} ${L(`${esc(pairedWith)} 已连接`, `${esc(pairedWith)} is connected`)}</p><p class="hint">${L('现在可以按 <kbd>O</kbd> 和它说话。', 'Press <kbd>O</kbd> to talk to it.')}</p>`;
  } else if (pairing) {
    html = `<div class="op-code">${esc(pairing.code)}</div>
      <p>${L('对你的 Agent 说：', 'Tell your agent:')}<br/><b class="op-say">${L(`「${esc(PAIR_SAY(pairing.code))}」`, `"${esc(PAIR_SAY(pairing.code))}"`)}</b></p>
      <p><button class="ghost" data-copy="op-say">${L('复制这句话', 'Copy the sentence')}</button> <button class="ghost" data-act="pair">${L('换一个', 'New code')}</button> <span class="hint">${L('有效期', 'Valid for')} <span id="op-count"></span> · ${L('只能用一次', 'single use')}</span></p>`;
  } else {
    html = `<p><button data-act="pair" class="op-big">${ic('owl')}${L('生成配对码', 'Get a pairing code')}</button></p>
      <p class="hint">${pairExpired ? L('配对码过期了，再生成一个吧。', 'That code expired; get a new one.') : L(`得到一个 6 位配对码（${Math.round(PAIR_TTL_S / 60)} 分钟内有效，只能用一次），然后对你的 Agent 说：「连上霍格沃茨，配对码 XXX-XXX」。不用复制任何长密钥。`, `You get a 6-character code (${Math.round(PAIR_TTL_S / 60)} minutes, single use); then tell your agent: "Connect to Hogwarts, pairing code XXX-XXX". No long key to copy.`)}</p>`;
  }
  if (html !== lastPairHtml) { $('#op-pair').innerHTML = html; lastPairHtml = html; }
  const cnt = document.getElementById('op-count');
  if (cnt) cnt.textContent = fmtT(left);
  const agentLine = a?.connected
    ? `<i class="dot on"></i>${esc(a.client)} ${L('已连接', 'connected')}${a.ago !== null ? ` · ${agoText(a.ago)}${a.tool ? `：${esc(a.tool)}` : ''}` : ''}${a.paused ? L(' · ⏸ 已暂停', ' · ⏸ paused') : ''}`
    : `<i class="dot"></i>${L('还没有 Agent 连接。', 'No agent connected yet.')}`;
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
  return `<div class="ow-opts">${l.ask.options.map((o) => `<button data-ask="${l.id}" data-choice="${esc(o)}"${st === 'pending' ? ' disabled' : ''}>${esc(o)}</button>`).join('')}<span class="hint timer">${ic('hourglass')}<span data-left="${l.id}"></span></span></div>`;
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
    $('#owl-who').innerHTML = a?.connected ? `<i class="dot ${a.paused ? 'paused' : 'on'}"></i>${esc(a.client)} ${a.paused ? L('已暂停', 'paused') : L('已连接', 'connected')}` : `<i class="dot"></i><span class="hint">${L('Agent 未连接：信会留在信箱里，它连上后用 listen 收。', 'No agent connected: owls wait in the owlbox until it listens.')}</span>`;
    const log = $('#owl-log');
    log.innerHTML = owlLog.length
      ? owlLog.map((l) => `<div class="ow ${l.from}"><span class="ow-from">${l.from === 'agent' ? `${ic('quill')}${L(`${esc(a?.client ?? 'Agent')} 回信`, `${esc(a?.client ?? 'Agent')} writes`)}` : L('你写道', 'You wrote')}${l.re !== undefined ? L('（回答）', ' (answer)') : ''}</span><div class="ow-text">${esc(l.text)}</div>${askHtml(l, now)}</div>`).join('')
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
  pop.innerHTML = `<div class="op-head">${ic('owl')}${L('你的 Agent 来信', 'Your agent writes')} <span class="hint">${L('（按 O 回复）', '(O to reply)')}</span></div><div class="ow-text">${esc(l.text)}</div>${askHtml(l, worldNow())}`;
  pop.hidden = false;
  owlPopUntil = performance.now() + (l.ask ? Math.max(4, l.ask.expiresAt - worldNow()) * 1000 : 9000);
}
function toggleOwl(force?: boolean) {
  const p = $('#owl');
  p.hidden = !(force ?? p.hidden);
  if (!p.hidden) {
    solo(p);
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

// ------------------------------------------------------------------ agent presence: an owl glyph with a status dot; hover, focus or click opens its card
let lastAgentHtml = '';
function renderAgentBox() {
  const el = $('#agentbox');
  if (!me) return;
  const a = agentNow();
  const live = !!a && (a.connected || a.paused);
  if (!el.firstElementChild) {
    el.innerHTML = `<button type="button" class="ab-glyph" aria-label="Agent"><svg class="ic"><use href="#i-owl"/></svg><span class="ab-dot"></span><b class="ab-n" hidden></b></button><div class="ab-card" role="dialog"></div>`;
    el.hidden = false;
  }
  el.classList.toggle('on', live && !a!.paused);
  el.classList.toggle('paused', live && a!.paused);
  const n = el.querySelector('.ab-glyph .ab-n') as HTMLElement;
  n.hidden = !owlUnread; n.textContent = String(owlUnread);
  let html: string;
  if (live) {
    const act = a!.ago !== null ? `<div class="hint">${agoText(a!.ago)}${a!.tool ? `：<code>${esc(a!.tool)}</code>` : ''}</div>` : '';
    html = `<div><b>${esc(a!.client)}</b> ${a!.paused ? L('已暂停', 'paused') : L('已连接', 'connected')}</div>${act}`
      + (a!.goal ? `<div class="ab-goal">${L('目标', 'Goal')}：${esc(a!.goal)}</div>` : '')
      + `<div class="ab-row"><button data-act="pause" class="${a!.paused ? '' : 'ghost'}">${a!.paused ? L('▶ 让它继续', '▶ Resume agent') : L('⏸ 暂停 Agent', '⏸ Pause agent')}</button> <button data-act="owl" class="ghost">${L('写信', 'Write')} <kbd>O</kbd>${owlUnread ? ` <b class="ab-n">${owlUnread}</b>` : ''}</button></div>`;
  } else {
    html = `<div><b>${L('你的 Agent 还没来', 'No agent yet')}</b></div><div class="hint">${L('生成一个配对码，对你的 Agent（例如 Claude Code）念出来，它就能替你走路、施法、写咒语。', 'Get a pairing code and read it to your agent (e.g. Claude Code): it can then walk, cast and write spells for you.')}</div>`
      + `<div class="ab-row"><button data-act="pair">${L('生成配对码', 'Get a pairing code')}</button>${owlUnread ? ` <button data-act="owl" class="ghost">${L('新猫头鹰', 'New owls')} <b class="ab-n">${owlUnread}</b></button>` : ''}</div>`;
  }
  if (html !== lastAgentHtml) { (el.querySelector('.ab-card') as HTMLElement).innerHTML = html; lastAgentHtml = html; }
}
/** The bottom stack's height, so toasts, the chat line and the coach mark sit just above it (read by hud() at 10 Hz). */
let barsH = -1, tlBottom = -1;
function trackBars() {
  const h = Math.round(innerHeight - $('#bars').getBoundingClientRect().top);
  if (h !== barsH && h > 0) { barsH = h; document.documentElement.style.setProperty('--bars-h', `${h}px`); }
  const tl = Math.round($('#topleft').getBoundingClientRect().bottom);
  if (tl !== tlBottom && tl > 0) { tlBottom = tl; document.documentElement.style.setProperty('--tl-bottom', `${tl}px`); }
  const tut = $('#tutorial');
  const high = tut.dataset.at === 'topleft' || tut.dataset.at === 'topright';
  const th = !tut.hidden && high && !tut.dataset.over ? Math.round(tut.getBoundingClientRect().height) : 0;
  if (th !== tutH) { tutH = th; document.documentElement.style.setProperty('--tut-h', `${th}px`); }
}
let tutH = -1;
$('#agentbox').addEventListener('click', (e) => {
  const el = $('#agentbox');
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b) return;
  if (b.classList.contains('ab-glyph')) { el.classList.toggle('open'); return; }
  el.classList.remove('open');
  if (b.dataset.act === 'pause') send({ t: 'pause', on: !me?.agent?.paused });
  if (b.dataset.act === 'owl') toggleOwl(true);
  if (b.dataset.act === 'pair') pairNow();
  (document.activeElement as HTMLElement | null)?.blur();
});
document.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).closest('#agentbox')) $('#agentbox').classList.remove('open'); });

// ------------------------------------------------------------------ curse banner (from me.hex)
function renderCurseBar() {
  const el = $('#cursebar');
  const c = curseText(me?.hex);
  if (curseNews && performance.now() > curseNews.until) curseNews = null;
  if ((!c || (!c.hexed && !c.respite)) && !curseNews) { el.hidden = true; return; }
  if (!el.firstElementChild) {
    el.innerHTML = `<div class="cb-news"></div><div class="cb-text"></div><div class="cb-acts"><button data-act="finite">${L('咒立停', 'Finite Incantatem')}</button> <button class="ghost" data-act="revelio">${L('原形立现', 'Revelio')}</button> <button class="ghost" data-act="trunk">${L('行囊', 'Trunk')} <kbd>T</kbd></button></div>`;
  }
  const hexed = !!c?.hexed;
  el.classList.toggle('quiet', !hexed && !curseNews);
  el.classList.toggle('news', !hexed && !!curseNews);
  const news = el.querySelector('.cb-news') as HTMLElement;
  const nt = curseNews?.text ?? '';
  if (news.textContent !== nt) news.textContent = nt;
  news.hidden = !nt;
  // fresh news already says how to end it and how to find out who: the banner then lists only what is on you
  const text = hexed
    ? `<b>${esc(c!.head)}</b>${c!.parts.map(esc).join(' · ')}${L('。', '.')}${curseNews ? '' : `<br/>${esc(c!.cure)} ${esc(c!.who)}`}${c!.resting ? `<br/>${esc(c!.resting)}` : ''}`
    : curseNews ? '' : esc(c?.respite ?? '');
  const t = el.querySelector('.cb-text') as HTMLElement;
  if (t.innerHTML !== text) t.innerHTML = text;
  t.hidden = !text;
  (el.querySelector('.cb-acts') as HTMLElement).hidden = !hexed && !curseNews;
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
/** The armory has arrived at least once (so an empty trunk really is empty). */
let trunkKnown = false;
let trunkOk = false;
const SLOT_ZH: Record<string, string> = { wand: '魔杖', robe: '长袍', amulet: '护身符', trinket: '小饰物', broom: '扫帚' };
const MOD_ZH: Record<string, string> = { maxHp: '生命上限', maxMana: '法力上限', manaRegen: '回蓝', speed: '移速', power: '威力', ward: '护甲' };
function onArmory(armory: { items?: TrunkItem[]; spells?: { name: string }[] }) {
  if (Array.isArray(armory.items)) { trunkItems = armory.items; trunkAt = performance.now(); trunkKnown = true; }
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
    $('#trunk-cure').innerHTML = `<button data-act="finite"${fin ? ` disabled title="${esc(fin)}"` : ''}>${ic('finite')}${L('念咒立停解咒', 'Cast Finite Incantatem to break curses')}</button>${fin ? ` <span class="hint">${esc(fin)}</span>` : ''}
      <button class="ghost" data-act="revelio"${rev ? ` disabled title="${esc(rev)}"` : ''}>${ic('eye')}${L('念原形立现，看看是谁', 'Cast Revelio: who sent it?')}</button>`;
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
      return `<li class="${it.cursed ? 'cursed' : ''}"><span class="it-ic">${ic(itemIcon(it.slot))}</span><div class="ti-name"><b>${esc(it.name)}</b> <span class="hint">${esc(L(SLOT_ZH[it.slot] ?? it.slot, it.slot))}</span> ${badges}</div>
        <div class="ti-mods">${modsText(it.mods)}${it.lore ? ` <i class="hint">“${esc(it.lore)}”</i>` : ''}</div><div class="ti-acts">${wear} ${del}</div></li>`;
    }).join('') : `<li class="hint">${L('箱子是空的。在下面的商店买一件，或者让你的 Agent 用 forge_item 给你锻造。', 'Your trunk is empty. Buy something in the shop below, or ask your agent to forge you something (forge_item).')}</li>`;
    $('#trunk-msg').textContent = trunkMsg;
    $('#trunk-msg').className = trunkOk ? 'ok' : 'err';
    renderShop();
  } else if (shopSig !== `${me?.galleons}`) renderShop();
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
  if (!t.hidden) { solo(t); trunkMsg = ''; destroyArmed = null; send({ t: 'book' }); renderTrunk(true); }
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
  trunkOk = false;
  if (act === 'finite') { ctl.castOnSelf('Finite Incantatem'); return; }
  if (act === 'revelio') { ctl.castOnSelf('Revelio'); return; }
  if (act === 'buy') { send({ t: 'buy', item: b.dataset.item, lang }); b.disabled = true; return; }
  if (act === 'equip') send({ t: 'equip', item: b.dataset.id });
  else if (act === 'unequip') send({ t: 'unequip', slot: b.dataset.slot });
  else if (act === 'destroy') { destroyArmed = b.dataset.id ?? null; renderTrunk(true); return; }
  else if (act === 'destroy-no') { destroyArmed = null; renderTrunk(true); return; }
  else if (act === 'destroy-yes') { destroyArmed = null; send({ t: 'destroy', item: b.dataset.id }); }
  else return;
  send({ t: 'book' }); // the server does not answer equip / unequip / destroy: read the trunk again
});

// ------------------------------------------------------------------ the shop (in the trunk): fixed presets, forged for yourself (src/shared/shop.ts)
let shopSig = '';
function renderShop() {
  const g = me?.galleons ?? 0;
  shopSig = `${me?.galleons}`;
  $('#shop').innerHTML = `<h3>${ic('coin')}${L('商店', 'Shop')} <small>${L(`你有 <span class="num">${g}</span> 加隆 · 买下自动穿上 · 打败魔物赚加隆`, `you have <span class="num">${g}</span> Galleons · worn at once · creatures drop Galleons`)}</small></h3><ul class="shop-list">` +
    SHOP.map((s) => {
      const price = shopPrice(s), can = g >= price;
      return `<li><span class="it-ic">${ic(itemIcon(s.slot))}</span><div class="ti-name"><b>${esc(L(s.zh, s.en))}</b> <span class="hint">${esc(L(SLOT_ZH[s.slot] ?? s.slot, s.slot))}</span></div>
        <div class="ti-mods">${modsText(s.mods)} <i class="hint">“${esc(L(s.lore.zh, s.lore.en))}”</i></div>
        <div class="ti-acts"><button data-act="buy" data-item="${esc(s.key)}"${can ? '' : ' disabled'}>${L(`<span class="num">${price}</span> 加隆 · 购买`, `Buy · <span class="num">${price}</span> Galleons`)}</button>${can ? '' : ` <span class="hint">${L(`还差 ${price - g} 加隆`, `${price - g} more Galleons`)}</span>`}</div></li>`;
    }).join('') + '</ul>';
}
function onBought(r: { item: string; equipped: boolean; notes: string[] }) {
  trunkOk = true;
  trunkMsg = `✓ ${L(`买下了「${r.item}」`, `Bought "${r.item}"`)}${r.equipped ? L('，已经穿上。', ', now wearing it.') : L('：在上面点「穿上」。', ': press Equip above.')} ${tr(r.notes[0] ?? '')}`;
  renderTrunk(true);
}

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
/** The hotbar as spell ids (from the last armory; changed at once when you move a spell, then confirmed by the server). */
let bookBar: (string | null)[] = [null, null, null, null, null, null];
/** The last error the editor showed (handed to your agent by "🦉 Ask my agent"). */
let lastBookErr = '';
/** 咒语集市: the market page laid over the open book (client/market.ts), opened from its tab in the list. */
const market = createMarket($('#book'), { send: (o) => send(o), year: () => me?.year ?? 1, spells: () => bookSpells });
function toggleBook(force?: boolean) {
  const b = $('#book');
  b.hidden = !(force ?? b.hidden);
  if (b.hidden) market.close();
  if (!b.hidden) { solo(b); b.dataset.house = me?.house ?? ''; send({ t: 'book' }); ctl.notify('book'); }
}
function bookOut(text: string, cls = '') {
  const o = $('#sp-out');
  o.textContent = text;
  o.className = cls;
  if (cls === 'bad') lastBookErr = text; else if (cls === 'good') lastBookErr = '';
}
function renderBook(armory: { spells: ArmorySpell[]; hotbar: { slot: number; spell: string | null }[] }, grimoireText: string) {
  bookSpells = armory.spells;
  const idOf = (name: string | null) => (name ? bookSpells.find((s) => s.name === name)?.id ?? null : null);
  bookBar = Array.from({ length: 6 }, (_, i) => idOf(armory.hotbar.find((h) => h.slot === i + 1)?.spell ?? null));
  $('#grimoire').textContent = grimoireText;
  renderBookList();
}
const spellLabel = (s: ArmorySpell) => (s.builtin ? L(`${spellName(s.name)} ${s.name}`, s.name) : s.name);
/** The spell list (each row with its hotbar keys 1–6) and the hotbar strip above it (drop a spell on a cell). */
function renderBookList() {
  const slotOf = (id: string) => bookBar.indexOf(id) + 1;
  const keys = (s: ArmorySpell) => `<span class="bk-slots" role="group" aria-label="${esc(L('放到快捷栏', 'Put on the hotbar'))}">${[1, 2, 3, 4, 5, 6].map((n) =>
    `<button type="button" class="bk-slot${slotOf(s.id) === n ? ' on' : ''}" data-slot="${n}" data-spell="${esc(s.id)}" title="${esc(slotOf(s.id) === n ? L(`在 ${n} 号栏 · 再点一下取下`, `On slot ${n} · click again to remove`) : L(`放到 ${n} 号栏`, `Put on slot ${n}`))}">${n}</button>`).join('')}</span>`;
  $('#book-list').innerHTML = `<li data-id="" class="tab${!bookSel && !tplKey ? ' sel' : ''}" title="${esc(L('自己写一个', 'write your own'))}">${ic('plus')}${L('新咒语', 'New spell')}</li>`
    + `<li data-tpl="1" class="tab tpl-entry${tplKey ? ' sel' : ''}" title="${esc(L('不用写代码：选一选、拖一拖', 'no code: pick and slide'))}">${ic('scroll')}${L('从模板开始', 'Start from a template')}</li>`
    + `<li data-market="1" class="tab mk-entry" title="${esc(L('别人发布的咒语：抄、改编、发布你自己的', 'spells others published: copy, fork, publish yours'))}">${ic('coin')}${L('咒语集市', 'Spell market')}</li>`
    + pn.bookTab()
    + bookSpells.map((s) => `<li data-id="${esc(s.id)}" draggable="true" class="${s.id === bookSel ? 'sel' : ''}" title="${esc(spellLabel(s))}"><span class="sp-ic">${ic(spellIcon(s.name, s.effects, s.source))}</span>`
      + `<span class="sp-tx"><b>${s.builtin && lang === 'zh' ? `${esc(spellName(s.name))}<span class="lat">${esc(s.name)}</span>` : `<span class="${isLatin(s.name) ? 'lat' : ''}">${esc(s.name)}</span>`}</b>`
      + `<small>${L(`${YEAR_ZH[s.minYear] ?? s.minYear}年级`, `Year ${s.minYear}`)} · ${s.nodes} ${L('节点', 'nodes')} · ${esc(s.effects.join(', ') || '—')}</small></span>${keys(s)}</li>`).join('');
  $('#book-bar').innerHTML = `<span class="bb-h">${L('快捷栏', 'Hotbar')}</span>` + bookBar.map((id, i) => {
    const s = id ? bookSpells.find((x) => x.id === id) : null;
    const nm = s ? (s.builtin ? spellName(s.name) : s.name) : '';
    return `<div class="bb-cell${s ? '' : ' empty'}" data-cell="${i + 1}" title="${esc((nm ? nm + ' — ' : '') + L('把咒语拖到这里；或者先选中咒语再点这一格', 'Drop a spell here, or select one and click this cell'))}"><b>${i + 1}</b>${ic(s ? spellIcon(s.name, s.effects, s.source) : 'plus')}<span>${esc(nm || '·')}</span></div>`;
  }).join('') + `<span class="bb-hint hint">${L('把咒语拖到格子里', 'Drag a spell onto a cell')}</span>`;
  renderBookTitle();
}
/** The right page's heading: the template, the spell you are reading, or a blank page. */
function renderBookTitle() {
  const t = tplKey ? TEMPLATES.find((x) => x.key === tplKey) : null;
  const s = !t && bookSel ? bookSpells.find((x) => x.id === bookSel) : null;
  $('#sp-title').innerHTML = t ? `${esc(L(t.zh, t.en))} <small>${L('模板 · 不用写代码：选一选、拖一拖', 'template · no code: pick and slide')}</small>`
    : s ? `${esc(s.builtin ? spellName(s.name) : s.name)}${s.builtin && lang === 'zh' ? ` <span class="lat">${esc(s.name)}</span>` : ''} <small>${s.builtin ? L('标准课程', 'the standard curriculum') : L('你自己的咒语', 'your own spell')}</small>`
    : `${L('新咒语', 'A new spell')} <small>${L('写一段 Runes 程序', 'write a Runes program')}</small>`;
}
/** Put a spell on a hotbar slot (it swaps with whatever was there; the same slot again takes it off). */
function assignSlot(id: string, n: number) {
  const bar = [...bookBar], i = n - 1, j = bar.indexOf(id);
  if (j === i) bar[i] = null;
  else { if (j >= 0) bar[j] = bar[i]; bar[i] = id; }
  bookBar = bar;
  renderBookList();
  send({ t: 'hotbar', slots: bar });
  const s = bookSpells.find((x) => x.id === id);
  const nm = s ? (s.builtin ? spellName(s.name) : s.name) : '';
  bookOut(bar[i] === id ? L(`「${nm}」放到了 ${n} 号栏：按 ${n} 施放。`, `${nm} is on slot ${n}: press ${n}.`) : L(`「${nm}」从 ${n} 号栏取下了。`, `${nm} left slot ${n}.`), 'good');
}
$('#book-list').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const k = t.closest('.bk-slot') as HTMLElement | null;
  if (k) { assignSlot(k.dataset.spell!, Number(k.dataset.slot)); return; }
  const li = t.closest('li') as HTMLElement | null;
  if (!li) return;
  if (li.dataset.pn) return; // a panel's tab (client/panels: the O.W.L.s), opened by its own listener
  if (li.dataset.market) market.open();
  else if (li.dataset.tpl) openTemplates();
  else loadSpell(li.dataset.id || null);
});
$('#book-list').addEventListener('dragstart', (e) => {
  const li = (e.target as HTMLElement).closest('li[data-id]') as HTMLElement | null;
  if (!li?.dataset.id || !e.dataTransfer) return;
  e.dataTransfer.setData('text/plain', li.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  $('#book-bar').classList.add('drag');
});
$('#book-list').addEventListener('dragend', () => $('#book-bar').classList.remove('drag'));
const barCell = (e: Event) => (e.target as HTMLElement).closest('.bb-cell') as HTMLElement | null;
$('#book-bar').addEventListener('dragover', (e) => { const c = barCell(e); if (!c) return; e.preventDefault(); c.classList.add('over'); });
$('#book-bar').addEventListener('dragleave', (e) => barCell(e)?.classList.remove('over'));
$('#book-bar').addEventListener('drop', (e) => {
  const c = barCell(e);
  $('#book-bar').classList.remove('drag');
  if (!c) return;
  e.preventDefault();
  const id = e.dataTransfer?.getData('text/plain');
  if (id && bookSpells.some((s) => s.id === id)) assignSlot(id, Number(c.dataset.cell));
});
$('#book-bar').addEventListener('click', (e) => { const c = barCell(e); if (c && bookSel) assignSlot(bookSel, Number(c.dataset.cell)); });

function loadSpell(id: string | null) {
  bookSel = id;
  closeTemplates();
  const s = bookSpells.find((x) => x.id === id);
  $<HTMLInputElement>('#sp-name').value = s ? (s.builtin ? `${s.name} II` : s.name) : '';
  $<HTMLInputElement>('#sp-inc').value = s && !s.builtin ? s.incantation : '';
  $<HTMLTextAreaElement>('#sp-src').value = s?.source ?? '';
  renderBookList();
  bookOut(s?.builtin ? L(`${spellName(s.name)}（${s.name}）是标准课程的一部分。点后面的数字把它放上快捷栏；改一改、用新名字铸造，它就是你的了。`, `${s.name} is part of the standard curriculum. Click a number to put it on the hotbar; edit it and forge it under a new name to make it yours.`) : s ? L('修改后点「铸造」来改良它（同名会覆盖）。', 'Edit and Forge to rework it (same name replaces it).') : L('写一段 Runes 程序，或者点左边的「从模板开始」。下面的魔法书里有你能用的每一个词。', 'Write a Runes program, or pick "Start from a template" on the left. The Grimoire below has every word you can use.'));
}
function showSim(r: { ok: boolean; mana: number; effects: string[]; notes: string[]; gas: number; error?: string; nodes?: number }) {
  const notes = r.notes.map((n) => '  ! ' + tr(n)).join('\n');
  bookOut(r.ok
    ? `✓ ${L(`会消耗 ${r.mana} 法力`, `Would cast for ${r.mana} mana`)}（${r.gas} gas${r.nodes ? L(`，${r.nodes} 个节点`, `, ${r.nodes} nodes`) : ''}）\n${r.effects.map((e) => '  • ' + e).join('\n') || L('  （无效果）', '  (no effects)')}${notes ? '\n' + notes : ''}`
    : `✗ ${L('失效', 'Fizzles')}：${tr(r.error ?? '')}${r.gas ? L(`（运行了 ${r.gas} gas 之后）`, ` (after ${r.gas} gas)`) : ''}${notes ? '\n' + notes : ''}`, r.ok ? 'good' : 'bad');
}
const simulateDraft = () => send({ t: 'simulate', source: $<HTMLTextAreaElement>('#sp-src').value, x: ctl.aim.x, z: ctl.aim.z, target: ctl.targetKey() ?? undefined });
$('#sp-sim').onclick = simulateDraft;
$('#sp-forge').onclick = () => {
  const slot = Number($<HTMLSelectElement>('#sp-slot').value) || undefined;
  send({ t: 'forge', name: $<HTMLInputElement>('#sp-name').value, incantation: $<HTMLInputElement>('#sp-inc').value || undefined, source: $<HTMLTextAreaElement>('#sp-src').value, slot });
};
$('#sp-cast').onclick = () => { if (bookSel) ctl.castKey(bookSel); };

// ------------------------------------------------------------------ templates (从模板开始): menus and sliders write the Runes, simulated live
let tplKey: string | null = null;
let tplValues: Record<string, TplValue> = {};
let tplName = '';
let tplTimer = 0;
const firstFreeSlot = () => { const i = bookBar.indexOf(null); return i >= 0 ? i + 1 : 6; };
function openTemplates(key?: string) {
  const y = me?.year ?? 1;
  const t = TEMPLATES.find((x) => x.key === key && x.year <= y) ?? TEMPLATES.find((x) => x.key === tplKey && x.year <= y) ?? TEMPLATES[0];
  if (t.key !== tplKey) tplValues = tplDefaults(t, y, me?.seals ?? 0);
  tplKey = t.key;
  bookSel = null;
  const slot = $<HTMLSelectElement>('#sp-slot');
  if (!slot.value) slot.value = String(firstFreeSlot());
  $('#sp-tpl').hidden = false;
  renderTemplates();
  renderBookList();
  applyTemplate();
}
function closeTemplates() { tplKey = null; $('#sp-tpl').hidden = true; }
/** How far along its track a slider sits (the inked part of the track). */
const rangePct = (v: number, min: number, max: number) => `${max > min ? Math.round(((v - min) / (max - min)) * 100) : 0}%`;
function renderTemplates() {
  const t = TEMPLATES.find((x) => x.key === tplKey);
  if (!t) return;
  const y = me?.year ?? 1, se = me?.seals ?? 0;
  const v = tplClamp(t, tplValues, y, se);
  const chips = TEMPLATES.map((k) => `<button type="button" class="tp-chip${k.key === t.key ? ' on' : ''}" data-tk="${k.key}"${k.year > y ? ` disabled title="${esc(L(`${k.year} 年级解锁`, `unlocks in year ${k.year}`))}"` : ''}>${esc(L(k.zh, k.en))}${k.year > y ? ` <small>${L(`${k.year} 年级`, `y${k.year}`)}</small>` : ''}</button>`).join('');
  const params = t.params.map((p) => {
    if (p.kind === 'range') {
      const unit = p.unit ? L(p.unit.zh, p.unit.en) : '';
      return `<label class="tp-p"><span>${esc(L(p.zh, p.en))}</span><input type="range" data-p="${p.id}" min="${p.min}" max="${p.max(y, se)}" step="${p.step ?? 1}" value="${v[p.id]}" style="--p:${rangePct(Number(v[p.id]), p.min, p.max(y, se))}"/><b class="num" data-pv="${p.id}">${v[p.id]}${unit}</b></label>`;
    }
    // the element: inked chips with their drawings, not a menu
    if (p.options.every((o) => ELEMENT_ICON[o.v])) {
      return `<div class="tp-p"><span>${esc(L(p.zh, p.en))}</span><div class="tp-els" role="radiogroup">${p.options.map((o) => {
        const open = optionOpen(o, y, se);
        return `<label class="tp-el" title="${esc(L(o.zh, o.en))}"><input type="radio" name="tp-${p.id}" data-p="${p.id}" value="${esc(o.v)}"${o.v === v[p.id] ? ' checked' : ''}${open ? '' : ' disabled'}/>${ic(ELEMENT_ICON[o.v])}${esc(L(o.zh, o.en).split(/\s*[—（(]/)[0])}</label>`;
      }).join('')}</div></div>`;
    }
    return `<label class="tp-p"><span>${esc(L(p.zh, p.en))}</span><select data-p="${p.id}">${p.options.map((o) => {
      const lock = optionLock(o, y, se);
      return `<option value="${esc(o.v)}"${o.v === v[p.id] ? ' selected' : ''}${optionOpen(o, y, se) ? '' : ' disabled'}>${esc(L(o.zh, o.en))}${lock ? L(`（${lock}）`, ` (${lock})`) : ''}</option>`;
    }).join('')}</select></label>`;
  }).join('');
  $('#sp-tpl').innerHTML = `<div class="tp-chips">${chips}</div><p class="tp-desc hint">${esc(L(t.desc.zh, t.desc.en))}</p><div class="tp-params">${params}</div>`
    + `<p class="tp-foot hint">${L('代码会写进下面的框里，并自动模拟出法力消耗。满意了就选一个快捷栏，点「铸造」。', 'The code goes in the box below and is simulated for its mana cost. Happy? Pick a hotbar slot and Forge.')}</p>`;
}
function applyTemplate() {
  const t = TEMPLATES.find((x) => x.key === tplKey);
  if (!t) return;
  const y = me?.year ?? 1, se = me?.seals ?? 0;
  tplValues = tplClamp(t, tplValues, y, se);
  $<HTMLTextAreaElement>('#sp-src').value = t.build(tplValues, y, se);
  const nm = $<HTMLInputElement>('#sp-name');
  const suggested = L(t.name.zh, t.name.en);
  if (!nm.value || nm.value === tplName || bookSpells.some((s) => s.builtin && `${s.name} II` === nm.value)) nm.value = suggested;
  tplName = suggested;
  clearTimeout(tplTimer);
  tplTimer = window.setTimeout(simulateDraft, 250);
}
$('#sp-tpl').addEventListener('click', (e) => {
  const c = (e.target as HTMLElement).closest('.tp-chip') as HTMLButtonElement | null;
  if (c && !c.disabled) openTemplates(c.dataset.tk);
});
$('#sp-tpl').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const id = el.dataset.p;
  if (!id) return;
  tplValues[id] = el instanceof HTMLInputElement && el.type === 'range' ? Number(el.value) : el.value;
  const t = TEMPLATES.find((x) => x.key === tplKey)!;
  const p = t.params.find((x) => x.id === id);
  const out = $('#sp-tpl').querySelector(`[data-pv="${id}"]`);
  if (out && p?.kind === 'range') out.textContent = `${el.value}${p.unit ? L(p.unit.zh, p.unit.en) : ''}`;
  if (el instanceof HTMLInputElement && el.type === 'range') el.style.setProperty('--p', rangePct(Number(el.value), Number(el.min), Number(el.max)));
  applyTemplate();
});

// ------------------------------------------------------------------ 🦉 ask my agent: the owl pre-filled with the draft, or a prompt to copy
function agentRequest() {
  return {
    draft: $<HTMLTextAreaElement>('#sp-src').value,
    error: lastBookErr.split('\n')[0].replace(/^✗\s*(?:失效|Fizzles)?[:：]?\s*/, ''),
    slot: Number($<HTMLSelectElement>('#sp-slot').value) || firstFreeSlot(),
    name: $<HTMLInputElement>('#sp-name').value.trim() || undefined,
  };
}
function renderAgentBlock() {
  const box = $('#sp-agent');
  const code = pairing && pairing.until > performance.now() ? pairing.code : null;
  box.innerHTML = `<p><b>${L('你的 Agent 还没连接。', 'Your agent is not connected.')}</b> ${L('把下面这段复制给它（例如 Claude Code）：', 'Copy this to it (e.g. Claude Code):')}</p>
    <div class="op-cmd"><pre id="sp-agent-text">${esc(agentPrompt({ ...agentRequest(), code }))}</pre></div>
    <p class="row"><button data-copy="sp-agent-text">${L('复制给 Agent 的提示词', 'Copy the prompt for your agent')}</button>${code ? '' : ` <button class="ghost" data-act="pair">${L('生成配对码（放进提示词）', 'Get a pairing code (goes in the prompt)')}</button>`} <button class="ghost quiet" data-act="close">${L('收起', 'Hide')}</button></p>`;
  box.hidden = false;
}
$('#sp-agent').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b) return;
  if (b.dataset.copy) copyText($('#sp-agent-text').textContent ?? '', b);
  if (b.dataset.act === 'pair') requestPairCode();
  if (b.dataset.act === 'close') $('#sp-agent').hidden = true;
});
$('#sp-agent-btn').onclick = () => {
  if (agentNow()?.connected) {
    $('#sp-agent').hidden = true;
    const text = agentAsk(agentRequest());
    toggleOwl(true);
    const i = $<HTMLInputElement>('#owl-input');
    i.value = text;
    i.focus();
    i.setSelectionRange(text.length, text.length);
    owlStatus = L('写好了：按回车寄给你的 Agent（可以先改一改）。', 'Ready: press Enter to send it to your agent (edit it first if you like).');
    owlDirty = true;
    renderOwl();
  } else renderAgentBlock();
};

// ------------------------------------------------------------------ the Restricted Section (seals)
let sealTier = 1;
const sealState = (st: string) => lang !== 'zh' ? st : st === 'broken' ? '已破解' : st === 'open to you' ? '向你敞开' : st.startsWith('needs year') ? `需要 ${st.slice(-1)} 年级` : '先破解上一道封印';
function toggleSeals() { const s = $('#seals'); s.hidden = !s.hidden; if (!s.hidden) { solo(s); send({ t: 'seals' }); } }
type SealInfo = { tier: number; name: string; zh: string; rewardZh: string; requiresYear: number; inputWords: number; reward: string; state: string; pages: { page: number; where: string; collected: boolean }[] };
function renderSeals(section: { progress: string; seals: SealInfo[]; codex: string[] }, current: { tier: number; name: string; zh: string; inputWords: number; pagesCollected: string; runes: string; broken: boolean }) {
  sealTier = current.tier;
  $('#seal-list').innerHTML = section.seals.map((x) => `<div class="${x.state === 'broken' ? 'broken' : ''}">${ic(x.state === 'broken' ? 'seal-broken' : 'seal')}<b>${esc(L(x.zh, x.name))}</b><br/>${esc(sealState(x.state))} · ${L(`${x.requiresYear} 年级`, `year ${x.requiresYear}`)} · ${L(`${x.inputWords} 个字`, `${x.inputWords} word(s)`)}<br/><i>${esc(L(x.rewardZh, x.reward))}</i><br/>${x.pages.map((p) => `<span class="pg${p.collected ? '' : ' no'}">${ic('scroll')} ${esc(placeName(p.where))}</span>`).join('<br/>')}</div>`).join('');
  $('#seal-title').textContent = L(`${current.zh} —— 已收集 ${current.pagesCollected} 页${current.broken ? '（已破解）' : ''}`, `${current.name} — ${current.pagesCollected} pages${current.broken ? ' (broken)' : ''}`);
  $('#seal-runes').textContent = current.runes;
  $('#seal-codex').textContent = section.codex.join('\n');
}
$('#seal-read').onclick = () => send({ t: 'readpage', tier: sealTier });
$('#seal-break').onclick = () => send({ t: 'breakseal', tier: sealTier, words: $<HTMLInputElement>('#seal-words').value.split(/[\s,]+/).filter(Boolean) });

$('#sp-forget').onclick = () => { const n = $<HTMLInputElement>('#sp-name').value; if (n) send({ t: 'unlearn', spell: n }); };

// ------------------------------------------------------------------ the next goal (下一步): one quiet line under your name, after the tutorial
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
let goalOff = lsGet('hogwarts.goal.off') === '1';
let goalKey = lsGet('hogwarts.goal.seen') ?? '';
let goalOpen = false;
let goal: Goal | null = null;
function renderGoal() {
  const el = $('#goal');
  if (!me || goalOff || ctl.tutorialActive() || me.stunned || me.jailed) { el.hidden = true; return; }
  goal = nextGoal({
    year: me.year, xp: me.xp, xpNext: me.xpNext, ui: me.ui, seals: me.seals, galleons: me.galleons, reputation: me.reputation, decree: me.decree, house: me.house,
    customSpells: bookSpells.length ? bookSpells.filter((x) => !x.builtin).length : null,
    items: trunkKnown ? trunkItems.length : null,
    ...pn.goalState(),
  });
  if (!goal) { el.hidden = true; return; }
  if (goal.key !== goalKey) {
    // progress: remember it and say so once
    if (goalKey) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    goalKey = goal.key; lsSet('hogwarts.goal.seen', goal.key); goalOpen = false;
  }
  const html = `<div class="g-row"><button type="button" class="g-line" aria-expanded="${goalOpen}" title="${esc(L('点一下看怎么做', 'Click for how'))}">${ic('quill')}<span class="g-k">${L('下一步', 'Next')}</span><span class="g-t">${esc(goal.text)}</span></button>`
    + `<button type="button" class="g-x" title="${esc(L('隐藏（帮助面板 H 里可以重新打开）', 'Hide (the help panel, H, brings it back)'))}" aria-label="×"><svg class="ic"><use href="#i-x"/></svg></button></div>`
    + (goalOpen ? `<div class="g-why">${esc(goal.why)}${goal.act ? `<div class="g-acts"><button type="button" class="g-act">${esc(goal.actLabel ?? '')}</button></div>` : ''}</div>` : '');
  setHtml(el, html);
  el.hidden = false;
}
$('#goal').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.classList.contains('g-line')) goalOpen = !goalOpen;
  else if (b.classList.contains('g-x')) { goalOff = true; lsSet('hogwarts.goal.off', '1'); }
  else if (b.classList.contains('g-act') && goal?.act) {
    const a = goal.act;
    goalOpen = false;
    if ('cast' in a) ctl.castOnSelf(a.cast);
    else if (a.open === 'book') toggleBook(true);
    else if (a.open === 'tpl') { toggleBook(true); openTemplates(); }
    else if (a.open === 'seals') { if ($('#seals').hidden) toggleSeals(); }
    else if (a.open === 'trunk') toggleTrunk(true);
    else if (a.open === 'board') { if ($('#board').hidden) void showBoard(); }
    else if (a.open === 'owl') toggleOwl(true);
    else if (a.open === 'exams') pn.openExams();
    else if (a.open === 'da') pn.openDa();
  }
  b.blur();
  renderGoal();
});
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('#help-goal')) return;
  goalOff = false; lsSet('hogwarts.goal.off', '0');
  ctl.toggleHelp(false);
  renderGoal();
});

// ------------------------------------------------------------------ input (targeting, smart casting, click-to-move, camera, help, onboarding: controls.ts)
function toggleMenu() {
  const m = $('#menu');
  m.hidden = !m.hidden;
  if (!m.hidden) solo(m);
  keyShown = false; // the key is hidden again every time the Owl Post opens or closes
  rotateArmed = false;
  if (!m.hidden) { ctl.notify('menu'); if (!$('#op-pair')) menuInfo(); renderMenuLive(); }
}
probe.mark("preControls");
const ctl = createControls({
  canvas, camera, scene, ground: world.ground, hoverRing: aimRing, wizards, creatures,
  snap: () => snap, me: () => me, myHandle: () => myHandle, send, toast,
  cam: {
    get yaw() { return camYaw; }, set yaw(v: number) { camYaw = v; },
    get pitch() { return camPitch; }, set pitch(v: number) { camPitch = v; },
    get dist() { return camDist; }, set dist(v: number) { camDist = v; },
  },
  panels: { book: toggleBook, menu: toggleMenu, owl: (force?: boolean) => toggleOwl(force), trunk: () => toggleTrunk() },
  agent: agentNow,
  pair: pairNow,
  // 隐藏宝箱: F at a closed chest opens it
  extraAction: () => {
    const p = wizards.get(myHandle)?.root.position;
    const c = p && snap?.cup ? funWorld.chestNear(p, snap.cup.ch) : null;
    return c ? { label: L(`按 F 打开宝箱 ·「${c.zh}」`, `F — open the chest (${c.en})`), x: c.x, z: c.z, y: heightAt(c.x, c.z) + 1.6, act: () => send({ t: 'chest' }) } : null;
  },
});
// ------------------------------------------------------------------ the panels: 黑魔王, 邓布利多军, 偷师, O.W.L., 使魔, 专注力, 无规则区 (client/panels)
/** Put a source in the spellbook's editor as a new draft (偷师's 看源码). */
function loadDraft(name: string, source: string, note: string) {
  loadSpell(null);
  $<HTMLInputElement>('#sp-name').value = name;
  $<HTMLTextAreaElement>('#sp-src').value = source;
  bookOut(note, 'good');
}
const pn = createPanels({
  send, toast, me: () => me, snap: () => snap,
  myPos: () => wizards.get(myHandle)?.root.position ?? null,
  camYaw: () => camYaw,
  wizardRoot: (h) => wizards.get(h)?.root ?? null,
  agentConnected: () => !!agentNow()?.connected,
  spells: () => bookSpells,
  wantSpells: () => { if (!bookSpells.length) send({ t: 'book' }); },
  openBook: () => { if ($('#book').hidden) toggleBook(true); },
  loadDraft, solo,
});
// ------------------------------------------------------------------ 学院杯 · 校园事件轮盘 · 巧克力蛙画片 · 隐藏宝箱 (client/panels/fun.ts, client/funworld.ts)
const fun = createFun({ send, toast, me: () => me, snap: () => snap, myPos: () => wizards.get(myHandle)?.root.position ?? null, camYaw: () => camYaw, solo });
const funWorld = createFunWorld();
scene.add(funWorld.group);
/** What a chest held (the card itself arrives as its own event and flips over). */
function onChest(r: { whereZh?: string; where?: string; housePoints?: number; galleons?: number; card?: string; fragment?: { zh: string; en: string; source: string }; left?: number }) {
  const parts: string[] = [];
  if (r.galleons) parts.push(L(`${r.galleons} 加隆`, `${r.galleons} Galleons`));
  if (r.fragment) parts.push(L(`一页如尼文残页：${r.fragment.zh}`, `a torn page of Runes: ${r.fragment.en}`));
  if (r.card) parts.push(L('一张巧克力蛙画片', 'a Chocolate Frog card'));
  toast(L(`🧰 打开了宝箱（${r.whereZh ?? ''}）：${parts.join('、') || '空的'} · 学院分 +${r.housePoints ?? 0} · 本学期还剩 ${r.left ?? 0} 个`, `🧰 You open the chest (${r.where ?? ''}): ${parts.join(', ') || 'empty'} · +${r.housePoints ?? 0} house points · ${r.left ?? 0} left this term`));
  if (r.fragment) loadDraft(L('宝箱里的残页', 'Page from a chest'), r.fragment.source, L(r.fragment.zh, r.fragment.en));
}
// the camera keeps out of walls, fades what hides you, x-rays you and your allies (view.ts)
const view = createView({ scene, camera, renderer: R.renderer, ground: [world.ground], wizards, creatures, myHandle: () => myHandle, snap: () => snap, target: () => ctl.lockedTarget(), cam: {
  get yaw() { return camYaw; }, set yaw(v: number) { camYaw = v; }, get pitch() { return camPitch; }, set pitch(v: number) { camPitch = v; }, get dist() { return camDist; }, set dist(v: number) { camDist = v; } } });
// ------------------------------------------------------------------ chat: the line appears on Enter and goes away when it is empty
const chatBox = $<HTMLInputElement>('#chat');
function openChat() { chatBox.hidden = false; chatBox.focus(); }
chatBox.addEventListener('blur', () => { if (!chatBox.value.trim()) { chatBox.value = ''; chatBox.hidden = true; } });
$('#tb-chat').onclick = () => { if (chatBox.hidden) openChat(); else chatBox.blur(); };

// ------------------------------------------------------------------ close buttons (×) on every sheet, and the collapsed key line
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-close]') as HTMLElement | null;
  if (!b) return;
  const id = b.dataset.close!;
  if (id === 'menu') { if (!$('#menu').hidden) toggleMenu(); }
  else if (id === 'helppanel') ctl.toggleHelp(false);
  else $('#' + id).hidden = true;
});
$('#help .mini').addEventListener('click', () => ctl.toggleHelp());

// ------------------------------------------------------------------ lore when idle: now and then, one line, then gone
let lastActivity = performance.now();
let lastLore = performance.now();
const LORE_EVERY_MS = 180_000, LORE_IDLE_MS = 40_000, LORE_SHOW_MS = 11_000;
for (const ev of ['keydown', 'pointerdown', 'touchstart', 'wheel']) addEventListener(ev, () => { lastActivity = performance.now(); if (performance.now() - lastLore > 1500) $('#lore').classList.remove('show'); }, { passive: true });
setInterval(() => {
  const t = performance.now();
  const busy = PANELS.some((id) => !document.getElementById(id)?.hidden) || ctl.tutorialActive() || !$('#toast').hidden || !chatBox.hidden || !$('#cursebar').hidden || !$('#banner').hidden || !me;
  if (busy || t - lastActivity < LORE_IDLE_MS || t - lastLore < LORE_EVERY_MS) return;
  const tip = nextTip();
  if (!tip) return;
  lastLore = t;
  const el = $('#lore');
  el.textContent = tip;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => el.classList.remove('show'), LORE_SHOW_MS);
}, 5000);

addEventListener('keydown', (e) => {
  const chat = chatBox;
  if (document.activeElement === chat) {
    if (e.key === 'Enter') { sendChat(chat.value); chat.value = ''; chat.blur(); }
    if (e.key === 'Escape') chat.blur();
    return;
  }
  // typing never triggers game keys (O and T included)
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')) {
    if (e.key === 'Escape') {
      const a = document.activeElement as HTMLElement;
      if (a === $('#owl-input')) toggleOwl(false);
      // the spellbook keeps your draft: Esc closes it straight from a field
      if (a.closest('#book')) $('#book').hidden = true;
      a.blur();
    }
    return;
  }
  if (pn.keydown(e)) return; // J 邓布利多军, K O.W.L. (client/panels)
  if (fun.keydown(e)) return; // C 巧克力蛙画片 (client/panels/fun.ts)
  if (e.key === 'b' || e.key === 'B') { toggleBook(); return; }
  if (e.key === 'r' || e.key === 'R') { toggleSeals(); return; }
  if (e.key === 'l' || e.key === 'L') { showBoard(); return; }
  if (e.key === 'o' || e.key === 'O') { if (!e.repeat) toggleOwl(); e.preventDefault(); return; }
  if (e.key === 't' || e.key === 'T') { if (!e.repeat) toggleTrunk(); return; }
  if (e.key === 'Enter') { openChat(); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    // close the topmost panel, then drop the target, then open the Owl Post
    if (!$('#atask').hidden) { $('#atask').hidden = true; atPending = null; return; }
    if (!$('#book').hidden) { $('#book').hidden = true; return; }
    if (pn.closeTop()) return;
    if (fun.closeTop()) return;
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
let frameNo = 0;
const ORIGIN = new THREE.Vector3();
const litPool: { x: number; y: number; z: number; color: number; d: number }[] = [], lit: typeof litPool = [];
function frame() {
  requestAnimationFrame(frame);
  probe.frameBegin();
  let tp = probe.begin();
  const now = performance.now();
  const dt = Math.min(0.1, (now - prev) / 1000);
  if (snap) dyn?.frame(now - prev);
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
  // level of detail from last frame's camera (it moves a fraction of a metre per frame)
  const lod = LOD[quality], cam = camera.position, focusKey = ctl.targetKey();
  crowd.begin();
  parts.begin();
  for (const [h, w] of wizards) {
    const px = w.root.position.x, pz = w.root.position.z;
    w.root.position.x += (w.tx - w.root.position.x) * k;
    w.root.position.z += (w.tz - w.root.position.z) * k;
    w.root.position.y = heightAt(w.root.position.x, w.root.position.z);
    const turn = Math.atan2(Math.sin(-w.tf - w.body.rotation.y), Math.cos(-w.tf - w.body.rotation.y));
    w.body.rotation.y += turn * Math.min(1, dt * 14);
    const speed = dt > 0 ? Math.hypot(w.root.position.x - px, w.root.position.z - pz) / dt : 0;
    const d = Math.hypot(w.root.position.x - cam.x, w.root.position.y - cam.y, w.root.position.z - cam.z);
    const mine = h === myHandle, focused = h === focusKey;
    // (a stunned wizard lies down: only the full model does that)
    w.far = !mine && !focused && d > lod.wizard + (w.far ? 0 : 4) && Math.abs(w.body.rotation.z) < 0.1;
    w.body.visible = !w.far;
    w.label.show(focused || (!w.far && d < lod.label));
    if (w.patronus.visible) {
      w.patronus.position.set(Math.cos(clock * 3) * 2, 1.5, Math.sin(clock * 3) * 2);
      particles.trail(w.patronus, w.patronus.getWorldPosition(tmpTip), 0xcfe4ff, 0.35);
    }
    if (w.far) {
      // the crowd's walk: a bob twice per stride while moving
      w.bob = ((w.bob ?? 0) + dt * Math.min(speed, 9) * 1.3) % Math.PI;
      const col = farColors(w);
      crowd.put(w.root.position.x, w.root.position.y + w.body.position.y, w.root.position.z, w.body.rotation.y, speed > 0.3 ? Math.abs(Math.cos(w.bob)) * 0.06 : 0, col.robe, col.trim);
      w.castPending = false;
      continue;
    }
    w.setMid(!mine && !focused && d > lod.mid);
    const fire = w.update(dt, speed, w.castPending);
    w.castPending = false;
    w.root.updateMatrixWorld();
    parts.add(w.root);
    if (fire) particles.flash(w.wandTip.getWorldPosition(tmpTip), 0xfff2c0);
  }
  crowd.end(quality === 'high');
  parts.end();
  herd.begin();
  for (const [i, c] of creatures) {
    c.root.position.x += (c.tx - c.root.position.x) * k;
    c.root.position.z += (c.tz - c.root.position.z) * k;
    c.root.position.y = heightAt(c.root.position.x, c.root.position.z);
    c.root.rotation.y = -c.tf;
    const d = Math.hypot(c.root.position.x - cam.x, c.root.position.y - cam.y, c.root.position.z - cam.z);
    const focused = i === focusKey;
    // near: the animated model; far: a statue in the herd; beyond `creature`: not drawn
    c.root.visible = focused || d < lod.anim;
    c.label.show(focused || d < lod.label);
    if (c.root.visible) c.anim(clock);
    else if (d < lod.creature) herd.put(c.k, c.root.position, c.root.rotation.y);
  }
  herd.end();
  for (const b of bolts.values()) {
    b.position.x += ((b.tx ?? b.position.x) - b.position.x) * Math.min(1, k * 2);
    b.position.z += ((b.tz ?? b.position.z) - b.position.z) * Math.min(1, k * 2);
    b.position.y = 1.3 + heightAt(b.position.x, b.position.z);
    particles.trail(b, b.position, b.userData.color ?? 0xffffff);
    const spin = b.children[0];
    if (spin) spin.rotation.set(clock * 7, clock * 5, 0);
  }
  boltBatch.update(bolts.values());
  fxm.update(dt);
  elderGlint.rotation.y += dt * 2;
  elderGlint.position.y = 2.6 + heightAt(elderGlint.position.x, elderGlint.position.z) + Math.sin(clock * 2) * 0.2;
  probe.end('anim', tp); tp = probe.begin();

  // camera follows me
  const my = wizards.get(myHandle);
  if (my) {
    const t = my.root.position;
    view.place(t, dt); // (view.ts: aims at t.y + 1.25, a little below the head, so the wizard sits above the dock)
    weather.points.position.set(t.x, 0, t.z);
  }

  // lighting, sky and decorations from the hour, the weather and whatever the last Minister decreed
  if (snap) {
    const look: Look = snap.look ?? DEFAULT_LOOK;
    R.update(snap.hour, snap.weather, look, my ? my.root.position : ORIGIN);
    const night = 1 - R.day;
    for (const m of world.nightGlow) m.emissiveIntensity = (0.35 + 3.2 * night) * look.glow;
    decor.update(look, R.day, clock, dt);
    weather.update(snap.weather, dt);
    let nearWillow = false;
    if (!snap.willowCalm) for (const w of wizards.values()) if (Math.hypot(w.root.position.x - 45, w.root.position.z) < 9) { nearWillow = true; break; }
    world.tick(clock, dt, nearWillow, R.sunDir,
      { hour: snap.hour, banner: look.banner, focus: my?.root.position });
  }
  candles.update();
  probe.end('world', tp); tp = probe.begin();
  particles.setQuality(quality);
  particles.update(dt, camera, R.renderer, R.day);
  // spells light up their surroundings: the pool goes to the bolts nearest the camera
  // (the light budget, lights.ts, then picks among these and every other light)
  let nl = 0;
  for (const b of bolts.values()) {
    const l = (litPool[nl++] ??= { x: 0, y: 0, z: 0, color: 0, d: 0 });
    l.x = b.position.x; l.y = b.position.y + 0.2; l.z = b.position.z; l.color = (b.userData.color as number) ?? 0xffffff; l.d = b.position.distanceToSquared(camera.position);
  }
  lit.length = 0;
  for (let i = 0; i < nl; i++) lit.push(litPool[i]);
  lit.sort((a, b) => a.d - b.d);
  R.setBoltLights(lit);
  probe.end('fx', tp); tp = probe.begin();

  ctl.update(dt);
  pn.frame(dt);
  funWorld.frame(dt, snap);
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) { $('#banner').classList.add('out'); setTimeout(() => { if (bannerT <= 0) $('#banner').hidden = true; }, 1000); } }
  lights.update(captureFocus(my ? my.root.position : camera.position));
  probe.end('ctl', tp); tp = probe.begin();
  R.shadowFrame(fullDetail || (++frameNo & 1) === 1);
  R.render();
  probe.end('render', tp);
  if (snap) probe.mark('firstFrame');
  probe.frameEnd();
}

setInterval(() => { const t = probe.begin(); hud(); probe.end('hud', t); }, 100);

// ------------------------------------------------------------------ shader warm-up
/**
 * Compile every shader the game will need while the veil and the gate are up, without blocking (three.js
 * compileAsync, KHR_parallel_shader_compile where the browser has it): the world, a wizard, each kind of
 * creature (near and far), the crowd, bolts, effects, name tags. Otherwise each of them compiles on the frame
 * it first appears, a visible hitch (and the first frame alone compiled ~70 programs). The warm-up models are
 * kept (their materials keep the programs alive); the creatures go to the pools.
 */
const warmed = (async () => {
  await new Promise((r) => setTimeout(r, 0));
  const t0 = performance.now();
  const g = new THREE.Group();
  g.position.set(0, -200, 0);
  // a wizard of every house (each house's knitwear, sleeves and hat are materials and batches of their own)
  const ws = (['Gryffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin'] as const).map((h, i) => {
    const w = makeWizard(h, false, `warm-up-${i}`);
    w.root.position.x = i * 2;
    w.label.draw('warm-up', '#fff', 1);
    // its Lumos light hidden like every wizard's (lights.ts): four extra lights would have compiled every lit
    // shader for a light set the game never draws with, and the first frames compiled them all again
    w.glow.visible = false;
    w.root.add(makeAuraRing());
    g.add(w.root);
    return w;
  });
  g.add(makeBolt('root', 'fire'));
  g.updateMatrixWorld(true);
  parts.begin(); for (const w of ws) parts.add(w.root); parts.end();
  const kinds = Object.keys(NAMES) as CreatureKind[];
  const made: CreatureEntry[] = [];
  for (const k of kinds) {
    const c = Object.assign(makeCreature(k), { k, tx: 0, tz: 0, tf: 0, aura: makeAuraRing() }) as CreatureEntry;
    c.root.add(c.aura);
    c.root.name = 'creature';
    c.label.sprite.visible = false;
    g.add(c.root);
    made.push(c);
    herd.put(k, g.position, 0);
  }
  herd.end();
  crowd.begin(); crowd.put(0, -200, 0, 0, 0, 0x222222, 0xffffff); crowd.end(true);
  const far = 3000;
  ring(far, far, 0xffffff, 1, 2, 0.1); puff(far, far, 0xffffff); column(far, far, 0xffffff, 0.1); floatText(far, far, '1', '#fff'); lightning([far, far, far + 1, far], 0xffffff);
  scene.add(g);
  funWorld.warm(true); // the snitch, Filch, Mrs Norris, Peeves, the Room's door (client/funworld.ts)
  // compiled for the post-processing scene pass's target: the scene is drawn into it (linear HDR, multisampled,
  // tone mapped later), and a pipeline for another target format would be another compile
  try { await R.warm(scene, camera); } catch (e) { console.warn('[gpu] warm-up compile failed, compiling on first use', e); }
  // and one frame with the warm-up models in it (under the ground, but in the sun's shadow frustum): the shadow
  // map's pipelines and the post-processing passes, which compileAsync does not build
  try { R.warmFrame(); } catch (e) { console.warn('[gpu] warm-up frame failed', e); }
  scene.remove(g);
  funWorld.warm(false);
  herd.begin(); herd.end();
  crowd.begin(); crowd.end(false);
  parts.begin(); parts.end();
  for (const c of made) { g.remove(c.root); const pool = herdPool.get(c.k) ?? []; pool.push(c); herdPool.set(c.k, pool); }
  if (probe.PERF) console.log(`[perf] shaders warmed in ${(performance.now() - t0).toFixed(0)} ms (${R.renderer.info.memory.programs} programs)`);
  probe.mark('warm');
})();

// ------------------------------------------------------------------ boot
(async () => {
  probe.mark('boot');
  applyStatic();
  veil(true);
  token = await gate();
  probe.mark('gate');
  $('#gate').hidden = true;
  veil(true);
  setTimeout(() => veil(false), 20000); // never hide the castle for long, snapshot or not
  $('#hud').hidden = false;
  connect();
  await warmed;
  frame();
})();

