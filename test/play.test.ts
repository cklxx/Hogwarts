import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import type { Creature, Wizard } from '../src/kernel/types.js';
import { XP_FOR_YEAR, maxNodes } from '../src/kernel/progression.js';
import { analyze } from '../src/runes/checker.js';
import { SHOP } from '../src/shared/shop.js';
import { buyPreset, UNKNOWN_SHOP_ITEM } from '../src/server/shop.js';
import { LIMITS } from '../src/server/net.js';
import { TEMPLATES, agentAsk, agentPrompt, downAdvice, nextGoal, optionOpen, shopPrice, tplClamp, tplDefaults, type GoalState } from '../client/play.js';
import { tr } from '../client/i18n.js';
import { TITLES } from '../src/lore/titles.js';
import { FIZZLE_QUIPS, FORGE_NAME_EGGS, GRINGOTTS } from '../src/lore/memes.js';
import { FORBIDDEN_LOOKS } from '../src/shared/glamour.js';
import { breakSeal, readSealPage } from '../src/kernel/seals.js';

const CJK = /[一-鿿]/;
function mk() {
  const w = new World({ seed: 5, secret: 'play-secret' });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string, year = 1): Wizard {
  const x = w.enroll(name).wizard;
  x.connections = 1;
  x.pos = { x: 60, z: 60 };
  if (year > 1) { w.gainXp(x, XP_FOR_YEAR[year] - x.xp); x.year = year; }
  return x;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) w.tick(0.05); };
function creature(w: World, kind: Creature['kind'], x: number, z: number, hp = 200): Creature {
  const c: Creature = { id: `c_${kind}_${x}_${z}`, kind, pos: { x, z }, home: { x, z }, hp, maxHp: hp, facing: 0, target: null, attackCd: 99, rootedUntil: 0, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
  w.creatures.set(c.id, c);
  return c;
}

describe('spell templates (从模板开始)', () => {
  const rules = new World().rules;
  const compile = (src: string, year: number, seals = 0) => analyze(src, { year, maxNodes: maxNodes(year, rules), banned: [], seals });

  it('every template compiles at its minimum year with its defaults, and at every year after', () => {
    for (const t of TEMPLATES) {
      for (let y = t.year; y <= 7; y++) {
        const src = t.build(tplDefaults(t, y), y, 0);
        expect(() => compile(src, y), `${t.key} y${y}: ${src}`).not.toThrow();
      }
    }
  });

  it('every open choice compiles at its year, at both ends of every slider', () => {
    for (const t of TEMPLATES) {
      for (let y = t.year; y <= 7; y++) {
        const d = tplDefaults(t, y);
        for (const p of t.params) {
          const vals = p.kind === 'range' ? [p.min, p.max(y, 0)] : p.options.filter((o) => optionOpen(o, y, 0)).map((o) => o.v);
          for (const v of vals) {
            const src = t.build(tplClamp(t, { ...d, [p.id]: v }, y), y, 0);
            expect(() => compile(src, y), `${t.key}.${p.id}=${v} y${y}: ${src}`).not.toThrow();
          }
        }
      }
    }
  });

  it('a locked option is clamped back, and the checker would have refused it', () => {
    const glam = TEMPLATES.find((t) => t.key === 'glamour')!;
    const silk = glam.build({ ...tplDefaults(glam, 1), mat: 'silk' }, 1, 0);
    expect(() => compile(silk, 1)).toThrow(/year 2/);
    expect(tplClamp(glam, { mat: 'silk' }, 1).mat).not.toBe('silk');
    expect(tplClamp(glam, { mat: 'silk' }, 2).mat).toBe('silk');
    const freeze = TEMPLATES.find((t) => t.key === 'freeze')!;
    expect(tplClamp(freeze, { mode: 'root' }, 1).mode).toBe('ice');
    expect(tplClamp(freeze, { power: 999 }, 1).power).toBe(16);
  });

  it('templates run: a mass freeze at year 1 hits up to its count and never plans too many effects', () => {
    const w = mk();
    const a = join(w, 'Template Tess');
    for (let i = 0; i < 7; i++) creature(w, 'pixie', 62 + i * 0.5, 61);
    const freeze = TEMPLATES.find((t) => t.key === 'freeze')!;
    const src = freeze.build(tplClamp(freeze, { n: 99 }, 1), 1, 0);
    const r = w.simulate(a.id, src);
    expect(r.ok, r.error).toBe(true);
    expect(r.effects.length).toBeLessThanOrEqual(4);
    expect(r.mana).toBeGreaterThan(0);
    const bolt = TEMPLATES.find((t) => t.key === 'bolt')!;
    const rb = w.simulate(a.id, bolt.build(tplDefaults(bolt, 1), 1, 0));
    expect(rb.ok && rb.mana > 0).toBe(true);
  });
});

describe('the next goal (下一步)', () => {
  const base: GoalState = { year: 1, xp: 0, xpNext: 150, ui: [], seals: 0, galleons: 20, reputation: 0, decree: false, house: 'Gryffindor', customSpells: 0, items: 0 };
  it('always names exactly one goal, walking the three pillars from Revelio to Minister', () => {
    const y2 = { ...base, ui: ['revelio', 'point-me'], xp: 150, year: 2, items: 1, customSpells: 1 };
    const exams = { passed: 0, of: 6, open: 2 };
    const seq = [
      nextGoal(base)!.key,
      nextGoal({ ...base, ui: ['revelio'] })!.key,
      nextGoal({ ...base, ui: ['revelio'], xp: 60 })!.key,
      nextGoal({ ...base, ui: ['revelio'], xp: 60, items: 1 })!.key,
      nextGoal({ ...base, ui: ['revelio'], xp: 60, items: 1, customSpells: 1 })!.key,
      nextGoal({ ...base, ui: ['revelio'], xp: 150, year: 2, items: 1, customSpells: 1 })!.key,
      nextGoal({ ...y2, exams })!.key,
      nextGoal({ ...y2, exams: { ...exams, passed: 1 }, da: { member: false, eligible: true } })!.key,
      nextGoal({ ...y2, exams: { ...exams, passed: 1 }, da: { member: true, eligible: false } })!.key,
      nextGoal({ ...y2, year: 4, reputation: 120, exams: { ...exams, passed: 1 }, da: { member: false, eligible: false } })!.key,
      nextGoal({ ...y2, year: 4, reputation: 160, darkLord: true, exams: { ...exams, passed: 1 } })!.key,
      nextGoal({ ...y2, year: 4, reputation: 120, decree: true })!.key,
    ];
    expect(seq).toEqual(['revelio', 'pixies', 'shop', 'spell', 'year2', 'pointme', 'owl', 'da', 'cup', 'minister', 'darklord', 'decree']);
    for (const g of [nextGoal(base)!, nextGoal({ ...base, ui: ['revelio'] })!]) { expect(CJK.test(g.text)).toBe(true); expect(CJK.test(g.why)).toBe(true); }
    // the pillars: fight, then write, then politics
    expect([nextGoal({ ...base, ui: ['revelio'] })!.pillar, nextGoal({ ...y2, exams })!.pillar, nextGoal({ ...y2, exams: { ...exams, passed: 1 } })!.pillar]).toEqual([1, 2, 3]);
  });
  it('never sends you to the seals: the Restricted Section is an elective, mentioned only from year 2', () => {
    const states: GoalState[] = [];
    for (const year of [1, 2, 4]) for (const seals of [0, 2]) for (const rep of [0, 120]) for (const custom of [0, 1])
      states.push({ ...base, ui: ['revelio', 'point-me'], year, seals, reputation: rep, customSpells: custom, items: 1, xp: year === 1 ? 200 : 900 });
    for (const st of states) {
      const g = nextGoal(st)!;
      expect(g.act && 'open' in g.act ? g.act.open : '').not.toBe('seals');
      if (st.year < 2) expect(`${g.text}${g.why}`).not.toMatch(/封印|禁书区/);
    }
    const cup = nextGoal({ ...base, ui: ['revelio', 'point-me'], year: 2, items: 1, customSpells: 1, reputation: 10 })!;
    expect(cup.key).toBe('cup');
    expect(cup.why).toContain('选修');
  });
  it('counts pixies from XP', () => {
    expect(nextGoal({ ...base, ui: ['revelio'], xp: 36 })!.text).toContain('3/5');
  });
});

describe('the stun overlay says what hit you', () => {
  it('privateState.down names the creature kind and how many swarmed you', () => {
    const w = mk();
    const a = join(w, 'Swarmed Sam');
    a.createdAt = -1e6; // not a newcomer
    const p1 = creature(w, 'pixie', 61, 60), p2 = creature(w, 'pixie', 60, 61);
    expect(w.privateState(a.id).down).toBeNull();
    for (let i = 0; i < 60 && !a.st.stunnedUntil; i++) w.damage(i % 2 ? p1.id : p2.id, a.id, 10, 'arcane');
    const d = w.privateState(a.id).down!;
    expect(d).toMatchObject({ k: 'pixie', n: 2 });
    const line = downAdvice(d, (s) => (s === 'Protego' ? 3 : s === 'Episkey' ? 4 : 0), 1);
    expect(line).toContain('2 只');
    expect(line).toContain('盔甲护身(3)');
    expect(line).toContain('愈合如初(4)');
    expect(line).toContain('大礼堂');
    run(w, 0.1);
    expect(JSON.stringify(w.privateState(a.id))).not.toContain(p1.id);
  });
  it('a duel names the wizard (public name only), the willow is the willow', () => {
    const w = mk();
    w.rules.combat.pvp = true;
    const a = join(w, 'Duel Dora'), b = join(w, 'Duel Dan');
    a.createdAt = b.createdAt = -1e6;
    if (a.house === b.house) b.house = a.house === 'Gryffindor' ? 'Slytherin' : 'Gryffindor';
    for (let i = 0; i < 40 && !a.st.stunnedUntil; i++) w.damage(b.id, a.id, 20, 'arcane');
    const d = w.privateState(a.id).down;
    expect(d).toMatchObject({ k: 'wizard', name: 'Duel Dan' });
    expect(JSON.stringify(d)).not.toContain(b.id);
    expect(downAdvice(d, () => 0, 1)).toContain('Duel Dan');
    expect(downAdvice({ k: 'willow', n: 0 }, () => 0, 1)).toContain('打人柳');
    expect(downAdvice(null, () => 0, 1)).toContain('大礼堂');
  });
});

describe('asking an agent (🦉 让 Agent 帮我写)', () => {
  it('carries the draft, the error and the slot; the copy block says how to connect', () => {
    const ask = agentAsk({ draft: '(bolt target 14)', error: '✗ bolt: expected place', slot: 5 });
    expect(ask).toContain('5 号栏');
    expect(ask).toContain('(bolt target 14)');
    expect(ask).toContain('报错');
    expect(ask.length).toBeLessThanOrEqual(400);
    const p = agentPrompt({ draft: '(bolt target 14)', error: 'x', slot: 2, code: 'ABC-DEF' });
    expect(p).toContain('配对码 ABC-DEF');
    expect(p).toContain('slot=2');
    expect(agentPrompt({ draft: '', error: '', slot: 1 })).toContain('Esc');
  });
});

describe('the browser shop ({t:"buy"})', () => {
  it('forges a preset into your own trunk through forgeItem, pays its price and wears it', () => {
    const w = mk();
    const a = join(w, 'Shopper Sue');
    const amulet = SHOP.find((s) => s.key === 'amulet')!;
    const before = a.galleons;
    const r = buyPreset(w, a.id, 'amulet');
    expect(r.equipped).toBe(true);
    expect(a.galleons).toBe(before - shopPrice(amulet));
    expect(a.items.map((i) => i.name)).toEqual(['生命护符']);
    expect(w.privateState(a.id).maxHp).toBe(100 + 20);
    expect(tr(r.notes[0])).toMatch(CJK);
  });
  it('refuses what the shop does not sell and what you cannot afford', () => {
    const w = mk();
    const a = join(w, 'Broke Bob');
    expect(() => buyPreset(w, a.id, 'elder-wand')).toThrow(UNKNOWN_SHOP_ITEM);
    a.galleons = 3;
    expect(() => buyPreset(w, a.id, 'broom')).toThrow(/Galleons/);
    expect(a.items.length).toBe(0);
    expect(tr(UNKNOWN_SHOP_ITEM)).toMatch(CJK);
  });
  it('every preset fits a first-year budget; the buy message has its own rate limit', () => {
    const w = mk();
    for (const s of SHOP) {
      const a = join(w, `Buyer ${s.key}`);
      a.galleons = 999;
      expect(() => buyPreset(w, a.id, s.key, 'en')).not.toThrow();
      expect(a.items[0].name).toBe(s.en);
    }
    expect(LIMITS.buy).toBeDefined();
  });
});

describe('every English message a browser player meets has a Chinese translation', () => {
  const w = mk();
  const a = join(w, 'Error Eve');
  const errOf = (f: () => unknown) => { try { f(); } catch (e) { return (e as Error).message; } throw new Error('did not throw'); };
  const simErr = (src: string, wiz = a) => { const r = w.simulate(wiz.id, src); return r.error ?? ''; };
  const simNotes = (src: string) => w.simulate(a.id, src).notes;
  it('Runes checker, interpreter, glamour, spellbook, enrolment, titles and the new kernel refusals', () => {
    const rules = w.rules;
    const check = (src: string, year = 1) => errOf(() => analyze(src, { year, maxNodes: maxNodes(year, rules) }));
    const msgs = [
      check('(bolt (or target aim) 14'),
      check('(bolt target 14))'),
      check('(foo 1)'),
      check('(let x 1) (bolt y 3)'),
      check('(bolt)'),
      check('()'),
      check(''),
      check('"abc'),
      check('(summon :serpent 20)'),
      check('(glamour :material :silk)'),
      check('(glamour :material :flame)', 4),
      check('(glamour :material :tweed)'),
      check('(glamour :robe "nope")'),
      check('(glamour :invisibility :x)'),
      check(`(do ${Array.from({ length: 30 }, () => '(heal self 1)').join(' ')})`),
      simErr('(bolt target 14)'),
      simErr('(heal target 5)'),
      simErr('(bolt aim 10 :plasma)'),
      simErr(`(repeat 10 (repeat 10 (repeat 10 (+ 1 1))))`),
      simErr('(each e (enemies 30) (bolt e 5)) (bolt aim 1) (bolt aim 1) (bolt aim 1) (bolt aim 1) (bolt aim 1)'),
      (w.forgeSpell(a.id, { name: 'Nothing Much', source: '(when (> 0 1) (bolt aim 5))' }), w.cast(a.id, 'Nothing Much').error ?? ''),
      w.cast(a.id, 'Nothing Much').error ?? '',
      w.cast(a.id, 'Nope').error ?? '',
      ...simNotes('(bolt aim 99)'),
      ...simNotes('(when (> 0 1) (bolt aim 5))'),
      errOf(() => w.enroll('x')),
      errOf(() => w.enroll('Error Eve')),
      errOf(() => w.forgeSpell(a.id, { name: 'Stupefy', source: '(bolt aim 5)' })),
      errOf(() => w.forgeSpell(a.id, { name: '', source: '(bolt aim 5)' })),
      errOf(() => w.forgeSpell(a.id, { name: 'Broken', source: '(bolt aim 5' })),
      errOf(() => w.unlearn(a.id, 'Stupefy')),
      errOf(() => w.unlearn(a.id, 'Nope')),
      errOf(() => w.setHotbar(a.id, ['Nope'])),
      errOf(() => w.forgeItem(a.id, a.id, { name: 'Invisibility Cloak', slot: 'robe', mods: {} })),
      errOf(() => w.forgeItem(a.id, a.id, { name: 'Time-Turner', slot: 'trinket', mods: {} })),
      errOf(() => w.forgeItem(a.id, a.id, { name: 'Elder Wand', slot: 'wand', mods: {} })),
      errOf(() => w.forgeItem(a.id, a.id, { name: 'Big', slot: 'amulet', mods: { maxHp: 60 } })),
      errOf(() => w.forgeItem(a.id, a.id, { name: 'Odd', slot: 'hat', mods: {} })),
      errOf(() => w.forgeItem(a.id, a.id, { name: 'Odd', slot: 'amulet', mods: { luck: 3 } as never })),
      errOf(() => readSealPage(w, a.id, 9)),
      errOf(() => breakSeal(w, a.id, 2, [])),
      'bolt power 40 clamped to your cap 16',
      'The spell found nothing to act on (no target in range?). No mana spent.',
      ':silk is year-2 transfiguration (you are year 1) — 八眼巨蛛丝：绒光加一层清漆般的光泽是 2 年级的变形术',
      ':flame lies behind seal 1 of the Restricted Section; you have broken 0 — 需要禁书区第 1 道封印',
      'glamour :on someone else is year-2 magic (a Colour-Change jinx)',
      ...TITLES.map((t) => t.how),
    ];
    for (const m of msgs) {
      expect(m, `message #${msgs.indexOf(m)}`).toBeTruthy();
      for (const line of m.split('\n')) {
        const zh = tr(line);
        expect(CJK.test(zh), `${line} → ${zh}`).toBe(true);
        // no untranslated English sentence left behind (a few Runes words and names are fine)
        expect(/[A-Za-z]{3,} [a-z]{3,} [a-z]{3,}/.test(zh.replace(/\([^)]*\)/g, '').replace(/"[^"]*"/g, '').replace(/:[\w -]+/g, '')), `${line} → ${zh}`).toBe(false);
      }
    }
  });
  it('a line the kernel already wrote in both languages keeps only its Chinese half', () => {
    const lines = [...Object.values(FIZZLE_QUIPS).flat(), ...FORGE_NAME_EGGS.map((e) => e.line), ...GRINGOTTS];
    for (const l of lines) expect(tr(`${l.zh} ${l.en}`), l.en).toBe(l.zh);
    for (const f of FORBIDDEN_LOOKS) expect(tr(`${f.en} ${f.zh} (line 1, col 3)`)).toBe(`${f.zh}（第 1 行，第 3 列）`);
  });
  it('the key errors carry their hints', () => {
    expect(tr("unclosed '(' (line 1, col 1)")).toMatch(/第 1 行/);
    expect(tr("unknown name 'y' (line 1, col 1)")).toMatch(/魔法书/);
    expect(tr('bolt at: expected place, got nil from target (line 1, col 7)')).toContain('(or target aim)');
    expect(tr('bolt power 40 clamped to your cap 16')).toContain('16');
    expect(tr('Earn 30 XP.')).toContain('30');
  });
});
