/**
 * Transfiguration of self (变形术): a wizard's look changes only through a spell — (glamour ...) — and a
 * Colour-Change jinx on someone else only where you could duel them, for at most a minute.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { analyze } from '../src/runes/checker.js';
import { EFFECT_COST, PRIM_BY_NAME } from '../src/runes/primitives.js';
import { grimoire } from '../src/mcp/grimoire.js';
import { defaultRulebook } from '../src/kernel/rulebook.js';
import { CURRICULUM } from '../src/lore/spells.js';
import { ZH_SPELL } from '../src/shared/zh.js';
import { GLAMOUR_PRANK_MAX_S, cleanGlamour, colourFromText, glamourKey, parseGlamourKey } from '../src/shared/glamour.js';
import { XP_FOR_YEAR, derived } from '../src/kernel/progression.js';
import type { Wizard } from '../src/kernel/types.js';

const SAFE = { x: 0, z: -56 }; // the Great Hall
function mk() {
  const w = new World({ seed: 7, secret: 'x' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function wiz(w: World, name: string, house: string, year = 1, x = 60, z = 60): Wizard {
  const a = w.enroll(name, house).wizard;
  a.connections = 1;
  if (a.year < year) w.gainXp(a, XP_FOR_YEAR[year] - a.xp);
  a.pos = { x, z };
  a.mana = derived(a, w.rules).maxMana;
  return a;
}
/** Forge and cast a spell (resting the wand in between so cooldowns never interfere). */
function cast(w: World, a: Wizard, source: string, target?: string) {
  const name = `G${Math.floor(w.now * 1000)}${Math.random().toString(36).slice(2, 6)}`;
  for (const s of a.spells.filter((s) => !s.builtin)) w.unlearn(a.id, s.id);
  w.forgeSpell(a.id, { name, source });
  w.now += 5;
  a.mana = derived(a, w.rules).maxMana;
  return w.cast(a.id, name, { target: target ?? null });
}
const look = (w: World, a: Wizard) => w.snapshot().w.find((x) => x.h === a.handle)!.g;
const check = (src: string, year = 7, seals = 0) => analyze(src, { year, maxNodes: 500, seals });

describe('glamour: the language', () => {
  it('is an effect primitive in the table, auto-documented in the grimoire with worked examples', () => {
    const p = PRIM_BY_NAME.get('glamour')!;
    expect(p.kind).toBe('effect');
    const g = grimoire(1, defaultRulebook());
    expect(g).toMatch(/\(glamour \.\.\.\)\s+Transfiguration of self/);
    expect(g).toContain('TRANSFIGURATION OF SELF');
    expect(g).toContain('(glamour :robe "#7a1f2b" :trim :gold :hat "#222" :material :velvet)');
    expect(g).toMatch(/:ghost\s+y6, \+16 mana .*\[LOCKED: year 6\]/);
    expect(grimoire(7, defaultRulebook())).toMatch(/:flame\s+y4 \+ seal 1.*\[SEALED: seal 1\]/);
  });

  it('parses keyword arguments, strings, names, lists and nil', () => {
    for (const src of [
      '(glamour :robe "#7a1f2b" :trim "#d4af37" :hat "#222" :skin "#e8c39e" :glow "#9fd8ff" :material :velvet)',
      '(glamour :robe :midnight :trim :slytherin)',
      '(glamour :robe (list 122 31 43) :hat nil)',
      '(glamour :reset)',
      '(glamour :reset :hat :black)',
      '(glamour :robe (house self))',
    ]) expect(() => check(src), src).not.toThrow();
    expect(colourFromText('#b5f')).toBe(0xbb55ff);
    expect(colourFromText('Gryffindor')).toBe(0xae0001);
    expect(colourFromText('nope')).toBeNull();
  });

  it('refuses typos, bad colours and odd arity at forge time, with a position', () => {
    expect(() => check('(glamour)')).toThrow(/needs at least one key/);
    expect(() => check('(glamour :robes "#fff")')).toThrow(/unknown key :robes.*line 1/);
    expect(() => check('(glamour :robe "#ggg")')).toThrow(/not a colour/);
    expect(() => check('(glamour :robe)')).toThrow(/:robe needs a value/);
    expect(() => check('(glamour :material :tweed)')).toThrow(/no such material :tweed/);
  });

  it('the Hallows cannot be forged: invisibility is refused with a lore error (both languages)', () => {
    expect(() => check('(glamour :material :invisibility-shimmer)')).toThrow(/Deathly Hallows.*死亡圣器/);
    expect(() => check('(glamour :invisibility)')).toThrow(/Cloak of Invisibility/);
    expect(() => check('(glamour :material :metamorphmagus)')).toThrow(/born, not made/);
  });

  it('gates fancy materials by year and seals, statically and when the material is computed', () => {
    expect(check('(glamour :material :velvet)', 1).minYear).toBe(1);
    expect(check('(glamour :material :ghost)').minYear).toBe(6);
    expect(() => check('(glamour :material :starlight)', 4)).toThrow(/needs year 5 magic \(glamour :starlight\)/);
    expect(() => check('(glamour :material :flame)', 7, 0)).toThrow(/glamour :flame lies behind seal 1/);
    expect(check('(glamour :material :flame)', 4, 1).minSeals).toBe(1);
    expect(() => check('(glamour :on target :robe :pink)', 1)).toThrow(/needs year 2 magic/);
    // computed: the kernel refuses at cast time
    const w = mk();
    const a = wiz(w, 'Computed', 'gryffindor', 1);
    const r = cast(w, a, '(let m (if true "ghost" "plain")) (glamour :material m)');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/:ghost is year-6 transfiguration/);
    expect(a.look).toBeNull();
  });

  it('costs 5 + 2 per colour + the material; a jinx on someone else more', () => {
    expect(EFFECT_COST.glamour({ parts: 0, tier: 0, other: 0, secs: 0 })).toBe(5);
    expect(EFFECT_COST.glamour({ parts: 2, tier: 4, other: 0, secs: 0 })).toBe(13);
    expect(EFFECT_COST.glamour({ parts: 1, tier: 0, other: 1, secs: 30 })).toBe(5 + 2 + 5 + 15);
    const w = mk();
    const a = wiz(w, 'Payer', 'ravenclaw', 1);
    const r = cast(w, a, '(glamour :robe "#7a1f2b" :trim :gold :material :velvet)');
    expect(r.ok).toBe(true);
    expect(r.mana).toBe(w.rules.magic.castOverhead + 13);
  });
});

describe('glamour: your own look', () => {
  it('persists on the wizard, ships compactly in the snapshot entry and merges part by part', () => {
    const w = mk();
    const a = wiz(w, 'Dresser', 'gryffindor', 1);
    expect(look(w, a)).toBeUndefined(); // house look: nothing on the wire
    expect(cast(w, a, '(glamour :robe "#7a1f2b" :trim "#d4af37" :material :velvet)').ok).toBe(true);
    expect(a.look).toEqual({ mat: 'velvet', robe: 0x7a1f2b, trim: 0xd4af37 });
    expect(look(w, a)).toBe('velvet:7a1f2b:d4af37:::');
    expect(cast(w, a, '(glamour :hat :black :glow "#9fd8ff")').ok).toBe(true);
    expect(look(w, a)).toBe('velvet:7a1f2b:d4af37:111114::9fd8ff');
    expect(cast(w, a, '(glamour :trim nil)').ok).toBe(true); // nil = that part back to the house default
    expect(look(w, a)).toBe('velvet:7a1f2b::111114::9fd8ff');
    // the snapshot entry key stays inside the wizard entry (fan-out encodes entries once)
    expect(Object.keys(w.snapshot())).not.toContain('g');
    expect(parseGlamourKey(look(w, a))).toEqual(a.look);
  });

  it('clamps computed colours (with a note) and validates computed keys', () => {
    const w = mk();
    const a = wiz(w, 'Clamper', 'hufflepuff', 1);
    const r = cast(w, a, '(glamour :robe (list 300 -5 128.4) :hat 99999999)');
    expect(r.ok).toBe(true);
    expect(a.look).toMatchObject({ robe: 0xff0080, hat: 0xffffff });
    expect(r.notes.join(' ')).toMatch(/clamped to \[255 0 128\]/);
    expect(r.notes.join(' ')).toMatch(/clamped to 16777215/);
    const bad = cast(w, a, '(let k "wings") (glamour k "#fff")');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/unknown key :wings/);
    const hallow = cast(w, a, '(glamour :material (str "invisi" "bility"))');
    expect(hallow.error).toMatch(/Deathly Hallows/);
    expect(cast(w, a, '(glamour :robe (vec 1 2))').error).toMatch(/expected a colour/);
  });

  it('is transactional: a fizzled cast changes nothing and costs nothing', () => {
    const w = mk();
    const a = wiz(w, 'Fizzler', 'slytherin', 1);
    const before = a.mana;
    const r = w.simulate(a.id, '(glamour :robe :emerald) (bolt aim 999999) (glamour :material :ghost)');
    expect(r.ok).toBe(false);
    expect(a.look).toBeNull();
    expect(a.mana).toBe(before);
  });

  it(':reset (Reparifarge) restores the house defaults; the curriculum teaches Vestimentum and Reparifarge', () => {
    const w = mk();
    const a = wiz(w, 'Resetter', 'ravenclaw', 1);
    expect(CURRICULUM.map((c) => c.name)).toEqual(expect.arrayContaining(['Vestimentum', 'Reparifarge']));
    expect(ZH_SPELL.Vestimentum).toBeTruthy();
    expect(ZH_SPELL.Reparifarge).toBeTruthy();
    w.now += 5;
    expect(w.cast(a.id, 'Vestimentum').ok).toBe(true);
    expect(a.look).toEqual({ mat: 'velvet', robe: 0x2a5bd7, trim: 0xd4af37 });
    w.now += 5;
    expect(w.cast(a.id, 'Reparifarge').ok).toBe(true);
    expect(a.look).toBeNull();
    expect(look(w, a)).toBeUndefined();
    expect(cast(w, a, '(glamour :robe :plum :material :velvet)').ok).toBe(true);
    expect(cast(w, a, '(glamour :reset :hat :gold)').ok).toBe(true);
    expect(a.look).toEqual({ mat: 'plain', hat: 0xd4af37 });
  });

  it('survives serialize/restore; old saves get the house look; junk on disk is sanitised', () => {
    const w = mk();
    const a = wiz(w, 'Keeper', 'gryffindor', 6);
    a.seals = 1;
    expect(cast(w, a, '(glamour :robe "#101030" :glow :lumos :material :ghost)').ok).toBe(true);
    expect(cast(w, a, '(glamour :material :flame)').ok).toBe(true);
    const data = JSON.parse(JSON.stringify(w.serialize()));
    const w2 = World.restore(data);
    expect(w2.wizards.get(a.id)!.look).toEqual({ mat: 'flame', robe: 0x101030, glow: 0xfff2a0 });
    const old = JSON.parse(JSON.stringify(w.serialize()));
    delete old.wizards[0].look;
    expect(World.restore(old).wizards.get(a.id)!.look).toBeNull();
    const junk = JSON.parse(JSON.stringify(w.serialize()));
    junk.wizards[0].look = { mat: 'invisibility', robe: 1e12, hat: 'red' };
    expect(World.restore(junk).wizards.get(a.id)!.look).toEqual({ mat: 'plain', robe: 0xffffff });
    expect(cleanGlamour({ mat: 'plain' })).toBeNull();
    expect(glamourKey(null)).toBeUndefined();
  });

  it('respects Ministry decrees: glamour can be banned or repriced like any effect', () => {
    const w = mk();
    const a = wiz(w, 'Lawful', 'hufflepuff', 1);
    w.rules.magic.costMultipliers.glamour = 2;
    expect(cast(w, a, '(glamour :robe :gold)').mana).toBe(w.rules.magic.castOverhead + 14);
    w.rules.magic.bannedPrimitives = ['glamour'];
    expect(() => w.forgeSpell(a.id, { name: 'Banned', source: '(glamour :robe :gold)' })).toThrow(/banned by Ministry decree: glamour/);
  });
});

describe('glamour :on — the Colour-Change jinx', () => {
  function duel() {
    const w = mk();
    const a = wiz(w, 'Prankster', 'gryffindor', 2, 60, 60);
    const b = wiz(w, 'Mark', 'slytherin', 2, 64, 60);
    return { w, a, b };
  }

  it('lays a timed look over the victim, tells them privately, and wears off by itself', () => {
    const { w, a, b } = duel();
    expect(cast(w, b, '(glamour :robe :emerald :material :velvet)').ok).toBe(true);
    const r = cast(w, a, '(glamour :on target :robe :pink :hat :pink :secs 20)', b.handle);
    expect(r.ok).toBe(true);
    expect(b.look).toEqual({ mat: 'velvet', robe: 0x1f8a4c }); // their own look is untouched underneath
    expect(look(w, b)).toBe(`velvet:ff69b4::ff69b4::`);
    expect(w.afflicted(b.id)).toBe(true);
    expect(w.inboxFor(b.id).some((e) => e.to === b.id && /Colour-Change/.test(e.text) && /变色咒/.test(e.zh ?? ''))).toBe(true);
    expect(a.look).toBeNull();
    w.now += 21;
    expect(look(w, b)).toBe('velvet:1f8a4c::::');
  });

  it('is capped at 60 s (clamped with a note) and never shorter than 5 s', () => {
    const { w, a, b } = duel();
    const r = cast(w, a, '(glamour :on target :robe :pink :secs 600)', b.handle);
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/glamour secs 600 clamped to your cap 60/);
    expect(b.jinxLook!.until - w.now).toBeCloseTo(GLAMOUR_PRANK_MAX_S, 5);
    cast(w, a, '(glamour :on target :robe :pink :secs 0)', b.handle);
    expect(b.jinxLook!.until - w.now).toBeCloseTo(5, 5);
  });

  it('Finite Incantatem (cleanse) ends it', () => {
    const { w, a, b } = duel();
    expect(cast(w, a, '(glamour :on target :robe :pink :secs 60)', b.handle).ok).toBe(true);
    w.now += 5;
    b.mana = 999;
    expect(w.cast(b.id, 'Finite Incantatem').ok).toBe(true);
    expect(b.jinxLook).toBeNull();
    expect(look(w, b)).toBeUndefined();
  });

  it('only where canHarm allows it: not in a safe zone, not with PvP off, not a housemate without friendly fire, not out of range', () => {
    const { w, a, b } = duel();
    b.pos = { ...SAFE };
    a.pos = { x: SAFE.x + 3, z: SAFE.z };
    expect(cast(w, a, '(glamour :on target :robe :pink)', b.handle).error).toMatch(/cannot jinx Mark's robes here/);
    b.pos = { x: 64, z: 60 }; a.pos = { x: 60, z: 60 };
    w.rules.combat.pvp = false;
    expect(cast(w, a, '(glamour :on target :robe :pink)', b.handle).error).toMatch(/cannot jinx/);
    w.rules.combat.pvp = true;
    const mate = wiz(w, 'Housemate', 'gryffindor', 2, 62, 60);
    w.rules.combat.friendlyFire = false;
    expect(cast(w, a, '(glamour :on target :robe :pink)', mate.handle).error).toMatch(/cannot jinx/);
    b.pos = { x: 100, z: 60 };
    expect(cast(w, a, '(glamour :on target :robe :pink)', b.handle).error).toMatch(/out of range/);
    expect(b.jinxLook).toBeNull();
    expect(mate.jinxLook).toBeNull();
  });

  it('is year-2 magic, never resets someone else, only targets wizards, and :on self is just your own look', () => {
    const w = mk();
    const kid = wiz(w, 'Firstie', 'gryffindor', 1, 60, 60);
    const b = wiz(w, 'Other', 'slytherin', 2, 63, 60);
    const r = w.simulate(kid.id, '(glamour :on target :robe :pink)', { target: b.handle });
    expect(r.error).toMatch(/needs year 2 magic/);
    const a = wiz(w, 'Second', 'hufflepuff', 2, 61, 61);
    expect(cast(w, a, '(glamour :on target :reset)', b.handle).error).toMatch(/only works on yourself/);
    expect(cast(w, a, '(glamour :on self :robe :gold :secs 9)').ok).toBe(true);
    expect(a.look).toEqual({ mat: 'plain', robe: 0xd4af37 });
    expect(a.jinxLook).toBeNull();
  });

  it('does not outlive a restart', () => {
    const { w, a, b } = duel();
    expect(cast(w, a, '(glamour :on target :robe :pink :secs 60)', b.handle).ok).toBe(true);
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(w2.wizards.get(b.id)!.jinxLook).toBeNull();
  });
});
