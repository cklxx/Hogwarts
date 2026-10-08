/**
 * The snapshots every browser gets (src/shared/snapwire.ts, src/server/binfanout.ts, geometry src/server/fanout.ts)
 * decode, frame after frame, to the world snapshot cut to the client's area: every field of every entity sent is
 * the snapshot's own, everything within radius − 2·margin is always there and nothing beyond radius + 2·margin +
 * 2 cell diagonals ever is — while the world moves, entities are born and die, viewers walk across cells, frames
 * are missed (resync) and speech bubbles come and go. The edge has hysteresis.
 */
import { describe, expect, it } from 'vitest';
import { ensureNpcs } from '../src/kernel/npc.js';
import { resolve } from '../src/kernel/physics.js';
import { World } from '../src/kernel/world.js';
import { BinFanout, binState } from '../src/server/binfanout.js';
import { AoiGrid } from '../src/server/fanout.js';
import { SnapDecoder, Writer, fxJson } from '../src/shared/snapwire.js';
import { mulberry32, WORLD_HALF } from '../src/shared/map.js';

type Obj = Record<string, unknown>;
const byId = (xs: Obj[], id: string) => new Map(xs.map((e) => [String(e[id]), JSON.parse(JSON.stringify(e))]));

function world(n: number, seed: number) {
  const w = new World({ seed, secret: 's' });
  w.rules.creatures.spawnMultiplier = 3;
  w.rules.terms.lengthSeconds = 86400;
  w.term.endsAt = 86400;
  ensureNpcs(w, 4);
  for (let i = 0; i < 30; i++) (w as unknown as { spawnCreatures(): void }).spawnCreatures();
  const rnd = mulberry32(seed);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const wz = w.enroll(`Wire ${i}`).wizard;
    wz.connections = 1;
    const p = { x: (rnd() * 2 - 1) * (WORLD_HALF - 8), z: (rnd() * 2 - 1) * (WORLD_HALF - 8) };
    resolve(p, 0.5);
    wz.pos = p;
    ids.push(wz.id);
  }
  return { w, ids, rnd };
}

const R = 140, CELL = 16, M = 10;
/** Everything this close is always sent; nothing further than FAR ever is (fanout.ts). */
const NEAR = R - 2 * M, FAR = R + 2 * M + 2 * CELL * Math.SQRT2;
const head = (s: Obj) => { const { w: _w, c: _c, p: _p, fx: _f, ...h } = s; return h; };

/** A decoded frame against the full snapshot (JSON round-tripped): the client standing at `me`. */
function check(got: Obj, full: Obj, me: { handle: string; pos: { x: number; z: number } }) {
  expect(head(got)).toEqual(head(full));
  const mx = Math.round(me.pos.x * 10) / 10, mz = Math.round(me.pos.z * 10) / 10;
  for (const [k, id] of [['w', 'h'], ['c', 'i'], ['p', 'i']] as const) {
    const want = byId(full[k] as Obj[], id), have = byId(got[k] as Obj[], id);
    for (const [key, e] of have) expect(e).toEqual(want.get(key)); // every field the snapshot's own
    for (const [key, e] of want) {
      const d = Math.hypot((e.x as number) - mx, (e.z as number) - mz);
      if (d <= NEAR) expect(have.has(key)).toBe(true);
      if (have.has(key)) expect(d).toBeLessThanOrEqual(FAR + 1e-6);
    }
  }
  const fx = new Set((full.fx as Obj[]).map((e) => fxJson(e)));
  for (const e of got.fx as Obj[]) expect(fx.has(fxJson(e))).toBe(true);
  expect((got.w as Obj[]).some((x) => x.h === me.handle)).toBe(true);
}
const snapOf = (w: World) => JSON.parse(JSON.stringify(w.snapshot())) as Obj;

describe('binary delta snapshots', () => {
  it('varints and zigzag round-trip', () => {
    const wr = new Writer(4);
    const vals = [0, 1, -1, 63, -64, 64, 127, 128, 2400, -2400, 32767, -32768, 1e6, -1e6, 2 ** 40];
    for (const v of vals) wr.zz(v);
    const b = wr.take();
    let i = 0;
    const vu = () => { let v = 0, m = 1, x: number; do { x = b[i++]; v += (x & 0x7f) * m; m *= 0x80; } while (x & 0x80); return v; };
    for (const v of vals) { const u = vu(); expect(u % 2 ? -(u + 1) / 2 : u / 2).toBe(v); }
  });

  it('decode to the snapshot cut to the area, frame after frame, for moving viewers, missed frames and resyncs', () => {
    const { w, ids, rnd } = world(160, 11);
    const bin = new BinFanout(new AoiGrid(R, CELL, M));
    // viewers: some stand, some walk fast across cells, one misses frames now and then
    const viewers = ids.slice(0, 12).map((id, i) => ({ id, dec: new SnapDecoder(), st: binState(), walk: i % 3 !== 0, flaky: i === 5 }));
    for (const v of viewers) if (v.walk) { const a = rnd() * Math.PI * 2; w.setInput(v.id, Math.cos(a), Math.sin(a)); }
    let frames = 0, bytesBin = 0, bytesJson = 0, withMeta = 0;
    for (let t = 0; t < 400; t++) {
      for (let i = 12; i < ids.length; i++) {
        if ((t + i * 7) % 20 === 0) w.cast(ids[i], 'Stupefy', { target: null, aim: { x: w.wizards.get(ids[i])!.pos.x + 12, z: w.wizards.get(ids[i])!.pos.z } });
        if ((t + i * 13) % 60 === 0) { const a = rnd() * Math.PI * 2; w.setInput(ids[i], Math.cos(a), Math.sin(a)); }
      }
      if (t % 97 === 0) for (const v of viewers) if (v.walk) { const a = rnd() * Math.PI * 2; w.setInput(v.id, Math.cos(a) * 2, Math.sin(a) * 2); }
      w.tick();
      if (t % 2) continue; // a broadcast every other tick, as in the server
      const snap = w.snapshot(), full = JSON.parse(JSON.stringify(snap));
      bin.load(snap);
      for (const v of viewers) {
        const me = w.wizards.get(v.id)!;
        if (v.flaky && t % 30 === 0) { v.st.resync = true; continue; } // a skipped frame (main.ts: the socket was backed up)
        const frame = bin.payloadFor(me.pos.x, me.pos.z, v.st);
        const got = v.dec.decode(frame);
        expect(got).not.toBeNull();
        check(got!, full, me);
        frames++; bytesBin += frame.length; bytesJson += JSON.stringify({ t: 'snap', s: got }).length;
        if (frame[1] & 1) withMeta++;
      }
    }
    expect(frames).toBeGreaterThan(2000);
    // the point of it all (2026-10-08: 10x content grew deltas to ~29% of JSON; budget moved to a third, still a >3x win)
    expect(bytesBin * 3).toBeLessThan(bytesJson);
    expect(withMeta).toBeGreaterThan(0);
  }, 60000);

  it('a decoder that lost its state says so instead of guessing, and a resync frame repairs it', () => {
    const { w, ids } = world(40, 3);
    const bin = new BinFanout(new AoiGrid(R, CELL, M));
    const dec = new SnapDecoder(), st = binState();
    const me = w.wizards.get(ids[0])!;
    for (let i = 0; i < 3; i++) { w.tick(); w.tick(); bin.load(w.snapshot()); expect(dec.decode(bin.payloadFor(me.pos.x, me.pos.z, st))).not.toBeNull(); }
    dec.clear();
    w.tick(); w.tick();
    bin.load(w.snapshot());
    expect(dec.decode(bin.payloadFor(me.pos.x, me.pos.z, st))).toBeNull();
    st.resync = true;
    w.tick(); w.tick();
    const full = snapOf(w);
    bin.load(w.snapshot());
    check(dec.decode(bin.payloadFor(me.pos.x, me.pos.z, st))!, full, me);
  });

  it("a first frame carries exactly the cells in reach of the client's own, and is shared within a cell", () => {
    const { w, ids } = world(150, 21);
    const grid = new AoiGrid(R, CELL, M), bin = new BinFanout(grid);
    const snap = w.snapshot(), full = JSON.parse(JSON.stringify(snap));
    bin.load(snap);
    const cellOf = (v: number) => Math.floor(v / CELL);
    for (const id of ids.slice(0, 60)) {
      const me = w.wizards.get(id)!;
      const got = new SnapDecoder().decode(bin.payloadFor(me.pos.x, me.pos.z, binState()))!;
      check(got, full, me);
      const cx = cellOf(Math.round(me.pos.x * 10) / 10), cz = cellOf(Math.round(me.pos.z * 10) / 10);
      for (const [k, key] of [['w', 'h'], ['c', 'i'], ['p', 'i']] as const) {
        const want = (full[k] as Obj[]).filter((e) => grid.inReach(cellOf(e.x as number) - cx, cellOf(e.z as number) - cz)).map((e) => String(e[key])).sort();
        expect((got[k] as Obj[]).map((e) => String(e[key])).sort()).toEqual(want);
      }
      expect(bin.payloadFor(me.pos.x + 0.001, me.pos.z, binState())).toBe(bin.payloadFor(me.pos.x, me.pos.z, binState()));
    }
  });

  it('has hysteresis: going back and forth across a cell edge (by less than 2 x margin) changes nothing', () => {
    // A synthetic world: a viewer at the centre of cell (0, 0) and one wizard on the row z = 8, walking
    // over the edge of the viewer's area.
    const grid = new AoiGrid(R, CELL, M), bin = new BinFanout(grid);
    let edge = 1;
    while (grid.inReach(edge, 0)) edge++; // first column out of reach
    const xb = edge * CELL; // the boundary between the last column in reach and the first out of it
    const wiz = (h: string, x: number, z: number) => ({ h, n: h, ho: 'Gryffindor', x, z, f: 0, hp: 100, m: 100, y: 1, t: '', s: '' });
    const snapAt = (ex: number, vx = 8) => ({ t: 0, hour: 12, night: false, weather: 'clear', term: { n: 1, left: 100 }, w: [wiz('viewer', vx, 8), wiz('walker', ex, 8)], c: [], p: [], fx: [], elder: null, willowCalm: false, look: {} }) as never;
    const dec = new SnapDecoder(), st = binState();
    const sees = (ex: number, vx = 8) => {
      bin.load(snapAt(ex, vx));
      return (dec.decode(bin.payloadFor(vx, 8, st))!.w as Obj[]).some((x) => x.h === 'walker');
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
});
