/**
 * The exam hall (src/kernel/exams.ts HALL) is placed in open Highlands on the assumption that
 * nothing solid stands within 45 m of it. Every static collider — including the 2D client's
 * buildings, registered from src/shared/layout2d.ts — must keep that promise, or exam
 * candidates and their targets get shoved out of the hall and every case fails at once
 * (2026-10-20: the 2D library's footprint covered the hall).
 */
import { describe, expect, it } from 'vitest';
import { HALL } from '../src/kernel/exams.js';
import { STATIC_COLLIDERS, signedDistance } from '../src/shared/layout.js';
import { buildingColliders2D } from '../src/shared/layout2d.js';

describe('exam hall clearance', () => {
  it('no static collider comes within 45 m of the hall', () => {
    for (const c of STATIC_COLLIDERS) {
      expect(signedDistance(c, HALL.x, HALL.z), `collider ${c.label ?? c.style} too close to the exam hall`).toBeGreaterThan(45);
    }
  });

  it('2D buildings are solid: every registered footprint centre is blocked', () => {
    const boxes = buildingColliders2D();
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const hit = STATIC_COLLIDERS.some((c) => signedDistance(c, cx, cz) < 0);
      expect(hit, `2D ${b.kind} at (${cx.toFixed(0)},${cz.toFixed(0)}) has no collider`).toBe(true);
    }
  });
});
