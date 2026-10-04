import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import type { Creature } from '../src/kernel/types.js';
import { equipRune, grantRune } from '../src/kernel/runes.js';
import { isWet } from '../src/kernel/chem.js';
import { studyable } from '../src/kernel/unfair.js';
import { displaySpellTags, ENGINE_SPELL_TAGS, userSpellTag } from '../src/shared/spell-tags.js';
import { readFileSync } from 'node:fs';

const fixture = () => {
  const world = new World({ seed: 31, secret: 'spell-tags-test' });
  world.rules.creatures.spawnMultiplier = 0; world.rules.events.pool = []; world.term.endsAt = 1e12;
  world.rules.combat.elementStatuses = false;
  const helper = world.enroll('Water Tag Helper', 'Slytherin').wizard;
  const partner = world.enroll('Tag Partner', 'Gryffindor').wizard;
  for (const w of [helper, partner]) { w.connections = 1; w.createdAt = -1e6; w.mana = 10000; w.pos = { x: 40, z: 12 }; }
  const c: Creature = { id: 'tag-troll', kind: 'troll', pos: { x: 40, z: 20 }, home: { x: 40, z: 20 }, hp: 1000, maxHp: 1000, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  world.creatures.set(c.id, c);
  const ticks = (n = 8) => { for (let i = 0; i < n; i++) world.tick(); };
  return { world, helper, partner, c, ticks };
};

describe('display names and incantations cannot impersonate engine tags', () => {
  it.each([
    { name: 'water', incantation: 'ordinary' },
    { name: 'A name', incantation: 'water' },
    { name: 'ordinary | water | rune', incantation: 'ordinary' },
    { name: 'A name', incantation: 'water | ordinary | conduct' },
  ])('real forged zero bolt $name / $incantation cannot soak or earn an assist', (spec) => {
    const { world, helper, partner, c, ticks } = fixture();
    const { spell } = world.forgeSpell(helper.id, { ...spec, source: '(bolt target 0)' });
    expect(world.cast(helper.id, spell.id, { target: c.id }).ok).toBe(true); ticks();
    expect(isWet(world, c.id)).toBe(false);
    expect(world.chem.waterSources.has(c.id)).toBe(false);
    world.damage(partner.id, c.id, 10, 'fire'); world.damage(partner.id, c.id, 2000, 'arcane');
    expect(helper.xp).toBe(0); expect(partner.xp).toBe(140);
  });
  it('a real Aguamenti primitive still creates source and earns its conserved XP share', () => {
    const { world, helper, partner, c, ticks } = fixture();
    const { spell } = world.forgeSpell(helper.id, { name: 'water', incantation: 'water | conduct', source: '(aguamenti target)' });
    expect(world.cast(helper.id, spell.id, { target: c.id }).ok).toBe(true); ticks();
    expect(isWet(world, c.id)).toBe(true);
    expect(world.chem.waterSources.get(c.id)?.by).toBe(helper.id);
    world.damage(partner.id, c.id, 10, 'fire'); world.damage(partner.id, c.id, 2000, 'arcane');
    expect([helper.xp, partner.xp]).toEqual([35, 105]);
  });
  it.each([...ENGINE_SPELL_TAGS, 'user:water', 'ordinary | water'])('a legitimate spell named %s still accepts split and can be studied', (name) => {
    const { world, helper, partner, ticks } = fixture();
    partner.pos = { x: 40, z: 20 };
    const { spell } = world.forgeSpell(helper.id, { name, incantation: 'ordinary', source: '(bolt target 10)' });
    grantRune(world, helper.id, 'split'); equipRune(world, helper.id, 'split', spell.id);
    let spawned = 0;
    const spawn = world.spawnProjectile.bind(world);
    world.spawnProjectile = (...args: Parameters<typeof spawn>) => { spawned++; return spawn(...args); };
    expect(world.cast(helper.id, spell.id, { target: partner.handle }).ok).toBe(true); ticks(4);
    expect(spawned).toBe(3);
    ticks(20);
    expect(studyable(world, partner).some((s) => s.spell === name)).toBe(true);
  });
  it.each(ENGINE_SPELL_TAGS)('actual cast labels cannot inject internal %s provenance', (tag) => {
    const { world, helper, c, ticks } = fixture();
    const { spell } = world.forgeSpell(helper.id, { name: tag, incantation: `ordinary | ${tag}`, source: '(bolt target 0)' });
    expect(world.cast(helper.id, spell.id, { target: c.id }).ok).toBe(true);
    const tags = [...world.projectiles.values()][0].tags;
    expect(tags).toEqual(displaySpellTags(spell.name, spell.incantation));
    expect(tags).toHaveLength(2);
    expect(tags.some((t) => (ENGINE_SPELL_TAGS as readonly string[]).includes(t))).toBe(false);
    ticks(); expect(c.hp).toBe(1000); expect(c.auras).toEqual([]);
  });
  it('the existing Wingardium Leviosa display incantation retains its troll multiplier', () => {
    const { world, helper, c, ticks } = fixture();
    const plain = world.damage(helper.id, c.id, 10, 'fire');
    const { spell } = world.forgeSpell(helper.id, { name: 'Troll Charm', incantation: 'Wingardium Leviosa', source: '(bolt target 10 "fire")' });
    const hp = c.hp;
    expect(world.cast(helper.id, spell.id, { target: c.id }).ok).toBe(true); ticks();
    expect(hp - c.hp).toBeCloseTo(plain * 3, 8);
  });
  it('binds display provenance and injective encoding to the independently proved Lean vectors', () => {
    const vectors = JSON.parse(readFileSync(new URL('../formal/water-assist-vectors.json', import.meta.url), 'utf8')) as { displayTags: [string, string][] };
    expect(vectors.displayTags.slice(0, ENGINE_SPELL_TAGS.length).map(([name]) => name)).toEqual([...ENGINE_SPELL_TAGS]);
    for (const [text, encoded] of vectors.displayTags) {
      expect(userSpellTag(text)).toBe(encoded);
      expect((ENGINE_SPELL_TAGS as readonly string[]).includes(encoded)).toBe(false);
      expect(displaySpellTags(text, 'water | overload')).toHaveLength(2);
    }
    const names = vectors.displayTags.map(([text]) => text);
    expect(new Set(names.map(userSpellTag)).size).toBe(names.length);
  });
});
