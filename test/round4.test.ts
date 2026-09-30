/**
 * Playtest round 3 (claude-db: the hunter, the duellist, the first-year): a cast at nothing or through a wall costs
 * nothing, the hour never jumps, no wild blow takes more than CREATURE_HIT_CAP, creatures are not born beside you,
 * and reflexes — presets, what each did and why not, explain — are there to be seen.
 */
import { describe, expect, it } from 'vitest';
import { FEATURE_BY_ID } from '../src/kernel/features.js';
import { PRESETS, setReflexes } from '../src/kernel/reflexes.js';
import { World } from '../src/kernel/world.js';
import { CREATURES } from '../src/kernel/creatures.js';
import { CREATURE_HIT_CAP } from '../src/shared/constants.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk(seed = 4) {
  const w = new World({ seed, secret: 'round4' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.rules.combat.pvp = true;
  w.term.endsAt = 1e12;
  return w;
}
function join(w: World, name: string, house: string, x: number, z: number, year = 3): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.year = year; a.pos = { x, z };
  a.hp = w.privateState(a.id).maxHp; a.mana = w.privateState(a.id).maxMana;
  return a;
}
function beast(w: World, id: string, kind: Creature['kind'], x: number, z: number, hp = 400): Creature {
  const c: Creature = { id, kind, pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const tool = (id: string, name: string) => FEATURE_BY_ID.get(id)!.tools!.find((t) => t.name === name)!;

describe('施法: nothing to hit costs nothing', () => {
  it('a target that is gone: refused, no mana, no bolt flying at whoever stands ahead', () => {
    const w = mk();
    const a = join(w, 'Hunter Kid', 'Gryffindor', 100, 100), goyle = join(w, 'Gregory Bystander', 'Slytherin', 100, 95);
    a.facing = 0; // facing -z: straight at the bystander
    const mana = a.mana, hp = goyle.hp;
    const r = w.cast(a.id, 'Stupefy', { target: 'c_gone' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No mana spent/);
    expect(a.mana).toBe(mana);
    run(w, 1);
    expect(goyle.hp).toBe(hp);
  });

  it('a target behind a wall: refused, no mana; look marks it blocked; a clear one is not', () => {
    const w = mk();
    // find a wall: two free points 12 m apart with a solid between them
    let pair: { a: { x: number; z: number }; b: { x: number; z: number } } | null = null;
    for (let x = -120; x <= 120 && !pair; x += 3) for (let z = -120; z <= 120 && !pair; z += 3) {
      const p = { x, z }, q = { x: x + 12, z };
      const pp = { ...p }, qq = { ...q };
      w.solids.resolve(pp, 0.9); w.solids.resolve(qq, 0.9);
      if (Math.hypot(pp.x - p.x, pp.z - p.z) < 0.01 && Math.hypot(qq.x - q.x, qq.z - q.z) < 0.01 && !w.inBlast(p, q) && !w.inSafe(p) && !w.inSafe(q)) pair = { a: p, b: q };
    }
    expect(pair).not.toBeNull();
    const a = join(w, 'Hunter Kid', 'Gryffindor', pair!.a.x, pair!.a.z);
    beast(w, 'c_wall', 'troll', pair!.b.x, pair!.b.z);
    const mana = a.mana;
    const r = w.cast(a.id, 'Stupefy', { target: 'c_wall' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no clear shot/);
    expect(a.mana).toBe(mana);
    const seen = w.look(a.id).creatures.find((c) => c.id === 'c_wall')!;
    expect(seen.blocked).toBe(true);
    // in the open: fine
    const w2 = mk();
    const b = join(w2, 'Open Kid', 'Gryffindor', 100, 100);
    beast(w2, 'c_open', 'troll', 110, 100);
    expect(w2.look(b.id).creatures[0].blocked).toBeUndefined();
    expect(w2.cast(b.id, 'Stupefy', { target: 'c_open' }).ok).toBe(true);
  });
});

describe('时间: the hour never jumps', () => {
  it('a decree that changes the day length keeps the hour, then runs at the new pace; a restart keeps it too', () => {
    const w = mk();
    run(w, 40);
    const before = w.rules, h0 = w.hour();
    w.rules = { ...before, world: { ...before.world, dayLengthSeconds: before.world.dayLengthSeconds * 3 } };
    w.rulesChanged(before, null);
    expect(w.hour()).toBeCloseTo(h0, 6);
    run(w, 30);
    expect(w.hour() - h0).toBeCloseTo((30 / w.rules.world.dayLengthSeconds) * 24, 1);
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(w2.hour()).toBeCloseTo(w.hour(), 6);
  });
});

describe('魔物: no one-shots, not born beside you', () => {
  it(`no wild blow takes more than ${CREATURE_HIT_CAP * 100} % of a first-year's health, whatever the event made it`, () => {
    const w = mk();
    const kid = join(w, 'Small Kid', 'Hufflepuff', 100, 100, 1);
    const max = w.privateState(kid.id).maxHp;
    const t = beast(w, 'c_big', 'troll', 101, 100);
    t.dmgMult = 5;
    w.damage(t.id, kid.id, 28 * 5, 'arcane');
    expect(max - kid.hp).toBeLessThanOrEqual(CREATURE_HIT_CAP * max + 1e-6);
    expect(kid.st.stunnedUntil).toBe(0);
  });

  it('a new hostile creature appears beyond its own aggro reach of every wizard', () => {
    const w = new World({ seed: 9, secret: 'spawn' });
    w.term.endsAt = 1e12;
    const s = CREATURES.spider.spawn;
    const walkers = Array.from({ length: 12 }, (_, i) => join(w, `Forest Walker ${i}`, 'Ravenclaw', s.x + Math.cos(i) * 30, s.z + Math.sin(i) * 30));
    for (let i = 0; i < 40; i++) {
      const known = new Set(w.creatures.keys());
      (w as unknown as { spawnCreatures(): void }).spawnCreatures();
      for (const c of w.creatures.values()) {
        if (known.has(c.id) || CREATURES[c.kind].faction !== 'hostile') continue;
        const near = Math.min(...walkers.map((x) => Math.hypot(x.pos.x - c.pos.x, x.pos.z - c.pos.z)));
        expect(near).toBeGreaterThanOrEqual(Math.max(8, CREATURES[c.kind].aggro + 2));
      }
    }
  });
});

describe('反射: strategies you can see', () => {
  it('presets build from the spells you know; explain says what each rule would do now', () => {
    const w = mk();
    const a = join(w, 'Duel Kid', 'Gryffindor', 100, 100);
    const r = tool('reflexes', 'reflexes').run(w, a.id, { preset: 'duelist' }) as { reflexes: { when: string; do: string }[] };
    expect(r.reflexes.map((x) => `${x.when}:${x.do}`)).toEqual(['incoming:ward', 'incoming:dodge', 'low_hp:cast', 'enemy_near:cast']);
    for (const k of Object.keys(PRESETS)) expect(PRESETS[k].build(() => true).length).toBeGreaterThan(0);
    const ex = tool('reflexes', 'reflexes').run(w, a.id, { explain: true }) as { now: { state: string }[] };
    expect(ex.now.map((x) => x.state)).toEqual(['waits: no incoming now', 'waits: no incoming now', 'waits: no low hp now', 'waits: no enemy near now']);
    const foe = join(w, 'Draco Foe', 'Slytherin', 108, 100);
    const ex2 = tool('reflexes', 'reflexes').run(w, a.id, { explain: true }) as { now: { state: string }[] };
    expect(ex2.now[3].state).toBe('would act now');
    void foe;
  });

  it('ward first, else dodge: what acted is counted and told (a private reflex event), what could not says why', () => {
    const w = mk();
    const a = join(w, 'Duel Kid', 'Gryffindor', 100, 100), b = join(w, 'Draco Foe', 'Slytherin', 100, 118);
    setReflexes(w, a.id, [{ when: 'incoming', do: 'ward' }, { when: 'incoming', do: 'dodge' }]);
    w.spawnProjectile(b, 'bolt', a.pos, a.id, 20, 'arcane', 0, []);
    run(w, 1.5);
    let v = tool('reflexes', 'reflexes').run(w, a.id, {}) as { reflexes: { fired: number; notActing?: string }[] };
    expect(v.reflexes[0].fired).toBe(1);
    expect(w.events.some((e) => e.type === 'reflex' && e.to === a.id && /ward/.test(e.text))).toBe(true);
    // the ward recharges: the next bolt is met by the roll instead, and the ward's rule says why it did not act
    run(w, 2.5);
    w.spawnProjectile(b, 'bolt', a.pos, a.id, 20, 'arcane', 0, []);
    run(w, 1.5);
    v = tool('reflexes', 'reflexes').run(w, a.id, {}) as { reflexes: { fired: number; notActing?: string }[] };
    expect(v.reflexes[1].fired).toBe(1);
    expect(v.reflexes[0].notActing).toMatch(/recharging/);
    expect(w.events.filter((e) => e.type === 'reflex' && e.to === a.id).length).toBe(2);
  });

  it('are saved with the world', () => {
    const w = mk();
    const a = join(w, 'Keep Kid', 'Gryffindor', 100, 100);
    tool('reflexes', 'reflexes').run(w, a.id, { preset: 'hunter' });
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(w2.reflexes.of.get(a.id)?.map((r) => r.when)).toEqual(w.reflexes.of.get(a.id)?.map((r) => r.when));
    expect(w2.whoami(a.id)).toMatchObject({ reflexes: expect.stringMatching(/3 set/) });
  });
});
