/** Revelio for agents (playtest round 2): the HUD corners a reveal charm lights show up in MCP look, and only then. */
import { describe, expect, it } from 'vitest';
import { tr } from '../client/i18n';
import { OBSTACLES } from '../src/shared/map.js';
import { compass, homenum } from '../src/shared/reveal.js';
import { World } from '../src/kernel/world.js';
import type { Creature } from '../src/kernel/types.js';

function setup() {
  const w = new World({ seed: 9, secret: 'revelio' });
  w.rules.creatures.spawnMultiplier = 0;
  w.creatures.clear();
  const me = w.enroll('Seer').wizard;
  me.connections = 1; me.pos = { x: 150, z: 150 };
  return { w, me };
}
type Look = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('reveal charms over MCP', () => {
  it('a first-year sees only dark corners, and which charm lights each', () => {
    const { w, me } = setup();
    const v = w.look(me.id) as Look;
    for (const k of ['tempus', 'revelio', 'pointMe', 'homenum']) expect(v[k], k).toBeUndefined();
    expect(v.darkCorners.map((d: Look) => [d.section, d.cast, d.fromYear])).toEqual([
      ['tempus', 'Tempus', undefined], ['revelio', 'Revelio', undefined], ['pointMe', 'Point Me', 2], ['homenum', 'Homenum Revelio', 3],
    ]);
  });

  it('casting Tempus says where to look, and look gains the clock and the term', () => {
    const { w, me } = setup();
    const before = w.events.length;
    const r = w.cast(me.id, 'Tempus');
    expect(r.ok, r.error).toBe(true);
    expect(r.notes).toContain('reveal :tempus → look.tempus (the top-right corner: the time, and the term)');
    expect(tr(r.notes.find((n) => n.startsWith('reveal'))!)).toBe('显形 :tempus 点亮了右上角：时间与学期（Agent 看 look.tempus）');
    expect(w.events.slice(before).map((e) => e.text).join('\n')).toMatch(/A new sense settles into the top-right corner.*\(MCP: look\.tempus\)/);
    const v = w.look(me.id) as Look;
    expect(v.tempus).toMatchObject({ clock: expect.stringMatching(/^\d\d:\d\d$/), term: 1, weather: w.rules.world.weather, proclamation: w.rules.proclamation });
    expect(v.tempus.termSecondsLeft).toBe(Math.round(w.term.endsAt - w.now));
    expect(v.darkCorners.map((d: Look) => d.section)).toEqual(['revelio', 'pointMe', 'homenum']);
    // a dry run says the same, and lights nothing
    const { w: w2, me: me2 } = setup();
    expect(w2.simulate(me2.id, '(reveal :revelio)').notes[0]).toMatch(/^reveal :revelio → look\.revelio/);
    expect(me2.ui).toEqual([]);
  });

  it('Revelio: your own measure, as the browser shows it', () => {
    const { w, me } = setup();
    me.galleons = 42; me.reputation = 17.4; me.seals = 1;
    w.reveal(me, 'revelio');
    const v = w.look(me.id) as Look;
    const t = w.title(me);
    expect(v.revelio).toEqual({ year: 1, galleons: 42, reputation: 17, seals: '1/4', title: t.en, nextTitle: { title: t.next!.en, how: t.next!.how } });
  });

  it('Homenum Revelio: the nearest five within 60 m, with a compass bearing (the browser uses the same helper)', () => {
    const { w, me } = setup();
    me.year = 3;
    w.reveal(me, 'homenum');
    const place = (name: string, dx: number, dz: number, extra: (x: typeof me) => void = () => {}) => {
      const x = w.enroll(name).wizard;
      x.connections = 1; x.pos = { x: me.pos.x + dx, z: me.pos.z + dz }; extra(x);
      return x;
    };
    place('North Near', 0, -10);
    place('East Far', 30, 0, (x) => { x.st.stunnedUntil = w.now + 5; });
    place('Out Of Range', 70, 0);
    place('Gone Home', 5, 5, (x) => { x.connections = 0; x.lastMcpAt = -1e9; });
    const v = w.look(me.id) as Look;
    expect(v.homenum.range).toBe(60);
    expect(v.homenum.near.map((n: Look) => [n.name, n.dist, n.bearing, n.degrees, n.stunned])).toEqual([
      ['North Near', 10, 'N', 0, undefined], ['East Far', 30, 'E', 90, true],
    ]);
    const many = Array.from({ length: 8 }, (_, i) => ({ x: i + 1, z: 0 }));
    expect(homenum({ x: 0, z: 0 }, many).map((n) => n.o.x)).toEqual([1, 2, 3, 4, 5]);
    expect([0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI / 4].map(compass)).toEqual(['N', 'E', 'S', 'W', 'NW']);
  });

  it('Point Me: the minimap as a north-up text radar — walls, water, creatures, wizards by house', () => {
    const { w, me } = setup();
    me.year = 2;
    const wall = OBSTACLES.find((o) => o.kind === 'box' && o.style === 'stone' && o.x1 - o.x0 > 4 && o.z1 - o.z0 > 4)!;
    if (wall.kind !== 'box') throw new Error('no wall');
    me.pos = { x: (wall.x0 + wall.x1) / 2, z: (wall.z0 + wall.z1) / 2 + 20 + (wall.z1 - wall.z0) / 2 };
    w.reveal(me, 'point-me');
    const c: Creature = { id: 'c_r', kind: 'pixie', pos: { x: me.pos.x - 40, z: me.pos.z }, home: { x: 0, z: 0 }, hp: 10, maxHp: 10, facing: 0, target: null, attackCd: 1e9, rootedUntil: 1e9, wander: null, lastHitBy: null, damageBy: {}, auras: [], owner: null, until: 0 };
    w.creatures.set(c.id, c);
    const o = w.enroll('Radar Blip').wizard;
    o.connections = 1; o.house = 'Hufflepuff'; o.pos = { x: me.pos.x + 30, z: me.pos.z + 30 };
    const v = w.look(me.id) as Look;
    const rows: string[] = v.pointMe.rows;
    expect(rows).toHaveLength(21);
    for (const r of rows) expect(r).toHaveLength(21);
    expect(rows[10][10]).toBe('@');
    expect(rows[10][6]).toBe('*'); // 40 m west
    expect(rows[13][13]).toBe('H'); // 30 m east, 30 m south
    expect(rows[10 - Math.ceil((20 + (wall.z1 - wall.z0) / 2) / 10)].slice(9, 12)).toContain('#'); // the wall to the north
    expect(v.pointMe.legend).toMatch(/north is up/);
  });
});
