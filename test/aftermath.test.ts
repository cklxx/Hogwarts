/** 战后世界 smoke test (src/kernel/aftermath.ts): 阵亡→墓碑→下周目不刷新，商店开关，战报升级。 */
import { describe, expect, it } from 'vitest';
import { WARWEEK_TERMS } from '../src/kernel/warweek.js';
import { buildAftermath, isShopClosed, shopPriceMultiplier, isNpcDead, tombstonesOf } from '../src/kernel/aftermath.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { browseMarket } from '../src/kernel/market.js';
import { World } from '../src/kernel/world.js';

function mk() {
  const w = new World({ seed: 11, secret: 'aftermath' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.terms.lengthSeconds = 30;
  return w;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const npcs = (w: World) => [...w.wizards.values()].filter((x) => x.npc);

/** 走到总攻开始，返回 assault。 */
function startAssault(w: World) {
  for (let n = 0; n < WARWEEK_TERMS; n++) { w.forceEndTerm(); run(w, 0.2); }
  expect(w.warweek.assault).not.toBe(null);
  return w.warweek.assault!;
}

describe('aftermath', () => {
  it('fallen NPC -> tombstone, removed, not respawned next ensure', () => {
    const w = mk();
    ensureNpcs(w, 4);
    expect(npcs(w).length).toBe(4);
    const a = startAssault(w);
    run(w, 200); // three waves
    expect(a.wave).toBe(3);

    // 击倒一个 NPC：总攻中被 stun = 阵亡
    const victim = npcs(w)[0];
    victim.st.stunnedUntil = w.now + 1000;
    victim.hp = 0;
    run(w, 1); // tracking tick records the fallen
    expect(a.fallen.has(victim.id)).toBe(true);

    // 杀光 mobs：结算
    for (const id of [...a.mobs]) w.creatures.delete(id);
    run(w, 1);
    expect(w.warweek.assault).toBe(null);

    // 墓碑立好了
    const tombs = tombstonesOf(w);
    expect(tombs.some((t) => t.name === victim.name)).toBe(true);
    // NPC 已从世界上移除
    expect(npcs(w).some((x) => x.name === victim.name)).toBe(false);
    // 阵亡名单
    expect(isNpcDead(w, victim.name)).toBe(true);
    // 下周目 ensureNpcs 不刷新他
    ensureNpcs(w, 4);
    expect(npcs(w).some((x) => x.name === victim.name)).toBe(false);
    // 但活着的还在
    expect(npcs(w).length).toBe(3);
  });

  it('merchant lost -> shop closed one term; saved -> 20% off', () => {
    const w = mk();
    ensureNpcs(w, 2);
    (w as any).fates.threads.merchant.state = 'lost';
    const a = startAssault(w);
    run(w, 200);
    for (const id of [...a.mobs]) w.creatures.delete(id);
    run(w, 1);
    // 关门 1 学期：结算学期 + 下学期都关门
    expect(isShopClosed(w)).toBe(true);
    expect(() => browseMarket(w, null)).toThrow(/closed/);
    // 下学期（新周目 Day 1）还关着
    w.forceEndTerm(); run(w, 0.2);
    expect(isShopClosed(w)).toBe(true);
    // 再下学期开门
    w.forceEndTerm(); run(w, 0.2);
    expect(isShopClosed(w)).toBe(false);

    // saved -> 八折
    (w as any).fates.threads.merchant.state = 'saved';
    buildAftermath(w, true, []);
    expect(shopPriceMultiplier(w)).toBe(0.8);
    expect(isShopClosed(w)).toBe(false);
  });

  it('settle report includes roster: alive count and fallen names', () => {
    const w = mk();
    ensureNpcs(w, 3);
    const lines: string[] = [];
    const origEmit = w.emit.bind(w);
    (w as any).emit = (t: any, text: string, o: any) => { if (t === 'term') lines.push(text); return origEmit(t, text, o); };
    const a = startAssault(w);
    run(w, 200);
    const victim = npcs(w)[0];
    victim.st.stunnedUntil = w.now + 1000;
    victim.hp = 0;
    run(w, 1);
    for (const id of [...a.mobs]) w.creatures.delete(id);
    run(w, 1);
    const report = lines.find((l) => /assault is broken|assault withdraws/.test(l));
    expect(report).toBeDefined();
    expect(report!).toMatch(/villagers stand/);
    expect(report!).toMatch(/1 fell/);
    expect(report!).toMatch(new RegExp(victim.name.split(' ')[0]));
  });

  it('Day 1 of new cycle broadcasts last week summary', () => {
    const w = mk();
    ensureNpcs(w, 3);
    const lines: string[] = [];
    const origEmit = w.emit.bind(w);
    (w as any).emit = (t: any, text: string, o: any) => { if (t === 'term') lines.push(text); return origEmit(t, text, o); };
    const a = startAssault(w);
    run(w, 200);
    const victim = npcs(w)[0];
    victim.st.stunnedUntil = w.now + 1000;
    victim.hp = 0;
    run(w, 1);
    for (const id of [...a.mobs]) w.creatures.delete(id);
    run(w, 1); // settle (end of Day 7)
    lines.length = 0;
    w.forceEndTerm(); run(w, 0.2); // -> Day 1 of new cycle
    const summary = lines.find((l) => /Last week/.test(l));
    expect(summary).toBeDefined();
    expect(summary!).toMatch(new RegExp(victim.name.split(' ')[0]));
  });

  it('snape saved -> next cycle Day 1 grants XP buff', () => {
    const w = mk();
    ensureNpcs(w, 2);
    const player = w.enroll('TestPlayer', 'Gryffindor').wizard;
    player.connections = 1; // online: Day 1 buffs go to online players
    const xp0 = player.xp;
    (w as any).fates.threads.snape.state = 'saved';
    const a = startAssault(w);
    run(w, 200);
    for (const id of [...a.mobs]) w.creatures.delete(id);
    run(w, 1); // settle -> pendingBuffs set
    w.forceEndTerm(); run(w, 0.2); // Day 1 -> buffs applied
    expect(player.xp).toBeGreaterThan(xp0);
  });
});
