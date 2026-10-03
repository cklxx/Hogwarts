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
 * puzzle of three props (kernel/props.ts), and any of them — or a level on one you have (RUNE_MAX) — as a door when
 * you clear an encounter (kernel/encounters.ts). Checked once a second from those features' own state; the browser's
 * card (client/panels/runes.ts) offers to put the new rune on a spell until it is on one.
 */
import { z } from 'zod';
import { BURST_LV, CHAIN_DMG, CHAIN_LV, CHAIN_R, RUNE_IDS, RUNE_MAX, RUNES, runeAt, SPLIT_DEG, SPLIT_LV, type RuneId } from '../shared/runes.js';
import type { Feature } from './feature.js';
import type { Projectile, Wizard } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 符文零件 (this module's Feature). */
    runes: {
      /** Per wizard: runes owned (at most one of each), which spell (by id) each is on, and levels above 1. */
      of: Map<string, Mine>;
      /** Bolts already seen (split once, on the first tick). */
      seen: Set<string>;
    };
  }
}

interface Mine { bag: RuneId[]; on: Record<string, RuneId>; lv?: Partial<Record<RuneId, number>> }
const mine = (world: World, wid: string) => world.runes.of.get(wid) ?? world.runes.of.set(wid, { bag: [], on: {} }).get(wid)!;
/** The level of rune `k` that `wid` has: 0 none, else 1..RUNE_MAX. */
export function runeLevel(world: World, wid: string, k: RuneId) {
  const r = world.runes.of.get(wid);
  return r?.bag.includes(k) ? Math.min(RUNE_MAX, r.lv?.[k] ?? 1) : 0;
}
/** The rune on the spell a cast came from (its name is in the tags) and its level, or null. */
function runeOf(world: World, w: Wizard | undefined, tags: readonly string[]): { k: RuneId; lv: number } | null {
  if (!w || w.npc) return null;
  const r = world.runes.of.get(w.id);
  if (!r) return null;
  for (const s of w.spells) if (tags.includes(s.name) && r.on[s.id]) return { k: r.on[s.id], lv: runeLevel(world, w.id, r.on[s.id]) };
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

/** Raise `wid`'s rune `k` one level (to at most RUNE_MAX): a line says what it does now. */
export function raiseRune(world: World, wid: string, k: RuneId) {
  const n = runeLevel(world, wid, k);
  if (!n || n >= RUNE_MAX) return false;
  const r = mine(world, wid);
  (r.lv ??= {})[k] = n + 1;
  const d = RUNES[k], at = runeAt(k, n + 1);
  world.emit('achievement', `✨ ${d.en} is level ${n + 1}: ${at.en}.`, { to: wid, zh: `✨「${d.zh}」升到 ${n + 1} 级：${at.zh}。` });
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
    runes: RUNE_IDS.map((k) => {
      const lv = runeLevel(world, wid, k), at = runeAt(k, Math.max(1, lv)), spell = Object.entries(r.on).find(([, x]) => x === k)?.[0];
      return { id: k, zh: RUNES[k].zh, en: RUNES[k].en, level: lv, maxLevel: RUNE_MAX, does: `${at.zh} / ${at.en}`, owned: lv > 0, on: spell ? w.spells.find((s) => s.id === spell)?.name ?? null : null, howToGet: `${RUNES[k].howZh} / ${RUNES[k].howEn}`, code: RUNES[k].code };
    }),
  };
}

/** Split a bolt: `each` more either side, SPLIT_DEG apart (straight), each and itself `share` of its power. */
function split(world: World, p: Projectile, w: Wizard, lv: number) {
  const { each, share } = SPLIT_LV[lv - 1];
  const sp = Math.hypot(p.vel.x, p.vel.z) || 1;
  const dir = Math.atan2(p.vel.x, p.vel.z);
  for (let i = 1; i <= each; i++) for (const s of [-1, 1]) {
    const a = dir + (s * i * SPLIT_DEG * Math.PI) / 180;
    const to = { x: p.pos.x + Math.sin(a) * sp * 2, z: p.pos.z + Math.cos(a) * sp * 2 };
    world.spawnProjectile({ id: w.id, pos: { ...p.pos }, facing: w.facing }, 'bolt', to, null, p.power * share, p.element, 0, [...p.tags, RUNE_TAG]);
  }
  p.power *= share;
}

export const RUNES_FEATURE: Feature = {
  id: 'runes',
  init(world) { world.runes = { of: new Map(), seen: new Set() }; },
  bolt(world, p) {
    if (world.runes.seen.has(p.id)) return;
    world.runes.seen.add(p.id);
    if (p.kind !== 'bolt' || p.tags.includes(RUNE_TAG)) return;
    const w = world.wizards.get(p.owner), r = runeOf(world, w, p.tags);
    if (r?.k === 'split') split(world, p, w!, r.lv);
  },
  hit(world, by, src, dstId, tags, dmg, element) {
    if (!dmg || !element || tags.includes(RUNE_TAG)) return 1;
    const r = runeOf(world, src ?? (by ? world.wizards.get(by) : undefined), tags);
    if (r?.k !== 'chain' && r?.k !== 'burst') return 1;
    const t = world.wizards.get(dstId) ?? world.creatures.get(dstId);
    if (!t) return 1;
    const rt = [...tags, RUNE_TAG];
    if (r.k === 'burst') {
      const b = BURST_LV[r.lv - 1];
      world.fx({ k: 'nova', x: t.pos.x, z: t.pos.z, r: b.r, e: element });
      for (const o of world.around(t.pos, b.r, (x) => x.id !== dstId && world.canHarm(by, x.id), by ?? undefined, 8)) world.damage(by, o.id, b.dmg, element, rt);
    } else {
      const pts = [t.pos.x, t.pos.z];
      let from = t.pos;
      const hit = new Set([dstId]);
      for (let i = 0; i < CHAIN_LV[r.lv - 1]; i++) {
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
    // from the features that make them happen
    for (const [wid, n] of world.chem?.reactions ?? []) if (n > 0) grantRune(world, wid, 'split');
    for (const [wid, groups] of world.props?.paid ?? []) if (groups.size > 0) grantRune(world, wid, 'burst');
  },
  view: { key: 'runes', me: (world, w) => { const r = world.runes.of.get(w.id); return r ? { bag: r.bag, on: r.on, ...(r.lv ? { lv: r.lv } : {}) } : null; } },
  tools: [{
    name: 'runes', title: 'Runes', cost: 0,
    description: '符文零件: pieces that change how a spell lands — split (a bolt goes out as three), chain (a hit leaps on to two more foes), burst (a hit bursts 3 m round); levels 1–3 (an encounter door raises one). See what you own, each one\'s level and how to get the rest; put one on a spell with {rune, spell} (one rune per spell), take it off with {spell, off: true}.',
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
  save: (world) => ({ of: Object.fromEntries(world.runes.of) }),
  load(world, data) {
    const d = data as { of?: Record<string, { bag?: unknown; on?: unknown; lv?: unknown }> } | undefined;
    if (!d || typeof d !== 'object') return;
    for (const [wid, r] of Object.entries(d.of ?? {})) {
      const bag = Array.isArray(r.bag) ? (r.bag as unknown[]).filter((x): x is RuneId => (RUNE_IDS as unknown[]).includes(x)) : [];
      const on: Record<string, RuneId> = {};
      for (const [k, v] of Object.entries((r.on as Record<string, unknown>) ?? {})) if ((RUNE_IDS as unknown[]).includes(v)) on[k] = v as RuneId;
      const lv: Partial<Record<RuneId, number>> = {};
      for (const [k, v] of Object.entries((r.lv as Record<string, unknown>) ?? {})) if ((RUNE_IDS as string[]).includes(k) && typeof v === 'number' && v >= 1) lv[k as RuneId] = Math.min(RUNE_MAX, Math.floor(v));
      world.runes.of.set(wid, { bag, on, ...(Object.keys(lv).length ? { lv } : {}) });
    }
  },
};
