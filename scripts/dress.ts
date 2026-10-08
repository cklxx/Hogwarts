/**
 * 布景 (the owner, 2026-10-01: 「内容太少了……丰富内容元素」): scatters the scene props that are not hand-placed in
 * src/shared/props.ts — bushes and hay in clumps that burn as one, toadstool rings, lantern trios (a group that pays),
 * puddles, ice blocks, cauldrons, crates and barrels — scene by scene, by the rules below, and writes them to
 * src/shared/dressing.ts. Deterministic (a fixed seed); run it again after moving buildings:
 *
 *   npx tsx scripts/dress.ts
 *
 * Every spot is checked as test/props.test.ts checks it: inside its scene and 3 m clear of its veil, out of the safe
 * zones and off the water, 1.6 m clear of every collider, and away from the gates, chests, fireplaces, the other
 * props and the encounters' toys.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/kernel/world.js';
import { CHESTS } from '../src/shared/chests.js';
import { ENCOUNTERS } from '../src/shared/encounters.js';
import { overWater } from '../src/shared/ice.js';
import { STATIC_COLLIDERS, signedDistance } from '../src/shared/layout.js';
import { mulberry32 } from '../src/shared/map.js';
import { HAND_PROPS, type Prop, type PropKind } from '../src/shared/props.js';
import { SCENES, sceneAt, type SceneId } from '../src/shared/scenes.js';
import { FIREPLACES } from '../src/shared/travel.js';

interface Rule {
  kind: PropKind; clumps: number; size: number;
  /** Members of a clump this far apart (a fire runs along a clump: under the kind's blast). */
  gap: number;
  /** Lanterns: each clump is a group of three that pays (src/kernel/props.ts). */
  group?: { zh: string; en: string };
  /** Only round here. */
  near?: { x: number; z: number; r: number };
}
const RULES: Record<SceneId, Rule[]> = {
  castle: [
    { kind: 'bush', clumps: 7, size: 4, gap: 1.8 },
    { kind: 'hay', clumps: 3, size: 3, gap: 1.8, near: { x: 10, z: 14, r: 26 } },
    { kind: 'puddle', clumps: 6, size: 1, gap: 0, near: { x: 8, z: 4, r: 34 } },
    { kind: 'lantern', clumps: 2, size: 3, gap: 2.6, group: { zh: '城堡小径的灯笼', en: 'the castle path lanterns' } },
    { kind: 'cauldron', clumps: 2, size: 1, gap: 0, near: { x: -40, z: -26, r: 9 } },
    { kind: 'ice', clumps: 2, size: 2, gap: 1.6, near: { x: 60, z: -44, r: 10 } },
    { kind: 'crate', clumps: 4, size: 2, gap: 1.4 },
    { kind: 'barrel', clumps: 3, size: 2, gap: 1.4 },
  ],
  lake: [
    { kind: 'puddle', clumps: 5, size: 1, gap: 0 },
    { kind: 'ice', clumps: 3, size: 2, gap: 1.6 },
    { kind: 'bush', clumps: 2, size: 3, gap: 1.8 },
    { kind: 'barrel', clumps: 2, size: 2, gap: 1.4 },
  ],
  forest: [
    { kind: 'mushroom', clumps: 5, size: 3, gap: 1.5 },
    { kind: 'bush', clumps: 4, size: 4, gap: 1.8 },
    { kind: 'web', clumps: 2, size: 3, gap: 1.8 },
    { kind: 'puddle', clumps: 2, size: 1, gap: 0 },
    { kind: 'cauldron', clumps: 1, size: 1, gap: 0, near: { x: 96, z: 30, r: 10 } },
    { kind: 'crate', clumps: 2, size: 2, gap: 1.4 },
  ],
  pitch: [
    { kind: 'hay', clumps: 5, size: 3, gap: 1.8 },
    { kind: 'lantern', clumps: 2, size: 3, gap: 2.6, group: { zh: '球场的灯笼', en: 'the pitch lanterns' } },
    { kind: 'bush', clumps: 3, size: 3, gap: 1.8 },
    { kind: 'crate', clumps: 5, size: 2, gap: 1.4 },
    { kind: 'barrel', clumps: 2, size: 2, gap: 1.4 },
    { kind: 'puddle', clumps: 2, size: 1, gap: 0 },
  ],
  hogsmeade: [
    { kind: 'lantern', clumps: 4, size: 3, gap: 2.6, group: { zh: '霍格莫德街上的灯笼', en: 'the Hogsmeade street lanterns' } },
    { kind: 'barrel', clumps: 4, size: 2, gap: 1.4 },
    { kind: 'crate', clumps: 4, size: 2, gap: 1.4 },
    { kind: 'cauldron', clumps: 3, size: 1, gap: 0 },
    { kind: 'hay', clumps: 2, size: 3, gap: 1.8 },
    { kind: 'bush', clumps: 3, size: 3, gap: 1.8 },
    { kind: 'pot', clumps: 3, size: 2, gap: 1.3 },
    { kind: 'puddle', clumps: 5, size: 1, gap: 0 },
    { kind: 'ice', clumps: 1, size: 2, gap: 1.6, near: { x: 40, z: 160, r: 14 } },
  ],
};

const world = new World({ seed: 1, secret: 'dress' });
const keepOff: { x: number; z: number; r: number }[] = [
  ...CHESTS.map((c) => ({ x: c.x, z: c.z, r: 3 })),
  ...FIREPLACES.map((f) => ({ x: f.x, z: f.z, r: 3 })),
  ...SCENES.flatMap((s) => [s.gate, s.entry, s.hubGate, s.hubExit].filter((g): g is { x: number; z: number } => !!g).map((g) => ({ ...g, r: 4.5 }))),
  ...ENCOUNTERS.map((e) => ({ x: e.x, z: e.z, r: e.id === 'greenhouse' ? 6 : e.r })),
];
const placed: Prop[] = [...HAND_PROPS];
const open = (x: number, z: number, scene: SceneId, minGap: number, mine: Prop[]) => {
  const s = sceneAt(x, z);
  if (!s || s.id !== scene) return false;
  if (Math.min(x - s.box[0], s.box[2] - x, z - s.box[1], s.box[3] - z) < 3.5) return false;
  if (world.inSafe({ x, z }) || overWater(x, z)) return false;
  if (STATIC_COLLIDERS.some((c) => signedDistance(c, x, z) < 1.6)) return false;
  if (keepOff.some((k) => Math.hypot(k.x - x, k.z - z) < k.r)) return false;
  // away from every other prop (a clump's own members: just their gap), and anything that burns away from a whizbang
  return placed.every((p) => Math.hypot(p.x - x, p.z - z) >= (mine.includes(p) ? minGap : 3.2));
};

const out: Prop[] = [], groups: { id: string; zh: string; en: string; kind: PropKind }[] = [];
/** A clump that burns must leave one clear Incendio line from a 6 m ring point (test/dressing.test.ts). */
const clearFire = (clump: Prop[]) => {
  const p = clump[0];
  const s = sceneAt(p.x, p.z)?.id;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, at = { x: p.x + Math.cos(a) * 6, z: p.z + Math.sin(a) * 6 };
    if (sceneAt(at.x, at.z)?.id !== s || world.solids.blocked(at, 0.5) || world.solids.hitSegment(at.x, at.z, p.x, p.z)) continue;
    const onLine = placed.some((q) => q !== p && Math.hypot(q.x - p.x, q.z - p.z) > 0.1 && (() => {
      const dx = p.x - at.x, dz = p.z - at.z, t = Math.max(0, Math.min(1, ((q.x - at.x) * dx + (q.z - at.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(q.x - at.x - dx * t, q.z - at.z - dz * t) < 1.3;
    })());
    if (!onLine) return true;
  }
  return false;
};
const rnd = mulberry32(20261001);
for (const s of SCENES) {
  let n = 0;
  for (const r of RULES[s.id]) for (let c = 0; c < r.clumps; c++) {
    const [x0, z0, x1, z1] = s.box;
    for (let tries = 0; tries < 4000; tries++) {
      const cx = r.near ? r.near.x + (rnd() * 2 - 1) * r.near.r : x0 + rnd() * (x1 - x0);
      const cz = r.near ? r.near.z + (rnd() * 2 - 1) * r.near.r : z0 + rnd() * (z1 - z0);
      if (r.near && Math.hypot(cx - r.near.x, cz - r.near.z) > r.near.r) continue;
      // a clump: the first where it falls, each next one `gap` from one already in it, at a random angle
      const mine: Prop[] = [];
      const gid = r.group ? `${s.id}-lamps-${groups.filter((g) => g.id.startsWith(s.id)).length + 1}` : undefined;
      for (let k = 0; k < r.size; k++) {
        let ok = false;
        for (let t = 0; t < 40 && !ok; t++) {
          const from = mine[Math.floor(rnd() * mine.length)];
          const a = rnd() * Math.PI * 2;
          const x = from ? from.x + Math.cos(a) * r.gap : cx, z = from ? from.z + Math.sin(a) * r.gap : cz;
          if (!open(x, z, s.id, r.gap * 0.95, mine)) { if (!from) break; continue; }
          // a lantern trio stays within 4 m of its middle (test/props.test.ts)
          const p: Prop = { id: `${s.id}-${r.kind}-${++n}`, kind: r.kind, x: +x.toFixed(1), z: +z.toFixed(1), ...(gid ? { group: gid } : {}) };
          mine.push(p); placed.push(p); ok = true;
        }
        if (!ok) break;
      }
      if (mine.length === r.size && (!['bush', 'hay', 'web'].includes(r.kind) || clearFire(mine))) {
        out.push(...mine);
        if (r.group && gid) groups.push({ id: gid, zh: r.group.zh, en: r.group.en, kind: r.kind });
        break;
      }
      for (const p of mine) placed.splice(placed.indexOf(p), 1);
      n -= mine.length;
    }
  }
}

const file = join(dirname(fileURLToPath(import.meta.url)), '../src/shared/dressing.ts');
const line = (p: Prop) => `  { id: '${p.id}', kind: '${p.kind}', x: ${p.x}, z: ${p.z}${p.group ? `, group: '${p.group}'` : ''} },`;
writeFileSync(file, `/**
 * 布景: the scene props scattered by scripts/dress.ts (generated: edit the rules there and run it again, not this
 * file). ${out.length} props${groups.length ? `, ${groups.length} lantern groups` : ''}. src/shared/props.ts adds them to the hand-placed ones.
 */
import type { Prop, PropGroup } from './props.js';

export const DRESSING_GROUPS: readonly PropGroup[] = [
${groups.map((g) => `  { id: '${g.id}', zh: '${g.zh}', en: '${g.en}', kind: '${g.kind}' },`).join('\n')}
];

export const DRESSING: readonly Prop[] = [
${out.map(line).join('\n')}
];
`);
const by = (k: string) => out.filter((p) => p.id.startsWith(k + '-')).length;
console.log(`${out.length} props, ${groups.length} groups:`, SCENES.map((s) => `${s.id} ${by(s.id)}`).join(', '));
