/**
 * 掉落 (a Feature; the table is src/shared/loot.ts): things on the ground. kernel/props.ts drops them (`drop`) when a
 * breakable breaks (one in LOOT_PCT, an ice block always) and when a cauldron brews; every tick a wizard within
 * LOOT_PICK_R of one picks it up (a `loot` fx says what). Galleons are capped a term per wizard; mana and health only
 * fill what is missing. Nothing here is saved: what lies about goes with a restart.
 */
import { LOOT, LOOT_GALLEONS_PER_TERM, LOOT_MAX, LOOT_PICK_R, LOOT_S, type LootKind } from '../shared/loot.js';

/** A player is told about what lies within this (a square, half its side) of them. */
const LOOT_SEE_R = 30;
import type { Feature } from './feature.js';
import { derived } from './progression.js';
import type { Vec2 } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 掉落 (this module's Feature): what lies on the ground, and this term's galleons picked up per wizard. */
    loot: { items: Map<number, { kind: LootKind; x: number; z: number; until: number }>; next: number; term: number; galleons: Map<string, number> };
  }
}

/** Leave `kind` on the ground near `at` (scattered a little). */
export function drop(world: World, at: Vec2, kind: LootKind) {
  const s = world.loot;
  if (s.items.size >= LOOT_MAX) { const oldest = s.items.keys().next().value; if (oldest !== undefined) s.items.delete(oldest); }
  const a = world.funRand() * Math.PI * 2, r = 0.4 + world.funRand() * 0.8;
  s.items.set(++s.next, { kind, x: at.x + Math.cos(a) * r, z: at.z + Math.sin(a) * r, until: world.now + LOOT_S });
}

export const LOOT_FEATURE: Feature = {
  id: 'loot',
  init(world) { world.loot = { items: new Map(), next: 0, term: world.term.n, galleons: new Map() }; },
  step(world) {
    const s = world.loot;
    if (!s.items.size) return;
    if (s.term !== world.term.n) { s.term = world.term.n; s.galleons.clear(); }
    for (const [id, it] of s.items) {
      if (it.until <= world.now) { s.items.delete(id); continue; }
      for (const w of world.nearWizards(it, LOOT_PICK_R)) {
        if (w.npc || !world.isActive(w) || w.hp <= 0 || Math.hypot(w.pos.x - it.x, w.pos.z - it.z) > LOOT_PICK_R) continue;
        const d = LOOT[it.kind], st = derived(w, world.rules);
        let n = 0;
        if (d.galleons) { const got = s.galleons.get(w.id) ?? 0; n = Math.max(0, Math.min(d.galleons, LOOT_GALLEONS_PER_TERM - got)); if (n) { s.galleons.set(w.id, got + n); w.galleons += n; } }
        if (d.hp) { n = Math.max(n, Math.round(Math.min(d.hp, st.maxHp - w.hp))); w.hp = Math.min(st.maxHp, w.hp + d.hp); }
        if (d.mana) { n = Math.max(n, Math.round(Math.min(d.mana, st.maxMana - w.mana))); w.mana = Math.min(st.maxMana, w.mana + d.mana); }
        s.items.delete(id);
        world.fx({ k: 'loot', x: it.x, z: it.z, h: it.kind, n });
        break;
      }
    }
  },
  // the browser: what lies within LOOT_SEE_R of you, as [id, kind index, x, z, …] (each player only their own
  // surroundings: the whole ground's list would be every snapshot's largest part)
  view: {
    key: 'loot',
    me(world, w) {
      const s = world.loot;
      if (!s.items.size) return null;
      const out: number[] = [];
      for (const [id, it] of s.items) if (Math.abs(it.x - w.pos.x) < LOOT_SEE_R && Math.abs(it.z - w.pos.z) < LOOT_SEE_R) out.push(id, KINDS.indexOf(it.kind), Math.round(it.x * 10) / 10, Math.round(it.z * 10) / 10);
      return out.length ? out : null;
    },
  },
};
export const KINDS = Object.keys(LOOT) as LootKind[];
