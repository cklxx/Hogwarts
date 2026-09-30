/**
 * Playtest round 5 (people and agents on one server) and the browser walk-through: a roll no longer ends a walk; NPC
 * news is rationed; an older NPC spars at your level; a match start is said to each player; the Minister's bar is
 * one a short term can reach (and an untouched old one moves); a school event's creature goes easy on the youngest;
 * a market spell can carry a price; and the small ones (Quidditch after the whistle, spellsWritten, a chest's bearing,
 * where an arity error points).
 */
import { describe, expect, it } from 'vitest';
import { copySpell, publishSpell } from '../src/kernel/market.js';
import { chestClues } from '../src/kernel/cards.js';
import { CHESTS } from '../src/shared/chests.js';
import { duelJoin } from '../src/kernel/duelclub.js';
import { QD_CALL_S, QD_START_FRAC, qdJoin, qdPairing } from '../src/kernel/quidditch.js';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk(seed = 8) {
  const w = new World({ seed, secret: 'round8' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.rules.combat.pvp = true;
  w.term.endsAt = 1e12;
  return w;
}
function join(w: World, name: string, house: string, x = 100, z = 100, year = 3): Wizard {
  const a = w.enroll(name, house as never).wizard;
  a.connections = 1; a.createdAt = -1e6; a.year = year; a.pos = { x, z };
  a.hp = w.privateState(a.id).maxHp; a.mana = w.privateState(a.id).maxMana;
  return a;
}
function beast(w: World, id: string, x: number, z: number, hp = 400): Creature {
  const c: Creature = { id, kind: 'troll', pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(id, c);
  return c;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };

describe('walking and waiting', () => {
  it('a roll on the way does not end the walk (a reflex dodge had ended every agent\'s move_to)', () => {
    const w = mk();
    const a = join(w, 'Walker Roll', 'Hufflepuff', 0, 0);
    w.setGoal(a.id, { x: 30, z: 0 }, 'agent');
    run(w, 0.5);
    expect(w.dodge(a.id, 0, 1).ok).toBe(true);
    run(w, 0.5);
    expect(a.goal).not.toBeNull();
    run(w, 8);
    expect(Math.hypot(a.pos.x - 30, a.pos.z)).toBeLessThan(1.5);
  });
});

describe('the feed', () => {
  it('NPC news: at most one line every 30 s school-wide; a player\'s own news is never held back', () => {
    const w = mk();
    const n1 = join(w, 'Npc One', 'Gryffindor'), n2 = join(w, 'Npc Two', 'Slytherin'), p = join(w, 'Real Player', 'Ravenclaw');
    n1.npc = n2.npc = true;
    const before = w.events.length;
    w.emit('level', 'Npc One advanced', { who: [n1.id] });
    w.emit('level', 'Npc Two advanced', { who: [n2.id] });
    w.emit('combat', 'Npc One stunned Npc Two', { who: [n1.id, n2.id] });
    w.emit('level', 'Real Player advanced', { who: [p.id] });
    expect(w.events.slice(before).map((e) => e.text)).toEqual(['Npc One advanced', 'Real Player advanced']);
    w.now += 31;
    w.emit('level', 'Npc Two advanced again', { who: [n2.id] });
    expect(w.events.at(-1)!.text).toBe('Npc Two advanced again');
  });
});

describe('the Duelling Club', () => {
  it('the match start is told to each player privately (an agent a round trip behind still hears it)', () => {
    const w = mk();
    const a = join(w, 'Harry Duel', 'Gryffindor', 0, -20), b = join(w, 'Draco Duel', 'Slytherin', 2, -20);
    duelJoin(w, a.id); duelJoin(w, b.id);
    run(w, 0.3);
    expect(w.duel.match).not.toBeNull();
    for (const x of [a, b]) expect(w.events.some((e) => e.to === x.id && /match is on/.test(e.text))).toBe(true);
  });
});

describe('the Minister', () => {
  it('the default bar is 30 (20 for a 10-minute term); an old save\'s untouched 100 moves to it, a decreed one stays', () => {
    const w = mk();
    w.rules.terms.lengthSeconds = 600;
    expect(w.rules.terms.ministerMinReputation).toBe(30);
    expect(w.ministerBar()).toBe(20);
    w.rules.terms.ministerMinReputation = 100;
    const back = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(back.rules.terms.ministerMinReputation).toBe(30);
    w.decrees.push({ at: 0, term: 1, minister: 'Percy', changes: ['terms.ministerMinReputation: 30 → 100'], proclamation: '' });
    const kept = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(kept.rules.terms.ministerMinReputation).toBe(100);
  });
});

describe('school events and the youngest', () => {
  it('an event creature hits a first-year at half its plain strength (no event boost); a third-year in full', () => {
    const w = mk();
    const y1 = join(w, 'Tiny Firstie', 'Hufflepuff', 100, 100, 1), y3 = join(w, 'Big Third', 'Hufflepuff', 120, 100, 3);
    const t = beast(w, 'troll_ev8', 100, 104);
    t.ev = 1; t.dmgMult = 1.5;
    const h1 = y1.hp, h3 = y3.hp;
    w.damage(t.id, y1.id, 20, 'arcane');
    w.damage(t.id, y3.id, 20, 'arcane');
    expect(h1 - y1.hp).toBeCloseTo(10 / 1.5, 5);
    expect(h3 - y3.hp).toBeCloseTo(20, 5);
  });
});

describe('the market', () => {
  it('a price is paid to the author once per wizard; a fresh wizard takes it free (the author gets nothing); too poor is refused', () => {
    const w = mk();
    const author = join(w, 'Fred Trader', 'Gryffindor'), buyer = join(w, 'Percy Buyer', 'Gryffindor'), poor = join(w, 'Poor Colin', 'Gryffindor'), fresh = join(w, 'Fresh Luna', 'Ravenclaw');
    fresh.createdAt = w.now;
    w.forgeSpell(author.id, { name: 'Weakspot', source: '(bolt (or target aim) 12 :ice)' });
    const pub = publishSpell(w, author.id, 'Weakspot', { price: 7 }) as { published: string };
    const g0 = author.galleons, b0 = buyer.galleons;
    const r = copySpell(w, buyer.id, pub.published) as { paid?: number };
    expect(r.paid).toBe(7);
    expect([author.galleons - g0, b0 - buyer.galleons]).toEqual([7, 7]);
    poor.galleons = 3;
    expect(() => copySpell(w, poor.id, pub.published)).toThrow(/costs 7 Galleons/);
    expect(poor.spells.some((s) => s.name === 'Weakspot')).toBe(false);
    const f0 = fresh.galleons, g1 = author.galleons;
    copySpell(w, fresh.id, pub.published);
    expect([fresh.galleons, author.galleons]).toEqual([f0, g1]);
  });
});

describe('small ones', () => {
  it('Quidditch after the whistle: join says the match is over and names next term\'s pairing', () => {
    const w = mk();
    w.term.startedAt = 0; w.term.endsAt = 900;
    const [A] = qdPairing(w.term.n);
    const p = join(w, 'Late Oliver', A, 40, -150);
    const whistle = QD_START_FRAC * 900;
    w.now = whistle - QD_CALL_S + 1;
    run(w, 0.1);
    w.qd.match!.phase = 'done';
    const nx = qdPairing(w.term.n + 1);
    expect(() => qdJoin(w, p.id)).toThrow(new RegExp(`match is over.*Next term: ${nx[0]} v ${nx[1]}`));
  });

  it('whoami counts the spells you wrote (stats.forged counts forged items)', () => {
    const w = mk();
    const a = join(w, 'Writer Kid', 'Ravenclaw');
    w.forgeSpell(a.id, { name: 'Zap', source: '(bolt (or target aim) 10 :lightning)' });
    w.forgeSpell(a.id, { name: 'Zop', source: '(bolt (or target aim) 11 :fire)' });
    expect(w.whoami(a.id).stats).toMatchObject({ spellsWritten: 2 });
  });

  it('the nearest chest has a compass bearing', () => {
    const w = mk();
    const c = CHESTS[0];
    const a = join(w, 'Seeker Kid', 'Hufflepuff', c.x, c.z + 20);
    expect(chestClues(w, a).nearest).toMatchObject({ bearing: 'N' });
  });

  it('an arity error points at the extra argument, or names the missing one', () => {
    const w = mk();
    const a = join(w, 'Coder Kid', 'Ravenclaw');
    expect(() => w.forgeSpell(a.id, { name: 'A1', source: '(bolt target aim 10 :fire)' })).toThrow(/this one is extra \(line 1, col 21\)/);
    expect(() => w.forgeSpell(a.id, { name: 'A2', source: '(heal self)' })).toThrow(/missing amount/);
  });
});
