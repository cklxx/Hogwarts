/**
 * Binary delta snapshots (src/shared/snapwire.ts, src/server/binfanout.ts) must decode to exactly what the
 * JSON area-of-interest snapshot carries, frame after frame: while the world moves, entities are born and
 * die, viewers walk across cells, frames are missed (resync) and speech bubbles come and go.
 */
import { describe, expect, it } from 'vitest';
import { ensureNpcs } from '../src/kernel/npc.js';
import { resolve } from '../src/kernel/physics.js';
import { World } from '../src/kernel/world.js';
import { BinFanout, binState } from '../src/server/binfanout.js';
import { SnapshotFanout } from '../src/server/fanout.js';
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

function compare(bin: Obj, json: Obj) {
  for (const [k, id] of [['w', 'h'], ['c', 'i'], ['p', 'i']] as const) {
    expect(byId(bin[k] as Obj[], id)).toEqual(byId(json[k] as Obj[], id));
  }
  const fx = (xs: Obj[]) => xs.map((e) => fxJson(e)).sort();
  expect(fx(bin.fx as Obj[])).toEqual(fx(json.fx as Obj[]));
  const head = (s: Obj) => { const { w: _w, c: _c, p: _p, fx: _f, ...h } = s; return h; };
  expect(head(bin)).toEqual(head(json));
}

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

  it('decode to the JSON area-of-interest snapshot, frame after frame, for moving viewers, missed frames and resyncs', () => {
    const { w, ids, rnd } = world(160, 11);
    const geo = new SnapshotFanout(140, 16, 10);
    const bin = new BinFanout(geo);
    // viewers: some stand, some walk fast across cells, one misses frames now and then
    const viewers = ids.slice(0, 12).map((id, i) => ({ id, dec: new SnapDecoder(), st: binState(), anchor: { cell: -1 }, walk: i % 3 !== 0, flaky: i === 5 }));
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
      const snap = w.snapshot();
      geo.load(snap);
      bin.load(snap);
      for (const v of viewers) {
        const me = w.wizards.get(v.id)!;
        if (v.flaky && t % 30 === 0) { v.st.resync = true; continue; } // a skipped frame (main.ts: the socket was backed up)
        const json = JSON.parse(geo.payloadFor(me.pos.x, me.pos.z, v.anchor).toString()).s;
        const frame = bin.payloadFor(me.pos.x, me.pos.z, v.st);
        const got = v.dec.decode(frame);
        expect(got).not.toBeNull();
        compare(got!, json);
        expect(v.st.anchor).toBe(v.anchor.cell);
        frames++; bytesBin += frame.length; bytesJson += JSON.stringify({ t: 'snap', s: json }).length;
        if (frame[1] & 1) withMeta++;
      }
    }
    expect(frames).toBeGreaterThan(2000);
    // the point of it all
    expect(bytesBin * 4).toBeLessThan(bytesJson);
    expect(withMeta).toBeGreaterThan(0);
  });

  it('a decoder that lost its state says so instead of guessing, and a resync frame repairs it', () => {
    const { w, ids } = world(40, 3);
    const geo = new SnapshotFanout(140, 16, 10);
    const bin = new BinFanout(geo);
    const dec = new SnapDecoder(), st = binState();
    const me = w.wizards.get(ids[0])!;
    for (let i = 0; i < 3; i++) { w.tick(); w.tick(); const s = w.snapshot(); geo.load(s); bin.load(s); expect(dec.decode(bin.payloadFor(me.pos.x, me.pos.z, st))).not.toBeNull(); }
    dec.clear();
    w.tick(); w.tick();
    let s = w.snapshot(); geo.load(s); bin.load(s);
    expect(dec.decode(bin.payloadFor(me.pos.x, me.pos.z, st))).toBeNull();
    st.resync = true;
    w.tick(); w.tick();
    s = w.snapshot(); geo.load(s); bin.load(s);
    const got = dec.decode(bin.payloadFor(me.pos.x, me.pos.z, st));
    compare(got!, JSON.parse(geo.payloadFor(me.pos.x, me.pos.z).toString()).s);
  });

  it('with AOI off every entity is in the frame', () => {
    const { w, ids } = world(30, 5);
    const geo = new SnapshotFanout(0);
    const bin = new BinFanout(geo);
    const dec = new SnapDecoder(), st = binState();
    for (let i = 0; i < 5; i++) {
      w.tick(); w.tick();
      const s = w.snapshot(); geo.load(s); bin.load(s);
      const me = w.wizards.get(ids[0])!;
      compare(dec.decode(bin.payloadFor(me.pos.x, me.pos.z, st))!, JSON.parse(geo.fullPayload().toString()).s);
    }
  });
});
