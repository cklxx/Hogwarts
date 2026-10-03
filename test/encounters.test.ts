/**
 * 遭遇 (src/shared/encounters.ts, src/kernel/encounters.ts) — with the guarantees of docs/DESIGN.md §4: what a new
 * player's spells do at each toy, on every path; clearing opens doors; once per encounter per term.
 */
import { describe, expect, it } from 'vitest';
import { FEATURE_BY_ID } from '../src/kernel/features.js';
import { doorsFor, pickDoor } from '../src/kernel/encounters.js';
import { equipRune, grantRune, raiseRune, runeLevel } from '../src/kernel/runes.js';
import { touch } from '../src/kernel/props.js';
import { World, spellKind } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import { ENCOUNTERS, encounterById, PURSE_GALLEONS } from '../src/shared/encounters.js';
import { IGNITE_R, PROPS } from '../src/shared/props.js';
import { BURST_LV, CHAIN_LV, RUNE_MAX } from '../src/shared/runes.js';

function mk(spawn = 0) {
  const w = new World({ seed: 51, secret: 'enc' });
  w.rules.creatures.spawnMultiplier = spawn;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function wiz(w: World, name: string, at: { x: number; z: number }): Wizard {
  const a = w.enroll(`${name} Enc`.slice(0, 24), 'Hufflepuff' as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.pos = { ...at }; a.mana = 1e6;
  return a;
}
function mob(w: World, kind: Creature['kind'], x: number, z: number, hp = 1000): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const NEST = encounterById('nest')!;
/** The nest's webs (the forest has others, scripts/dress.ts, outside it). */
const webs = PROPS.filter((p) => p.kind === 'web' && Math.hypot(p.x - NEST.x, p.z - NEST.z) <= NEST.r);
const row = PROPS.filter((p) => p.id.startsWith('zk-'));
/** A new first-year's hotbar attack spells, by slot. */
const attacks = () => {
  const a = mk().enroll('Bar Enc', 'Hufflepuff' as never).wizard;
  return a.hotbar.map((id, i) => ({ slot: String(i + 1), sp: a.spells.find((s) => s.id === id)! })).filter((x) => x.sp && spellKind(x.sp.effects) === 'harm');
};

describe('encounters: where they are', () => {
  it('each encounter: its props are in its circle; the nest’s webs hang in threes that burn as one and do not reach the next', () => {
    expect(webs.length).toBe(9);
    const nest = encounterById('nest')!;
    for (const p of webs) expect(Math.hypot(p.x - nest.x, p.z - nest.z)).toBeLessThan(nest.r);
    for (let c = 0; c < 3; c++) {
      const cl = webs.slice(c * 3, c * 3 + 3);
      for (const p of cl) for (const q of cl) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThanOrEqual(2.6);
      for (const p of cl) for (const q of webs) if (!cl.includes(q)) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(2.6);
    }
    const zk = encounterById('zonko')!;
    expect(row.length).toBe(zk.need);
    for (let i = 1; i < row.length; i++) expect(Math.hypot(row[i].x - row[i - 1].x, row[i].z - row[i - 1].z)).toBeLessThan(4);
    for (const p of row) expect(Math.hypot(p.x - zk.x, p.z - zk.z)).toBeLessThan(zk.r);
  });
});

describe('encounters: the guarantees (every path)', () => {
  it('the nest: each hurting first-year spell at a web tears it; fire burns its whole cluster', () => {
    for (const { slot, sp } of attacks()) {
      if (sp.name === 'Aguamenti') continue; // (it soaks, it hurts nothing: the tip says fire)
      for (let c = 0; c < 3; c++) {
        const w = mk();
        const t = webs[c * 3];
        const a = wiz(w, `W${slot}${c}`, { x: t.x, z: t.z + 8 });
        expect(w.cast(a.id, slot, { aim: { x: t.x, z: t.z } }).ok, sp.name).toBe(true);
        run(w, 1.5);
        const gone = webs.filter((p) => w.props.broken.has(p.id));
        expect(gone.length, `${sp.name} at cluster ${c}`).toBeGreaterThan(0);
        if (sp.name === 'Incendio') expect(gone.map((p) => p.id).sort(), 'fire burns the cluster').toEqual(webs.slice(c * 3, c * 3 + 3).map((p) => p.id).sort());
      }
    }
  });
  it('the nest: burning webs scald the spider by them; three clusters clear it', () => {
    const w = mk();
    const a = wiz(w, 'Burner', { x: 140, z: 52 });
    const sp = mob(w, 'spider', webs[1].x + 0.8, webs[1].z);
    touch(w, webs[0], 'fire', a.id);
    expect(sp.hp).toBeLessThan(1000);
    touch(w, webs[3], 'fire', a.id); touch(w, webs[6], 'fire', a.id);
    run(w, 1.2);
    expect(w.enc.done.get(a.id)?.has('nest')).toBe(true);
    expect(w.enc.doors.get(a.id)?.[0].doors[0]).toEqual({ t: 'rune', rune: 'burst' });
  });
  it('Zonko’s: one Incendio at any barrel of the row sets off all five and clears it; the pixies loose there are all hit', () => {
    for (const t of row) {
      const w = mk(1);
      const a = wiz(w, `Z ${t.id}`, { x: -10, z: 139 }); // (away while the yard's pixies come out: they are born out of reach)
      run(w, 8);
      a.pos = { x: t.x, z: 130 }; // (Hogsmeade's edge is z 128)
      // the yard's pixies, each where it was born (where it stands when nobody has stirred it)
      const pix = [...w.creatures.values()].filter((c) => c.kind === 'pixie' && Math.hypot(c.home.x - 14, c.home.z - 139) <= 3.6);
      expect(pix.length, 'pixies in the yard').toBeGreaterThan(0);
      for (const c of pix) { c.target = null; c.pos = { ...c.home }; c.attackCd = 99; }
      // (wherever they are in the yard: kept within their leash, every spot of it within a spark of a barrel)
      for (let x = 14 - 3.8; x <= 14 + 3.8; x += 0.2) for (let z = 139 - 3.8; z <= 139 + 3.8; z += 0.2) if (Math.hypot(x - 14, z - 139) <= 3.8) expect(Math.min(...row.map((p) => Math.hypot(p.x - x, p.z - z)))).toBeLessThan(IGNITE_R);
      const hp = new Map(pix.map((c) => [c.id, c.hp]));
      expect(w.cast(a.id, 'Incendio', { aim: { x: t.x, z: t.z } }).ok).toBe(true);
      run(w, 1.5);
      expect(row.filter((p) => !w.props.broken.has(p.id)).map((p) => p.id), `${t.id}: the row`).toEqual([]);
      for (const c of pix) expect(!w.creatures.has(c.id) || w.creatures.get(c.id)!.hp < hp.get(c.id)!, `${c.id} by ${t.id}`).toBe(true);
      expect(w.enc.done.get(a.id)?.has('zonko'), `${t.id}: cleared`).toBe(true);
    }
  });
  it('Zonko’s: the pixies come out at you but stay in the yard; fire on any one of them sets off the row', () => {
    const w = mk(1);
    const a = wiz(w, 'Chased', { x: -10, z: 139 });
    run(w, 8);
    a.pos = { x: 14, z: 131 };
    run(w, 4); // (they rush you, up to the yard's edge)
    const pix = [...w.creatures.values()].filter((c) => c.kind === 'pixie' && Math.hypot(c.home.x - 14, c.home.z - 139) <= 3.6);
    expect(pix.length).toBeGreaterThan(0);
    for (const c of pix) expect(Math.hypot(c.pos.x - 14, c.pos.z - 139)).toBeLessThanOrEqual(3.85);
    const c = pix.sort((p, q) => p.pos.z - q.pos.z)[0];
    a.mana = 1e6;
    expect(w.cast(a.id, 'Incendio', { target: c.id }).ok).toBe(true);
    run(w, 1.5);
    expect(row.filter((p) => !w.props.broken.has(p.id)).map((p) => p.id)).toEqual([]);
  });
  it('Zonko’s: five barrels one by one, slower than its 3 s, is not one go', () => {
    const w = mk();
    const a = wiz(w, 'Slow', { x: 14, z: 130 });
    for (const p of row) { touch(w, p, 'arcane', a.id); run(w, 1.1); }
    expect(w.enc.done.get(a.id)?.has('zonko') ?? false).toBe(false);
  });
});

describe('encounters: the doors', () => {
  it('three doors: the encounter’s rune, another (new first), a purse; levels once owned; two when all are full', () => {
    const w = mk();
    const a = wiz(w, 'Doors', { x: 0, z: 0 });
    const gh = encounterById('greenhouse')!;
    expect(doorsFor(w, a.id, gh)).toEqual([{ t: 'rune', rune: 'chain' }, { t: 'rune', rune: 'split' }, { t: 'purse' }]);
    grantRune(w, a.id, 'chain'); grantRune(w, a.id, 'split');
    expect(doorsFor(w, a.id, gh)).toEqual([{ t: 'level', rune: 'chain', to: 2 }, { t: 'rune', rune: 'burst' }, { t: 'purse' }]);
    grantRune(w, a.id, 'burst');
    for (const k of ['split', 'chain', 'burst'] as const) while (runeLevel(w, a.id, k) < RUNE_MAX) raiseRune(w, a.id, k);
    expect(doorsFor(w, a.id, gh)).toEqual([{ t: 'purse' }, { t: 'study' }]);
  });
  it('a pick applies its door; once per encounter per term, again next term', () => {
    const w = mk();
    const a = wiz(w, 'Picker', { x: 41, z: -16 });
    const clear = () => { for (let k = 0; k < 3; k++) { const s = mob(w, 'snare', 41 + k * 2 + w.term.n * 0.1, -26, 10); w.damage(a.id, s.id, 999, 'fire'); run(w, 1.1); } };
    clear();
    const g = a.galleons;
    pickDoor(w, a.id, 2);
    expect(a.galleons - g).toBe(PURSE_GALLEONS);
    clear();
    expect(w.enc.doors.get(a.id)).toBeUndefined();
    w.term.n++;
    clear();
    pickDoor(w, a.id, 0);
    expect(runeLevel(w, a.id, 'chain')).toBe(1);
    expect(() => pickDoor(w, a.id, 0)).toThrow(/No rewards/);
  });
  it('the doors waiting and this term’s progress survive a restart', () => {
    const w = mk();
    const a = wiz(w, 'Keeper', { x: 41, z: -16 });
    for (let k = 0; k < 3; k++) { const s = mob(w, 'snare', 41 + k * 2, -26, 10); w.damage(a.id, s.id, 999, 'fire'); run(w, 1.1); }
    raiseRune(w, a.id, 'split');
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.enc.doors.get(a.id)).toEqual(w.enc.doors.get(a.id));
    expect(back.enc.done.get(a.id)).toEqual(w.enc.done.get(a.id));
  });
  it('agents: the encounters tool lists each one and takes a pick', () => {
    const w = mk();
    const a = wiz(w, 'Agent', { x: 140, z: 37 });
    const tool = FEATURE_BY_ID.get('encounters')!.tools![0];
    const st = tool.run(w, a.id, {}) as { encounters: { id: string; here?: boolean }[] };
    expect(st.encounters.map((e) => e.id)).toEqual(ENCOUNTERS.map((e) => e.id));
    expect(st.encounters.find((e) => e.here)?.id).toBe('nest');
    for (const p of webs) touch(w, p, 'arcane', a.id);
    run(w, 1.2);
    expect(tool.run(w, a.id, { pick: 0 })).toMatchObject({ ok: true, took: { t: 'rune', rune: 'burst' } });
  });
});

describe('rune levels', () => {
  it('split 2 sends five bolts; chain 3 leaps on to four; burst 2 reaches 4 m', () => {
    const w = mk();
    const a = wiz(w, 'Lv', { x: 40, z: 0 });
    grantRune(w, a.id, 'split'); raiseRune(w, a.id, 'split');
    equipRune(w, a.id, 'split', 'Incendio');
    let n = 0;
    const sp = w.spawnProjectile.bind(w);
    w.spawnProjectile = (...args: Parameters<typeof sp>) => { n++; return sp(...args); };
    w.cast(a.id, 'Incendio', { aim: { x: 40, z: 30 } });
    run(w, 0.2);
    expect(n).toBe(5);

    const w2 = mk();
    const b = wiz(w2, 'Chain', { x: 40, z: 0 });
    grantRune(w2, b.id, 'chain'); raiseRune(w2, b.id, 'chain'); raiseRune(w2, b.id, 'chain');
    expect(raiseRune(w2, b.id, 'chain')).toBe(false);
    equipRune(w2, b.id, 'chain', 'Stupefy');
    const t = mob(w2, 'troll', 40, 10), more = [1, 2, 3, 4, 5].map((i) => mob(w2, 'troll', 40 + i * 3, 10));
    w2.cast(b.id, 'Stupefy', { target: t.id }); run(w2, 1.5);
    expect(more.filter((m) => m.hp < 1000).length).toBe(CHAIN_LV[2]);

    const w3 = mk();
    const c = wiz(w3, 'Burst', { x: 40, z: 0 });
    grantRune(w3, c.id, 'burst'); raiseRune(w3, c.id, 'burst');
    equipRune(w3, c.id, 'burst', 'Stupefy');
    const t3 = mob(w3, 'troll', 40, 10), far = mob(w3, 'troll', 40 + BURST_LV[1].r - 0.4, 10);
    w3.cast(c.id, 'Stupefy', { target: t3.id }); run(w3, 1.5);
    expect(far.hp).toBeLessThan(1000);
  });
});
