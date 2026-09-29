/**
 * The performance work must not change behaviour. Each fast path is checked against the slow
 * reference it replaced: the spatial index against full scans, the zone raster against inZone,
 * the derived() cache against a fresh computation, and area-of-interest snapshots against the
 * full snapshot they are cut from.
 */
import { describe, expect, it } from 'vitest';
import { derived, derivedUncached } from '../src/kernel/progression.js';
import { resolve } from '../src/kernel/physics.js';
import { EntityMap, SpatialHash } from '../src/kernel/spatial.js';
import { World } from '../src/kernel/world.js';
import { ZONE_BIT, maskOf, zoneIdsAt, zoneMask } from '../src/kernel/zones.js';
import { SnapshotFanout } from '../src/server/fanout.js';
import { admit, flushInputs, forget, LIMITS, SLOW_DOWN, sendMeIfChanged } from '../src/server/net.js';
import { adoptedSessionId, cookieRealm, loginToken, realmCookie, realmDataPath, realmOf } from '../src/server/realms.js';
import { ZONES, inZone, mulberry32, WORLD_HALF } from '../src/shared/map.js';

type P = { id: string; pos: { x: number; z: number } };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('SpatialHash', () => {
  it('returns every entity within the radius, in insertion order, through moves and removals', () => {
    const rnd = mulberry32(1);
    const h = new SpatialHash<P>(8);
    const all: P[] = [];
    for (let i = 0; i < 400; i++) {
      const e = { id: `e${i}`, pos: { x: (rnd() - 0.5) * 1400, z: (rnd() - 0.5) * 1400 } }; // some beyond the dense window
      all.push(e);
      h.insert(e, i);
    }
    for (let round = 0; round < 50; round++) {
      for (const e of all) if (rnd() < 0.3) { e.pos.x += (rnd() - 0.5) * 40; e.pos.z += (rnd() - 0.5) * 40; h.update(e); }
      if (round % 10 === 0) { const gone = all.splice(Math.floor(rnd() * all.length), 1)[0]; h.remove(gone); }
      expect(h.check()).toBeNull();
      for (let q = 0; q < 20; q++) {
        const p = { x: (rnd() - 0.5) * 1200, z: (rnd() - 0.5) * 1200 }, r = rnd() * 60;
        const got = h.near(p.x, p.z, r)!;
        const want = all.filter((e) => dist(e.pos, p) <= r).map((e) => e.id);
        const gotIds = got.filter((e) => dist(e.pos, p) <= r).map((e) => e.id);
        expect(gotIds).toEqual(want); // superset after the exact test = the same list, same order
        const ords = got.map((e) => Number(e.id.slice(1)));
        expect(ords).toEqual([...ords].sort((a, b) => a - b));
      }
    }
  });

  it('keeps entities with non-finite positions visible to every query, and refuses non-finite queries', () => {
    const h = new SpatialHash<P>(8);
    const lost = { id: 'nan', pos: { x: NaN, z: 0 } };
    h.insert(lost, 1);
    h.insert({ id: 'a', pos: { x: 0, z: 0 } }, 2);
    expect(h.near(300, 300, 1)!.map((e) => e.id)).toEqual(['nan']);
    expect(h.near(NaN, 0, 5)).toBeNull();
    expect(h.near(0, 0, NaN)).toBeNull();
    lost.pos.x = 1;
    h.syncAll();
    expect(h.near(300, 300, 1)).toEqual([]);
    expect(h.check()).toBeNull();
  });

  it('EntityMap mirrors Map membership and order (re-setting a key keeps its place)', () => {
    const m = new EntityMap<P>(8);
    const mk = (id: string, x: number) => ({ id, pos: { x, z: 0 } });
    m.set('a', mk('a', 0)); m.set('b', mk('b', 1)); m.set('c', mk('c', 2));
    m.set('a', mk('a', 3)); // replaced value, same position in the Map
    m.delete('b'); m.set('b', mk('b', 4)); // re-added: now last
    const order = [...m.keys()];
    expect(order).toEqual(['a', 'c', 'b']);
    expect(m.grid.near(0, 0, 10)!.map((e) => e.id)).toEqual(order);
    expect(m.grid.count).toBe(3);
    m.clear();
    expect(m.grid.count).toBe(0);
    expect(m.grid.check()).toBeNull();
  });
});

function busyWorld(seed: number, n: number) {
  const w = new World({ seed, secret: 'perf' });
  w.rules.creatures.spawnMultiplier = 3;
  for (let i = 0; i < 40; i++) (w as unknown as { spawnCreatures(): void }).spawnCreatures();
  const rnd = mulberry32(seed + 9);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = w.enroll(`Perf ${i}`).wizard;
    x.connections = 1;
    const p = { x: (rnd() * 2 - 1) * 120, z: (rnd() * 2 - 1) * 120 };
    resolve(p, 0.5);
    x.pos = p;
    ids.push(x.id);
  }
  return { w, ids, rnd };
}

describe('World spatial queries equal full scans', () => {
  it('around() matches the scan it replaced, including after direct position edits and odd radii', () => {
    const { w, ids, rnd } = busyWorld(11, 120);
    for (let t = 0; t < 60; t++) {
      for (let i = 0; i < ids.length; i++) if ((t + i) % 10 === 0) w.cast(ids[i], rnd() < 0.5 ? 'Stupefy' : 'Incendio', { aim: { x: (rnd() - 0.5) * 200, z: (rnd() - 0.5) * 200 } });
      w.tick();
      // tools and tests move people directly between ticks
      const moved = w.wizards.get(ids[t % ids.length])!;
      moved.pos = { x: (rnd() - 0.5) * 300, z: (rnd() - 0.5) * 300 };
      for (const r of [0, 2.2, 8, 25, 40, 90, NaN, -3]) {
        const p = { x: (rnd() - 0.5) * 260, z: (rnd() - 0.5) * 260 };
        const f = (e: { id: string }) => e.id.charCodeAt(e.id.length - 1) % 3 !== 0;
        expect(w.around(p, r, f, ids[0], 12).map((e) => e.id)).toEqual(w.aroundByScan(p, r, f, ids[0], 12).map((e) => e.id));
      }
      const fp = w.wizards.get(ids[5])!.pos;
      expect(w.fallen(fp, 30).map((x) => x.id)).toEqual([...w.wizards.values()].filter((x) => x.st.stunnedUntil > 0 && !x.st.jailedUntil && w.online(x) && dist(x.pos, fp) <= 30).sort((a, b) => dist(a.pos, fp) - dist(b.pos, fp)).slice(0, 8).map((x) => x.id));
    }
  });

  it('a busy world runs with every spatial query cross-checked against a full scan', () => {
    const was = World.verifySpatial;
    World.verifySpatial = true;
    try {
      const { w, ids, rnd } = busyWorld(12, 80);
      w.rules.world.eternalNight = true; // dementors and inferi too
      for (let t = 0; t < 200; t++) {
        for (let i = 0; i < ids.length; i++) {
          if ((t + i) % 20 === 0) w.cast(ids[i], 'Stupefy', { aim: { x: (rnd() - 0.5) * 200, z: (rnd() - 0.5) * 200 } });
          if ((t + i) % 60 === 0) w.setInput(ids[i], rnd() - 0.5, rnd() - 0.5);
        }
        w.tick();
      }
      expect(w.wizards.grid.check()).toBeNull();
      expect(w.creatures.grid.check()).toBeNull();
    } finally {
      World.verifySpatial = was;
    }
  }, 90_000); // heavy: ~5–7 s on an idle box, several times that under a loaded CI runner
});

describe('zone raster', () => {
  const exactMask = (x: number, z: number) => ZONES.reduce((m, zn, i) => (inZone(zn, x, z) ? m | (1 << i) : m), 0);
  it('answers exactly like inZone, on random points and on every zone boundary', () => {
    const rnd = mulberry32(3);
    const pts: [number, number][] = [];
    for (let i = 0; i < 40000; i++) pts.push([(rnd() - 0.5) * 2 * (WORLD_HALF + 40), (rnd() - 0.5) * 2 * (WORLD_HALF + 260)]);
    for (const zn of ZONES) {
      if (zn.box) for (let i = 0; i <= 200; i++) {
        const [a, b, c, d] = zn.box, t = i / 200;
        pts.push([a, b + (d - b) * t], [c, b + (d - b) * t], [a + (c - a) * t, b], [a + (c - a) * t, d], [a - 1e-9, b + (d - b) * t], [c + 1e-9, b + (d - b) * t]);
      } else for (let i = 0; i < 400; i++) {
        const a = (i / 400) * Math.PI * 2, r = zn.r ?? 0;
        pts.push([zn.x + Math.cos(a) * r, zn.z + Math.sin(a) * r], [zn.x + Math.cos(a) * (r + 1e-9), zn.z + Math.sin(a) * (r - 1e-9)]);
      }
    }
    for (let x = -260; x <= 260; x += 2) for (let z = -260; z <= 460; z += 2) pts.push([x, z]); // raster cell corners
    pts.push([NaN, 0], [0, NaN], [Infinity, 3], [1e9, -1e9]);
    for (const [x, z] of pts) {
      expect(zoneMask(x, z)).toBe(exactMask(x, z));
      expect(zoneIdsAt(x, z)).toEqual(ZONES.filter((zn) => inZone(zn, x, z)).map((zn) => zn.id));
    }
  });

  it('inSafe / onGrounds follow the live rulebook exactly', () => {
    const w = new World({ seed: 1, secret: 'x' });
    const rnd = mulberry32(4);
    const combos = [[], ['great_hall'], ['courtyard', 'hogsmeade'], ['great_hall', 'courtyard', 'hogsmeade', 'greenhouses']] as const;
    for (const safe of combos) {
      w.rules.combat.safeZones = [...safe];
      for (let i = 0; i < 5000; i++) {
        const p = { x: (rnd() - 0.5) * 520, z: (rnd() - 0.5) * 520 };
        const zs = ZONES.filter((zn) => inZone(zn, p.x, p.z)).map((zn) => zn.id as string);
        expect(w.inSafe(p)).toBe(safe.some((s) => zs.includes(s)));
        expect(w.onGrounds(p)).toBe(zs.includes('grounds') && !zs.includes('hogsmeade'));
      }
    }
    expect(maskOf(['great_hall', 'nowhere'])).toBe(ZONE_BIT.great_hall);
  });
});

describe('derived() cache', () => {
  it('always equals a fresh computation through equip, forge, level, curse and decree changes', () => {
    const w = new World({ seed: 2, secret: 'x' });
    const a = w.enroll('Cache Tester').wizard;
    const check = () => expect(derived(a, w.rules)).toEqual(derivedUncached(a, w.rules));
    check();
    a.galleons = 10_000;
    const hat = w.forgeItem(a.id, a.id, { name: 'Thinking Cap', slot: 'amulet', mods: { maxHp: 8, maxMana: 8 } }).item;
    check();
    w.equip(a.id, hat.id); check();
    const robe = w.forgeItem(a.id, a.id, { name: 'Swift Robe', slot: 'robe', mods: { speed: 10 } }).item;
    w.equip(a.id, robe.id); check();
    w.unequip(a.id, 'amulet'); check();
    a.equipped.amulet = hat.id; check(); // direct edits too
    w.destroyItem(a.id, robe.id); check();
    a.year = 4; check();
    w.applyAura(a.id, 'cursed', 30, 1, null); check();
    a.auras = []; check();
    w.rules.magic.manaPerYear = 33; check();
    w.rules = { ...w.rules, magic: { ...w.rules.magic, baseMaxMana: 150 } }; check();
    a.wand = { ...a.wand, core: 'Phoenix feather' }; check();
  });
});

describe('area-of-interest snapshots', () => {
  const R = 140, CELL = 16, M = 10;
  /** Everything this close is always sent; nothing further than FAR ever is (see fanout.ts). */
  const NEAR = R - 2 * M, FAR = R + 2 * M + 2 * CELL * Math.SQRT2;
  const world = () => {
    const { w, ids, rnd } = busyWorld(21, 150);
    for (const id of ids) w.wizards.get(id)!.pos = { x: (rnd() * 2 - 1) * (WORLD_HALF - 5), z: (rnd() * 2 - 1) * (WORLD_HALF - 5) };
    for (let t = 0; t < 30; t++) {
      for (let i = 0; i < ids.length; i++) if ((t + i) % 15 === 0) w.cast(ids[i], 'Stupefy', { aim: { x: 0, z: 0 } });
      w.tick();
    }
    return { w, ids, rnd };
  };
  type E = { x: number; z: number };
  const key = (e: unknown) => JSON.stringify(e);
  /** A client's payload must be the full snapshot with the four arrays cut down, in snapshot order. */
  const checkPayload = (buf: Buffer, full: Record<string, unknown>, me: { handle: string; pos: E }) => {
    const msg = JSON.parse(buf.toString());
    expect(msg.t).toBe('snap');
    expect(Object.keys(msg.s)).toEqual(Object.keys(full));
    for (const k of Object.keys(full)) if (!['w', 'c', 'p', 'fx'].includes(k)) expect(msg.s[k]).toEqual(full[k]);
    const mx = Math.round(me.pos.x * 10) / 10, mz = Math.round(me.pos.z * 10) / 10;
    for (const k of ['w', 'c', 'p', 'fx'] as const) {
      const got = new Set((msg.s[k] as unknown[]).map(key)); // (fx entries can repeat)
      for (const e of full[k] as E[]) {
        const d = Math.hypot(e.x - mx, e.z - mz);
        if (d <= NEAR) expect(got.has(key(e))).toBe(true); // nothing within the guaranteed radius is ever cut
        if (got.has(key(e))) expect(d).toBeLessThanOrEqual(FAR + 1e-6);
      }
    }
    expect(msg.s.w.some((x: { h: string }) => x.h === me.handle)).toBe(true);
    return msg.s as { w: { h: string }[]; c: { i: string }[] };
  };

  it('each client gets exactly the cells in reach (with no history yet: everything within the radius), itself — in the full snapshot schema', () => {
    const { w, ids } = world();
    const snap = w.snapshot();
    const f = new SnapshotFanout(R, CELL, M);
    f.load(snap);
    const cellOf = (v: number) => Math.floor(v / CELL);
    const full = JSON.parse(JSON.stringify(snap));
    for (const id of ids.slice(0, 60)) {
      const me = w.wizards.get(id)!;
      const buf = f.payloadFor(me.pos.x, me.pos.z);
      const s = checkPayload(buf, full, me) as unknown as Record<string, unknown[]>;
      // First broadcast, no history: everything is filed under its own cell.
      const cx = cellOf(Math.round(me.pos.x * 10) / 10), cz = cellOf(Math.round(me.pos.z * 10) / 10);
      for (const k of ['w', 'c', 'p', 'fx'] as const) {
        const want = (full[k] as E[]).filter((e) => f.inReach(cellOf(e.x) - cx, cellOf(e.z) - cz));
        expect(s[k].map(key).sort()).toEqual(want.map(key).sort()); // the same entries (cell by cell, so in another order)
      }
      expect(f.payloadFor(me.pos.x + 0.001, me.pos.z)).toBe(f.payloadFor(me.pos.x, me.pos.z)); // shared within a cell
    }
  });

  it('with hysteresis, whatever the history: everything within radius − 2·margin, nothing beyond radius + 2·margin + 2 cell diagonals', () => {
    const { w, ids, rnd } = world();
    const f = new SnapshotFanout(R, CELL, M);
    const viewers = ids.slice(0, 25).map((id) => ({ id, anchor: { cell: -1 } }));
    for (let b = 0; b < 40; b++) {
      for (const id of ids) { const x = w.wizards.get(id)!; x.pos = { x: x.pos.x + (rnd() - 0.5) * 9, z: x.pos.z + (rnd() - 0.5) * 9 }; }
      w.tick(); w.tick();
      const snap = w.snapshot();
      f.load(snap);
      const full = JSON.parse(JSON.stringify(snap));
      for (const v of viewers) {
        const me = w.wizards.get(v.id)!;
        checkPayload(f.payloadFor(me.pos.x, me.pos.z, v.anchor), full, me);
      }
    }
  });

  it('has hysteresis: going back and forth across a cell edge (by less than 2 x margin) changes nothing', () => {
    // A synthetic world: a viewer at the centre of cell (0, 0) and one wizard on the row z = 8, walking
    // over the edge of the viewer's area.
    const f = new SnapshotFanout(R, CELL, M);
    let edge = 1;
    while (f.inReach(edge, 0)) edge++; // first column out of reach
    const xb = edge * CELL; // the boundary between the last column in reach and the first out of it
    const wiz = (h: string, x: number, z: number) => ({ h, n: h, ho: 'Gryffindor', x, z, f: 0, hp: 100, m: 100, y: 1, t: '', s: '', say: undefined });
    const snapAt = (ex: number, vx = 8) => ({ t: 0, hour: 12, night: false, weather: 'clear', term: { n: 1, left: 100 }, w: [wiz('viewer', vx, 8), wiz('walker', ex, 8)], c: [], p: [], fx: [], elder: null, willowCalm: false, look: {} }) as never;
    const anchor = { cell: -1 };
    const sees = (ex: number, vx = 8) => {
      f.load(snapAt(ex, vx));
      return JSON.parse(f.payloadFor(vx, 8, anchor).toString()).s.w.some((x: { h: string }) => x.h === 'walker');
    };
    expect(sees(xb - 1)).toBe(true);
    // wobbling over the edge, up to just under `margin` past it: still seen
    for (let i = 0; i < 10; i++) { expect(sees(xb + M - 0.5)).toBe(true); expect(sees(xb - 1)).toBe(true); }
    // really leaving (margin past the edge): gone; wobbling back over the edge: still gone
    expect(sees(xb + M + 1)).toBe(false);
    for (let i = 0; i < 10; i++) { expect(sees(xb - M + 0.5)).toBe(false); expect(sees(xb + 1)).toBe(false); }
    // really coming back
    expect(sees(xb - M - 1)).toBe(true);
    // The viewer wobbling across its own cell's edge (x = 16) keeps its anchor, so what it sees stays put.
    const far = xb + CELL - 2; // filed under column `edge`: in reach of the neighbouring cell (1, 0), not of the viewer's own (0, 0)
    expect(sees(far, 15)).toBe(false);
    for (let i = 0; i < 10; i++) { expect(sees(far, CELL + M - 0.5)).toBe(false); expect(sees(far, 15)).toBe(false); }
    expect(sees(far, CELL + M + 1)).toBe(true); // moved on: anchored to (1, 0) now
    for (let i = 0; i < 10; i++) { expect(sees(far, CELL - M + 0.5)).toBe(true); expect(sees(far, CELL + 1)).toBe(true); }
  });

  it('with AOI off every client gets the full snapshot, byte for byte; so do clients without AOI', () => {
    const { w } = world();
    const snap = w.snapshot();
    const off = new SnapshotFanout(0);
    off.load(snap);
    expect(off.payloadFor(0, 0).toString()).toBe(JSON.stringify({ t: 'snap', s: snap }));
    expect(off.payloadFor(200, -200)).toBe(off.payloadFor(0, 0));
    const on = new SnapshotFanout(R, CELL, M);
    on.load(snap);
    expect(on.fullPayload().toString()).toBe(JSON.stringify({ t: 'snap', s: snap }));
    expect(on.fullPayload()).toBe(on.fullPayload()); // serialised once per broadcast
  });
});

describe('socket hygiene', () => {
  const fakeSocket = () => {
    const sent: string[] = [];
    return { sent, ws: { readyState: 1, bufferedAmount: 0, send: (m: string) => sent.push(String(m)) } as never };
  };
  it('rate-limits per kind, both budgets checked before either is spent, and tells a chatterbox why (in English)', () => {
    const { ws, sent } = fakeSocket();
    const handled: unknown[] = [];
    const h = (m: unknown) => handled.push(m);
    for (let i = 0; i < 50; i++) admit(ws, { t: 'chat', text: 'hi' }, h, 1000);
    expect(handled).toHaveLength(LIMITS.chat[1]);
    const errs = sent.filter((s) => s.includes('"err"'));
    expect(errs).toEqual([JSON.stringify({ t: 'err', error: SLOW_DOWN })]);
    expect(SLOW_DOWN).not.toMatch(/[　-鿿]/); // English only; the client translates (i18n.ts)
    expect(admit(ws, { t: 'chat', text: 'later' }, h, 3000)).toBe('handled'); // refilled
    // Dropped chat did not use up the shared budget: a burst of casts right after still goes through.
    let casts = 0;
    for (let i = 0; i < LIMITS.cast[1]; i++) if (admit(ws, { t: 'cast', key: '1' }, h, 3000) === 'handled') casts++;
    expect(casts).toBe(LIMITS.cast[1]);
    // message kinds are looked up as own keys only (no prototype names), unknown kinds share 'other'
    expect(() => admit(ws, { t: 'constructor' }, h, 9000)).not.toThrow();
    expect(() => admit(ws, { t: '__proto__' }, h, 9000)).not.toThrow();
  });

  it('never drops movement input at any frame rate, and input never starves casts', () => {
    for (const hz of [60, 144, 240, 360, 1000]) {
      const { ws, sent } = fakeSocket();
      const handled: { t: string; f?: number }[] = [];
      const h = (m: unknown) => handled.push(m as { t: string; f?: number });
      let casts = 0, inputs = 0, last: { f: number } | null = null, nextCast = 137, tickAt = 0;
      for (let t = 0; t < 10_000; t += 1000 / hz) {
        last = { f: t };
        inputs++;
        admit(ws, { t: 'input', dx: Math.sin(t), dz: Math.cos(t), f: t }, h, t);
        if (t >= nextCast) { casts++; nextCast += 300; admit(ws, { t: 'cast', key: '1' }, h, t); }
        if (t >= tickAt) { tickAt += 50; flushInputs(); } // the world tick
      }
      flushInputs();
      expect(handled.filter((m) => m.t === 'cast')).toHaveLength(casts);
      expect(sent).toEqual([]);
      expect(handled.filter((m) => m.t === 'input').at(-1)!.f).toBe(last!.f); // the latest input always lands
      if (hz <= 240) expect(handled.filter((m) => m.t === 'input')).toHaveLength(inputs); // all applied, one by one
    }
  });

  it('merges inputs over the budget into exactly the state applying each would leave, in socket order', () => {
    const rnd = mulberry32(5);
    for (let round = 0; round < 60; round++) {
      const direct = new World({ seed: 3, secret: 'x' }), limited = new World({ seed: 3, secret: 'x' });
      const a = direct.enroll('Direct Wizard').wizard, b = limited.enroll('Direct Wizard').wizard;
      for (const x of [a, b]) { x.goal = { x: 10, z: 10 }; x.route = [{ x: 5, z: 5 }]; }
      const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
      const state = (t: string, x: typeof a) => [t, { ...x.input }, x.facing, x.goal && { ...x.goal }];
      // What handleClient does with these messages ('goto' sets a walk-to goal, as the controls client's does).
      const apply = (w: World, x: typeof a, log: unknown[] | null) => (m: unknown) => {
        const i = m as { t: string; dx?: unknown; dz?: unknown; f?: unknown };
        if (i.t === 'input') return w.setInput(x.id, finite(i.dx) ? i.dx : 0, finite(i.dz) ? i.dz : 0, finite(i.f) ? i.f : undefined);
        log?.push(state(i.t, x));
        if (i.t === 'goto') { x.goal = { x: 10, z: 10 }; x.route = [{ x: 5, z: 5 }]; }
      };
      const order: unknown[] = [], want: unknown[] = [];
      const { ws } = fakeSocket();
      let now = 1000; // 2 messages per ms: the input budget runs out, then 1 input in 8 is applied at once, the rest merged
      const n = 450 + Math.floor(rnd() * 100);
      for (let i = 0; i < n; i++) {
        now += 0.5;
        const still = rnd() < 0.4;
        const m: Record<string, unknown> = { t: 'input', dx: still ? 0 : rnd() * 2 - 1, dz: still ? 0 : rnd() * 2 - 1 };
        if (rnd() < 0.6) m.f = rnd() * 6 - 3; else if (rnd() < 0.3) m.f = 'x';
        if (rnd() < 0.1) m.dx = 'bad';
        if (round % 2 && i === n - 1) { m.dx = 0; m.dz = 0; } // end on a stop
        apply(direct, a, null)(m);
        admit(ws, m, apply(limited, b, order), now);
        if (rnd() < 0.08) { // another kind of message: the inputs sent before it must have landed first
          const t = rnd() < 0.5 ? 'goto' : 'book', before = state(t, a);
          if (admit(ws, { t }, apply(limited, b, order), now) === 'handled') { want.push(before); apply(direct, a, null)({ t }); }
        }
      }
      flushInputs();
      expect(want.length).toBeGreaterThan(5);
      expect(order).toEqual(want);
      expect(b.input).toEqual(a.input);
      expect(b.facing).toBe(a.facing);
      expect(b.goal).toEqual(a.goal);
      expect(b.route).toEqual(a.route);
    }
  });

  it('never applies an input after its socket closed', () => {
    const { ws } = fakeSocket();
    const handled: unknown[] = [];
    for (let i = 0; i <= LIMITS.input[1]; i++) admit(ws, { t: 'input', dx: 1, dz: 0 }, (m) => handled.push(m), 1000);
    expect(handled).toHaveLength(LIMITS.input[1]); // the last one is pending
    forget(ws);
    flushInputs();
    expect(handled).toHaveLength(LIMITS.input[1]);
  });

  it('sends the private state only when it changed', () => {
    const { ws, sent } = fakeSocket();
    expect(sendMeIfChanged(ws, 'a')).toBe(true);
    expect(sendMeIfChanged(ws, 'a')).toBe(false);
    expect(sendMeIfChanged(ws, 'b')).toBe(true);
    expect(sent).toEqual(['a', 'b']);
  });
});

describe('realms', () => {
  it('route by token / session prefix and keep realm 0 on the original save', () => {
    expect(realmOf('r12.abc')).toBe(12);
    expect(realmOf('abc')).toBeNull();
    expect(realmOf(undefined)).toBeNull();
    expect(realmDataPath('/d/world.json', 0)).toBe('/d/world.json');
    expect(realmDataPath('/d/world.json', 3)).toBe('/d/world.r3.json');
  });
  it('route tokenless browser requests by the realm cookie, and spot MCP login calls', () => {
    expect(realmCookie(3)).toMatch(/^hogwarts_realm=3; Path=\//);
    expect(cookieRealm(realmCookie(3).split(';')[0])).toBe(3);
    expect(cookieRealm('a=1; hogwarts_realm=12; b=2')).toBe(12);
    expect(cookieRealm('hogwarts_realm=x')).toBeNull();
    expect(cookieRealm('xhogwarts_realm=2')).toBeNull();
    expect(cookieRealm(undefined)).toBeNull();
    const call = (name: string, args: unknown) => ({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
    expect(loginToken(call('login', { token: ' r1.abcdefgh ' }))).toBe('r1.abcdefgh');
    expect(loginToken([call('look', {}), call('login', { token: 'r2.abcdefgh' })])).toBe('r2.abcdefgh');
    expect(loginToken(call('whoami', { token: 'r1.abcdefgh' }))).toBeNull();
    expect(loginToken(call('login', { token: 5 }))).toBeNull();
    expect(loginToken(undefined)).toBeNull();
    // Outside REALMS mode no request can choose its MCP session id.
    expect(adoptedSessionId({ headers: { 'x-hogwarts-adopt-session': 'r1.00000000-0000-0000-0000-000000000000' } } as never)).toBeNull();
  });
  it('a realm world mints prefixed tokens; a plain world is unchanged', () => {
    const w = new World({ seed: 1, secret: 'x' });
    expect(w.enroll('Plain Token').wizard.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    w.tokenPrefix = 'r2.';
    expect(w.enroll('Realm Token').wizard.token).toMatch(/^r2\.[A-Za-z0-9_-]{24}$/);
  });
});
