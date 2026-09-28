/**
 * The forge egg, second layer (docs/AGENT_LINK.md §B): negative enchantments and lore jinxes posted to
 * someone else's registry number — and every fairness rule that keeps a curse a nuisance, never a lockout.
 */
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, BOUND_REFUSAL, CURSE_BLESS, FORGE_REFUSAL, SILENCED, World } from '../src/kernel/world.js';
import { parseJinx } from '../src/kernel/hex.js';
import { derived, derivedUncached, hexHpFloor, hexPrice, hpFloor, itemPoints, manaFloor, yearBaseHp } from '../src/kernel/progression.js';
import {
  CURSED_ITEM_BIND_S, HEX_MALICE_TAX, HEX_PAIR_COOLDOWN_S, HEX_RESPITE_S, JINX_DEFAULTS, NEG_LIMITS, SILENCE_COOLDOWN_S, SILENCE_MAX_S,
  VICTIM_HEX_PER_10MIN,
} from '../src/shared/constants.js';
import { XP_FOR_YEAR } from '../src/kernel/progression.js';
import type { Item, Wizard } from '../src/kernel/types.js';

const SAFE = { x: 0, z: -56 }; // the Great Hall
function mk(seed = 3) {
  const w = new World({ seed, secret: 'x' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) w.tick(0.05); };
/** A wizard old enough, senior enough and rich enough to curse and be cursed, standing outside any safe zone. */
function wiz(w: World, name: string, house: string, x = 60, z = 60, year = 2): Wizard {
  const a = w.enroll(name, house).wizard;
  a.connections = 1;
  if (a.year < year) w.gainXp(a, XP_FOR_YEAR[year] - a.xp); // real level-ups, so the curriculum (Finite Incantatem) is granted
  a.createdAt = -10_000;
  a.galleons = 1000;
  a.pos = { x, z };
  a.hp = derived(a, w.rules).maxHp;
  return a;
}
function pair(w: World) {
  return [wiz(w, 'Sender', 'gryffindor', 60, 60), wiz(w, 'Victim', 'slytherin', 64, 60)] as const;
}
const hex = (w: World, from: Wizard, to: Wizard | string, spec: Partial<{ name: string; slot: string; mods: Partial<Item['mods']>; lore: string; charm: string }> = {}) =>
  w.forgeItem(from.id, typeof to === 'string' ? to : to.id, { name: spec.name ?? 'Shrinking Jumper', slot: spec.slot ?? 'robe', mods: spec.mods, lore: spec.lore, charm: spec.charm });

describe('cursed items (negative enchantments)', () => {
  it('forging a negative value for yourself is still an error', () => {
    const w = mk();
    const [a] = pair(w);
    expect(() => w.forgeItem(a.id, a.id, { name: 'Lead Boots', slot: 'broom', mods: { speed: -10 } })).toThrow(/speed must be a non-negative number/);
  });

  it('a negative parcel for someone else arrives cursed, anonymous, equipped into an empty slot and stuck there', () => {
    const w = mk();
    const [a, b] = pair(w);
    const r = hex(w, a, b, { mods: { maxHp: -30 } });
    const it = b.items.find((i) => i.id === r.item.id)!;
    expect(it).toMatchObject({ cursed: true, anon: true, bound: true, boundUntil: w.now + CURSED_ITEM_BIND_S });
    expect(b.equipped.robe).toBe(it.id);
    expect(derived(b, w.rules).maxHp).toBe(Math.max(hpFloor(b.year), yearBaseHp(b.year) - 30));
    expect(b.hp).toBeLessThanOrEqual(derived(b, w.rules).maxHp);
    expect(() => w.unequip(b.id, 'robe')).toThrow(BOUND_REFUSAL);
    expect(() => w.destroyItem(b.id, it.id)).toThrow(BOUND_REFUSAL);
    const robe = w.forgeItem(b.id, b.id, { name: 'Own Robe', slot: 'robe', mods: { ward: 2 } }).item;
    expect(() => w.equip(b.id, robe.id)).toThrow(BOUND_REFUSAL); // never displaced either
    expect(b.equipped.robe).toBe(it.id);
    // the recipient is told, privately and without a name
    const ev = w.events.filter((e) => e.type === 'curse' && e.to === b.id).at(-1)!;
    expect(ev.text).toMatch(/no name on it/);
    expect(ev.zh).toMatch(/没有署名/);
    expect(ev.text + ev.zh).not.toContain(a.name);
    expect(ev.text + ev.zh).not.toContain(a.id);
    expect(ev.who).toBeUndefined();
  });

  it('wears off after CURSED_ITEM_BIND_S and then is an ordinary bad item', () => {
    const w = mk();
    const [a, b] = pair(w);
    const it = hex(w, a, b, { mods: { speed: -10 } }).item;
    run(w, CURSED_ITEM_BIND_S + 1.1);
    expect(it.bound).toBe(false);
    expect(w.events.some((e) => e.to === b.id && /worn off/.test(e.text) && /消退/.test(e.zh ?? ''))).toBe(true);
    w.unequip(b.id, 'robe');
    expect(w.destroyItem(b.id, it.id).id).toBe(it.id);
  });

  it('Finite Incantatem on yourself breaks the binding at once', () => {
    const w = mk();
    const [a, b] = pair(w);
    const it = hex(w, a, b, { mods: { power: -10 } }).item;
    expect(w.cast(b.id, 'Finite Incantatem').ok).toBe(true);
    expect(w.boundItems(b)).toEqual([]);
    expect(it.bound).toBe(false);
    w.unequip(b.id, 'robe');
    w.destroyItem(b.id, it.id);
  });

  it('lands in the trunk, harmless, when the slot is taken', () => {
    const w = mk();
    const [a, b] = pair(w);
    const own = w.forgeItem(b.id, b.id, { name: 'Own Robe', slot: 'robe', mods: { ward: 2 } }).item;
    w.equip(b.id, own.id);
    const it = hex(w, a, b, { mods: { ward: -10 } }).item;
    expect(b.equipped.robe).toBe(own.id);
    expect(it.bound).toBeUndefined();
    expect(w.boundItems(b)).toEqual([]);
    expect(derived(b, w.rules).ward).toBeCloseTo(0.02);
    w.destroyItem(b.id, it.id);
  });

  it('a curse cannot also bless, and stays within NEG_LIMITS and the budget', () => {
    const w = mk();
    const [a, b] = pair(w);
    expect(() => hex(w, a, b, { mods: { maxHp: -10, speed: 5 } })).toThrow(CURSE_BLESS);
    expect(() => hex(w, a, b, { mods: { speed: 5 }, lore: 'Furnunculus!' })).toThrow(CURSE_BLESS);
    expect(() => hex(w, a, b, { mods: { maxHp: -10 }, charm: '(say "hi")' })).toThrow(CURSE_BLESS);
    expect(() => hex(w, a, b, { mods: { maxHp: NEG_LIMITS.maxHp - 1 } })).toThrow(/below the floor of -30/);
    expect(() => hex(w, a, b, { mods: { ward: -20, power: -15 } })).toThrow(/budget/); // 35 points > 14 at year 2
    expect(b.items).toHaveLength(0);
  });

  it('the sender pays the item price plus the malice tax; the recipient pays nothing', () => {
    const w = mk();
    const [a, b] = pair(w);
    const ga = a.galleons, gb = b.galleons;
    const mods = { speed: -10, ward: -2 };
    hex(w, a, b, { mods });
    const { points } = itemPoints(mods, 0, true);
    expect(points).toBe(8);
    expect(ga - a.galleons).toBe(hexPrice(points));
    expect(hexPrice(points)).toBe(24 + HEX_MALICE_TAX);
    expect(b.galleons).toBe(gb);
  });

  it('the derived() cache stays exact through cursed items, jinxes and their end', () => {
    const w = mk();
    const [a, b] = pair(w);
    const check = () => expect(derived(b, w.rules)).toEqual(derivedUncached(b, w.rules));
    check();
    hex(w, a, b, { mods: { maxHp: -30 }, lore: 'Locomotor Wibbly' });
    check();
    w.cast(b.id, 'Finite Incantatem');
    check();
    w.unequip(b.id, 'robe');
    check();
  });
});

describe('derived() floors (§B.7)', () => {
  it('no enchantment can push a stat past its floor', () => {
    const w = mk();
    for (const year of [1, 4, 7]) {
      const b = wiz(w, `Floor ${year}`, 'hufflepuff', 60, 60, year);
      // stack far more than any one parcel may carry, straight into the equipment
      const junk = (slot: Item['slot'], mods: Item['mods']): Item => ({ id: `junk_${year}_${slot}`, name: 'junk', slot, mods, forgedBy: 'x', forgedByName: 'x', createdAt: 0 });
      b.items = [
        junk('wand', { maxHp: -500, maxMana: -500, manaRegen: -50, speed: -500, power: -500, ward: -500 }),
        junk('robe', { maxHp: -500 }), junk('amulet', { power: -500 }),
      ];
      b.equipped = { wand: `junk_${year}_wand`, robe: `junk_${year}_robe`, amulet: `junk_${year}_amulet` };
      w.applyAura(b.id, 'cursed', 30, 1, null);
      const d = derived(b, w.rules);
      expect(d).toEqual(derivedUncached(b, w.rules));
      expect(d.maxHp).toBe(Math.max(40, 0.6 * yearBaseHp(year)));
      expect(d.maxMana).toBe(manaFloor(w.rules.magic.baseMaxMana + w.rules.magic.manaPerYear * (year - 1)));
      expect(d.manaRegen).toBe(w.rules.magic.manaRegen * 0.5);
      expect(d.speedMult).toBe(0.5);
      expect(d.power).toBe(0.25);
      expect(d.ward).toBe(-0.25);
      // damage is never healing, and a negative ward amplifies by at most 25%
      b.hp = 50;
      const c = wiz(w, `Hitter ${year}`, 'gryffindor', 62, 60);
      c.items = [junk('wand', { power: -500 })];
      c.equipped = { wand: `junk_${year}_wand` };
      const dealt = w.damage(c.id, b.id, 10, 'arcane');
      expect(dealt).toBeGreaterThan(0);
      expect(dealt).toBeCloseTo(10 * 0.25 * 1.25);
      // positive items are untouched by the floors
      b.items = []; b.equipped = {}; b.auras = [];
      expect(derived(b, w.rules).maxHp).toBe(yearBaseHp(year));
    }
  });
});

describe('jinxes in the lore', () => {
  it('are recognised by their canon incantations, with kernel-chosen strength', () => {
    expect(parseJinx('A lovely scarf. Locomotor Wibbly!')).toEqual({ kind: 'jelly', ...JINX_DEFAULTS.jelly });
    expect(parseJinx('jelly-legs for you')?.kind).toBe('jelly');
    expect(parseJinx('TARANTALLEGRA')?.kind).toBe('dance');
    expect(parseJinx('furnunculus x 1000 for 9999 seconds')).toEqual({ kind: 'boils', mag: 3, seconds: 12 });
    expect(parseJinx('Bat-Bogey Hex')?.kind).toBe('bats');
    expect(parseJinx('Lang-lock')?.kind).toBe('langlock');
    expect(parseJinx('first Langlock, then Furnunculus')?.kind).toBe('langlock');
    expect(parseJinx('a perfectly nice present')).toBeNull();
    expect(parseJinx(undefined)).toBeNull();
  });

  it('a jinx in the lore of a parcel for yourself is only words', () => {
    const w = mk();
    const [a] = pair(w);
    const it = w.forgeItem(a.id, a.id, { name: 'Diary', slot: 'trinket', mods: { maxMana: 4 }, lore: 'Furnunculus' }).item;
    expect(it.jinx).toBeUndefined();
    expect(a.auras).toEqual([]);
  });

  it('Furnunculus harasses but never knocks out, and never stops regeneration', () => {
    const w = mk();
    const [a, b] = pair(w);
    const hurtAt = b.hurtAt, lastHurtBy = b.lastHurtBy;
    b.hp = 40;
    hex(w, a, b, { name: 'Box of Chocolates', slot: 'trinket', lore: 'Furnunculus' });
    expect(b.auras.map((x) => x.k)).toEqual(['boils']);
    expect(b.auras[0].src).toBe(a.id);
    const floor = hexHpFloor(derived(b, w.rules).maxHp);
    let min = b.hp;
    for (let t = 0; t < 12; t += 0.05) { w.tick(0.05); min = Math.min(min, b.hp); }
    expect(min).toBeGreaterThanOrEqual(floor);
    expect(min).toBeLessThan(40);
    expect(b.st.stunnedUntil).toBe(0);
    expect([b.hurtAt, b.lastHurtBy]).toEqual([hurtAt, lastHurtBy]);
    const after = b.hp;
    run(w, 3);
    expect(b.hp).toBeGreaterThan(after); // natural regeneration was never interrupted
  });

  it('a jinx damage tick goes through canHarm: no damage in a safe zone, or between housemates without friendly fire', () => {
    const w = mk();
    const [a, b] = pair(w);
    hex(w, a, b, { name: 'Sweets', slot: 'trinket', lore: 'Furnunculus' });
    b.pos = { ...SAFE };
    b.hp = 60;
    run(w, 2);
    expect(b.hp).toBeGreaterThanOrEqual(60);
    const w2 = mk();
    w2.rules.combat.friendlyFire = false;
    const a2 = wiz(w2, 'House A', 'ravenclaw', 60, 60), b2 = wiz(w2, 'House B', 'ravenclaw', 64, 60);
    hex(w2, a2, b2, { name: 'Sweets', slot: 'trinket', lore: 'Furnunculus' });
    b2.hp = 60;
    run(w2, 2);
    expect(b2.hp).toBeGreaterThanOrEqual(60);
  });

  it('Jelly-Legs slows you, never below a quarter of your speed, and not in a safe zone', () => {
    const w = mk();
    const [a, b] = pair(w);
    const c = wiz(w, 'Control', 'hufflepuff', 64, 64);
    hex(w, a, b, { name: 'Socks', slot: 'trinket', lore: 'Jelly-Legs!' });
    const x0 = b.pos.x, y0 = c.pos.x;
    w.setInput(b.id, 1, 0); w.setInput(c.id, 1, 0);
    run(w, 1);
    expect((b.pos.x - x0) / (c.pos.x - y0)).toBeCloseTo(0.6, 1);
    // with an Inferius' chill on top the floor holds: 1 - 0.4 - 0.4 < 0.25 -> 0.25
    w.applyAura(b.id, 'chill', 5, 0.4, null);
    const x1 = b.pos.x, y1 = c.pos.x;
    run(w, 1);
    expect((b.pos.x - x1) / (c.pos.x - y1)).toBeCloseTo(0.25, 1);
    // inside the Great Hall the jinx rests
    b.auras = b.auras.filter((x) => x.k !== 'chill');
    b.pos = { x: -6, z: -56 }; c.pos = { x: -6, z: -52 };
    const x2 = b.pos.x, y2 = c.pos.x;
    run(w, 0.5);
    expect(b.pos.x - x2).toBeCloseTo(c.pos.x - y2, 3);
  });

  it('Tarantallegra makes the legs wander, deterministically and without touching the world RNG', () => {
    const go = (dance: boolean) => {
      const w = mk(9);
      const [a, b] = pair(w);
      if (dance) hex(w, a, b, { name: 'Dancing Shoes', slot: 'trinket', lore: 'Tarantallegra!' });
      else a.galleons -= 0; // same RNG draws otherwise: forging uses one nid()
      if (!dance) w.forgeItem(a.id, a.id, { name: 'Plain Shoes', slot: 'trinket', mods: { maxMana: 1 } });
      w.setInput(b.id, 0, 1);
      run(w, 3);
      return { pos: { ...b.pos }, next: w.rand() };
    };
    const d1 = go(true), d2 = go(true), plain = go(false);
    expect(d1).toEqual(d2);
    expect(d1.next).toBe(plain.next);
    expect(Math.abs(d1.pos.x - plain.pos.x)).toBeGreaterThan(0.05);
  });

  it('Langlock silences for at most SILENCE_MAX_S: no casting, no public speech, no item charms — owls and simulation still work', () => {
    const w = mk();
    const [a, b] = pair(w);
    const wand = w.forgeItem(b.id, b.id, { name: 'Glow Stick', slot: 'wand', charm: '(light 5)' }).item;
    hex(w, a, b, { name: 'Tongue Twister', slot: 'trinket', lore: 'Langlock' });
    expect(b.st.silencedUntil).toBe(w.now + SILENCE_MAX_S);
    expect(w.cast(b.id, 'Lumos').error).toBe(SILENCED);
    expect(() => w.say(b, 'help!')).toThrow(SILENCED);
    expect(w.useItem(b.id, wand.id).error).toBe(SILENCED);
    expect(w.simulate(b.id, '(light 5)').ok).toBe(true);
    expect(w.cast(b.id, 'Lumos', { dryRun: true }).ok).toBe(true);
    expect(w.owl(b.id, 'player', 'someone glued my tongue').from).toBe('player');
    expect(w.afflicted(b.id)).toBe(true);
    // a safe zone suspends it
    b.pos = { ...SAFE };
    expect(w.cast(b.id, 'Lumos').ok).toBe(true);
    b.pos = { x: 64, z: 60 };
    run(w, SILENCE_MAX_S + 0.1);
    expect(w.cast(b.id, 'Lumos').ok).toBe(true);
    w.say(b, 'I can talk again');
  });

  it('after a silence, new silences are dropped for SILENCE_COOLDOWN_S: there is always a window to cast in', () => {
    const w = mk();
    const [a, b] = pair(w);
    const c = wiz(w, 'Second Sender', 'ravenclaw', 60, 64);
    hex(w, a, b, { name: 'Gag 1', slot: 'trinket', lore: 'Langlock' });
    const firstEnds = b.st.silencedUntil;
    run(w, SILENCE_MAX_S + 1);
    hex(w, c, b, { name: 'Gag 2', slot: 'amulet', lore: 'Langlock' }); // accepted, but its silence is dropped
    expect(b.st.silencedUntil).toBe(firstEnds);
    expect(w.cast(b.id, 'Lumos').ok).toBe(true);
    expect(b.st.silenceCdUntil).toBe(firstEnds + SILENCE_COOLDOWN_S);
  });

  it('a Bat-Bogey is a short DoT and a silence, and counts as one jinx', () => {
    const w = mk();
    const [a, b] = pair(w);
    hex(w, a, b, { name: 'Hanky', slot: 'trinket', lore: 'Bat-Bogey' });
    expect(b.auras.map((x) => x.k)).toEqual(['bats']);
    expect(b.st.silenceBy).toBe('bats');
    expect(w.activeHexes(b)).toBe(1);
    expect(w.snapshot().w.find((x) => x.h === b.handle)!.s).toMatch(/Q.*t/);
  });

  it('Finite Incantatem clears every jinx and the silence, and grants a respite', () => {
    const w = mk();
    const [a, b] = pair(w);
    const c = wiz(w, 'Second Sender', 'ravenclaw', 60, 64);
    hex(w, a, b, { name: 'Box', slot: 'trinket', lore: 'Furnunculus' });
    hex(w, c, b, { name: 'Socks', slot: 'amulet', lore: 'Jelly-Legs' });
    expect(w.activeHexes(b)).toBe(2);
    run(w, SILENCE_MAX_S + 0.5); // ride out nothing but time; now cleanse
    expect(w.cast(b.id, 'Finite Incantatem').ok).toBe(true);
    expect(w.activeHexes(b)).toBe(0);
    expect(b.st.silencedUntil).toBe(0);
    expect(b.respiteUntil).toBeCloseTo(w.now + HEX_RESPITE_S);
    w.destroyItem(b.id, b.items.find((i) => i.name === 'Box')!.id); // (two cursed items is the most a trunk takes)
    const d = wiz(w, 'Third Sender', 'hufflepuff', 60, 56);
    expect(() => hex(w, d, b, { name: 'Again', slot: 'wand', lore: 'Langlock' })).toThrow(FORGE_REFUSAL);
    run(w, HEX_RESPITE_S + 0.1);
    expect(() => hex(w, d, b, { name: 'Again', slot: 'wand', lore: 'Langlock' })).not.toThrow();
  });
});

describe('the fairness gate', () => {
  it('refuses senders who are not ready for the Dark Arts, saying why', () => {
    const w = mk();
    const [a, b] = pair(w);
    a.year = 1;
    expect(() => hex(w, a, b, { mods: { speed: -5 } })).toThrow(/Dark Arts yet/);
    a.year = 2;
    a.createdAt = w.now - 60;
    expect(() => hex(w, a, b, { mods: { speed: -5 } })).toThrow(/less than 10 minutes/);
    a.createdAt = -10_000;
    a.galleons = 5;
    expect(() => hex(w, a, b, { mods: { speed: -5 } })).toThrow(/costs \d+ Galleons/);
    a.npc = true;
    a.galleons = 100;
    expect(() => hex(w, a, b, { mods: { speed: -5 } })).toThrow(FORGE_REFUSAL);
    expect(b.items).toHaveLength(0);
  });

  it('refuses every protected recipient with one and the same sentence as an unknown registry number', () => {
    const cases: [string, (w: World, b: Wizard) => void][] = [
      ['unknown registry number', () => {}],
      ['NPC', (_, b) => { b.npc = true; }],
      ['first year', (_, b) => { b.year = 1; }],
      ['enrolled 5 minutes ago', (w, b) => { b.createdAt = w.now - 300; }],
      ['offline', (w, b) => { b.connections = 0; b.lastMcpAt = -1e9; }],
      ['stunned', (w, b) => { b.st.stunnedUntil = w.now + 5; }],
      ['in a safe zone', (_, b) => { b.pos = { ...SAFE }; }],
      ['in respite', (w, b) => { b.respiteUntil = w.now + 10; }],
      ['trunk full', (w, b) => { for (let i = 0; i < 16; i++) b.items.push({ id: `f${i}`, name: 'x', slot: 'trinket', mods: {}, forgedBy: b.id, forgedByName: b.name, createdAt: 0 }); }],
    ];
    const seen = new Set<string>();
    for (const [what, prep] of cases) {
      const w = mk();
      const [a, b] = pair(w);
      prep(w, b);
      const target = what === 'unknown registry number' ? 'wz_00000000' : b.id;
      const before = a.galleons;
      try { hex(w, a, target, { mods: { speed: -5 } }); throw new Error(`${what}: accepted`); } catch (e) { seen.add((e as Error).message); }
      expect(a.galleons, what).toBe(before);
    }
    expect([...seen]).toEqual([FORGE_REFUSAL]);
    // and a benign gift to an unknown number gets the same sentence
    const w = mk();
    const [a] = pair(w);
    expect(() => w.forgeItem(a.id, 'wz_00000000', { name: 'Scarf', slot: 'robe', mods: { ward: 1 } })).toThrow(FORGE_REFUSAL);
  });

  it('caps what one victim can carry: 3 jinxes, 2 cursed items, 1 bound curse, 3 parcels per 10 minutes', () => {
    const w = mk();
    const b = wiz(w, 'Victim', 'slytherin', 64, 60);
    const senders = ['One', 'Two', 'Three', 'Four', 'Five'].map((n, i) => wiz(w, `Sender ${n}`, 'gryffindor', 60, 50 + i * 3));
    // 1 bound curse
    hex(w, senders[0], b, { name: 'Curse 1', slot: 'robe', mods: { speed: -5 } });
    expect(() => hex(w, senders[1], b, { name: 'Curse 2', slot: 'amulet', mods: { speed: -5 } })).toThrow(FORGE_REFUSAL);
    // 2 cursed items in the trunk
    hex(w, senders[1], b, { name: 'Jinx A', slot: 'trinket', lore: 'Furnunculus' });
    expect(b.items.filter((i) => i.cursed)).toHaveLength(2);
    expect(() => hex(w, senders[2], b, { name: 'Jinx B', slot: 'trinket', lore: 'Tarantallegra' })).toThrow(FORGE_REFUSAL);
    // destroying them makes room; the per-10-minute window still counts what arrived
    w.destroyItem(b.id, b.items.find((i) => i.name === 'Jinx A')!.id);
    hex(w, senders[2], b, { name: 'Jinx B', slot: 'trinket', lore: 'Tarantallegra' });
    expect(b.hexWindow).toHaveLength(VICTIM_HEX_PER_10MIN);
    w.destroyItem(b.id, b.items.find((i) => i.name === 'Jinx B')!.id);
    expect(() => hex(w, senders[3], b, { name: 'Jinx C', slot: 'trinket', lore: 'Langlock' })).toThrow(FORGE_REFUSAL);
    run(w, 601);
    // after the window: at most 3 active jinxes (the 4th is refused while 3 are live)
    b.auras = [];
    for (const [i, k] of (['jelly', 'dance', 'boils'] as const).entries()) w.applyAura(b.id, k, 100, 0.1, senders[i].id);
    expect(w.activeHexes(b)).toBe(3);
    expect(() => hex(w, senders[4], b, { name: 'Jinx D', slot: 'trinket', lore: 'Langlock' })).toThrow(FORGE_REFUSAL);
    b.auras = b.auras.filter((x) => x.k !== 'boils');
    hex(w, senders[4], b, { name: 'Jinx D', slot: 'trinket', lore: 'Langlock' });
    expect(w.activeHexes(b)).toBe(3); // jelly, dance and a Langlock silence
  });

  it('the same sender must wait HEX_PAIR_COOLDOWN_S before cursing the same wizard again', () => {
    const w = mk();
    const [a, b] = pair(w);
    hex(w, a, b, { name: 'One', slot: 'trinket', lore: 'Langlock' });
    w.destroyItem(b.id, b.items[0].id);
    expect(() => hex(w, a, b, { name: 'Two', slot: 'trinket', lore: 'Langlock' })).toThrow(/recently.*wait/);
    run(w, HEX_PAIR_COOLDOWN_S + 0.1);
    expect(() => hex(w, a, b, { name: 'Two', slot: 'trinket', lore: 'Langlock' })).not.toThrow();
    expect(Object.keys(a.hexLog)).toEqual([b.id]);
  });
});

describe('who sent it', () => {
  it('the armory hides an anonymous sender until Revelio, which tells the victim privately', () => {
    const w = mk();
    const [a, b] = pair(w);
    const it = hex(w, a, b, { mods: { maxMana: -10 } }).item;
    const shown = w.armory(b.id).items.find((i) => i.id === it.id)!;
    expect(shown).not.toHaveProperty('forgedBy');
    expect(shown).not.toHaveProperty('forgedByName');
    expect(shown).toMatchObject({ cursed: true, anon: true, bound: true, equipped: true });
    expect(JSON.stringify(w.armory(b.id))).not.toContain(a.id);
    expect(w.cast(b.id, 'Revelio').ok).toBe(true);
    const ev = w.events.filter((e) => e.to === b.id && e.type === 'curse').at(-1)!;
    expect(ev.text).toContain(a.name);
    expect(ev.text).toContain(a.id);
    expect(ev.zh).toContain('原形立现');
    expect(w.armory(b.id).items.find((i) => i.id === it.id)).toMatchObject({ forgedBy: a.id, forgedByName: a.name });
    expect(w.events.filter((e) => !e.to).some((e) => e.text.includes(a.id))).toBe(false);
  });

  it('the first curse earns a private "Dark Arts" (no reputation, nothing public), and the world-first note goes to one wizard once', () => {
    const w = mk();
    const [a, b] = pair(w);
    const c = wiz(w, 'Copycat', 'ravenclaw', 60, 64);
    const before = w.events.length, rep = a.reputation;
    hex(w, a, b, { mods: { speed: -5 } });
    const fresh = w.events.slice(before);
    expect(a.achievements).toContain('dark_arts');
    expect(a.achievements).not.toContain('weasley_loophole');
    expect(ACHIEVEMENTS.dark_arts.rep).toBe(0);
    expect(a.reputation).toBe(rep);
    expect(fresh.every((e) => e.to)).toBe(true); // nothing public at all
    expect(fresh.filter((e) => e.to === a.id).map((e) => e.zh).join()).toMatch(/黑魔法.*你第一个发现/s);
    expect(w.flags.curseFoundBy).toBe(a.name);
    expect(JSON.stringify(w.leaderboard())).not.toMatch(/curse/i); // not on any public board
    hex(w, c, b, { name: 'Second', slot: 'trinket', lore: 'Tarantallegra' });
    expect(c.achievements).toContain('dark_arts');
    expect(w.flags.curseFoundBy).toBe(a.name);
    expect(w.events.filter((e) => /你第一个发现/.test(e.zh ?? ''))).toHaveLength(1);
  });
});

describe('persistence', () => {
  it('hex state survives a restart; an old save without it restores with defaults', () => {
    const w = mk();
    const [a, b] = pair(w);
    const it = hex(w, a, b, { mods: { speed: -5 } }).item;
    w.cast(b.id, 'Finite Incantatem');
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    const a2 = w2.wizards.get(a.id)!, b2 = w2.wizards.get(b.id)!;
    expect(a2.hexLog).toEqual(a.hexLog);
    expect(b2.hexWindow).toEqual(b.hexWindow);
    expect(b2.respiteUntil).toBe(b.respiteUntil);
    expect(b2.items.find((i) => i.id === it.id)).toMatchObject({ cursed: true, anon: true });
    expect(w2.flags.curseFoundBy).toBe(a.name);
    const old = JSON.parse(JSON.stringify(w.serialize()));
    delete old.flags.curseFoundBy;
    for (const x of old.wizards) { delete x.hexLog; delete x.hexWindow; delete x.respiteUntil; delete x.st.silencedUntil; }
    const w3 = World.restore(old);
    const b3 = w3.wizards.get(b.id)!;
    expect([b3.hexLog, b3.hexWindow, b3.respiteUntil, b3.st.silencedUntil, b3.st.silenceCdUntil, w3.flags.curseFoundBy]).toEqual([{}, [], 0, 0, 0, null]);
  });
});
