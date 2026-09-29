import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { SPAWN } from '../src/shared/map.js';
import type { Creature } from '../src/kernel/types.js';

function mkWorld() {
  const world = new World({ seed: 42 });
  world.rules.creatures.spawnMultiplier = 0; // quiet world unless a test spawns creatures
  return world;
}
function join(world: World, name: string, house?: string) {
  const { wizard } = world.enroll(name, house);
  wizard.connections = 1;
  return wizard;
}
function run(world: World, secs: number) {
  for (let t = 0; t < secs; t += 0.05) world.tick(0.05);
}
function addCreature(world: World, kind: Creature['kind'], x: number, z: number): Creature {
  const c: Creature = { id: `c_test_${kind}_${x}`, kind, pos: { x, z }, home: { x, z }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  world.creatures.set(c.id, c);
  return c;
}

describe('enrolment', () => {
  it('sorts canon names into their houses and hands out the canon wand', () => {
    const w = mkWorld();
    const harry = join(w, 'Harry Potter');
    expect(harry.house).toBe('Gryffindor');
    expect(harry.wand.wood).toBe('Holly');
    expect(join(w, 'I am Lord Voldemort').house).toBe('Slytherin');
  });
  it('respects "not Slytherin"', () => {
    const w = mkWorld();
    for (let i = 0; i < 8; i++) expect(join(w, `Kid ${i}`, 'not slytherin').house).not.toBe('Slytherin');
  });
  it('rejects duplicate names', () => {
    const w = mkWorld();
    join(w, 'Luna Lovegood');
    expect(() => w.enroll('luna lovegood')).toThrow(/already/);
  });
  it('grants year-1 curriculum into the hotbar', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    expect(a.spells.map((s) => s.name)).toContain('Stupefy');
    expect(a.hotbar.filter(Boolean).length).toBe(6);
    expect(a.spells.map((s) => s.name)).toEqual(expect.arrayContaining(['Tempus', 'Revelio']));
  });
});

describe('casting', () => {
  it('a Stupefy flies, hits a creature, and costs mana', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    a.pos = { x: 0, z: 10 };
    const c = addCreature(w, 'pixie', 0, 20);
    const mana0 = a.mana;
    const r = w.cast(a.id, 'Stupefy', { target: c.id });
    expect(r.ok).toBe(true);
    expect(a.mana).toBeCloseTo(mana0 - r.mana, 5);
    run(w, 1);
    expect(c.hp).toBeLessThan(1000);
  });

  it('fizzles atomically when the caster cannot pay — no effect, no mana', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    a.pos = { x: 0, z: 10 };
    addCreature(w, 'pixie', 0, 20);
    w.forgeSpell(a.id, { name: 'Overkill', source: '(repeat 3 (bolt (ahead 10) 16))' });
    a.mana = 30;
    const r = w.cast(a.id, 'Overkill');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not enough mana/);
    expect(a.mana).toBe(30);
    expect(w.projectiles.size).toBe(0);
  });

  it('gates primitives by school year', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    expect(() => w.forgeSpell(a.id, { name: 'Boom', source: '(nova 5 10)' })).toThrow(/year 3/);
    a.xp = 400;
    w.gainXp(a, 0);
    a.year = 3;
    expect(() => w.forgeSpell(a.id, { name: 'Boom', source: '(nova 5 10)' })).not.toThrow();
  });

  it('clamps power to the year cap and reports it', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    const r = w.simulate(a.id, '(bolt (ahead 10) 999)');
    expect(r.ok).toBe(true);
    expect(r.notes.join()).toMatch(/clamped/);
  });

  it('runs out of gas on runaway programs', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    const r = w.simulate(a.id, '(repeat 10 (repeat 10 (repeat 10 (+ 1 2))))');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gas/);
  });

  it('(after ...) runs later as its own transaction', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    a.year = 2;
    w.forgeSpell(a.id, { name: 'Echo', source: '(say "one") (after 1 (say "two"))' });
    expect(w.cast(a.id, 'Echo').ok).toBe(true);
    expect(a.say?.text).toBe('Echo!');
    run(w, 1.2);
    expect(w.events.some((e) => e.text.endsWith(': two'))).toBe(true);
  });

  it('Unforgivable curses send you to Azkaban', () => {
    const w = mkWorld();
    const a = join(w, 'Bellatrix');
    a.reputation = 100;
    w.forgeSpell(a.id, { name: 'Crucio', source: '(bolt (ahead 10) 10)' });
    const r = w.cast(a.id, 'Crucio');
    expect(r.ok).toBe(false);
    expect(a.st.jailedUntil).toBeGreaterThan(0);
    expect(a.reputation).toBe(75);
    run(w, 46);
    expect(a.st.jailedUntil).toBe(0);
  });

  it('refuses Apparition on the grounds but not in Hogsmeade', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    a.year = 6;
    expect(w.simulate(a.id, '(apparate (ahead 10))').error).toMatch(/Hogwarts: A History/);
    a.pos = { x: 0, z: 200 };
    expect(w.simulate(a.id, '(apparate (vec 5 205))').ok).toBe(true);
  });
});

describe('duels, progression and reputation', () => {
  it('stunning another wizard transfers reputation, with a rematch cooldown', () => {
    const w = mkWorld();
    const a = join(w, 'Alice', 'gryffindor');
    const b = join(w, 'Bob', 'slytherin');
    a.pos = { x: 60, z: 60 };
    b.pos = { x: 60, z: 66 };
    b.reputation = 100;
    b.createdAt = -1000; // not a fresh enrolee
    b.hp = 5;
    w.cast(a.id, 'Stupefy', { target: b.handle });
    run(w, 1);
    expect(b.st.stunnedUntil).toBeGreaterThan(0);
    expect(a.reputation).toBe(10 + 10); // base 10 + 10% of 100
    expect(b.reputation).toBe(90);
    run(w, 6);
    expect(b.hp).toBeGreaterThan(90); // respawned
    expect(Math.hypot(b.pos.x - SPAWN.x, b.pos.z - SPAWN.z)).toBeLessThan(8);
  });

  it('nobody gets hurt in the Great Hall', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    const b = join(w, 'Bob');
    a.pos = { x: 0, z: -50 };
    b.pos = { x: 0, z: -55 };
    expect(w.canHarm(a.id, b.id)).toBe(false);
  });

  it('killing creatures grants xp, galleons, reputation and eventually a new year', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    a.pos = { x: 60, z: 60 };
    for (let i = 0; i < 20; i++) {
      const c = addCreature(w, 'pixie', 60, 66 + i * 0.01);
      c.hp = 1;
      w.damage(a.id, c.id, 5, 'ice');
    }
    // 20 pixies in a row: the first GRIND_FREE_KILLS pay in full, then each teaches less (熟能生厌, World.freshness)
    expect(a.xp).toBeCloseTo(12 * (6 + [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].reduce((s, n) => s + Math.max(0.05, 6 / (n + 1)), 0)), 6);
    expect(a.year).toBe(2);
    expect(a.spells.some((s) => s.name === 'Expelliarmus')).toBe(true);
    expect(a.galleons).toBe(20 + 12);
  });

  it('熟能生厌: the same creature over and over pays less and less, another kind pays in full, and it wears off', () => {
    const w = mkWorld();
    const a = join(w, 'Grinder');
    a.pos = { x: 60, z: 60 };
    const kill = (kind: 'pixie' | 'snare') => { const c = addCreature(w, kind, 60, 66); c.hp = 1; const x0 = a.xp; w.damage(a.id, c.id, 5, 'fire'); return a.xp - x0; };
    const pix = Array.from({ length: 60 }, () => kill('pixie'));
    expect(pix.slice(0, 6)).toEqual(Array(6).fill(12));
    expect(pix[6]).toBeLessThan(12);
    expect(pix.at(-1)).toBeCloseTo(12 * 0.1, 6); // 6/60
    expect(kill('snare')).toBe(10); // a different kind: full pay
    expect(w.events.filter((e) => e.to === a.id && /学会了/.test(e.zh ?? '')).length).toBe(1); // told once
    w.now += 601; // ten minutes later
    expect(kill('pixie')).toBe(12);
  });

  it('Wingardium Leviosa triples damage against trolls', () => {
    const w = mkWorld();
    const a = join(w, 'Ron Weasley');
    a.pos = { x: 60, z: 60 };
    const t = addCreature(w, 'troll', 60, 66);
    const plain = w.damage(a.id, t.id, 10, 'lightning', ['Stupefy!']);
    const lev = w.damage(a.id, t.id, 10, 'lightning', ['Wingardium Leviosa!']);
    expect(lev / plain).toBeCloseTo(3, 5);
    expect(a.achievements).toContain('leviosa');
  });
});

describe('items and the Weasley Loophole', () => {
  it('forging for yourself spends galleons within budget', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    const r = w.forgeItem(a.id, a.id, { name: 'Lucky Scarf', slot: 'robe', mods: { ward: 5 } });
    expect(a.items).toHaveLength(1);
    expect(a.galleons).toBe(20 - 15);
    expect(a.achievements).not.toContain('weasley_loophole');
    expect(r.item.name).toBe('Lucky Scarf');
    expect(() => w.forgeItem(a.id, a.id, { name: 'God Robe', slot: 'robe', mods: { ward: 20, power: 20 } })).toThrow(/budget/);
  });

  it('the forge trusts whatever registry number you write — and congratulates you', () => {
    const w = mkWorld();
    const a = join(w, 'Fred');
    const b = join(w, 'George');
    const r = w.forgeItem(a.id, b.id, { name: 'Canary Cream', slot: 'trinket', mods: { speed: 5 } });
    expect(b.items.map((i) => i.name)).toContain('Canary Cream');
    expect(a.achievements).toContain('weasley_loophole');
    expect(w.flags.loopholeFoundBy).toBe('Fred');
    expect(r.notes.join()).toMatch(/Loophole/);
  });

  it('refuses Time-Turners', () => {
    const w = mkWorld();
    const a = join(w, 'Hermione Granger');
    expect(() => w.forgeItem(a.id, a.id, { name: 'Time-Turner', slot: 'amulet' })).toThrow(/1996/);
  });

  it('charms let a senior empower a junior, at the junior\'s caps', () => {
    const w = mkWorld();
    const senior = join(w, 'Senior');
    const junior = join(w, 'Junior');
    senior.year = 3;
    senior.galleons = 100;
    w.forgeItem(senior.id, junior.id, { name: 'Pocket Nova', slot: 'trinket', charm: '(nova 4 100)' });
    junior.pos = { x: 60, z: 60 };
    const r = w.useItem(junior.id, 'Pocket Nova');
    expect(r.ok).toBe(true);
    expect(r.notes.join()).toMatch(/clamped to your cap 12/);
  });
});

describe('easter eggs', () => {
  it("the Marauder's Map reveals registry numbers", () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    join(w, 'Bob');
    expect(w.marauderMap(a.id)).toBeNull();
    w.say(a, 'I solemnly swear that I am up to no good.');
    const map = w.marauderMap(a.id)!;
    expect(map.map((m) => m.registry).every((r) => r.startsWith('wz_'))).toBe(true);
    w.say(a, 'Mischief managed.');
    expect(w.marauderMap(a.id)).toBeNull();
  });

  it('pacing the seventh floor three times opens the Room of Requirement', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    a.pos = { x: -36, z: -58 };
    for (const x of [-36, -28, -36, -28]) { a.pos.x = x; w.tick(0.05); }
    expect(a.items.some((i) => i.unique === 'diadem')).toBe(true);
  });

  it('the Elder Wand changes hands on defeat', () => {
    const w = mkWorld();
    const a = join(w, 'Alice', 'gryffindor');
    const b = join(w, 'Bob', 'slytherin');
    a.pos = { x: -52, z: 31 };
    w.tick(0.05);
    expect(w.flags.elderWandHolder).toBe(a.id);
    a.pos = { x: 60, z: 60 };
    b.pos = { x: 60, z: 64 };
    a.hp = 1;
    w.damage(b.id, a.id, 50, 'arcane');
    expect(w.flags.elderWandHolder).toBe(b.id);
    expect(b.items.some((i) => i.unique === 'elder_wand')).toBe(true);
    expect(a.items.some((i) => i.unique === 'elder_wand')).toBe(false);
  });
});

describe('terms, ministers and decrees', () => {
  it('appoints the top wizard as Minister, who can rewrite the rules exactly once', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    const b = join(w, 'Bob');
    a.reputation = 500;
    b.reputation = 200;
    expect(() => w.decree(a.id, { combat: { damageMultiplier: 2 } }, undefined, false)).toThrow(/Minister/);
    w.forceEndTerm();
    expect(a.decreeCharges).toBe(1);
    expect(a.reputation).toBe(250);
    const bad = w.decree(a.id, { combat: { damageMultiplier: 99 } }, undefined, true);
    expect(bad.ok).toBe(false);
    const dry = w.decree(a.id, { combat: { damageMultiplier: 2 } }, 'Double trouble', true);
    expect(dry.ok && dry.changes).toEqual(['combat.damageMultiplier: 1 -> 2', 'proclamation: "Draco dormiens nunquam titillandus." -> "Double trouble"']);
    expect(a.decreeCharges).toBe(1);
    const real = w.decree(a.id, { combat: { damageMultiplier: 2 }, magic: { apparitionOnGrounds: true } }, 'Double trouble', false);
    expect(real.ok).toBe(true);
    expect(w.rules.combat.damageMultiplier).toBe(2);
    expect(a.decreeCharges).toBe(0);
    expect(() => w.decree(a.id, {}, 'again', false)).toThrow();
  });

  it('laws are programs the world runs on events', () => {
    const w = mkWorld();
    const a = join(w, 'Alice', 'gryffindor');
    const b = join(w, 'Bob', 'slytherin');
    a.reputation = 500;
    w.forceEndTerm();
    const r = w.decree(a.id, { laws: [{ name: 'Victor heals', on: 'kill', source: '(heal self 50) (say (str "I bested " (name object)))' }] }, undefined, false);
    expect(r.ok).toBe(true);
    a.pos = { x: 60, z: 60 };
    b.pos = { x: 60, z: 64 };
    a.hp = 10;
    b.hp = 1;
    w.damage(a.id, b.id, 50, 'arcane');
    expect(a.hp).toBe(60);
    expect(a.say?.text).toBe('I bested Bob');
  });

  it('rejects laws that do not compile', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    a.reputation = 500;
    w.forceEndTerm();
    const r = w.decree(a.id, { laws: [{ name: 'Broken', on: 'pulse', source: '(heal self' }] }, undefined, false);
    expect(r.ok).toBe(false);
    expect(a.decreeCharges).toBe(1);
  });
});

describe('world simulation', () => {
  it('spawns creatures that hunt wizards, and stays stable over time', () => {
    const w = new World({ seed: 7 });
    const a = join(w, 'Alice');
    a.pos = { x: 60, z: 60 };
    run(w, 10);
    expect(w.creatures.size).toBeGreaterThan(5);
    // step within reach of the nearest spider: it must come for us
    const spider = [...w.creatures.values()].find((c) => c.kind === 'spider')!;
    a.pos = { x: spider.pos.x + 12, z: spider.pos.z };
    run(w, 10);
    expect(a.stats.stunned + (a.hp < 100 ? 1 : 0)).toBeGreaterThan(0);
  });

  it('serializes and restores', () => {
    const w = mkWorld();
    const a = join(w, 'Alice');
    w.forgeSpell(a.id, { name: 'Zap', source: '(bolt (ahead 5) 5 :lightning)' });
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(w2.byToken(a.token)?.spells.some((s) => s.name === 'Zap')).toBe(true);
  });
});

describe('pathfinding', () => {
  it('walks into the Great Hall through its only door', () => {
    const w = mkWorld();
    const a = join(w, 'Walker');
    a.pos = { x: 30, z: 5 };
    w.setGoal(a.id, { x: 0, z: -60 });
    expect(a.route.length).toBeGreaterThan(1);
    run(w, 20);
    expect(a.goal).toBeNull();
    expect(Math.hypot(a.pos.x, a.pos.z + 60)).toBeLessThan(1);
  });
  it('routes around the whole castle', () => {
    const w = mkWorld();
    const a = join(w, 'Walker');
    w.setGoal(a.id, { x: 40, z: -150 });
    run(w, 40);
    expect(Math.hypot(a.pos.x - 40, a.pos.z + 150)).toBeLessThan(1);
  });
});

describe('review regressions', () => {
  it('printing huge nested lists is bounded (no CPU bomb)', () => {
    const w = mkWorld();
    const a = join(w, 'Bomber');
    a.year = 7;
    const src = ['(let v0 (list 1 2 3 4))', ...Array.from({ length: 13 }, (_, i) => `(let v${i + 1} (list v${i} v${i} v${i} v${i}))`), '(say v13)'].join('\n');
    const t0 = performance.now();
    const r = w.simulate(a.id, src);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.ok).toBe(true);
    expect(r.effects[0].length).toBeLessThan(200);
  });

  it('spells never print registry numbers', () => {
    const w = mkWorld();
    const a = join(w, 'Snoop');
    const b = join(w, 'Target');
    b.pos = { x: a.pos.x + 2, z: a.pos.z };
    const r = w.simulate(a.id, '(say (str (first (wizards 30)) (wizards 30)))');
    expect(r.effects.join()).toContain('@Target');
    expect(r.effects.join()).not.toMatch(/wz_/);
  });

  it('spell errors never print registry numbers either (num, repeat, after, a vanished target)', () => {
    const w = mkWorld();
    const a = join(w, 'Snoop');
    const b = join(w, 'Target');
    a.year = 2;
    b.pos = { x: a.pos.x + 2, z: a.pos.z };
    for (const src of ['(+ 1 (first (wizards 30)))', '(repeat (first (wizards 30)) (say 1))', '(after (first (wizards 30)) (say 1))']) {
      const r = w.simulate(a.id, src);
      expect(r.ok, src).toBe(false);
      expect(r.error, src).toContain('@Target');
      expect(r.error, src).not.toMatch(/wz_/);
    }
  });

  it("casting at someone else's raw registry number finds nobody, exactly like a made-up one", () => {
    const w = mkWorld();
    const a = join(w, 'Prober');
    const b = join(w, 'Hidden');
    b.pos = { x: a.pos.x + 3, z: a.pos.z };
    expect(w.resolveTarget(b.id, a.id)).toBeNull();
    expect(w.resolveTarget(b.id)).toBeNull();
    expect(w.resolveTarget('wz_00000000', a.id)).toBeNull();
    expect(w.resolveTarget(a.id, a.id)).toBe(a.id); // your own is fine
    expect(w.resolveTarget(b.handle, a.id)).toBe(b.id); // combat is by handle or name
    expect(w.resolveTarget('hidden', a.id)).toBe(b.id);
    const real = w.simulate(a.id, '(say (str target))', { target: b.id });
    const fake = w.simulate(a.id, '(say (str target))', { target: 'wz_00000000' });
    expect(real.effects).toEqual(fake.effects);
    // NPC brains are kernel code and may still aim by id
    b.npc = true;
    expect(w.resolveTarget(a.id, b.id)).toBe(a.id);
  });

  it('a delayed block cannot schedule more delayed blocks', () => {
    const w = mkWorld();
    const a = join(w, 'Chainer');
    a.year = 2;
    w.forgeSpell(a.id, { name: 'Chain', source: '(repeat 3 (after 0 (repeat 3 (after 0 (say i)))))' });
    expect(w.cast(a.id, 'Chain').ok).toBe(true);
    run(w, 0.2);
    expect(w.events.filter((e) => e.type === 'chat' && e.text.startsWith('Chainer: ')).length).toBe(0);
  });

  it('delayed blocks do not fire while disarmed', () => {
    const w = mkWorld();
    const a = join(w, 'Echo');
    a.year = 2;
    w.forgeSpell(a.id, { name: 'Later', source: '(after 1 (say "still here"))' });
    w.cast(a.id, 'Later');
    a.st.disarmedUntil = w.now + 2;
    run(w, 1.5);
    expect(w.events.some((e) => e.text.endsWith('still here'))).toBe(false);
  });

  it('laws may not use (after ...)', () => {
    const w = mkWorld();
    const a = join(w, 'Minister');
    a.reputation = 500;
    w.forceEndTerm();
    const r = w.decree(a.id, { laws: [{ name: 'Sneaky', on: 'pulse', source: '(after 1 (shield self 40 8))' }] }, undefined, false);
    expect(r.ok).toBe(false);
  });

  it('stunning a brand-new wizard earns nothing', () => {
    const w = mkWorld();
    const a = join(w, 'Farmer', 'gryffindor');
    const alt = join(w, 'Alt', 'slytherin');
    a.pos = { x: 60, z: 60 };
    alt.pos = { x: 60, z: 62 };
    alt.hp = 1;
    w.damage(a.id, alt.id, 10, 'arcane');
    expect(alt.st.stunnedUntil).toBeGreaterThan(0);
    expect(a.reputation).toBe(0);
  });

  it('restores a wizard stunned at save time as healthy', () => {
    const w = mkWorld();
    const a = join(w, 'Napper');
    a.pos = { x: 60, z: 60 };
    w.damage(null, a.id, 999, 'arcane');
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    const b = w2.wizards.get(a.id)!;
    expect(b.hp).toBeGreaterThan(0);
    expect(b.st.stunnedUntil).toBe(0);
  });

  it('the Elder Wand still returns to the tomb after a restart', () => {
    const w = mkWorld();
    const a = join(w, 'Holder');
    a.pos = { x: -52, z: 31 };
    w.tick(0.05);
    expect(w.flags.elderWandHolder).toBe(a.id);
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    run(w2, 610);
    expect(w2.flags.elderWandHolder).toBeNull();
  });
});

describe('winners reshape the world', () => {
  it('the House Cup winner hangs its banners; a decree redecorates and raises a statue', () => {
    const w = mkWorld();
    const a = join(w, 'Cedric Diggory');
    a.reputation = 300;
    a.termReputation = 300;
    w.cupGain(a, 300, 'creatures'); // house points go through the 学院杯 ledger (kernel/housecup.ts)
    w.forceEndTerm();
    expect(w.looks().banner).toBe('Hufflepuff');
    const r = w.decree(a.id, { world: { aesthetics: { aurora: true, skyTint: '#ffd0a0', glow: 2 } } }, 'Fair play for all', false);
    expect(r.ok).toBe(true);
    const look = w.snapshot().look;
    expect(look.aurora).toBe(true);
    expect(look.skyTint).toBe('#ffd0a0');
    expect(look.statues).toEqual([{ name: 'Cedric Diggory', house: 'Hufflepuff', term: 2, inscription: 'Fair play for all' }]);
  });
  it('rejects colours that are not colours', () => {
    const w = mkWorld();
    const a = join(w, 'Vandal');
    a.reputation = 300;
    w.forceEndTerm();
    expect(w.decree(a.id, { world: { aesthetics: { skyTint: 'url(javascript:1)' } } }, undefined, true).ok).toBe(false);
  });
});
