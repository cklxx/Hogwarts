/** NPC stalls in the spell market (试玩: 「集市 0 个上架」; kernel/market.ts npcStock). */
import { describe, expect, it } from 'vitest';
import { EXAMS, gradeExam } from '../src/kernel/exams.js';
import { NPC_STALLS, browseMarket, copySpell } from '../src/kernel/market.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { World } from '../src/kernel/world.js';

describe('NPC stalls', () => {
  it('each NPC keeps one listing, once, marked as an NPC\'s', () => {
    const w = new World({ seed: 9, secret: 'stalls' });
    ensureNpcs(w, 4);
    ensureNpcs(w, 4); // again (a restart): no duplicates
    const b = browseMarket(w, null);
    expect(b.total).toBe(4);
    expect(b.listings.every((l: { npc?: boolean }) => l.npc)).toBe(true);
  });

  it('none of them is an exam answer (copying one never passes an O.W.L.)', () => {
    for (const e of EXAMS) for (const s of Object.values(NPC_STALLS)) expect(gradeExam(e, s.source).ok, `${e.id} with ${s.name}`).toBe(false);
  });

  it('earn their NPC authors nothing when players cast them', () => {
    const w = new World({ seed: 9, secret: 'stalls' });
    w.rules.creatures.spawnMultiplier = 0;
    ensureNpcs(w, 4);
    const padma = [...w.wizards.values()].find((x) => x.name === 'Padma Patil')!;
    const rep0 = padma.reputation;
    const p = w.enroll('Buyer').wizard;
    p.connections = 1;
    p.createdAt = -1e6; // not a fresh account (fresh ones pay no royalties anyway)
    const listing = browseMarket(w, p.id).listings.find((l: { author: string }) => l.author === 'Padma Patil')!;
    const copy = copySpell(w, p.id, listing.id) as { copied: { id: string } };
    w.creatures.set('c_pix', { id: 'c_pix', kind: 'pixie', pos: { x: p.pos.x + 6, z: p.pos.z }, home: { x: p.pos.x + 6, z: p.pos.z }, hp: 500, maxHp: 500, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 });
    expect(w.cast(p.id, copy.copied.id).ok).toBe(true);
    expect(w.market.listings[listing.id].casts).toBeGreaterThan(0); // it counted as a cast of the listing
    expect(padma.reputation).toBe(rep0);
  });
});
