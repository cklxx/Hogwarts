/** NPC 自主升级 (kernel/npc.ts + world.ts gainXp + progression.ts derived): 击杀涨 XP、升级、低调广播、5 年级上限、老兵属性成长。 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { derived } from '../src/kernel/progression.js';
import { NPC_MAX_YEAR } from '../src/shared/constants.js';
import type { Creature } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 42, secret: 'npc-level' });
  w.rules.creatures.spawnMultiplier = 0;
  ensureNpcs(w, 1);
  return w;
}
const npcOf = (w: World) => [...w.wizards.values()].find((x) => x.npc)!;

function slayBy(w: World, npcId: string, kind: Creature['kind'] = 'pixie') {
  const c: Creature = {
    id: 'c1', kind, pos: { x: 0, z: 0 }, home: { x: 0, z: 0 }, hp: 0, maxHp: 10, facing: 0,
    target: null, attackCd: 0, rootedUntil: 0, wander: null, lastHitBy: npcId,
    damageBy: { [npcId]: 100 }, auras: [], owner: null, until: 0,
  };
  w.creatures.set(c.id, c);
  (w as any).slay(c);
}

describe('npc leveling', () => {
  it('an NPC kill grants XP through the same slay path as players', () => {
    const w = mk();
    const npc = npcOf(w);
    const before = npc.xp;
    slayBy(w, npc.id, 'pixie'); // pixie: 12 xp
    expect(npc.xp).toBeGreaterThan(before);
    expect(npc.npc).toBe(true); // still flagged NPC
  });

  it('NPC levels up with a low-key broadcast, once per level', () => {
    const w = mk();
    const npc = npcOf(w);
    const seen: string[] = [];
    const origEmit = w.emit.bind(w);
    (w as any).emit = (t: any, text: string, o: any) => { if (t === 'level') seen.push(text); return origEmit(t, text, o); };
    w.gainXp(npc, 150); // year 2 threshold
    expect(npc.year).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(`${npc.name} reached year 2.`);
    expect(seen[0]).not.toContain('curriculum');
  });

  it('NPC year caps at NPC_MAX_YEAR (5), never outshining players', () => {
    expect(NPC_MAX_YEAR).toBe(5);
    const w = mk();
    const npc = npcOf(w);
    w.gainXp(npc, 100000);
    expect(npc.year).toBe(5);
    // a player with the same XP goes all the way
    const p = w.enroll('TestPlayer', 'Gryffindor').wizard;
    w.gainXp(p, 100000);
    expect(p.year).toBe(7);
  });

  it('NPC veteran bonus: +10% maxHp and +5% damage per year above 1; players unaffected', () => {
    const w = mk();
    const npc = npcOf(w);
    const p = w.enroll('TestPlayer', 'Gryffindor').wizard;
    // year 1: no bonus for anyone
    expect(derived(npc, w.rules).power).toBeCloseTo(derived(p, w.rules).power, 5);
    // level both to year 3
    w.gainXp(npc, 400);
    w.gainXp(p, 400);
    expect(npc.year).toBe(3);
    const dn = derived(npc, w.rules), dp = derived(p, w.rules);
    // same year, same wand-less base: NPC gets 1.2x HP and 1.1x power
    expect(dn.maxHp).toBe(Math.round(dp.maxHp * 1.2));
    expect(dn.power).toBeCloseTo(dp.power * 1.1, 5);
  });
});
