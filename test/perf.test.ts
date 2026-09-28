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
import { allowMessage, LIMITS, sendMeIfChanged } from '../src/server/net.js';
import { realmDataPath, realmOf } from '../src/server/realms.js';
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
  });
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
  const R = 140;
  const world = () => {
    const { w, ids, rnd } = busyWorld(21, 150);
    for (const id of ids) w.wizards.get(id)!.pos = { x: (rnd() * 2 - 1) * (WORLD_HALF - 5), z: (rnd() * 2 - 1) * (WORLD_HALF - 5) };
    for (let t = 0; t < 30; t++) {
      for (let i = 0; i < ids.length; i++) if ((t + i) % 15 === 0) w.cast(ids[i], 'Stupefy', { aim: { x: 0, z: 0 } });
      w.tick();
    }
    return { w, ids };
  };

  it('each client gets exactly the entries in reach, everything within the radius, itself — in the full snapshot schema', () => {
    const { w, ids } = world();
    const snap = w.snapshot();
    const f = new SnapshotFanout(R, 16);
    f.load(snap);
    const cellOf = (v: number) => Math.floor(v / 16);
    const full = JSON.parse(JSON.stringify(snap));
    for (const id of ids.slice(0, 60)) {
      const me = w.wizards.get(id)!;
      const buf = f.payloadFor(me.pos.x, me.pos.z);
      const msg = JSON.parse(buf.toString());
      expect(msg.t).toBe('snap');
      expect(Object.keys(msg.s)).toEqual(Object.keys(full));
      for (const k of Object.keys(full)) if (!['w', 'c', 'p', 'fx'].includes(k)) expect(msg.s[k]).toEqual(full[k]);
      const mx = Math.round(me.pos.x * 10) / 10, mz = Math.round(me.pos.z * 10) / 10;
      const cx = cellOf(mx), cz = cellOf(mz);
      for (const k of ['w', 'c', 'p', 'fx'] as const) {
        const want = (full[k] as { x: number; z: number }[]).filter((e) => f.inReach(cellOf(e.x) - cx, cellOf(e.z) - cz));
        const key = (e: unknown) => JSON.stringify(e);
        expect(new Set((msg.s[k] as unknown[]).map(key))).toEqual(new Set(want.map(key)));
        expect(msg.s[k]).toHaveLength(want.length);
        for (const e of full[k] as { x: number; z: number }[]) {
          const d = Math.hypot(e.x - mx, e.z - mz);
          if (d <= R) expect(want).toContain(e); // nothing within the radius is ever cut
          if (want.includes(e)) expect(d).toBeLessThanOrEqual(R + 16 * Math.SQRT2 * 2 + 1e-6);
        }
      }
      expect(msg.s.w.some((x: { h: string }) => x.h === me.handle)).toBe(true);
      expect(f.payloadFor(me.pos.x + 0.001, me.pos.z)).toBe(f.payloadFor(me.pos.x, me.pos.z)); // shared within a cell
    }
  });

  it('with AOI off every client gets the full snapshot, byte for byte', () => {
    const { w } = world();
    const snap = w.snapshot();
    const f = new SnapshotFanout(0);
    f.load(snap);
    expect(f.payloadFor(0, 0).toString()).toBe(JSON.stringify({ t: 'snap', s: snap }));
    expect(f.payloadFor(200, -200)).toBe(f.payloadFor(0, 0));
  });
});

describe('socket hygiene', () => {
  const fakeSocket = () => { const sent: string[] = []; return { sent, ws: { readyState: 1, bufferedAmount: 0, send: (m: string) => sent.push(String(m)) } as never } };
  it('rate-limits per kind and tells a chatterbox why', () => {
    const { ws, sent } = fakeSocket();
    let ok = 0;
    for (let i = 0; i < 50; i++) if (allowMessage(ws, { t: 'chat', text: 'hi' }, 1000)) ok++;
    expect(ok).toBe(LIMITS.chat[1]);
    expect(sent.filter((s) => s.includes('"err"'))).toHaveLength(1);
    expect(allowMessage(ws, { t: 'chat', text: 'later' }, 3000)).toBe(true); // refilled
    let inputs = 0;
    for (let i = 0; i < 100; i++) if (allowMessage(ws, { t: 'input', dx: 1, dz: 0 }, 5000)) inputs++;
    expect(inputs).toBe(LIMITS.input[1]);
    // message kinds are looked up as own keys only (no prototype names), unknown kinds share 'other'
    expect(() => allowMessage(ws, { t: 'constructor' }, 9000)).not.toThrow();
    expect(() => allowMessage(ws, { t: '__proto__' }, 9000)).not.toThrow();
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
  it('a realm world mints prefixed tokens; a plain world is unchanged', () => {
    const w = new World({ seed: 1, secret: 'x' });
    expect(w.enroll('Plain Token').wizard.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    w.tokenPrefix = 'r2.';
    expect(w.enroll('Realm Token').wizard.token).toMatch(/^r2\.[A-Za-z0-9_-]{24}$/);
  });
});

