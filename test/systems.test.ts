import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { generateSeal, runSeal } from '../src/kernel/seals.js';
import { LANDMARKS } from '../src/shared/map.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import type { CreatureKind } from '../src/shared/constants.js';
import { XP_FOR_YEAR } from '../src/kernel/progression.js';

const SECRET = 'test-secret';
function mk() {
  const w = new World({ seed: 11, secret: SECRET });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string, house?: string): Wizard {
  const x = w.enroll(name, house).wizard;
  x.connections = 1;
  x.pos = { x: 60, z: 60 };
  return x;
}
/** Advance through real level-ups so the curriculum is granted. */
const setYear = (w: World, a: Wizard, y: number) => { if (a.year < y) w.gainXp(a, XP_FOR_YEAR[y] - a.xp); a.year = y; };
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) w.tick(0.05); };
function creature(w: World, kind: CreatureKind, x: number, z: number, hp = 200): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
const at = (w: World, wz: Wizard, landmark: string) => { const l = LANDMARKS.find((x) => x.id === landmark)!; wz.pos = { x: l.x, z: l.z }; };

describe('titles', () => {
  it('everyone starts as a Muggle and climbs', () => {
    const w = mk();
    const a = join(w, 'Petunia');
    expect(w.title(a).zh).toBe('麻瓜');
    w.gainXp(a, 30);
    expect(w.title(a).zh).toBe('哑炮');
    w.gainXp(a, 200);
    expect(w.title(a).en).toBe('Apprentice');
    a.year = 7; a.seals = 4;
    expect(w.title(a).en).toBe('Chief Warlock');
    a.wasMinister = true;
    expect(w.title(a).zh).toBe('梅林');
  });
});

describe('UI charms', () => {
  it('Tempus unlocks the clock; Point Me is year-2 magic', () => {
    const w = mk();
    const a = join(w, 'Viewer');
    expect(w.cast(a.id, 'Tempus').ok).toBe(true);
    expect(a.ui).toContain('tempus');
    expect(w.simulate(a.id, '(reveal :point-me)').error).toMatch(/year-2/);
    setYear(w, a, 3);
    expect(w.simulate(a.id, '(reveal :homenum)').ok).toBe(true);
    expect(w.simulate(a.id, '(reveal :xray)').error).toMatch(/reveal what/);
  });
});

describe('the Restricted Section', () => {
  it('needs the year, every page read in place, and the one true answer', () => {
    const w = mk();
    const a = join(w, 'Scholar');
    expect(() => w.breakSeal(a.id, 1, ['0x0'])).toThrow(/year 2/);
    setYear(w, a, 2);
    expect(() => w.breakSeal(a.id, 1, ['0x0'])).toThrow(/every page/);
    expect(() => w.readSealPage(a.id, 1)).toThrow(/Missing pages rest at/);
    at(w, a, 'courtyard');
    expect(w.readSealPage(a.id, 1).runes).toMatch(/TIWAZ/);
    at(w, a, 'great_hall');
    w.readSealPage(a.id, 1);
    expect(w.inspectSeal(a.id, 1).runes).not.toMatch(/missing/);
    a.pos = { x: 60, z: 60 };
    const hp = a.hp;
    const bad = w.breakSeal(a.id, 1, ['0x12345678']);
    expect(bad.opened).toBe(false);
    expect(a.hp).toBeLessThan(hp);
    const key = generateSeal(SECRET, a.id, 1).key;
    const ok = w.breakSeal(a.id, 1, key.map((k) => '0x' + k.toString(16)));
    expect(ok.opened).toBe(true);
    expect(a.seals).toBe(1);
  });

  it('rate-limits attempts to three per ten minutes', () => {
    const w = mk();
    const a = join(w, 'Guesser');
    setYear(w, a, 2);
    a.sealPages[1] = [0, 1];
    for (let i = 0; i < 3; i++) { a.hp = 100; w.breakSeal(a.id, 1, [String(i)]); }
    a.hp = 100;
    expect(() => w.breakSeal(a.id, 1, ['7'])).toThrow(/smouldering/);
  });

  it('every seal is unique per wizard and per server secret', () => {
    const a = generateSeal('s1', 'wz_a', 3);
    expect(runSeal(a.code, a.key)).toBe(true);
    expect(runSeal(generateSeal('s1', 'wz_b', 3).code, a.key)).toBe(false);
    expect(runSeal(generateSeal('s2', 'wz_a', 3).code, a.key)).toBe(false);
  });

  it('seals raise the caps and unlock chain (II) and storm (IV)', () => {
    const w = mk();
    const a = join(w, 'Adept');
    setYear(w, a, 4);
    expect(() => w.forgeSpell(a.id, { name: 'Arc', source: '(chain target 20)' })).toThrow(/seal 2/);
    a.seals = 2;
    expect(() => w.forgeSpell(a.id, { name: 'Arc', source: '(let t (first (enemies 30))) (when t (chain t 20))' })).not.toThrow();
    const c1 = creature(w, 'pixie', 60, 70), c2 = creature(w, 'pixie', 63, 72), c3 = creature(w, 'pixie', 66, 74);
    expect(w.cast(a.id, 'Arc').ok).toBe(true);
    expect([c1, c2, c3].filter((c) => c.hp < 200).length).toBe(3);
    setYear(w, a, 7); a.seals = 4; a.mana = 400;
    const t = creature(w, 'troll', 60, 80, 500);
    expect(w.simulate(a.id, '(storm (vec 60 80) 6 40)').ok).toBe(true);
    w.forgeSpell(a.id, { name: 'Tempest', source: '(storm (vec 60 80) 6 40)' });
    run(w, 0.5); // global cooldown after Arc
    t.hp = 500;
    expect(w.cast(a.id, 'Tempest').ok).toBe(true);
    run(w, 1);
    expect(t.hp).toBe(500);
    run(w, 1);
    expect(t.hp).toBeLessThan(500);
  });
});

describe('the healing school', () => {
  it('regen heals over time and never past max health', () => {
    const w = mk();
    const a = join(w, 'Healer');
    setYear(w, a, 2);
    a.hp = 50;
    w.forgeSpell(a.id, { name: 'Mend Me', source: '(regen self 4 8)' });
    expect(w.cast(a.id, 'Mend Me').ok).toBe(true);
    run(w, 4);
    expect(a.hp).toBeGreaterThan(60);
    run(w, 30);
    expect(a.hp).toBe(115);
  });

  it('cleanse ends venom, roots and curses', () => {
    const w = mk();
    const a = join(w, 'Bitten');
    setYear(w, a, 2);
    w.applyAura(a.id, 'poison', 10, 3, null);
    a.st.rootedUntil = w.now + 10;
    expect(w.afflicted(a.id)).toBe(true);
    expect(w.cast(a.id, 'Finite Incantatem').ok).toBe(true);
    expect(w.afflicted(a.id)).toBe(false);
  });

  it('Rennervate revives a stunned wizard where they fell', () => {
    const w = mk();
    const a = join(w, 'Medic', 'hufflepuff');
    const b = join(w, 'Patient', 'hufflepuff');
    setYear(w, a, 3);
    b.pos = { x: 62, z: 60 };
    w.damage(null, b.id, 999, 'arcane');
    expect(b.st.stunnedUntil).toBeGreaterThan(0);
    const r = w.cast(a.id, 'Rennervate');
    expect(r.ok).toBe(true);
    expect(b.st.stunnedUntil).toBe(0);
    expect(b.pos).toEqual({ x: 62, z: 60 });
    expect(b.hp).toBe(30); // 30% of a first-year's 100
  });

  it('mend heals your house, not your rivals', () => {
    const w = mk();
    const a = join(w, 'Singer', 'hufflepuff');
    const friend = join(w, 'Friend', 'hufflepuff');
    const rival = join(w, 'Rival', 'slytherin');
    setYear(w, a, 4);
    friend.hp = 20; rival.hp = 20;
    friend.pos = { x: 62, z: 60 }; rival.pos = { x: 58, z: 60 };
    expect(w.cast(a.id, 'Vulnera Sanentur').ok).toBe(true);
    expect(friend.hp).toBeGreaterThan(20);
    expect(rival.hp).toBe(20);
  });
});

describe('conjuration', () => {
  it('a summon fights for its owner, never against them, and is capped', () => {
    const w = mk();
    const a = join(w, 'Draco Malfoy');
    setYear(w, a, 2);
    const pixie = creature(w, 'pixie', 62, 64, 80);
    expect(w.cast(a.id, 'Serpensortia').ok).toBe(true);
    const snake = [...w.creatures.values()].find((c) => c.owner === a.id)!;
    expect(snake.kind).toBe('serpent');
    expect(w.canHarm(snake.id, a.id)).toBe(false);
    expect(w.canHarm(snake.id, pixie.id)).toBe(true);
    run(w, 6);
    expect(pixie.hp).toBeLessThan(80);
    // a second summon replaces the first (maxSummons = 1)
    a.mana = 200;
    w.cast(a.id, 'Serpensortia');
    expect([...w.creatures.values()].filter((c) => c.owner === a.id).length).toBe(1);
  });

  it('killing with a summon credits the owner; enemies may strike the summon', () => {
    const w = mk();
    const a = join(w, 'Owner', 'gryffindor');
    const foe = join(w, 'Foe', 'slytherin');
    setYear(w, a, 2);
    w.cast(a.id, 'Serpensortia');
    const snake = [...w.creatures.values()].find((c) => c.owner === a.id)!;
    expect(w.canHarm(foe.id, snake.id)).toBe(true);
    const pixie = creature(w, 'pixie', snake.pos.x + 1, snake.pos.z, 1);
    const xp = a.xp;
    w.damage(snake.id, pixie.id, 50, 'arcane');
    expect(a.xp - xp).toBe(12);
  });

  it('a decree can forbid conjuration', () => {
    const w = mk();
    const a = join(w, 'Conjurer');
    setYear(w, a, 2);
    w.rules.magic.maxSummons = 0;
    expect(w.cast(a.id, 'Serpensortia').error).toMatch(/forbidden/);
  });

  it('summons vanish when their owner is stunned', () => {
    const w = mk();
    const a = join(w, 'Fragile');
    setYear(w, a, 2);
    w.cast(a.id, 'Serpensortia');
    w.damage(null, a.id, 999, 'arcane');
    run(w, 0.2);
    expect([...w.creatures.values()].some((c) => c.owner === a.id)).toBe(false);
  });
});

describe('creatures of the Forest', () => {
  it('unicorns heal those near them and curse whoever harms them', () => {
    const w = mk();
    const a = join(w, 'Quirrell');
    const u = creature(w, 'unicorn', 65, 60);
    a.hp = 50;
    run(w, 3);
    expect(a.hp).toBeGreaterThan(55);
    expect(w.simulate(a.id, '(count (enemies 20))').ok).toBe(true);
    expect(w.around(a.pos, 20, (e) => w.canHarm(a.id, e.id) && !w.isBenign(e.id), a.id)).toHaveLength(0);
    w.damage(a.id, u.id, 10, 'arcane');
    expect(a.auras.some((x) => x.k === 'cursed')).toBe(true);
    a.hp = 999;
    run(w, 0.1);
    expect(a.hp).toBeLessThanOrEqual(70);
  });

  it('the phoenix cannot be harmed and weeps over the badly hurt', () => {
    const w = mk();
    const a = join(w, 'Harry Potter');
    const f = creature(w, 'phoenix', 64, 60);
    expect(w.canHarm(a.id, f.id)).toBe(false);
    a.hp = 30;
    run(w, 0.2);
    expect(a.hp).toBeGreaterThan(80);
  });

  it('Acromantula bites are venomous; fire burns; ice chills; a decree can switch elements off', () => {
    const w = mk();
    const a = join(w, 'Ron Weasley');
    const s = creature(w, 'spider', 61, 60);
    s.attackCd = 0;
    run(w, 0.1);
    expect(a.auras.some((x) => x.k === 'poison')).toBe(true);
    const p = creature(w, 'pixie', 70, 70);
    w.damage(a.id, p.id, 10, 'fire');
    expect(p.auras.some((x) => x.k === 'burn')).toBe(true);
    w.damage(a.id, p.id, 10, 'ice');
    expect(p.auras.some((x) => x.k === 'chill')).toBe(true);
    w.rules.combat.elementStatuses = false;
    const q = creature(w, 'pixie', 72, 70);
    w.damage(a.id, q.id, 10, 'fire');
    expect(q.auras).toHaveLength(0);
  });
});

describe('NPC wizards', () => {
  it('are real wizards who never become Minister and are worth no duel reputation', () => {
    const w = new World({ seed: 3, secret: SECRET });
    ensureNpcs(w, 4);
    const npcs = [...w.wizards.values()].filter((x) => x.npc);
    expect(npcs).toHaveLength(4);
    const p = join(w, 'Player', 'ravenclaw');
    p.reputation = 150;
    npcs[0].reputation = 9999;
    w.forceEndTerm();
    expect(p.decreeCharges).toBe(1);
    expect(npcs[0].decreeCharges).toBe(0);
    const goyle = npcs.find((x) => x.name === 'Gregory Goyle')!;
    goyle.pos = { x: 61, z: 60 };
    goyle.hp = 1;
    const before = p.reputation;
    w.damage(p.id, goyle.id, 50, 'arcane');
    expect(p.reputation).toBe(before);
  });
});
