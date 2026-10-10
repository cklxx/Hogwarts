/**
 * 命运链 Fates (a Feature): five two-branched threads across the War Week.
 *
 * Each thread opens on its trigger day, resolves by its deadline day, and its
 * outcome changes the Day 7 assault for real (not just words):
 *
 * - filch (Day 1→2): Mrs. Norris is lost. Find her (walk within 5m) → the castle
 *   gates open early on Day 7: the first assault wave is delayed 60s.
 * - merchant (Day 2→3): robbers hit Hogsmeade. Kill them → the merchant's guild
 *   sponsors 20% off all market listings, and free potions drop at Hogsmeade
 *   during the assault. Fail → no discount, no potions.
 * - hagrid (Day 3→4): dementors besiege Hagrid's hut in the forest. Kill them →
 *   3 allied hippogriffs join the Day 7 assault. Fail → no air support.
 * - snape (Day 4→5): nifflers stole Snape's potion ingredients in the dungeons.
 *   Kill them → every player deals +25% damage during the assault (his draught).
 * - luna (Day 5→6): Luna is trapped by grindylows at the lake. Kill them →
 *   she warns of the assault routes when Day 7 dawns. Fail → no warning.
 *
 * Toggle: world.flags.warweek (same as warweek.ts; when off, fates sleep too).
 * Threads reset every war-week cycle.
 */
import { CREATURES } from './creatures.js';
import type { CreatureKind } from '../shared/constants.js';
import { LANDMARKS } from '../shared/map.js';
import type { Creature, Vec2, Wizard } from './types.js';
import type { Feature } from './feature.js';
import type { World } from './world.js';
import { drop } from './loot.js';
import { WARWEEK_TERMS } from './warweek.js';

export type FateId = 'filch' | 'merchant' | 'hagrid' | 'snape' | 'luna';
export type FateState = 'idle' | 'open' | 'saved' | 'lost';

export interface FateThread {
  id: FateId;
  zh: string;
  en: string;
  triggerDay: number;
  deadlineDay: number;
  state: FateState;
  /** event creature ids (combat fates) */
  mobs: Set<string>;
  /** where the event happens */
  at: Vec2;
}

interface FatesState {
  /** which war-week cycle these threads belong to */
  cycle: number;
  threads: Record<FateId, FateThread>;
  /** allied reinforcement creature ids (hagrid's hippogriffs) */
  allies: Set<string>;
  /** assault already handled this cycle (one-shot effects) */
  assaultSeen: boolean;
  /** next free-potion drop (merchant) */
  nextPotionAt: number;
  /** id of the wizard the allies are credited to (for canHarm delegation) */
  allyOwner: string | null;
}

declare module './world.js' {
  interface World {
    /** 命运链 (this module's Feature): the five threads and their outcomes. */
    fates: FatesState;
  }
}

const dayOf = (termN: number) => ((termN - 1) % WARWEEK_TERMS) + 1;
const cycleOf = (termN: number) => Math.floor((termN - 1) / WARWEEK_TERMS);

/** Publish a thread outcome for the aftermath reader (kernel/aftermath.ts). */
function publishResult(world: World, t: FateThread) {
  const f = world.flags as unknown as { fateResults?: Record<string, string> };
  if (!f.fateResults) f.fateResults = {};
  f.fateResults[t.id] = t.state;
}

const landmark = (id: string): Vec2 => {
  const l = LANDMARKS.find((x) => x.id === id)!;
  return { x: l.x, z: l.z };
};

function newThreads(): Record<FateId, FateThread> {
  const mk = (id: FateId, zh: string, en: string, triggerDay: number, deadlineDay: number, at: Vec2): FateThread =>
    ({ id, zh, en, triggerDay, deadlineDay, state: 'idle', mobs: new Set(), at });
  return {
    filch: mk('filch', '费尔奇的猫', "Filch's cat", 1, 2, landmark('courtyard')),
    merchant: mk('merchant', '霍格莫德商人', 'Hogsmeade merchant', 2, 3, landmark('hogsmeade')),
    hagrid: mk('hagrid', '海格被围攻', 'Hagrid besieged', 3, 4, landmark('hagrid')),
    snape: mk('snape', '斯内普的材料', "Snape's ingredients", 4, 5, landmark('dungeons')),
    luna: mk('luna', '卢娜被困', 'Luna trapped', 5, 6, landmark('lake')),
  };
}

function spawnMob(world: World, kind: CreatureKind, at: Vec2, owner: string | null = null): Creature {
  const def = CREATURES[kind];
  const pos = { x: at.x + (world.rand() - 0.5) * 12, z: at.z + (world.rand() - 0.5) * 12 };
  if (!def.flying) world.solids.resolve(pos, def.radius);
  const hp = Math.round(def.hp * world.rules.creatures.statMultiplier);
  const c: Creature = {
    id: world.mintId('c'), kind, pos, home: { ...pos }, hp, maxHp: hp, facing: world.rand() * 6.28,
    target: null, attackCd: 1, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {},
    auras: [], owner, until: 0,
  };
  world.creatures.set(c.id, c);
  world.fx({ k: 'apparate', x: pos.x, z: pos.z });
  return c;
}

function despawnMobs(world: World, t: FateThread) {
  for (const id of t.mobs) world.creatures.delete(id);
  t.mobs.clear();
}

// ------------------------------------------------------------------ triggers

function triggerFilch(world: World, t: FateThread) {
  // Mrs. Norris hides near one of these; the broadcast hints at the area.
  const spots = ['courtyard', 'greenhouses', 'lake', 'pitch'].map(landmark);
  t.at = spots[Math.floor(world.rand() * spots.length)];
  const hint = t.at.x < -40 ? '温室附近' : t.at.z > 60 ? '魁地奇球场附近' : t.at.x > 40 ? '黑湖边' : '庭院附近';
  const hintEn = t.at.x < -40 ? 'near the greenhouses' : t.at.z > 60 ? 'near the Quidditch pitch' : t.at.x > 40 ? 'by the Black Lake' : 'near the courtyard';
  world.emit('term',
    `🐈 Mrs. Norris is lost! Filch is frantic — she was last seen ${hintEn}. Find her (walk close) before Day 2.`,
    { zh: `🐈 洛丽丝夫人走失了！费尔奇急疯了 —— 最后一次看到她在${hint}。第 2 天之前找到她（走近就行）。` });
  world.fx({ k: 'seal', x: t.at.x, z: t.at.z });
}

function triggerMerchant(world: World, t: FateThread) {
  const kinds: CreatureKind[] = ['redcap', 'redcap', 'erkling'];
  for (const k of kinds) t.mobs.add(spawnMob(world, k, t.at).id);
  world.emit('term',
    `🏪 Robbers hit Hogsmeade! Drive them off before Day 3 — the merchant's guild rewards its friends.`,
    { zh: `🏪 强盗袭击了霍格莫德！第 3 天之前赶走他们 —— 商人公会不会亏待朋友。` });
}

function triggerHagrid(world: World, t: FateThread) {
  const kinds: CreatureKind[] = ['dementor', 'dementor', 'dementor'];
  for (const k of kinds) t.mobs.add(spawnMob(world, k, t.at).id);
  world.emit('term',
    `🌲 Dementors besiege Hagrid's hut in the Forbidden Forest! Drive them off before Day 4.`,
    { zh: `🌲 摄魂怪围攻了禁林里海格的小屋！第 4 天之前赶走它们。` });
}

function triggerSnape(world: World, t: FateThread) {
  const kinds: CreatureKind[] = ['niffler', 'niffler', 'niffler', 'boggart'];
  for (const k of kinds) t.mobs.add(spawnMob(world, k, t.at).id);
  world.emit('term',
    `🧪 Nifflers stole Snape's potion ingredients in the dungeons! Recover them before Day 5 — he brews for the war.`,
    { zh: `🧪 嗅嗅偷走了斯内普在地牢里的魔药材料！第 5 天之前夺回来 —— 他在为大战熬药。` });
}

function triggerLuna(world: World, t: FateThread) {
  const kinds: CreatureKind[] = ['grindylow', 'grindylow', 'kelpie'];
  for (const k of kinds) t.mobs.add(spawnMob(world, k, t.at).id);
  // walk Luna to the lake so the scene is concrete
  const luna = [...world.wizards.values()].find((w) => w.npc && w.name === 'Luna Lovegood');
  if (luna && world.isActive(luna)) {
    luna.pos = { x: t.at.x + 3, z: t.at.z + 3 };
    world.moved(luna);
  }
  world.emit('term',
    `🌊 Grindylows trapped Luna at the Black Lake! Free her before Day 6.`,
    { zh: `🌊 格林迪洛在黑湖困住了卢娜！第 6 天之前救她出来。` });
}

const TRIGGERS: Record<FateId, (world: World, t: FateThread) => void> = {
  filch: triggerFilch, merchant: triggerMerchant, hagrid: triggerHagrid, snape: triggerSnape, luna: triggerLuna,
};

// ------------------------------------------------------------------ resolution

function resolveSaved(world: World, t: FateThread) {
  t.state = 'saved';
  publishResult(world, t);
  despawnMobs(world, t);
  const lines: Record<FateId, { en: string; zh: string }> = {
    filch: { en: `🐈 Mrs. Norris is found! Filch will open the castle gates early on Day 7.`, zh: `🐈 找到洛丽丝夫人了！第 7 天费尔奇会提前打开城门。` },
    merchant: { en: `🏪 Hogsmeade is safe! The guild sends wartime potions, and honors its debt with 20% off next cycle.`, zh: `🏪 霍格莫德保住了！公会送来战时魔药，下周期集市八折以谢。` },
    hagrid: { en: `🌲 Hagrid is safe! His hippogriffs will join the Day 7 assault.`, zh: `🌲 海格安全了！第 7 天他的鹰头马身兽会参战。` },
    snape: { en: `🧪 Ingredients recovered! Snape's draught gives everyone +25% damage in the assault.`, zh: `🧪 材料夺回来了！大战中斯内普的药剂让所有人伤害 +25%。` },
    luna: { en: `🌊 Luna is free! She will warn of the assault routes when Day 7 dawns.`, zh: `🌊 卢娜自由了！第 7 天拂晓她会预警进攻路线。` },
  };
  const l = lines[t.id];
  world.emit('term', l.en, { zh: l.zh });
}

function resolveLost(world: World, t: FateThread) {
  t.state = 'lost';
  publishResult(world, t);
  despawnMobs(world, t);
  const lines: Record<FateId, { en: string; zh: string }> = {
    filch: { en: `🐈 Mrs. Norris never came home. The gates open on schedule — no early warning.`, zh: `🐈 洛丽丝夫人没有回家。城门按时开，没有提前预警。` },
    merchant: { en: `🏪 Hogsmeade fell quiet. No discount, no wartime potions.`, zh: `🏪 霍格莫德安静了。没有折扣，没有战时魔药。` },
    hagrid: { en: `🌲 Hagrid drove them off alone, hurt. No hippogriffs on Day 7.`, zh: `🌲 海格独自赶走了它们，受了伤。第 7 天没有鹰头马身兽。` },
    snape: { en: `🧪 The ingredients are gone. No draught for the assault.`, zh: `🧪 材料没了。大战没有药剂。` },
    luna: { en: `🌊 Luna freed herself, shaken. No warning of the assault routes.`, zh: `🌊 卢娜自己脱身了，受了惊吓。没有进攻路线预警。` },
  };
  const l = lines[t.id];
  world.emit('term', l.en, { zh: l.zh });
}

/** A combat fate is saved the moment its last mob dies. */
function checkCombatSaved(world: World, t: FateThread): boolean {
  if (t.state !== 'open' || t.mobs.size === 0) return false;
  for (const id of t.mobs) if (world.creatures.has(id)) return false;
  t.mobs.clear();
  resolveSaved(world, t);
  return true;
}

// ------------------------------------------------------------------ assault effects

function onAssaultStart(world: World) {
  const st = world.fates;
  const a = world.warweek.assault;
  if (!a) return;
  // pick an owner for the allies: a participant, else any active player
  const owner: Wizard | undefined =
    [...a.participants].map((id) => world.wizards.get(id)).find((w) => w && world.isActive(w)) ??
    [...world.wizards.values()].find((w) => !w.npc && world.isActive(w));
  st.allyOwner = owner?.id ?? null;

  if (st.threads.hagrid.state === 'saved' && owner) {
    const at = landmark('courtyard');
    for (let i = 0; i < 3; i++) {
      const c = spawnMob(world, 'hippogriff', at, owner.id);
      st.allies.add(c.id);
    }
    world.emit('term',
      `🦅 Hagrid's hippogriffs scream down from the sky — for the castle!`,
      { zh: `🦅 海格的鹰头马身兽从天而降 —— 为了城堡！` });
  }
  if (st.threads.filch.state === 'saved') {
    a.nextWaveAt += 60; // gates opened early: the first wave loses its surprise
    world.emit('term',
      `🚪 Filch opened the gates early — scouts bought us time. The first wave is delayed!`,
      { zh: `🚪 费尔奇提前打开了城门 —— 斥候争取到了时间。第一波进攻推迟了！` });
  }
  if (st.threads.merchant.state === 'saved') {
    st.nextPotionAt = world.now + 5;
  }
}

function stepAllies(world: World) {
  const st = world.fates;
  const a = world.warweek.assault;
  if (!a) {
    // no assault: allies fly home
    for (const id of st.allies) world.creatures.delete(id);
    st.allies.clear();
    return;
  }
  const liveMobs = [...a.mobs].filter((id) => world.creatures.has(id));
  for (const id of [...st.allies]) {
    const c = world.creatures.get(id);
    if (!c) { st.allies.delete(id); continue; }
    if (liveMobs.length === 0) continue;
    // point at the nearest assault mob; the hostile AI does the rest
    // (canHarm delegates to the owner, a player, so assault mobs are valid targets)
    let best: string | null = null, bd = 40;
    for (const m of liveMobs) {
      const mc = world.creatures.get(m)!;
      const d = Math.hypot(mc.pos.x - c.pos.x, mc.pos.z - c.pos.z);
      if (d < bd) { bd = d; best = m; }
    }
    if (best) c.target = best;
  }
}

function stepMerchantPotions(world: World) {
  const st = world.fates;
  if (st.threads.merchant.state !== 'saved' || !world.warweek.assault) return;
  if (world.now < st.nextPotionAt) return;
  st.nextPotionAt = world.now + 60;
  drop(world, landmark('hogsmeade'), 'potion');
  world.emit('term',
    `🧪 The merchant's guild delivers a wartime potion to Hogsmeade.`,
    { zh: `🧪 商人公会送来一瓶战时魔药，放在霍格莫德。` });
}

function stepFilchCat(world: World, t: FateThread) {
  if (t.state !== 'open') return;
  for (const w of world.wizards.values()) {
    if (w.npc || !world.isActive(w)) continue;
    if (Math.hypot(w.pos.x - t.at.x, w.pos.z - t.at.z) < 5) {
      resolveSaved(world, t);
      return;
    }
  }
}

// ------------------------------------------------------------------ main step

function stepFates(world: World) {
  const st = world.fates;
  if (!world.flags.warweek) return;

  // assault one-shots FIRST: the assault starts on the cycle boundary (term 7→8),
  // and the outgoing cycle's thread outcomes must apply to it before any reset.
  const a = world.warweek.assault;
  if (a && !st.assaultSeen) {
    st.assaultSeen = true;
    onAssaultStart(world);
  }
  if (!a && st.assaultSeen) st.assaultSeen = false;

  // new cycle: reset the threads, but not while the assault is still running
  // (the old outcomes are still in play until the battle ends)
  const cycle = cycleOf(world.term.n);
  if (cycle !== st.cycle && !world.warweek.assault) {
    st.cycle = cycle;
    st.threads = newThreads();
    st.allies.clear();
    st.assaultSeen = false;
    st.allyOwner = null;
  }

  const day = dayOf(world.term.n);

  // trigger + deadline on day boundaries (checked every tick; idempotent)
  for (const t of Object.values(st.threads)) {
    if (t.state === 'idle' && day >= t.triggerDay) {
      t.state = 'open';
      TRIGGERS[t.id](world, t);
    }
    if (t.state === 'open' && day >= t.deadlineDay) {
      // combat fates: one last check (maybe the player just killed the last mob)
      if (!checkCombatSaved(world, t)) resolveLost(world, t);
    }
  }

  // ongoing checks
  for (const t of Object.values(st.threads)) {
    if (t.state !== 'open') continue;
    if (t.id === 'filch') stepFilchCat(world, t);
    else checkCombatSaved(world, t);
  }

  // Luna's warning: when Day 7 dawns
  if (day === 7 && st.threads.luna.state === 'saved' && !(st as { lunaWarned?: boolean }).lunaWarned) {
    (st as { lunaWarned?: boolean }).lunaWarned = true;
    world.emit('term',
      `🔮 Luna's warning: they come from the Forbidden Forest, the Black Lake shore, and the Hogsmeade road!`,
      { zh: `🔮 卢娜预警：他们会从禁林、黑湖岸边、霍格莫德路三路进攻！` });
  }
  if (day !== 7) (st as { lunaWarned?: boolean }).lunaWarned = false;

  // assault ongoing effects
  stepAllies(world);
  stepMerchantPotions(world);
}

export const FATES_FEATURE: Feature = {
  id: 'fates',
  init(world) {
    world.fates = {
      cycle: cycleOf(world.term.n),
      threads: newThreads(),
      allies: new Set(),
      assaultSeen: false,
      nextPotionAt: 0,
      allyOwner: null,
    };
  },
  stepLate(world) { stepFates(world); },
  /** Snape's draught: +25% damage for players during the assault. */
  hit(world, _by, src, _dstId, _tags, dmg) {
    if (dmg && src && !src.npc && world.warweek.assault && world.fates.threads.snape.state === 'saved') {
      return 1.25;
    }
    return 1;
  },
  wire: {
    key: 'fates',
    get: (world) => Object.values(world.fates.threads).map((t) => ({ id: t.id, zh: t.zh, state: t.state })),
  },
  save: (world) => ({
    cycle: world.fates.cycle,
    states: Object.fromEntries(Object.values(world.fates.threads).map((t) => [t.id, t.state])),
  }),
  load(world, data) {
    const d = (data ?? {}) as { cycle?: unknown; states?: unknown };
    const st = world.fates;
    st.cycle = typeof d.cycle === 'number' ? d.cycle : cycleOf(world.term.n);
    const states = (d.states ?? {}) as Record<string, unknown>;
    for (const t of Object.values(st.threads)) {
      const s = states[t.id];
      // an 'open' thread never survives a restart: re-trigger if its window is still open
      t.state = s === 'saved' || s === 'lost' ? s : 'idle';
      t.mobs.clear();
    }
    st.allies.clear();
    st.assaultSeen = false;
  },
};
