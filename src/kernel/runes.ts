/**
 * 符文零件 (a Feature; the pieces are src/shared/runes.ts): runes you own, the spell each is on, what they do, and the
 * first encounters that hand them out.
 *
 * - 分裂 split: a bolt from a spell carrying it goes out as three (the `bolt` hook sees it on its first tick and fans
 *   two more, SPLIT_SHARE of its power, tagged so they do not split again).
 * - 连锁 chain / 爆裂 burst: a direct hit from such a spell leaps on / bursts round (the `hit` hook; tagged likewise).
 * A spell is known by its name in the cast's tags (kernel/magic.ts tagsFor); one rune per spell.
 *
 * How you get them — each by something the game guarantees will happen (docs/DESIGN.md §4): split with your first
 * magic reaction (kernel/chem.ts: the first hit on the lawn's wet pixies is always one), burst with your first
 * puzzle of three props (kernel/props.ts), chain for clearing the greenhouse (GREENHOUSE_SNARES Devil's Snares down
 * there — the greenhouse is humid: its snares are always wet, so the first spell there reacts too). Checked once a
 * second from those features' own state; the browser's card (client/panels/runes.ts) offers to put the new rune on
 * a spell until it is on one.
 */
import { z } from 'zod';
import { BURST_DMG, BURST_R, CHAIN_DMG, CHAIN_LEAPS, CHAIN_R, GREENHOUSE, GREENHOUSE_SNARES, RUNE_IDS, RUNES, SPLIT_DEG, SPLIT_SHARE, type RuneId } from '../shared/runes.js';
import type { Feature } from './feature.js';
import type { Projectile, Wizard } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 符文零件 (this module's Feature). */
    runes: {
      /** Per wizard: runes owned (at most one of each) and which spell (by id) each is on. */
      of: Map<string, { bag: RuneId[]; on: Record<string, RuneId> }>;
      /** Devil's Snares downed in the greenhouse, per wizard; the snares alive there last second and who hit them last. */
      snares: Map<string, number>; alive: Map<string, string | null>;
      /** Bolts already seen (split once, on the first tick). */
      seen: Set<string>;
    };
  }
}

const mine = (world: World, wid: string) => world.runes.of.get(wid) ?? world.runes.of.set(wid, { bag: [], on: {} }).get(wid)!;
/** The rune on the spell a cast came from (its name is in the tags), or null. */
function runeOf(world: World, w: Wizard | undefined, tags: readonly string[]): RuneId | null {
  if (!w || w.npc) return null;
  const r = world.runes.of.get(w.id);
  if (!r) return null;
  for (const s of w.spells) if (tags.includes(s.name) && r.on[s.id]) return r.on[s.id];
  return null;
}
const RUNE_TAG = 'rune';

/** Give `wid` rune `k` (once): a line says what it does and how to use it. */
export function grantRune(world: World, wid: string, k: RuneId) {
  const w = world.wizards.get(wid);
  if (!w || w.npc) return false;
  const r = mine(world, wid);
  if (r.bag.includes(k)) return false;
  r.bag.push(k);
  const d = RUNES[k];
  world.emit('achievement', `✨ A new rune: ${d.en} — ${d.docEn}. Put it on a spell (the card, or MCP runes).`, { to: wid, zh: `✨ 新符文：${d.zh}——${d.docZh}。把它装到一个咒语上（点卡片，或 MCP runes）。` });
  return true;
}

/** Put rune `k` on spell `spellId` (off any other spell; a spell holds one: the one it had goes back to the bag). */
export function equipRune(world: World, wid: string, k: RuneId, spellId: string) {
  const w = world.need(wid);
  const r = mine(world, wid);
  if (!r.bag.includes(k)) throw new Error(`You have no ${k} rune yet (${RUNES[k].howEn}). 你还没有「${RUNES[k].zh}」符文（${RUNES[k].howZh}）。`);
  const s = w.spells.find((x) => x.id === spellId || x.name.toLowerCase() === spellId.toLowerCase());
  if (!s) throw new Error(`No spell ${spellId} in your book. 咒语书里没有 ${spellId}。`);
  for (const [id, x] of Object.entries(r.on)) if (x === k) delete r.on[id];
  r.on[s.id] = k;
  return { ok: true, rune: k, spell: s.name };
}
export const unequipRune = (world: World, wid: string, spellId: string) => { const r = mine(world, wid); delete r.on[spellId]; return { ok: true }; };

function status(world: World, wid: string) {
  const w = world.need(wid), r = mine(world, wid);
  return {
    runes: RUNE_IDS.map((k) => ({ id: k, zh: RUNES[k].zh, en: RUNES[k].en, does: `${RUNES[k].docZh} / ${RUNES[k].docEn}`, owned: r.bag.includes(k), on: Object.entries(r.on).find(([, x]) => x === k)?.[0] ? w.spells.find((s) => s.id === Object.entries(r.on).find(([, x]) => x === k)![0])?.name ?? null : null, howToGet: `${RUNES[k].howZh} / ${RUNES[k].howEn}`, code: RUNES[k].code })),
  };
}

/** Split a bolt into three: two more at ±SPLIT_DEG (straight, SPLIT_SHARE of its power). */
function split(world: World, p: Projectile, w: Wizard) {
  const sp = Math.hypot(p.vel.x, p.vel.z) || 1;
  const dir = Math.atan2(p.vel.x, p.vel.z);
  for (const s of [-1, 1]) {
    const a = dir + (s * SPLIT_DEG * Math.PI) / 180;
    const to = { x: p.pos.x + Math.sin(a) * sp * 2, z: p.pos.z + Math.cos(a) * sp * 2 };
    world.spawnProjectile({ id: w.id, pos: { ...p.pos }, facing: w.facing }, 'bolt', to, null, p.power * SPLIT_SHARE, p.element, 0, [...p.tags, RUNE_TAG]);
  }
  p.power *= SPLIT_SHARE;
}

export const RUNES_FEATURE: Feature = {
  id: 'runes',
  init(world) { world.runes = { of: new Map(), snares: new Map(), alive: new Map(), seen: new Set() }; },
  bolt(world, p) {
    if (world.runes.seen.has(p.id)) return;
    world.runes.seen.add(p.id);
    if (p.kind !== 'bolt' || p.tags.includes(RUNE_TAG)) return;
    const w = world.wizards.get(p.owner);
    if (runeOf(world, w, p.tags) === 'split') split(world, p, w!);
  },
  hit(world, by, src, dstId, tags, dmg, element) {
    // (the greenhouse's snares: who hit each last — it may be gone before the next second's count)
    const sn = world.creatures.get(dstId);
    if (dmg && by && sn?.kind === 'snare' && Math.hypot(sn.pos.x - GREENHOUSE.x, sn.pos.z - GREENHOUSE.z) <= GREENHOUSE.r) world.runes.alive.set(dstId, by);
    if (!dmg || !element || tags.includes(RUNE_TAG)) return 1;
    const r = runeOf(world, src ?? (by ? world.wizards.get(by) : undefined), tags);
    if (r !== 'chain' && r !== 'burst') return 1;
    const t = world.wizards.get(dstId) ?? world.creatures.get(dstId);
    if (!t) return 1;
    const rt = [...tags, RUNE_TAG];
    if (r === 'burst') {
      world.fx({ k: 'nova', x: t.pos.x, z: t.pos.z, r: BURST_R, e: element });
      for (const o of world.around(t.pos, BURST_R, (x) => x.id !== dstId && world.canHarm(by, x.id), by ?? undefined, 8)) world.damage(by, o.id, BURST_DMG, element, rt);
    } else {
      const pts = [t.pos.x, t.pos.z];
      let from = t.pos;
      const hit = new Set([dstId]);
      for (let i = 0; i < CHAIN_LEAPS; i++) {
        const o = world.around(from, CHAIN_R, (x) => !hit.has(x.id) && world.canHarm(by, x.id), by ?? undefined, 1)[0];
        if (!o) break;
        hit.add(o.id); pts.push(o.pos.x, o.pos.z); from = o.pos;
        world.damage(by, o.id, CHAIN_DMG, element, rt);
      }
      if (pts.length > 2) world.fx({ k: 'chain', x: t.pos.x, z: t.pos.z, e: element, pts });
    }
    return 1;
  },
  sweep(world) {
    const s = world.runes;
    // bolts long gone
    if (s.seen.size > 4096) for (const id of s.seen) if (!world.projectiles.has(id)) s.seen.delete(id);
    // the greenhouse's snares: who downed each one that is gone since last second
    for (const [id, by] of [...s.alive]) {
      const c = world.creatures.get(id);
      if (c && c.hp > 0) continue;
      s.alive.delete(id);
      if (!by) continue;
      const n = (s.snares.get(by) ?? 0) + 1;
      s.snares.set(by, n);
      if (n === GREENHOUSE_SNARES && world.wizards.get(by) && !world.wizards.get(by)!.npc) {
        world.emit('achievement', 'The greenhouse is clear of Devil’s Snare!', { to: by, zh: '温室里的魔鬼网清干净了！' });
        grantRune(world, by, 'chain');
      }
    }
    // the other two: from the features that make them happen
    for (const [wid, n] of world.chem?.reactions ?? []) if (n > 0) grantRune(world, wid, 'split');
    for (const [wid, groups] of world.props?.paid ?? []) if (groups.size > 0) grantRune(world, wid, 'burst');
  },
  view: { key: 'runes', me: (world, w) => { const r = world.runes.of.get(w.id); return r ? { bag: r.bag, on: r.on } : null; } },
  tools: [{
    name: 'runes', title: 'Runes', cost: 0,
    description: '符文零件: pieces that change how a spell lands — split (a bolt goes out as three), chain (a hit leaps on to two more foes), burst (a hit bursts 3 m round). See what you own and how to get the rest; put one on a spell with {rune, spell} (one rune per spell), take it off with {spell, off: true}.',
    input: { rune: z.enum(RUNE_IDS as [RuneId, ...RuneId[]]).optional(), spell: z.string().max(60).optional(), off: z.boolean().optional() },
    run(world, wid, a) {
      if (a.spell && a.off) return unequipRune(world, wid, world.need(wid).spells.find((s) => s.name === a.spell || s.id === a.spell)?.id ?? String(a.spell));
      if (a.rune && a.spell) return equipRune(world, wid, a.rune as RuneId, String(a.spell));
      return status(world, wid);
    },
  }],
  // the browser: {t:'runes', rune, spell} puts one on
  ws(world, wid, m) {
    if (typeof m.rune === 'string' && typeof m.spell === 'string' && (RUNE_IDS as string[]).includes(m.rune)) return equipRune(world, wid, m.rune as RuneId, m.spell);
    return status(world, wid);
  },
  save: (world) => ({ of: Object.fromEntries(world.runes.of), snares: Object.fromEntries(world.runes.snares) }),
  load(world, data) {
    const d = data as { of?: Record<string, { bag?: unknown; on?: unknown }>; snares?: Record<string, number> } | undefined;
    if (!d || typeof d !== 'object') return;
    for (const [wid, r] of Object.entries(d.of ?? {})) {
      const bag = Array.isArray(r.bag) ? (r.bag as unknown[]).filter((x): x is RuneId => (RUNE_IDS as unknown[]).includes(x)) : [];
      const on: Record<string, RuneId> = {};
      for (const [k, v] of Object.entries((r.on as Record<string, unknown>) ?? {})) if ((RUNE_IDS as unknown[]).includes(v)) on[k] = v as RuneId;
      world.runes.of.set(wid, { bag, on });
    }
    for (const [k, v] of Object.entries(d.snares ?? {})) if (typeof v === 'number') world.runes.snares.set(k, v);
  },
};
