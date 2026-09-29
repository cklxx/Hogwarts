/**
 * Sprint 1's HUD, pure parts (client/funlogic.ts): the house strip, the event slip, the curfew hint, the album and the
 * reveal queue — and that what they read is what the kernel sends (the snapshot's `cup` and `ev`, privateState().fun).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { World } from '../src/kernel/world.js';
import { startEvent } from '../src/kernel/wheel.js';
import { grantCard } from '../src/kernel/cards.js';
import { CARD_BY_ID, CARDS } from '../src/lore/cards.js';
import { EVENT_IDS } from '../src/shared/constants.js';
import {
  EVENT_INK, RevealQueue, albumModel, bossFrac, countdown, curfewHint, evTarget, finalMinute, inCastle, monogram, objective, resultLine, stripModel,
  type CupSnap, type EvSnap, type FunMe,
} from '../client/funlogic.js';
import { CASTLE } from '../src/kernel/wheel.js';

const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../client/panels/fun.css', import.meta.url), 'utf8');

function mk() {
  const w = new World({ seed: 9, secret: 'ui' });
  w.rules.creatures.spawnMultiplier = 0;
  const a = w.enroll('Ginny Weasley', 'Gryffindor').wizard;
  a.connections = 1; a.createdAt = -1000;
  return { w, a };
}

describe('the house strip', () => {
  it('reads the snapshot: four houses in order, the leader crowned, your house marked, the final minute', () => {
    const { w, a } = mk();
    w.cupGain(a, 40, 'creatures');
    const cup = w.snapshot().cup as CupSnap;
    const m = stripModel(cup, 'Gryffindor');
    expect(m.map((x) => x.house)).toEqual(['Gryffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin']);
    expect(m[0]).toMatchObject({ pts: 40, lead: true, mine: true, share: 1 });
    expect(m[1]).toMatchObject({ pts: 0, lead: false, share: 0 });
    expect(finalMinute(cup)).toBe(false);
    w.now = w.term.endsAt - 30;
    expect(finalMinute(w.snapshot().cup as CupSnap)).toBe(true);
    expect(countdown(754)).toBe('12:34');
    expect(countdown(-2)).toBe('0:00');
    // nobody scored: nobody leads
    expect(stripModel({ n: 1, left: 900, pts: [0, 0, 0, 0], fm: 0, ch: [] }).some((x) => x.lead)).toBe(false);
  });
});

describe('the event slip', () => {
  it('has ink and an objective for every event, and points the compass where the kernel says', () => {
    const { w } = mk();
    w.rules.world.eternalNight = true;
    for (const id of EVENT_IDS) {
      expect(EVENT_INK[id].icon.length).toBeGreaterThan(0);
      expect(html).toContain(`id="i-${EVENT_INK[id].icon}"`);
      const e = startEvent(w, id)!;
      w.tick(0.05);
      const ev = w.snapshot().ev as EvSnap;
      expect(ev.id).toBe(id);
      expect(objective(ev).length).toBeGreaterThan(8);
      expect(evTarget(ev)).toBeTruthy();
      if (id === 'snitch') expect(evTarget(ev)).toEqual(ev.s);
      w.wheel.active = null; // (next one)
      void e;
    }
  });
  it('the troll bar, the result line', () => {
    expect(bossFrac({ id: 'troll', hp: 250, m: 1000 })).toBe(0.25);
    expect(bossFrac({ id: 'troll', hp: -3, m: 1000 })).toBe(0);
    expect(resultLine({ id: 'snitch', st: 'won', hero: 'Cho' })).toMatch(/Cho/);
    expect(resultLine({ id: 'troll', st: 'lost' })).toMatch(/结束/);
  });
  it('curfew: the hint knows the castle the kernel knows, Filch\'s cone and Mrs Norris\' nose', () => {
    expect(CASTLE).toEqual({ x0: -64, z0: -73, x1: 64, z1: -4 });
    expect(inCastle({ x: 0, z: -22 })).toBe(true);
    expect(inCastle({ x: 0, z: 30 })).toBe(false);
    const ev: EvSnap = { id: 'curfew', st: 'on', p: [{ k: 'filch', x: 0, z: -20, f: 0 }, { k: 'norris', x: 30, z: -50, f: 0 }] };
    expect(curfewHint(ev, { x: 0, z: -26 })).toMatchObject({ k: 'filch', inCone: true, inside: true, danger: true });
    expect(curfewHint(ev, { x: 0, z: -12 })).toMatchObject({ k: 'filch', inCone: false });
    expect(curfewHint(ev, { x: 31, z: -52 })).toMatchObject({ k: 'norris', inCone: true });
    expect(curfewHint({ id: 'troll', st: 'on' }, { x: 0, z: 0 })).toBeNull();
  });
});

describe('the album and the reveal', () => {
  it('groups every card once, silhouettes for the missing, and reads privateState().fun', () => {
    const { w, a } = mk();
    grantCard(w, a, CARD_BY_ID.nick, { zh: '测', en: 't' });
    grantCard(w, a, CARD_BY_ID.merlin, { zh: '测', en: 't' });
    const fun = w.privateState(a.id).fun as FunMe;
    expect(fun.cards).toEqual(['nick', 'merlin']);
    expect(fun.total).toBe(CARDS.length);
    const m = albumModel(fun.cards);
    expect(m.owned).toBe(2);
    expect(m.groups.reduce((s, g) => s + g.cards.length, 0)).toBe(CARDS.length);
    expect(m.groups.find((g) => g.id === 'ghosts')!.have).toBe(1);
    expect(albumModel(fun.cards, 'owned').groups.reduce((s, g) => s + g.cards.length, 0)).toBe(2);
    expect(albumModel(fun.cards, 'missing').groups.reduce((s, g) => s + g.cards.length, 0)).toBe(CARDS.length - 2);
    expect(monogram(CARD_BY_ID.dumbledore)).toBe('阿');
  });
  it('the reveal queue flips each card event once, in order', () => {
    const q = new RevealQueue();
    expect(q.push(5, 'nick', false)).toBe(true);
    expect(q.push(5, 'nick', false)).toBe(false);
    q.push(6, 'merlin', true);
    expect(q.next()).toEqual({ id: 'nick', dup: false });
    expect(q.next()).toEqual({ id: 'merlin', dup: true });
    expect(q.next()).toBeNull();
  });
  it('respects prefers-reduced-motion and keeps text readable (≥ 15 px at scale 1)', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*cr-flip \{ animation: none/);
    for (const m of css.matchAll(/font-size: calc\(([\d.]+)px \* var\(--t\)\)/g)) expect(Number(m[1]), m[0]).toBeGreaterThanOrEqual(14.5);
    expect(html).toContain('panels/fun.css');
    expect(html).toContain('<kbd>C</kbd>');
  });
});
