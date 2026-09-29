import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { PERSONAS, ensureNpcs } from '../src/kernel/npc.js';
import { LANDMARKS } from '../src/shared/map.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import type { CreatureKind } from '../src/shared/constants.js';
import * as M from '../src/lore/memes.js';

const CJK = /[一-鿿]/;
function mk(seed = 7) {
  const w = new World({ seed, secret: 'memes' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string, house?: string, opts: { old?: boolean } = { old: true }): Wizard {
  const x = w.enroll(name, house).wizard;
  x.connections = 1;
  x.pos = { x: 60, z: 60 };
  if (opts.old) x.createdAt = w.now - 1000; // not a fresh enrolee
  return x;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) w.tick(0.05); };
function creature(w: World, kind: CreatureKind, x: number, z: number, hp = 200): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}
const at = (x: Wizard, landmark: string) => { const l = LANDMARKS.find((y) => y.id === landmark)!; x.pos = { x: l.x, z: l.z }; };
const mine = (w: World, x: Wizard) => w.events.filter((e) => e.to === x.id);
const since = (w: World, id: number) => w.events.filter((e) => e.id > id);
const lastId = (w: World) => w.events.at(-1)?.id ?? 0;
const revive = (x: Wizard) => { x.st.stunnedUntil = 0; x.hp = 100; };

/** Every Line in the library, with where it came from. */
function allLines(): [string, M.Line][] {
  const out: [string, M.Line][] = [];
  const walk = (v: unknown, path: string) => {
    if (!v || typeof v !== 'object' || v instanceof RegExp) return;
    if ('zh' in v && 'en' in v && typeof (v as M.Line).zh === 'string') { out.push([path, v as M.Line]); return; }
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  for (const [k, v] of Object.entries(M)) if (typeof v === 'object') walk(v, k);
  return out;
}

describe('the meme library', () => {
  it('has 40+ tips and every line is bilingual, Chinese first', () => {
    expect(M.TIPS.length).toBeGreaterThanOrEqual(40);
    const lines = allLines();
    expect(lines.length).toBeGreaterThan(200);
    for (const [where, l] of lines) {
      expect(CJK.test(l.zh), `${where}: ${l.zh}`).toBe(true);
      expect(l.en.trim().length, where).toBeGreaterThan(0);
    }
    // no two tips alike
    expect(new Set(M.TIPS.map((t) => t.zh)).size).toBe(M.TIPS.length);
  });

  it('keeps it kind: no profanity, and templates only use known placeholders', () => {
    const bad = /\b(fuck|shit|damn|bitch|idiot|stupid)\b|傻逼|他妈|操你|屎|滚蛋|废物|蠢货/i;
    for (const [where, l] of allLines()) {
      expect(bad.test(l.zh) || bad.test(l.en), where).toBe(false);
      for (const m of `${l.zh} ${l.en}`.matchAll(/\{(\w+)\}/g)) expect(['v', 'k', 'name', 'NAME', 'house', 'year', 'g', 'n', 'item', 'from'], `${where}: ${m[0]}`).toContain(m[1]);
    }
  });

  it('picks deterministically from world state, and spreads over the pool', () => {
    expect(M.pick(M.TIPS, 1, 2, 'x')).toBe(M.pick(M.TIPS, 1, 2, 'x'));
    expect(M.hash32('a', 1)).toBe(M.hash32('a', 1));
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(M.pick(M.TIPS, i).zh);
    expect(seen.size).toBeGreaterThan(M.TIPS.length * 0.8);
    let heads = 0;
    for (let i = 0; i < 1000; i++) if (M.chance(0.25, i)) heads++;
    expect(heads).toBeGreaterThan(180);
    expect(heads).toBeLessThan(320);
    expect(M.fill({ zh: '{v} 与 {house}', en: '{v} and {house}' }, { v: 'Bob', house: M.houseLine('Ravenclaw') })).toEqual({ zh: 'Bob 与 拉文克劳', en: 'Bob and Ravenclaw' });
  });

  it('Cooldowns: every gate must be ready, and then all are spent together', () => {
    const c = new M.Cooldowns();
    expect(c.take(0, ['a', 10], ['public', 20])).toBe(true);
    expect(c.take(5, ['b', 10], ['public', 20])).toBe(false); // the feed is busy: b stays unspent
    expect(c.take(21, ['b', 10], ['public', 20])).toBe(true);
    expect(c.take(25, ['a', 10])).toBe(true);
    expect(c.take(26, ['a', 10])).toBe(false);
    c.prune(10_000, 60);
    expect(c.size).toBe(0);
  });

  it('recognises the trigger phrases, in English and in Chinese', () => {
    const t = M.chatTriggers;
    expect(t('After all this time?')).toContain('always');
    expect(t('这么多年了？')).toContain('always');
    expect(t("Yer a wizard, Harry")).toContain('yer_wizard');
    expect(t('你是个巫师，哈利')).toContain('yer_wizard');
    expect(t('Did you put your name in the Goblet of Fire?')).toContain('goblet');
    expect(t('THIS IS VERY CALM INDEED')).toContain('caps');
    expect(t('ok')).toEqual([]);
    expect(t('Has anyone seen a toad?')).toContain('trevor');
    expect(t('翻到第394页')).toContain('page394');
    expect(t('Voldemort')).toContain('voldemort');
    expect(t('伏地魔')).toContain('voldemort');
    expect(t('神秘人来了')).toContain('you_know_who');
    expect(t('我的鼻子呢')).toContain('nose');
    expect(t('韦斯莱是我们的王')).toContain('weasley_king');
    expect(t('阿瓦达啃大瓜')).toContain('melon');
    expect(M.pointsAward('Ten points to Ravenclaw!')).toBe('Ravenclaw');
    expect(M.pointsAward('10 points to hufflepuff')).toBe('Hufflepuff');
    expect(M.pointsAward('给斯莱特林加十分！')).toBe('Slytherin');
    expect(M.pointsAward('格兰芬多加 50 分')).toBe('Gryffindor');
    expect(M.pointsAward('points')).toBeNull();
    expect(t('Fifty points from Gryffindor')).toContain('points_from');
    expect(M.fizzleKind('out of gas (400) — the spell collapsed')).toBe('gas');
    expect(M.fizzleKind("unclosed '(' (line 1, col 1)")).toBe('parse');
    expect(M.fizzleKind('not enough mana: needs 40, you have 3')).toBe('mana');
    expect(M.fizzleKind('You are stunned.')).toBeNull();
    expect(M.isHelloWorld('Hello World')).toBe(true);
    expect(M.isHelloWorld('你好，世界！')).toBe(true);
    expect(M.isHelloWorld('Hello Worldwide')).toBe(false);
  });
});

describe('"Ten points to …!"', () => {
  it('awards 10 house points once per wizard per term, never to your own house, not when fresh, capped per house', () => {
    const w = mk();
    const g = join(w, 'Gwen', 'gryffindor');
    const before = w.leaderboard().housePoints.Ravenclaw;
    w.say(g, 'Ten points to Ravenclaw!');
    expect(w.leaderboard().housePoints.Ravenclaw).toBe(before + M.MEME.HOUSE_POINTS);
    expect(w.events.some((e) => !e.to && e.type === 'egg' && /给拉文克劳加十分/.test(e.zh ?? ''))).toBe(true);
    // again this term: refused (after the reply cooldown so the refusal is said)
    w.now += M.MEME.TRIGGER_GAP_S + 1;
    w.say(g, '给赫奇帕奇加十分！');
    expect(w.leaderboard().housePoints.Hufflepuff).toBe(0);
    expect(mine(w, g).at(-1)!.zh).toMatch(/已经加过分/);
    // own house: Dumbledore only
    const r = join(w, 'Rory', 'ravenclaw');
    w.say(r, 'Ten points to Ravenclaw!');
    expect(w.leaderboard().housePoints.Ravenclaw).toBe(before + 10);
    expect(mine(w, r).at(-1)!.zh).toMatch(/邓布利多/);
    // a fresh enrolee: the professors do not know them yet
    const f = join(w, 'Fresh Face', 'slytherin', { old: false });
    w.say(f, 'Ten points to Ravenclaw!');
    expect(w.leaderboard().housePoints.Ravenclaw).toBe(before + 10);
    // NPCs never award
    ensureNpcs(w, 4);
    const goyle = [...w.wizards.values()].find((x) => x.name === 'Gregory Goyle')!;
    goyle.createdAt = -1e9;
    w.say(goyle, 'Ten points to Ravenclaw!');
    expect(w.leaderboard().housePoints.Ravenclaw).toBe(before + 10);
    // the cap: at most HOUSE_POINTS_CAP to one house in a term
    for (let i = 0; i < 15; i++) w.say(join(w, `Helper ${i}`, 'hufflepuff'), 'Ten points to Ravenclaw!');
    expect(w.flags.housePoints.pts.Ravenclaw).toBe(M.MEME.HOUSE_POINTS_CAP);
  });

  it('counts in the House Cup, resets with the term, and survives a restart', () => {
    const w = mk();
    const g = join(w, 'Gwen', 'gryffindor');
    w.say(g, 'Ten points to Hufflepuff!');
    const saved = World.restore(JSON.parse(JSON.stringify(w.serialize())), 7);
    expect(saved.leaderboard().housePoints.Hufflepuff).toBe(10);
    expect(saved.wizards.get(g.id)!.eggs.pointsTerm).toBe(1);
    w.forceEndTerm();
    expect(w.houseCups.at(-1)!.winner).toBe('Hufflepuff'); // nobody earned reputation: the 10 points decide it
    expect(w.leaderboard().housePoints.Hufflepuff).toBe(0);
    w.say(g, 'Ten points to Hufflepuff!'); // a new term: allowed again
    expect(w.leaderboard().housePoints.Hufflepuff).toBe(10);
  });
});

describe('chat triggers with a mechanic', () => {
  it('Trevor is found by the Black Lake (an achievement); elsewhere Neville is still looking', () => {
    const w = mk();
    const a = join(w, 'Nev Fan');
    w.say(a, 'Has anyone seen a toad?');
    expect(mine(w, a).at(-1)!.zh).toMatch(/有人看见一只蟾蜍吗/);
    expect(a.achievements).not.toContain('trevor');
    a.pos = { x: -110, z: 40 };
    w.say(a, '特雷弗！');
    expect(a.achievements).toContain('trevor');
    expect(a.reputation).toBe(5);
    w.say(a, 'Trevor!');
    expect(a.achievements.filter((x) => x === 'trevor')).toHaveLength(1);
  });

  it("Hagrid lets a secret slip, only near his hut, at most every HAGRID_GAP_S", () => {
    const w = mk();
    const a = join(w, 'Visitor');
    const n0 = mine(w, a).length;
    w.say(a, 'Hello Hagrid!');
    expect(mine(w, a).length).toBe(n0); // far from the hut: nothing
    at(a, 'hagrid');
    w.say(a, 'Hello Hagrid!');
    const hint = mine(w, a).at(-1)!;
    expect(hint.type).toBe('egg');
    expect(hint.zh).toMatch(/海格/);
    w.say(a, '海格，再说一个？');
    expect(mine(w, a).length).toBe(n0 + 1);
    w.now += M.MEME.HAGRID_GAP_S + 1;
    w.say(a, '海格，再说一个？');
    expect(mine(w, a).length).toBe(n0 + 2);
    expect(mine(w, a).at(-1)!.zh).not.toBe(hint.zh); // the next secret, not the same one
  });

  it('the Taboo: with the Ministry fallen the name breaks your Protego and draws one Dementor (cooldowned)', () => {
    const w = mk();
    const a = join(w, 'Brave One');
    w.rules.magic.unforgivablesBanned = false; // the Ministry has fallen
    a.st.shield = 25; a.st.shieldUntil = w.now + 10;
    const dementors = () => [...w.creatures.values()].filter((c) => c.kind === 'dementor');
    w.say(a, 'Voldemort!');
    expect(a.st.shield).toBe(0);
    expect(dementors()).toHaveLength(1);
    expect(dementors()[0].target).toBe(a.id);
    expect(dementors()[0].owner).toBeNull();
    expect(w.events.some((e) => !e.to && /搜捕队/.test(e.zh ?? ''))).toBe(true);
    w.say(a, '伏地魔！'); // the Chinese name is the same name
    expect(dementors()).toHaveLength(1); // cooldown
    w.now += M.MEME.TABOO_GAP_S + 1;
    at(a, 'great_hall'); // a safe zone: the shield still breaks, but nothing comes
    w.say(a, 'Voldemort');
    expect(dementors()).toHaveLength(1);
    // the Dementor is an ordinary hostile creature: the world's one hostility rule decides, as ever
    const d = dementors()[0];
    expect(w.canHarm(d.id, a.id)).toBe(false); // (in the Great Hall)
    a.pos = { x: 60, z: 60 };
    expect(w.canHarm(d.id, a.id)).toBe(true);
  });

  it('with the Ministry standing, the name only makes the room gasp (and the feed rate-limits it)', () => {
    const w = mk();
    const a = join(w, 'Brave One');
    const b = join(w, 'Braver One');
    const id = lastId(w);
    w.say(a, 'Voldemort');
    w.say(b, 'Voldemort');
    const gasps = since(w, id).filter((e) => e.type === 'egg' && /倒吸一口凉气/.test(e.zh ?? ''));
    expect(gasps).toHaveLength(1); // one public flavour line per PUBLIC_GAP_S
    expect([...w.creatures.values()]).toHaveLength(0);
  });

  it('Dumbledore asks calmly, in capitals; private replies come once per TRIGGER_GAP_S', () => {
    const w = mk();
    const a = join(w, 'Harriet');
    w.say(a, 'Who put a name in the goblet of fire?');
    const e = w.events.at(-1)!;
    expect(e.zh).toBe('邓布利多平静地问：「Harriet，你把名字投进火焰杯了吗？！」');
    expect(e.text).toContain('HARRIET, DID YOU PUT YOUR NAME IN THE GOBLET OF FIRE?!');
    const n = mine(w, a).length;
    w.say(a, 'After all this time?');
    w.say(a, 'After all this time?');
    expect(mine(w, a).length).toBe(n + 1);
    expect(mine(w, a).at(-1)!.zh).toMatch(/一直如此/);
  });

  it('NPC chatter sets off nothing', () => {
    const w = mk();
    ensureNpcs(w, 1);
    const s = [...w.wizards.values()].find((x) => x.npc)!;
    const id = lastId(w);
    w.say(s, 'Ten points to Ravenclaw! Voldemort! After all this time?', 'npc', '给拉文克劳加十分！');
    expect(since(w, id).map((e) => e.type)).toEqual(['chat']);
    expect(s.say!.text).toBe('给拉文克劳加十分！');
  });
});

describe('knock-outs, fizzles and growing up', () => {
  it('a Malfoy who is stunned invokes his father (at most every 4·STUN_GAP_S per victim); other jokes every STUN_GAP_S', () => {
    const w = mk();
    const a = join(w, 'Alice', 'gryffindor');
    const d = join(w, 'Draco Malfoy');
    const combat = () => w.events.filter((x) => x.type === 'combat').at(-1)!.zh!;
    w.damage(a.id, d.id, 1000, 'arcane');
    expect(combat()).toMatch(/爸爸/);
    expect(d.say?.text).toBe('我爸爸会知道这件事的！');
    revive(d);
    w.now += 4 * M.MEME.STUN_GAP_S;
    w.damage(a.id, d.id, 1000, 'arcane');
    expect(combat()).toMatch(/爸爸/);
    // the world-wide gap: a second fire knock-out right after the first gets no joke
    const b = join(w, 'Bob', 'hufflepuff');
    w.damage(a.id, b.id, 1000, 'fire');
    expect(combat()).toMatch(/芭比Q|外焦里嫩|字面意思/);
    revive(b);
    w.now += 1;
    w.damage(a.id, b.id, 1000, 'fire');
    expect(combat()).toMatch(/击晕了 Bob（重复击晕，不计声望）。$/);
  });

  it('a Malfoy who wins is 凡尔赛; fire is 芭比Q; spiders get Ron\'s line', () => {
    const w = mk();
    const d = join(w, 'Draco Malfoy');
    const b = join(w, 'Bob', 'hufflepuff');
    w.damage(d.id, b.id, 1000, 'arcane');
    expect(w.events.filter((x) => x.type === 'combat').at(-1)!.zh).toMatch(/凡尔赛/);
    revive(b);
    const c = join(w, 'Cat', 'gryffindor');
    w.damage(c.id, b.id, 1000, 'fire');
    expect(w.events.filter((x) => x.type === 'combat').at(-1)!.zh).toMatch(/芭比Q|外焦里嫩|字面意思/);
    revive(b);
    w.now += M.MEME.STUN_GAP_S;
    const spider = creature(w, 'spider', 60, 61);
    w.damage(spider.id, b.id, 1000, 'arcane');
    expect(w.events.filter((x) => x.type === 'combat').at(-1)!.zh).toMatch(/蝴蝶|罗恩/);
    const s = join(w, 'Seamus Finnigan', 'gryffindor');
    w.damage(d.id, s.id, 1000, 'fire');
    expect(w.events.filter((x) => x.type === 'combat').at(-1)!.zh).toMatch(/为什么总是我|连魔杖都还没举起来/);
    expect(s.say?.text).toBe('为什么总是我？！');
  });

  it('a broken Protego says 破防了 over your head (no feed line)', () => {
    const w = mk();
    const a = join(w, 'Alice', 'gryffindor');
    const b = join(w, 'Bob', 'slytherin');
    b.st.shield = 5; b.st.shieldUntil = w.now + 5;
    const id = lastId(w);
    w.damage(a.id, b.id, 10, 'arcane');
    expect(b.say?.text).toMatch(/破防了|护了个寂寞/);
    expect(since(w, id)).toHaveLength(0);
  });

  it('a spell that runs out of gas gets a programmer joke: in the notes always, in the feed once per FIZZLE_GAP_S', () => {
    const w = mk();
    const a = join(w, 'Coder');
    w.forgeSpell(a.id, { name: 'Loop', source: '(repeat 10 (repeat 10 (repeat 10 (+ 1 2))))' });
    const r = w.cast(a.id, 'Loop');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gas/); // the error itself is unchanged (the client translates it)
    expect(r.notes.join()).toMatch(/🪄/);
    expect(mine(w, a).at(-1)!.zh).toMatch(/🪄/);
    const n = mine(w, a).length;
    w.now += 1;
    const r2 = w.cast(a.id, 'Loop');
    expect(r2.notes.join()).toMatch(/🪄/);
    expect(mine(w, a).length).toBe(n);
    expect(w.simulate(a.id, '(bolt target').notes.join()).toMatch(/🪄/);
    expect(() => w.forgeSpell(a.id, { name: 'Oops', source: '(bolt target' })).toThrow(/unclosed[\s\S]*🪄/);
    expect(() => w.forgeSpell(a.id, { name: 'Stupefy', source: '(bolt target 1)' })).toThrow(/祖传代码/);
  });

  it('Hello World: the forge approves, and casting it is an achievement', () => {
    const w = mk();
    const a = join(w, 'First Timer');
    const { notes } = w.forgeSpell(a.id, { name: 'Hello World', source: '(say "Hello, World!")' });
    expect(notes.join()).toMatch(/Hello World/);
    expect(w.cast(a.id, 'Hello World').ok).toBe(true);
    expect(a.achievements).toContain('hello_world');
    expect(w.forgeSpell(a.id, { name: 'rm -rf /', source: '(say "bye")' }).notes.join()).toMatch(/删库跑路/);
  });

  it('level-ups carry a quip for the year; a new title gets a private line', () => {
    const w = mk();
    const a = join(w, 'Grower');
    w.gainXp(a, 30); // Muggle -> Squib
    expect(mine(w, a).at(-1)!.zh).toMatch(/哑炮/);
    w.gainXp(a, 1000);
    const lvl = w.events.filter((e) => e.type === 'level').at(-1)!;
    expect(lvl.zh).toMatch(/升入 \d 年级/);
    const y = a.year;
    expect(M.LEVEL_QUIPS[y].some((q) => lvl.zh!.includes(q.zh))).toBe(true);
  });

  it('item forging: Gringotts has a word, and a sock for yourself does not free Dobby', () => {
    const w = mk();
    const a = join(w, 'Shopper');
    a.galleons = 100;
    const r = w.forgeItem(a.id, a.id, { name: 'Lucky Sock', slot: 'robe', mods: { speed: 2 } });
    expect(r.notes.join()).toMatch(/加隆/);
    expect(r.notes.join()).toMatch(/多比/);
    // a sock posted to someone else (the Weasley Loophole) frees Dobby in the recipient's feed
    const b = join(w, 'Recipient');
    w.forgeItem(a.id, b.id, { name: 'Old Sock', slot: 'robe', mods: { speed: 1 } });
    const parcel = mine(w, b).filter((e) => e.type === 'forge').at(-1)!;
    expect(parcel.zh).toMatch(/多比是自由的小精灵/);
    expect(parcel.zh).toMatch(/Old Sock/);
  });

  it('grinding creatures earns a word about 内卷, at most every GRIND_GAP_S', () => {
    const w = mk();
    const a = join(w, 'Grinder');
    for (let i = 0; i < M.MEME.GRIND_KILLS; i++) w.damage(a.id, creature(w, 'pixie', 60 + i, 62, 1).id, 50, 'ice');
    expect(mine(w, a).filter((e) => /内卷|卷/.test(e.zh ?? ''))).toHaveLength(1);
    for (let i = 0; i < M.MEME.GRIND_KILLS; i++) w.damage(a.id, creature(w, 'pixie', 60 + i, 64, 1).id, 50, 'ice');
    expect(mine(w, a).filter((e) => /内卷|卷/.test(e.zh ?? ''))).toHaveLength(1);
  });
});

describe('the world between the jokes', () => {
  it('walking into a place earns a remark (browser players only, rate-limited); standing still earns 躺平', () => {
    const w = mk();
    const a = join(w, 'Walker');
    a.pos = { x: 0, z: -22 }; // the Courtyard
    run(w, 1.1);
    const n = mine(w, a).length;
    a.pos = { x: 0, z: -56 }; // the Great Hall
    run(w, 1.1);
    expect(mine(w, a).length).toBe(n + 1);
    expect(mine(w, a).at(-1)!.type).toBe('system'); // the feed, not the banner
    a.pos = { x: 0, z: -22 };
    run(w, 1.1);
    expect(mine(w, a).length).toBe(n + 1); // PLACE_GAP_S
    // an agent-only wizard gets no remarks (they would only wake it)
    const bot = join(w, 'Botty');
    bot.connections = 0; bot.lastMcpAt = w.now;
    bot.pos = { x: 0, z: -22 };
    run(w, 1.1);
    const bid = lastId(w);
    bot.pos = { x: 0, z: -56 };
    run(w, 1.1);
    expect(since(w, bid).filter((e) => e.to === bot.id)).toHaveLength(0);
    // 躺平: no feed line, a bubble
    const still = mine(w, a).length;
    run(w, M.MEME.AFK_S + 1);
    expect(a.say?.text).toBeTruthy();
    expect(M.AFK_BUBBLES.map((l) => l.zh)).toContain(a.say!.text);
    expect(mine(w, a).length).toBe(still);
  });

  it('NPCs chatter in both languages, all together at most every NPC_GAP_S', () => {
    const w = mk(5);
    ensureNpcs(w, 4);
    for (const x of w.wizards.values()) x.pos = { x: 60, z: 60 };
    run(w, 600);
    const lines = w.events.filter((e) => e.type === 'chat');
    expect(lines.length).toBeGreaterThan(3);
    for (let i = 1; i < lines.length; i++) expect(lines[i].t - lines[i - 1].t).toBeGreaterThanOrEqual(M.MEME.NPC_GAP_S - 0.1);
    for (const e of lines) expect(CJK.test(e.zh ?? ''), e.zh).toBe(true);
    const known = new Set(PERSONAS.flatMap((p) => p.lines.map((l) => l.en)));
    expect(lines.some((e) => known.has(e.text.slice(e.text.indexOf(': ') + 2)))).toBe(true);
  });

  it('the same seed tells the same jokes', () => {
    const story = () => {
      const w = mk(99);
      ensureNpcs(w, 4);
      const a = join(w, 'Draco Malfoy');
      const b = join(w, 'Bob', 'hufflepuff');
      run(w, 120);
      for (let i = 0; i < 3; i++) { w.damage(b.id, a.id, 1000, 'fire'); revive(a); w.now += 20; }
      w.say(b, 'Voldemort'); w.say(b, 'After all this time?'); w.say(b, '给斯莱特林加十分');
      w.gainXp(b, 600);
      run(w, 60);
      return w.events.map((e) => `${e.type}|${e.zh}`);
    };
    expect(story()).toEqual(story());
  });

  it('enrolment comes with a verse of the Sorting Hat\'s song', () => {
    const w = mk();
    const a = join(w, 'New Kid', 'hufflepuff');
    expect(mine(w, a).some((e) => (e.zh ?? '').includes(M.SORTING_SONG.Hufflepuff.zh))).toBe(true);
  });
});
