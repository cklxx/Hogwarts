/**
 * Playtest round 2's combat leftovers and the owner's live playtest (docs/PLAYTEST.md): homing spells and housemates,
 * the Duellist achievement, the triggered ward, bounded O.W.L. rankings, NPCs never in office, no glory in bullying.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { allied, spared, strikes } from '../src/kernel/allies.js';
import { duelGrant, newDuelClub } from '../src/kernel/duelclub.js';
import { RANKED_SITS, rewardBase, sitExam, weeklyExams, listExams, GRADE_MULT } from '../src/kernel/exams.js';
import { npcMayFight } from '../src/kernel/npc.js';
import { electMinister, stunPaysRep } from '../src/kernel/progression.js';
import { WARD_CD_S, WARD_MANA, WARD_MAX_S, armWard, lowerWard, wardStatus } from '../src/kernel/ward.js';
import { World } from '../src/kernel/world.js';
import { BULLY_YEAR_GAP, NPC_CALM_R } from '../src/shared/constants.js';
import { SPAWN } from '../src/shared/map.js';
import type { Creature, Wizard } from '../src/kernel/types.js';

function mk(seed = 5) {
  const w = new World({ seed, secret: 'combat-round2' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.rules.combat.pvp = true;
  w.rules.combat.friendlyFire = true;
  w.term.endsAt = 1e12;
  return w;
}
function join(w: World, name: string, house: string, x: number, z: number, year = 3): Wizard {
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

describe('误伤: a homing spell passes through the caster\'s allies', () => {
  it('a bolt aimed at a creature flies through a housemate in its path (friendly fire on) and hits the creature', () => {
    const w = mk();
    const a = join(w, 'Harry', 'Gryffindor', 100, 100), mate = join(w, 'Ron', 'Gryffindor', 100, 106);
    const t = beast(w, 'c_troll', 100, 114);
    const hp = mate.hp, thp = t.hp;
    w.spawnProjectile(a, 'bolt', t.pos, t.id, 20, 'arcane', 0, []);
    run(w, 1.5);
    expect(mate.hp).toBe(hp);
    expect(t.hp).toBeLessThan(thp);
    // a straight shot (aimed at a point) is the caster's risk: friendly fire still applies
    w.spawnProjectile(a, 'bolt', { x: 100, z: 114 }, null, 20, 'arcane', 0, []);
    run(w, 1.5);
    expect(mate.hp).toBeLessThan(hp);
  });

  it('a spell with a target strikes only it (playtest round 3); a straight shot strikes the foe in its path; a housemate aimed at on purpose is struck', () => {
    const w = mk();
    const a = join(w, 'Harry', 'Gryffindor', 100, 100), foe = join(w, 'Draco', 'Slytherin', 100, 106), mate = join(w, 'Seamus', 'Gryffindor', 120, 100);
    const t = beast(w, 'c_troll', 100, 114);
    const hp = foe.hp, thp = t.hp;
    w.spawnProjectile(a, 'bolt', t.pos, t.id, 20, 'arcane', 0, []);
    expect(w.incoming(foe.id)).toEqual([]); // and nobody else is warned of it
    run(w, 1.5);
    expect(foe.hp).toBe(hp);
    expect(t.hp).toBeLessThan(thp);
    w.spawnProjectile(a, 'bolt', { x: 100, z: 114 }, null, 20, 'arcane', 0, []);
    run(w, 1.5);
    expect(foe.hp).toBeLessThan(hp);
    expect(strikes(w, a.id, mate.id, mate.id)).toBe(true);
    expect(strikes(w, a.id, t.id, mate.id)).toBe(false);
    expect(strikes(w, a.id, null, mate.id)).toBe(true);
    // nothing changes without friendly fire: a housemate cannot be harmed at all
    w.rules.combat.friendlyFire = false;
    expect(strikes(w, a.id, mate.id, mate.id)).toBe(false);
  });

  it('incoming() does not warn a housemate of a spell that will pass through them', () => {
    const w = mk();
    const a = join(w, 'Harry', 'Gryffindor', 100, 100), mate = join(w, 'Ron', 'Gryffindor', 100, 106);
    const t = beast(w, 'c_troll', 100, 114);
    w.spawnProjectile(a, 'bolt', t.pos, t.id, 20, 'arcane', 0, []);
    expect(w.incoming(mate.id)).toEqual([]);
  });

  it('chain lightning never leaps to a housemate', () => {
    const w = mk();
    const a = join(w, 'Harry', 'Gryffindor', 100, 100), mate = join(w, 'Ron', 'Gryffindor', 100, 112);
    const t = beast(w, 'c_troll', 100, 110);
    const hp = mate.hp;
    w.chain(a, t.id, 20, 'lightning', 3, []);
    expect(mate.hp).toBe(hp);
    const foe = join(w, 'Draco', 'Slytherin', 102, 110);
    const fhp = foe.hp;
    w.chain(a, t.id, 20, 'lightning', 3, []);
    expect(foe.hp).toBeLessThan(fhp);
  });

  it('duellists of one house are opponents, not allies', () => {
    const w = mk();
    const a = join(w, 'Harry', 'Gryffindor', 100, 100), b = join(w, 'Ron', 'Gryffindor', 100, 106);
    expect(allied(w, a.id, b.id)).toBe(true);
    w.duel.match = { id: 1, a: a.id, b: b.id, sides: [[a.id], [b.id]], out: {}, phase: 'fight', at: 0, npc: false, stats: {} };
    expect(allied(w, a.id, b.id)).toBe(false);
  });
});

describe('决斗者 needs a real opponent', () => {
  it('not a housemate, not an NPC, not someone years below; a wizard of another house counts', () => {
    const w = mk();
    const a = join(w, 'Harry', 'Gryffindor', 100, 100);
    const mate = join(w, 'Ron', 'Gryffindor', 104, 100);
    w.damage(a.id, mate.id, 1e4, 'arcane');
    expect(mate.st.stunnedUntil).toBeGreaterThan(0);
    expect(a.achievements).not.toContain('first_blood');
    const npc = join(w, 'Padma Patil', 'Ravenclaw', 108, 100);
    npc.npc = true;
    w.damage(a.id, npc.id, 1e4, 'arcane');
    expect(a.achievements).not.toContain('first_blood');
    const kid = join(w, 'Dennis', 'Hufflepuff', 112, 100, 1);
    a.year = 1 + BULLY_YEAR_GAP + 1;
    w.damage(a.id, kid.id, 1e4, 'arcane');
    expect(a.achievements).not.toContain('first_blood');
    const foe = join(w, 'Draco', 'Slytherin', 116, 100, a.year);
    w.damage(a.id, foe.id, 1e4, 'arcane');
    expect(a.achievements).toContain('first_blood');
  });
});

describe('触发式铁甲咒 (the ward)', () => {
  it('meets the first hostile bolt with a perfect Protego: sent back, shield up, mana paid on arming', () => {
    const w = mk();
    const a = join(w, 'Hermione', 'Gryffindor', 100, 100), b = join(w, 'Pansy', 'Slytherin', 100, 112);
    const m0 = a.mana, hpA = a.hp, hpB = b.hp;
    expect(armWard(w, a.id, 2)).toMatchObject({ armed: 2, mana: WARD_MANA });
    expect(a.mana).toBe(m0 - WARD_MANA);
    w.spawnProjectile(b, 'bolt', a.pos, a.id, 14, 'arcane', 0, []);
    run(w, 1.5);
    expect(a.hp).toBe(hpA);
    expect(b.hp).toBeLessThan(hpB); // their own spell
    expect(a.stats.reflects).toBe(1);
    expect(a.st.shield).toBeGreaterThan(0); // the Protego it raised stays up
    expect(wardStatus(w, a.id).armed).toBe(0); // spent
    expect(w.events.some((e) => e.to === a.id && /ward/.test(e.text))).toBe(true);
  });

  it('no other spell while it is up; one ward per WARD_CD_S; it runs out; lower drops it', () => {
    const w = mk();
    const a = join(w, 'Hermione', 'Gryffindor', 100, 100);
    armWard(w, a.id);
    expect(w.cast(a.id, 'Stupefy').error).toMatch(/ward is up/);
    expect(() => armWard(w, a.id)).toThrow(/already up/);
    run(w, WARD_MAX_S + 0.1);
    expect(wardStatus(w, a.id).armed).toBe(0);
    expect(() => armWard(w, a.id)).toThrow(/recharging.*retry_after=/);
    run(w, WARD_CD_S - WARD_MAX_S);
    expect(armWard(w, a.id, 1).armed).toBe(1);
    expect(lowerWard(w, a.id).lowered).toBe(true);
    expect(w.cast(a.id, 'Protego').ok).toBe(true);
    run(w, WARD_CD_S);
    a.mana = WARD_MANA - 1;
    expect(() => armWard(w, a.id)).toThrow(/Not enough mana/);
  });

  it('answers only what a Protego answers: a root passes it by and leaves it armed; a timed-out ward does nothing', () => {
    const w = mk();
    const a = join(w, 'Hermione', 'Gryffindor', 100, 100), b = join(w, 'Pansy', 'Slytherin', 100, 108);
    armWard(w, a.id, 3);
    w.spawnProjectile(b, 'root', a.pos, a.id, 0, 'arcane', 2, []);
    run(w, 0.6);
    expect(a.st.rootedUntil).toBeGreaterThan(w.now);
    expect(wardStatus(w, a.id).armed).toBeGreaterThan(0);
    run(w, 3);
    const hp = a.hp;
    w.spawnProjectile(b, 'bolt', a.pos, a.id, 14, 'arcane', 0, []);
    run(w, 1);
    expect(a.hp).toBeLessThan(hp);
  });

  it('over MCP: the ward tool raises it, reports it, refuses a cast while it is up, and lowers it', async () => {
    const w = mk();
    const a = join(w, 'Claude Quill', 'Ravenclaw', 100, 100);
    const server = createMcpServer(w, { wizardId: a.id, baseUrl: 'http://x' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c = new Client({ name: 'test', version: '0' });
    await c.connect(ct);
    const tool = (await c.listTools()).tools.find((t) => t.name === 'ward');
    expect(tool?.description).toMatch(/perfect Protego/);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: !!r.isError, text: r.content[0].text };
    };
    const up = await call('ward', { seconds: 2 });
    expect(up.isError).toBe(false);
    expect(JSON.parse(up.text)).toMatchObject({ armed: 2, mana: WARD_MANA, status: { armed: 2, readyIn: WARD_CD_S } });
    expect((await call('cast', { spell: 'Stupefy' })).text).toMatch(/ward is up/);
    expect(JSON.parse((await call('ward', { op: 'lower' })).text)).toMatchObject({ lowered: true });
    const again = await call('ward');
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/retry_after=/);
    await c.close();
  });

  it('an agent\'s ward yields to the human steering; the browser key sends the same request', () => {
    const w = mk();
    const a = join(w, 'Ron', 'Gryffindor', 100, 100);
    w.setInput(a.id, 0, 1);
    expect(() => armWard(w, a.id, 3, 'agent')).toThrow(/steering/);
    expect(armWard(w, a.id, 3, 'player').armed).toBe(3);
  });
});

describe('限考: only the first RANKED_SITS sittings of an exam each week are ranked', () => {
  it('later sittings are graded, still count for your own best, but leave the leaderboard alone', () => {
    const w = new World({ seed: 7, secret: 'owl-test-secret' });
    w.rules.creatures.spawnMultiplier = 0;
    const a = w.enroll('Hermione Granger').wizard;
    a.connections = 1; a.year = 7; a.pos = { x: 60, z: 60 };
    let ms = Date.UTC(2026, 8, 28, 12);
    for (let k = 0; k < 400 && !weeklyExams('owl-test-secret', ms).some((e) => e.id === 'counting-door'); k++) ms += 7 * 86400e3;
    const ok = '(say (count (creatures 15))) (say (count (creatures 15)))'; // an A: passes, above par
    for (let i = 1; i <= RANKED_SITS; i++) {
      const r = sitExam(w, a.id, 'counting-door', i === 1 ? ok : '(say 1)', ms + i * 61_000);
      expect(r.sitting).toMatchObject({ n: i, ranked: RANKED_SITS, counted: true });
    }
    const board = () => w.owls.boards['counting-door'].find((e) => e.wid === a.id)!;
    const before = board().points;
    const late = sitExam(w, a.id, 'counting-door', '(say (count (creatures 15)))', ms + 20 * 61_000);
    expect(late.grade).toBe('O');
    expect(late.sitting.counted).toBe(false);
    expect(late.sitting.note).toMatch(/Practice/);
    expect(late.best?.grade).toBe('O'); // your own best
    expect(late.rewards).not.toBeNull(); // the better grade still pays its difference
    expect(board().points).toBe(before); // the board does not move
    expect(listExams(w, a.id, ms).exams.find((e) => e.id === 'counting-door')!.sittings).toEqual({ used: RANKED_SITS + 1, ranked: RANKED_SITS });
    // next week the count starts again
    const next = sitExam(w, a.id, 'counting-door', '(say 1)', ms + 7 * 86400e3);
    expect(next.sitting.n).toBe(1);
  });

  it('exam XP is rebalanced against hunting: 20 + 20×year, ×1.5 for an O', () => {
    expect(rewardBase(1).xp * GRADE_MULT.O).toBe(60);
    expect(rewardBase(2).xp * GRADE_MULT.O).toBe(90);
  });
});

describe('魔法部长: NPCs never hold office', () => {
  it('electMinister picks the top player, never an NPC however far ahead; ties go to the earlier', () => {
    expect(electMinister([{ reputation: 500, barred: true }, { reputation: 40, barred: false }], 33)).toBe(1);
    expect(electMinister([{ reputation: 500, barred: true }, { reputation: 20, barred: false }], 33)).toBe(-1);
    expect(electMinister([{ reputation: 40, barred: false }, { reputation: 40, barred: false }], 33)).toBe(0);
    expect(electMinister([], 0)).toBe(-1);
  });

  it('at the end of a term an NPC topping the board does not take office; the leaderboard names who would', () => {
    const w = mk();
    const npc = join(w, 'Hannah Abbott', 'Hufflepuff', 100, 100, 7);
    npc.npc = true;
    npc.reputation = 900;
    const p = join(w, 'Luna', 'Ravenclaw', 120, 100);
    p.reputation = w.ministerBar() + 5;
    expect(w.leaderboard().ministerInLine).toBe('Luna');
    expect(w.leaderboard().ministerRule).toMatch(/NPCs and absentees never hold office/);
    w.term.endsAt = w.now + 0.01;
    run(w, 0.1);
    expect(w.flags.ministerId).toBe(p.id);
    expect(npc.decreeCharges).toBe(0);
  });
});

describe('以大欺小: no glory in bullying, and NPCs pick no fights with the weak', () => {
  it('a knock-out of someone more than BULLY_YEAR_GAP years below pays no reputation', () => {
    expect(stunPaysRep(4, 2)).toBe(true);
    expect(stunPaysRep(5, 2)).toBe(false);
    expect(stunPaysRep(1, 7)).toBe(true); // the underdog always may
    const w = mk();
    const big = join(w, 'Cormac', 'Gryffindor', 100, 100, 7), kid = join(w, 'Dennis', 'Hufflepuff', 104, 100, 2);
    kid.reputation = 50;
    const r0 = big.reputation;
    w.damage(big.id, kid.id, 1e4, 'arcane');
    expect(kid.st.stunnedUntil).toBeGreaterThan(0);
    expect(big.reputation).toBe(r0);
    expect(kid.reputation).toBe(50);
    expect(w.events.at(-1)?.text ?? '').toBeTruthy();
    expect(w.events.some((e) => /5 years below you/.test(e.text) && /以大欺小/.test(e.zh ?? ''))).toBe(true);
  });

  it('the Duelling Club pays no reputation for beating someone years below you (XP still)', () => {
    const l = newDuelClub().ledger;
    expect(duelGrant(l, 'a', 'b', 0, 1, false, true)).toMatchObject({ rep: 0, why: 'bully' });
    expect(duelGrant(l, 'a', 'c', 0, 1, false, false).rep).toBeGreaterThan(0);
  });

  it('an NPC answers an attack only from a fair opponent, and never by the spawn', () => {
    const w = mk();
    const npc = join(w, 'Hannah Abbott', 'Hufflepuff', 100, 100, 7);
    npc.npc = true;
    const kid = join(w, 'Owner', 'Gryffindor', 104, 100, 2);
    expect(npcMayFight(w, npc, kid)).toBe(false); // five years below
    kid.year = 5;
    expect(npcMayFight(w, npc, kid)).toBe(true);
    kid.hp = 10;
    expect(npcMayFight(w, npc, kid)).toBe(false); // hurt
    kid.hp = 200;
    kid.createdAt = w.now;
    expect(npcMayFight(w, npc, kid)).toBe(false); // newcomer ward
    kid.createdAt = -1e6;
    kid.pos = { x: SPAWN.x + NPC_CALM_R - 1, z: SPAWN.z };
    expect(npcMayFight(w, npc, kid)).toBe(false); // by the spawn
  });

  it('an NPC\'s spell hunting a creature passes a player by; its summon never picks a player', () => {
    const w = mk();
    const npc = join(w, 'Gregory Goyle', 'Slytherin', 100, 100, 7);
    npc.npc = true;
    const p = join(w, 'Owner', 'Gryffindor', 100, 106, 2);
    const t = beast(w, 'c_troll', 100, 114);
    const hp = p.hp;
    expect(spared(w, npc.id, p.id)).toBe(true);
    w.spawnProjectile(npc, 'bolt', t.pos, t.id, 20, 'arcane', 0, []);
    run(w, 1.5);
    expect(p.hp).toBe(hp);
    // the NPC's own target is still fair game (a grudge, a duel)
    expect(strikes(w, npc.id, p.id, p.id)).toBe(true);
    w.creatures.delete(t.id);
    const s: Creature = { id: 'c_snake', kind: 'serpent', pos: { x: 100, z: 103 }, home: { x: 100, z: 103 }, hp: 50, maxHp: 50, facing: 0, target: null, attackCd: 0, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: npc.id, until: 1e9 };
    w.creatures.set(s.id, s);
    run(w, 2);
    expect(s.target).toBeNull();
    expect(p.hp).toBe(hp);
  });
});
