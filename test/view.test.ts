/**
 * The third-person camera (client/view.ts): the spring arm keeps out of every solid in the camera's picture of the
 * world (src/shared/layout.ts viewSolids), leaves the open-space camera exactly as it was, climbs or goes over
 * the shoulder when pressed against a wall, and knows when you are indoors.
 */
import { describe, expect, it } from 'vitest';
import { heightAt } from '../client/terrain.js';
import { CameraRig, HARD_ONLY, INDOOR_DIST, INDOOR_PITCH, LOOK_Y, MARGIN, PIVOT_Y, ViewWorld, WITH_SOFT, type RigInput } from '../client/view.js';
import { HALL_CANDLES, INTERIORS, STATIC_COLLIDERS, colliderOf, interiorAt, signedDistance, viewSolids } from '../src/shared/layout.js';
import { OBSTACLES, mulberry32 } from '../src/shared/map.js';

const world = new ViewWorld(viewSolids(heightAt));
const flat = () => 0;

/** Run the rig for `secs` at 60 fps and return it. */
function settle(rig: CameraRig, i: Omit<RigInput, 'dt' | 'ground'>, secs = 3, ground: RigInput['ground'] = heightAt, overhead = false) {
  for (let t = 0; t < secs; t += 1 / 60) rig.update({ ...i, dt: 1 / 60, ground, overhead });
  return rig;
}
/** The old camera (main.ts before view.ts). */
function oldCamera(x: number, y: number, z: number, yaw: number, pitch: number, dist: number) {
  const cx = x + Math.sin(yaw) * Math.cos(pitch) * dist, cz = z + Math.cos(yaw) * Math.cos(pitch) * dist;
  const cy = Math.max(y + 1.5 + Math.sin(pitch) * dist, heightAt(cx, cz) + 1.5);
  return { x: cx, y: cy, z: cz };
}
/** Hard solids (not the roof of the room the player is in) the point is inside of, grown by g. */
function insideHard(w: ViewWorld, x: number, y: number, z: number, room: number) {
  const out: number[] = [];
  for (let i = 0; i < w.n; i++) if (w.isOn(i) && !w.isSoft(i) && !(room >= 0 && w.roofOf(i) === room) && w.inside(i, x, y, z)) out.push(i);
  return out;
}
const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Degrees between where the camera looks and the player's head (the view is 60° tall, ~95° wide). */
function headAngle(rig: CameraRig, x: number, y: number, z: number) {
  const f = { x: rig.look.x - rig.pos.x, y: rig.look.y - rig.pos.y, z: rig.look.z - rig.pos.z };
  const h = { x: x - rig.pos.x, y: y + 1.7 - rig.pos.y, z: z - rig.pos.z };
  const c = (f.x * h.x + f.y * h.y + f.z * h.z) / (Math.hypot(f.x, f.y, f.z) * Math.hypot(h.x, h.y, h.z));
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
}

describe('interiors', () => {
  it('the Great Hall is the one roofed room, doorway included', () => {
    expect(INTERIORS.map((r) => r.label)).toEqual(['The Great Hall']);
    expect(interiorAt(0, -56)).toBe(0);
    expect(interiorAt(-11, -71)).toBe(0);
    expect(interiorAt(0, -40)).toBe(0); // in the doorway
    expect(interiorAt(0, -38)).toBe(-1); // the courtyard
    expect(interiorAt(15, -56)).toBe(-1); // outside the east wall
    expect(interiorAt(0, -80)).toBe(-1); // in the keep
  });
  it('its floor lies inside its walls: nothing walkable-blocking stands on it but the tables', () => {
    for (const c of STATIC_COLLIDERS) {
      if (c.label === 'House table') continue;
      for (const [x, z] of [[-11.5, -71.5], [11.5, -71.5], [0, -56], [-11.5, -41.5], [11.5, -41.5], [0, -40]]) expect(signedDistance(c, x, z), c.label).toBeGreaterThan(0);
    }
  });
});

describe('the camera\'s picture of the world', () => {
  it('stands every collider up to at least its height, and trees get a trunk and soft crowns', () => {
    const solids = viewSolids(flat);
    for (const o of OBSTACLES) {
      if (o.style === 'water') continue;
      const c = colliderOf(o);
      const cx = c.kind === 'box' ? (c.x0 + c.x1) / 2 : c.kind === 'disc' ? c.x : c.x;
      const cz = c.kind === 'box' ? (c.z0 + c.z1) / 2 : c.kind === 'disc' ? c.z : c.z;
      const hard = solids.filter((s) => !s.soft && s.y0 <= 0.01 && s.c.kind !== 'diamond' && signedDistance(s.c, cx, cz) < 0);
      expect(hard.length, `${o.label ?? o.style} at ${cx},${cz}`).toBeGreaterThan(0);
      if (o.style !== 'tree' && o.style !== 'willow' && o.style !== 'wood' && o.style !== 'rock') expect(Math.max(...hard.map((s) => s.y1))).toBeGreaterThanOrEqual(o.h);
    }
    const trees = OBSTACLES.filter((o) => o.style === 'tree').length;
    expect(solids.filter((s) => s.soft && s.c.style === 'tree').length).toBe(trees * 3);
    expect(solids.some((s) => s.roof === 0)).toBe(true);
  });

  it('sweeps a segment into a wall, over it, and through a crown only when asked', () => {
    // east of the Great Hall's east wall (x 12..13), between two buttresses, toward the hall at 5 m up
    const t = world.cast(20, 5, -54, 5, 5, -54, 0);
    expect(20 - 15 * t).toBeCloseTo(13, 5);
    expect(world.cast(20, 5, -54, 5, 5, -54, MARGIN) * 15).toBeCloseTo(7 - MARGIN, 5);
    // 5 cm from a buttress (x 13..13.7): the margin catches it
    expect(20 - 15 * world.cast(20, 5, -56, 5, 5, -56, MARGIN)).toBeCloseTo(13.7 + MARGIN, 5);
    // well over the walls: only the roof is in the way, and not for someone inside the hall
    expect(world.cast(20, 19, -56, 5, 19, -56, 0)).toBeLessThan(1);
    expect(world.cast(20, 19, -56, 5, 19, -56, 0, HARD_ONLY, 0)).toBe(1);
    expect(world.cast(20, 30, -56, 5, 30, -56, 0)).toBe(1);
    // a tree: the trunk stops the camera; the crown only hides you
    const tree = OBSTACLES.find((o) => o.style === 'tree' && o.kind === 'disc')!;
    if (tree.kind !== 'disc') throw new Error();
    const g = heightAt(tree.x, tree.z), y = g + tree.h * 0.5;
    expect(world.cast(tree.x - 8, y, tree.z, tree.x + 8, y, tree.z, 0, HARD_ONLY)).toBe(1);
    expect(world.cast(tree.x - 8, y, tree.z, tree.x + 8, y, tree.z, 0, WITH_SOFT)).toBeLessThan(0.5);
    expect(world.cast(tree.x - 8, g + 1, tree.z, tree.x + 8, g + 1, tree.z, 0, HARD_ONLY)).toBeLessThan(0.5);
  });

  it('the Great Hall\'s floating candles hide you (the fade comes on) but never stop the camera', () => {
    const c = HALL_CANDLES[19];
    // from 3 m up and 4 m south of a candle, down through it to a wizard's chest (the hall's roof hidden: inside)
    const [ax, ay, az, bx, by, bz] = [c.x, c.y + 3, c.z + 4, c.x, 1.1, c.z - (4 * (c.y - 1.1)) / 3];
    expect(world.cast(ax, ay, az, bx, by, bz, MARGIN, HARD_ONLY, 0)).toBe(1);
    expect(world.cast(ax, ay, az, bx, by, bz, 0, WITH_SOFT, 0)).toBeLessThan(0.6);
    expect(world.solids[world.hit].c.label).toBe('Candle');
  });

  it('a long house\'s roof overhangs its ends as drawn (a rhombus, not a box)', () => {
    // the Three Broomsticks: x -30..-16, z 150..162, walls 9 m, roof to 15.3 m; drawn roof corners reach 7.13 m out
    const h = OBSTACLES.find((o) => o.label === 'The Three Broomsticks')!;
    if (h.kind !== 'box') throw new Error();
    const y = h.h + 0.2, cz = (h.z0 + h.z1) / 2;
    // on the centre line the drawn roof reaches 6.58 m from the centre (the wall: 6 m)
    expect(world.cast(-23, y, h.z1 + 0.7, -23, y, h.z1 + 3, 0)).toBe(1);
    // near the west end it reaches 7.08 m: a ray coming in from the north meets it there, not at the wall
    const t = world.cast(-29.5, y, 166, -29.5, y, 160, 0);
    expect(166 - 6 * t).toBeGreaterThan(cz + 6.9);
    expect(166 - 6 * t).toBeLessThan(cz + 7.2);
    expect(world.cast(-30.5, y, cz + 6.5, -40, y, cz + 6.5, 0)).toBe(1); // beside the corner: open
  });

  it('switches statues on and off', () => {
    const w = new ViewWorld(viewSolids(flat));
    expect(w.cast(-12, 2, 4, -2, 2, 4, 0)).toBe(1); // statue 0 stands at (-7, 4)
    w.setStatues(1);
    expect(w.cast(-12, 2, 4, -2, 2, 4, 0)).toBeLessThan(1);
  });
});

describe('the spring arm', () => {
  it('in open space the camera is exactly where it always was', () => {
    for (const [yaw, pitch, dist] of [[0, 0.45, 14], [1.2, 0.2, 8], [-2.5, 1.1, 30], [3, 0.1, 5]]) {
      const rig = settle(new CameraRig(world), { x: 0, y: 0, z: -22, yaw, pitch, dist }, 0.5);
      const old = oldCamera(0, heightAt(0, -22), -22, yaw, pitch, dist);
      expect(dist3(rig.pos, old), `${yaw},${pitch},${dist}`).toBeLessThan(1e-6);
      expect(rig.look).toEqual({ x: 0, y: LOOK_Y, z: -22 });
    }
  });

  it('stays in front of the Great Hall wall behind the player, and eases back out when the wall is gone', () => {
    const rig = settle(new CameraRig(world), { x: 15.2, y: 0, z: -55, yaw: -Math.PI / 2, pitch: 0.35, dist: 14 });
    expect(rig.pos.x).toBeGreaterThanOrEqual(13 + MARGIN - 1e-6);
    expect(insideHard(world, rig.pos.x, rig.pos.y, rig.pos.z, rig.room)).toEqual([]);
    // turn the camera to the open side: one frame later it is still short, then it eases out
    rig.update({ x: 15.2, y: 0, z: -55, yaw: Math.PI / 2, pitch: 0.35, dist: 14, dt: 1 / 60, ground: heightAt });
    const first = dist3(rig.pos, { x: 15.2, y: PIVOT_Y, z: -55 });
    expect(first).toBeLessThan(10);
    settle(rig, { x: 15.2, y: 0, z: -55, yaw: Math.PI / 2, pitch: 0.35, dist: 14 }, 4);
    expect(dist3(rig.pos, oldCamera(15.2, 0, -55, Math.PI / 2, 0.35, 14))).toBeLessThan(0.05);
  });

  it('snaps in within the frame a wall comes between', () => {
    const rig = settle(new CameraRig(world), { x: 20, y: 0, z: -55, yaw: Math.PI / 2, pitch: 0.35, dist: 14 }, 1);
    rig.update({ x: 20, y: 0, z: -55, yaw: -Math.PI / 2, pitch: 0.35, dist: 14, dt: 1 / 60, ground: heightAt });
    expect(rig.pos.x).toBeGreaterThanOrEqual(13 + MARGIN - 1e-6);
  });

  it('with something low behind (Dumbledore\'s tomb, 2 m), the camera climbs over it and keeps its arm', () => {
    // the tomb is a 3.5 x 2.1 m box at (-52, 28); stand 1.2 m south of it with the camera to the north
    const at = { x: -52, y: heightAt(-52, 30.25), z: 30.25, yaw: Math.PI, pitch: 0.2, dist: 14 };
    const rig = settle(new CameraRig(world), at);
    expect(rig.lift).toBeGreaterThan(0.1);
    expect(rig.shoulder).toBeLessThan(0.01);
    expect(dist3(rig.pos, { x: at.x, y: at.y + PIVOT_Y, z: at.z })).toBeGreaterThan(10);
    expect(insideHard(world, rig.pos.x, rig.pos.y, rig.pos.z, -1)).toEqual([]);
    // and comes back down when you step away
    settle(rig, { ...at, z: 45 }, 6);
    expect(rig.lift).toBeLessThan(0.02);
  });

  it('pressed short, it eases over the shoulder: none at 4.5 m of arm, fully at MIN_ARM', () => {
    const rig = (x: number) => settle(new CameraRig(world), { x, y: 0, z: -54, yaw: -Math.PI / 2, pitch: 0.1, dist: 14 });
    expect(rig(30).shoulder).toBeLessThan(0.01); // 16.7 m of room
    const mid = rig(13 + MARGIN + 3.6);
    expect(mid.shoulder).toBeGreaterThan(0.2);
    expect(mid.shoulder).toBeLessThan(0.8);
    expect(rig(13 + MARGIN + 2).shoulder).toBeGreaterThan(0.99);
  });

  it('backed against a wall too tall to climb over, it goes over the shoulder (and up the wall), and still shows you', () => {
    for (const [x, z, yaw] of [[13.5, -59, -Math.PI / 2], [-40, -63.5, Math.PI], [-40, -62.6, Math.PI], [15, -54.5, -Math.PI / 2]]) {
      const rig = settle(new CameraRig(world), { x, y: 0, z, yaw, pitch: 0.3, dist: 14 });
      expect(rig.shoulder).toBeGreaterThan(0.9);
      expect(headAngle(rig, x, 0, z), `${x},${z}`).toBeLessThan(14.5);
      expect(dist3(rig.pos, { x, y: 1.7, z })).toBeGreaterThan(0.9);
      expect(insideHard(world, rig.pos.x, rig.pos.y, rig.pos.z, -1)).toEqual([]);
      // beside the head, not in it, looking on past it
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      expect((rig.pos.x - x) * right.x + (rig.pos.z - z) * right.z).toBeGreaterThan(0.2);
      expect((rig.look.x - x) * -Math.sin(yaw) + (rig.look.z - z) * -Math.cos(yaw)).toBeGreaterThan(0.3);
    }
  });

  it('on a phone (overhead), backed against a tall wall it rises over you instead: no hat filling the screen', () => {
    // the 2026-09-30 phone playtest: backing into the Great Hall's front wall, top-down and follow alike
    for (const [x, z, yaw, pitch, dist] of [[11, -39.5, Math.PI, 1.15, 16], [11, -39.5, Math.PI, 0.5, 13], [13.5, -59, -Math.PI / 2, 0.5, 13], [-40, -63.5, Math.PI, 0.5, 13]]) {
      const rig = settle(new CameraRig(world), { x, y: 0, z, yaw, pitch, dist }, 3, heightAt, true);
      expect(rig.arm, `${x},${z} pitch ${pitch}`).toBeGreaterThan(5);
      expect(rig.pos.y).toBeGreaterThan(6);
      expect(rig.shoulder).toBeLessThan(0.01);
      expect(insideHard(world, rig.pos.x, rig.pos.y, rig.pos.z, rig.room)).toEqual([]);
      // and settles back down on open ground
      settle(rig, { x: 0, y: heightAt(0, -10), z: -10, yaw, pitch, dist }, 8, heightAt, true);
      expect(rig.lift).toBeLessThan(0.02);
    }
  });

  it('a tree trunk behind you: the arm stops in front of it, never in it', () => {
    // the outermost tree of the forest, the player 1.5 m inside of it, the camera outward past it
    const trees = OBSTACLES.filter((o) => o.style === 'tree' && o.kind === 'disc') as { x: number; z: number; r: number; h: number }[];
    const t = trees.reduce((a, b) => (Math.hypot(b.x - 165, b.z - 15) > Math.hypot(a.x - 165, a.z - 15) ? b : a));
    const out = Math.atan2(t.x - 165, t.z - 15); // yaw that puts the camera outward
    const k = t.r * 0.5 + 0.45 + 1.5;
    const x = t.x - Math.sin(out) * k, z = t.z - Math.cos(out) * k;
    const rig = settle(new CameraRig(world), { x, y: heightAt(x, z), z, yaw: out, pitch: 0.12, dist: 14 });
    expect(rig.arm).toBeLessThan(3);
    expect(Math.hypot(rig.pos.x - t.x, rig.pos.z - t.z)).toBeGreaterThan(t.r * 0.5 + MARGIN - 0.01);
    expect(insideHard(world, rig.pos.x, rig.pos.y, rig.pos.z, -1)).toEqual([]);
    expect(headAngle(rig, x, heightAt(x, z), z)).toBeLessThan(14.5);
  });

  it('zoomed right in on open ground (3.5 m) it stays an ordinary third-person camera', () => {
    const rig = settle(new CameraRig(world), { x: 0, y: 0, z: -22, yaw: 0.4, pitch: 0.34, dist: 3.5 }, 1);
    expect(rig.shoulder).toBe(0);
    expect(dist3(rig.pos, oldCamera(0, 0, -22, 0.4, 0.34, 3.5))).toBeLessThan(1e-6);
  });

  it('indoors it rises and shortens its arm, and lets go again outside', () => {
    const rig = settle(new CameraRig(world), { x: 0, y: 0, z: -60, yaw: 0.3, pitch: 0.3, dist: 20 });
    expect(rig.room).toBe(0);
    expect(rig.indoor).toBeGreaterThan(0.99);
    const d = dist3(rig.pos, { x: 0, y: PIVOT_Y, z: -60 });
    expect(d).toBeLessThanOrEqual(INDOOR_DIST + 0.01);
    expect(Math.asin((rig.pos.y - PIVOT_Y) / d)).toBeGreaterThanOrEqual(INDOOR_PITCH[0] - 0.05);
    settle(rig, { x: 0, y: 0, z: -20, yaw: 0.3, pitch: 0.3, dist: 20 }, 4);
    expect(rig.indoor).toBeLessThan(0.01);
  });

  it('never ends up inside anything hard, anywhere a wizard can stand (fuzz), forest included', () => {
    const rnd = mulberry32(42);
    let n = 0, forest = 0, worst = 0;
    while (n < 1500) {
      const inForest = n % 3 === 0;
      const x = inForest ? 165 + (rnd() - 0.5) * 150 : (rnd() - 0.5) * 300, z = inForest ? 15 + (rnd() - 0.5) * 150 : -30 + (rnd() - 0.5) * 360;
      if (STATIC_COLLIDERS.some((c) => c.h > 0 && signedDistance(c, x, z) < 0.45)) continue;
      n++;
      if (inForest) forest++;
      const rig = new CameraRig(world);
      const i = { x, y: heightAt(x, z), z, yaw: rnd() * 6.3, pitch: 0.1 + rnd() * 1.2, dist: 3.5 + rnd() * 36.5 };
      settle(rig, i, 0.5, heightAt, n % 2 === 0); // every other one a phone (overhead)
      expect(insideHard(world, rig.pos.x, rig.pos.y, rig.pos.z, rig.room), `${JSON.stringify(i)} -> ${JSON.stringify(rig.pos)}`).toEqual([]);
      worst = Math.max(worst, headAngle(rig, x, i.y, z));
      // and it does not look through a hard wall at the player's head
      const hx = x, hy = i.y + PIVOT_Y, hz = z;
      expect(world.cast(rig.pos.x, rig.pos.y, rig.pos.z, hx, hy, hz, 0, HARD_ONLY, rig.room), JSON.stringify(i)).toBe(1);
    }
    expect(forest).toBeGreaterThan(400);
    expect(worst).toBeLessThan(14.5); // you are always in the picture
  });

  it('costs well under 0.3 ms a frame', () => {
    const rig = new CameraRig(world);
    const rnd = mulberry32(3);
    const t0 = performance.now();
    const N = 3000;
    for (let k = 0; k < N; k++) {
      const x = 165 + (rnd() - 0.5) * 60, z = 15 + (rnd() - 0.5) * 60;
      rig.update({ x, y: heightAt(x, z), z, yaw: rnd() * 6.3, pitch: 0.4, dist: 14, dt: 1 / 60, ground: heightAt });
      rig.hides(x, 1.1, z); rig.hides(x, 1.9, z);
    }
    expect((performance.now() - t0) / N).toBeLessThan(0.3);
  });
});
