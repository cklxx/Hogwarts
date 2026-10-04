/** Regressions from the real one-hour playtest; use the authoritative ticks and copy transaction. */
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { copySpell, marketSpell, publishSpell } from '../src/kernel/market.js';
import { QD_CALL_S, QD_GOAL, QD_PITCH, QD_START_FRAC, qdChase, qdJoin } from '../src/kernel/quidditch.js';
import { spellbookSize } from '../src/kernel/progression.js';
import { canCopyMarketName } from '../client/market.js';

const run = (w: World, seconds: number) => { for (let i = 0; i < seconds * 20; i++) w.tick(); };
function world() {
  const w = new World({ seed: 31, secret: 'combat-regressions' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  return w;
}
function seekerMatch() {
  const w = world(), a = w.enroll('Carrier Seeker', 'Gryffindor').wizard;
  a.connections = 1;
  a.createdAt = -10000;
  a.pos = { ...QD_PITCH };
  const whistle = w.term.startedAt + QD_START_FRAC * (w.term.endsAt - w.term.startedAt);
  w.now = whistle - QD_CALL_S + 1;
  run(w, 0.1);
  qdJoin(w, a.id, 'seeker');
  run(w, whistle - w.now + 0.2);
  const m = w.qd.match!;
  m.bludgers = [];
  m.snitchAt = w.now + 100;
  qdChase(w, a.id, true);
  return { w, a, m };
}
function listing() {
  const w = world(), author = w.enroll('Version Author').wizard, buyer = w.enroll('Version Buyer').wizard;
  author.createdAt = buyer.createdAt = -10000;
  w.forgeSpell(author.id, { name: 'Patch', source: '(heal self 5)' });
  const id = publishSpell(w, author.id, 'Patch', { price: 3 }).published;
  return { w, author, buyer, id };
}

describe('playtest: Quaffle carrier takes priority over seeker duty', () => {
  it('picks up, flies to the opposite hoops, scores, then resumes seeking without changing role', () => {
    const { w, a, m } = seekerMatch();
    run(w, 1.2);
    a.pos = { x: m.quaffle.x, z: m.quaffle.z };
    run(w, 0.05);
    expect(m.quaffle.carrier).toBe(a.id);
    const pickup = { ...a.pos };
    run(w, 0.5);
    expect(a.pos.z).toBeGreaterThan(pickup.z);
    run(w, 5.5);
    expect(m.score).toEqual([QD_GOAL, 0]);
    expect(m.roster[a.id]).toMatchObject({ role: 'seeker', goals: 1, chase: true });
    expect(Math.hypot(a.pos.x - 40, a.pos.z + 168)).toBeLessThan(1); // returned to seeker end
    m.snitchAt = w.now;
    run(w, 0.05);
    expect(m.snitch).not.toBeNull();
    expect(a.goal).toEqual({ x: m.snitch!.x, z: m.snitch!.z });
    run(w, 120);
    expect(m.caughtBy).toBe(a.id); // autonomous seeking still catches the real moving Snitch
    expect(m.phase).toBe('done');
  });

  it('gives manual steering precedence even while the seeker is carrying within shooting range', () => {
    const { w, a, m } = seekerMatch();
    a.pos = { x: 40, z: -132 };
    m.quaffle.carrier = a.id;
    w.setInput(a.id, 1, 0);
    run(w, 0.2);
    expect(m.quaffle.carrier).toBe(a.id);
    expect(m.quaffle.flying).toBe(0);
    expect(a.goal).toBeNull();
    expect(a.pos.x).toBeGreaterThan(40);
    w.setInput(a.id, 0, 0);
    run(w, 4);
    expect(m.score).toEqual([QD_GOAL, 0]);
  });
});

describe('playtest: market versions and copy availability', () => {
  it('suggests a legal name when the published name cleans to empty and uses server cleaning in the UI', () => {
    const { w, author, buyer } = listing();
    w.forgeSpell(author.id, { name: '\u0000', source: '(heal self 5)' });
    const id = publishSpell(w, author.id, '\u0000', { price: 3 }).published;
    w.forgeSpell(buyer.id, { name: 'Patch', source: '(light 1)' });
    const view = marketSpell(w, buyer.id, id);
    expect(view.canCopy).toMatchObject({ ok: true, requiresRename: true, suggestedName: 'Copy v1' });
    expect(canCopyMarketName(view, '\u0000', buyer.spells)).toBe(false);
    expect(canCopyMarketName(view, '\u0000Patch\n', buyer.spells)).toBe(false);
    expect(canCopyMarketName(view, view.canCopy.suggestedName!, buyer.spells)).toBe(true);
    const balance = [author.galleons, buyer.galleons];
    const book = JSON.stringify(buyer.spells);
    expect(() => copySpell(w, buyer.id, id)).toThrow(/1-40/);
    expect([author.galleons, buyer.galleons]).toEqual(balance);
    expect(JSON.stringify(buyer.spells)).toBe(book);
    expect(copySpell(w, buyer.id, id, { name: view.canCopy.suggestedName }).paid).toBe(3);
    expect(buyer.spells.find(s => s.name === 'Copy v1')).toMatchObject({ market: { id, v: 1 } });
    expect(marketSpell(w, buyer.id, id).canCopy.suggestedName).toBe('Copy v1 (2)');
  });

  it('offers v2 when v1 is owned, asks for a free name, preserves v1, and charges only once', () => {
    const { w, author, buyer, id } = listing();
    const initial = [author.galleons, buyer.galleons];
    expect(copySpell(w, buyer.id, id).paid).toBe(3);
    const v1 = buyer.spells.find(s => s.name === 'Patch')!;
    w.forgeSpell(author.id, { name: 'Patch', source: '(heal self 8)' });
    publishSpell(w, author.id, 'Patch');
    const view = marketSpell(w, buyer.id, id);
    expect(view).toMatchObject({ version: 2, canCopy: { ok: true, requiresRename: true, have: { name: 'Patch', v: 1 } } });
    const suggested = view.canCopy.suggestedName!;
    expect(canCopyMarketName(view, suggested, buyer.spells)).toBe(true);
    expect(canCopyMarketName(view, 'pAtCh', buyer.spells)).toBe(false);
    expect(canCopyMarketName(view, '', buyer.spells)).toBe(false);
    expect(() => copySpell(w, buyer.id, id)).toThrow(/another name/);
    expect([author.galleons, buyer.galleons]).toEqual([initial[0] + 3, initial[1] - 3]);
    expect(copySpell(w, buyer.id, id, { name: 'Patch v2' })).not.toHaveProperty('paid');
    expect(v1).toMatchObject({ source: '(heal self 5)', market: { id, v: 1 } });
    expect(buyer.spells.find(s => s.name === 'Patch v2')).toMatchObject({ source: '(heal self 8)', market: { id, v: 2 } });
    expect([author.galleons, buyer.galleons]).toEqual([initial[0] + 3, initial[1] - 3]);
    // Copying the same version under another name was already legal; metadata must say so too.
    expect(marketSpell(w, buyer.id, id, 1).canCopy).toMatchObject({ ok: true, requiresRename: true });
    expect(copySpell(w, buyer.id, id, { v: 1, name: 'Spare v1' })).not.toHaveProperty('paid');
  });

  it('permits the original v2 name when v1 was renamed, and generates a free suggestion when its suffix is taken', () => {
    const { w, author, buyer, id } = listing();
    copySpell(w, buyer.id, id, { name: 'My old patch' });
    w.forgeSpell(author.id, { name: 'Patch', source: '(heal self 8)' });
    publishSpell(w, author.id, 'Patch');
    expect(marketSpell(w, buyer.id, id).canCopy).toMatchObject({ ok: true, have: { name: 'My old patch', v: 1 } });
    expect(marketSpell(w, buyer.id, id).canCopy.requiresRename).toBeUndefined();
    copySpell(w, buyer.id, id);
    w.forgeSpell(buyer.id, { name: 'Patch v2', source: '(light 1)' });
    const view = marketSpell(w, buyer.id, id);
    expect(view.canCopy.suggestedName).toBe('Patch v2 (2)');
    expect(canCopyMarketName(view, view.canCopy.suggestedName!, buyer.spells)).toBe(true);
    expect(copySpell(w, buyer.id, id, { name: view.canCopy.suggestedName })).not.toHaveProperty('paid');
  });

  it.each(['full', 'poor', 'banned', 'primitive'] as const)('reports %s refusal and leaves money/book untouched', reason => {
    const { w, author, buyer, id } = listing();
    if (reason === 'full') for (let i = 0; i < spellbookSize(buyer.year); i++) w.forgeSpell(buyer.id, { name: `Own ${i}`, source: '(light 1)' });
    if (reason === 'poor') buyer.galleons = 2;
    if (reason === 'banned') w.rules.market.banned = [id];
    if (reason === 'primitive') w.rules.magic.bannedPrimitives = ['heal'];
    const state = JSON.stringify([author.galleons, buyer.galleons, buyer.spells, w.market.listings[id].copiers]);
    expect(marketSpell(w, buyer.id, id).canCopy.ok).toBe(false);
    expect(() => copySpell(w, buyer.id, id)).toThrow();
    expect(JSON.stringify([author.galleons, buyer.galleons, buyer.spells, w.market.listings[id].copiers])).toBe(state);
  });
});
