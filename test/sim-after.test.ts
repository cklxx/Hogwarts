/** simulate expands (after ...) blocks (playtest round 2): what each would do and when, under the cast's caps, with no side effects. */
import { describe, expect, it } from 'vitest';
import { simEffectZh, tr } from '../client/i18n';
import { World } from '../src/kernel/world.js';
import type { Creature } from '../src/kernel/types.js';
import { derived } from '../src/kernel/progression.js';

function setup(seed = 7) {
  const w = new World({ seed, secret: 'sim-after' });
  w.rules.creatures.spawnMultiplier = 0;
  const me = w.enroll('Planner').wizard;
  me.connections = 1; me.year = 4; me.pos = { x: 60, z: 60 };
  const c: Creature = { id: 'c_t', kind: 'pixie', pos: { x: 60, z: 66 }, home: { x: 60, z: 66 }, hp: 60, maxHp: 60, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return { w, me, c };
}

describe('simulate plans delayed blocks', () => {
  it('lists each block\'s effects with its delay, in the order they fire, and what they cost together', () => {
    const { w, me } = setup();
    const r = w.simulate(me.id, '(bolt target 10) (after 2 (say "late")) (after 0.5 (bolt target 12 :fire))', { target: 'c_t' });
    expect(r.ok, r.error).toBe(true);
    expect(r.effects).toEqual(['bolt 10 arcane (10 mana)', 't+0.5s: bolt 12 fire (13.2 mana)', 't+2s: say "late" (0 mana)']);
    expect(r.mana).toBe(12); // the cast itself: overhead + the first bolt
    expect(r.delayedMana).toBe(15.2 + 2); // each block is its own transaction (overhead included)
    expect(r.notes.join('\n')).toMatch(/planned against the world as it is now/);
    // the bindings as the cast left them, and the target the block closes over
    expect(w.simulate(me.id, '(let t target) (after 1 (when (alive t) (bolt t 8)))', { target: 'c_t' }).effects).toEqual(['t+1s: bolt 8 arcane (8 mana)']);
  });

  it('honours the caps: the delay clamp, afterPerCast, no nested after', () => {
    const { w, me } = setup();
    const clamp = w.simulate(me.id, '(after 9 (say "x"))');
    expect(clamp.effects).toEqual(['t+5s: say "x" (0 mana)']);
    expect(clamp.notes).toContain('after 9s clamped to 5s');
    const four = w.simulate(me.id, '(after 1 (say 1)) (after 1 (say 2)) (after 1 (say 3)) (after 1 (say 4))');
    expect(four.ok).toBe(false);
    expect(four.error).toMatch(/too many \(after \.\.\.\) blocks \(max 3\)/);
    const nested = w.simulate(me.id, '(say "now") (after 1 (after 1 (say "never")))');
    expect(nested.ok).toBe(true);
    expect(nested.effects[1]).toMatch(/^t\+1s: fizzles: a delayed block cannot schedule another/);
    // a block that finds nothing to act on (as the world stands now) says so; clamps inside a block carry its delay
    expect(w.simulate(me.id, '(say 1) (after 1 (when (> 0 1) (bolt aim 5)))').effects[1]).toBe('t+1s: nothing to act on');
    expect(w.simulate(me.id, '(say 1) (after 1 (bolt aim 999))').notes).toContain('t+1s: bolt power 999 clamped to your cap 34');
  });

  it('checks each block against the mana left by then (the cast and earlier blocks paid, regeneration added)', () => {
    const { w, me } = setup();
    me.mana = 30;
    const regen = derived(me, w.rules).manaRegen;
    const r = w.simulate(me.id, '(bolt target 20) (after 0.1 (bolt target 20))', { target: 'c_t' });
    expect(r.ok).toBe(true);
    expect(r.effects[1]).toMatch(/^t\+0\.1s: fizzles: not enough mana: needs 22, you have /);
    expect(r.effects[1]).toContain(`you have ${(8 + regen * 0.1).toFixed(1)}`);
    // (mana) inside the block reads the same estimate
    expect(w.simulate(me.id, '(say 1) (after 1 (say (str (floor (mana)))))').effects[1]).toBe(`t+1s: say "${Math.floor(30 - 2 + regen)}" (0 mana)`);
  });

  it('changes nothing in the world: mana, the pending queue, projectiles, creatures, the dice', () => {
    const a = setup(11), b = setup(11);
    const src = '(bolt target 10) (after 0.5 (when (< (rand) 2) (bolt target 12))) (after 1 (heal self 5))';
    const before = { mana: a.me.mana, hp: a.c.hp };
    for (let i = 0; i < 3; i++) expect(a.w.simulate(a.me.id, src, { target: 'c_t' }).ok).toBe(true);
    expect({ mana: a.me.mana, hp: a.c.hp }).toEqual(before);
    expect(a.w.pending).toHaveLength(0);
    expect(a.w.projectiles.size).toBe(0);
    expect(a.w.rand()).toBe(b.w.rand()); // a dry run's (rand) does not draw from the world's generator
  });

  it('reads in Chinese', () => {
    const { w, me } = setup();
    const lines = [
      ...w.simulate(me.id, '(bolt target 10) (after 0.5 (heal self 5)) (after 1 (after 1 (say 1)))', { target: 'c_t' }).effects,
      ...w.simulate(me.id, '(say 1) (after 1 (when (> 0 1) (bolt aim 5)))').effects,
    ];
    const zh = lines.map(simEffectZh);
    expect(zh).toEqual([expect.stringMatching(/^魔弹/), expect.stringMatching(/^0\.5 秒后：治疗 Planner 5 点（6\.5 法力）$/), expect.stringMatching(/^1 秒后：失败：延迟块里不能再套一个/), expect.stringMatching(/^说/), '1 秒后：没有可以作用的对象（按现在的世界）']);
    expect(tr('t+1s: bolt power 999 clamped to your cap 34')).toMatch(/^1 秒后：魔弹 bolt 威力 999 超过了你的年级上限/);
    expect(tr('Delayed blocks are planned against the world as it is now; by the time they fire, things may have moved.')).toMatch(/延时块/);
  });
});
