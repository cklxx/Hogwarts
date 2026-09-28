import { ZONES, inZone, type ZoneId } from '../shared/map.js';

/**
 * Zones rasterised once into a 2 m grid, so the hot "is this point in a safe zone?" question (every
 * canHarm, every creature step) is an array lookup instead of 14 circle/box tests and two arrays.
 *
 * Each cell stores two bitmasks over ZONES (bit i = ZONES[i]):
 *   inside — the zone contains the whole cell (padded by a millimetre-scale margin)
 *   edge   — the zone boundary crosses the cell: the exact test decides, for those zones only
 * A zone in neither mask cannot contain any point of the cell. Points outside the raster (or NaN) use
 * the exact test for every zone. So every answer equals `inZone(zone, x, z)` exactly.
 *
 * Zones are static map data; which of them are *safe* is policy (rules.combat.safeZones) and is turned
 * into a mask per call (<= 4 lookups), so a decree changing safeZones takes effect immediately.
 */
export const ZONE_BIT: Record<ZoneId, number> = Object.fromEntries(ZONES.map((z, i) => [z.id, 1 << i])) as Record<ZoneId, number>;
const ALL = (1 << ZONES.length) - 1;

const S = 2;
const PAD = 0.01;
const EPS = 1e-6;
const bounds = ZONES.reduce((b, z) => {
  const [x0, z0, x1, z1] = z.box ?? [z.x - (z.r ?? 0), z.z - (z.r ?? 0), z.x + (z.r ?? 0), z.z + (z.r ?? 0)];
  return [Math.min(b[0], x0), Math.min(b[1], z0), Math.max(b[2], x1), Math.max(b[3], z1)];
}, [Infinity, Infinity, -Infinity, -Infinity]);
const X0 = Math.floor(bounds[0] / S) * S - S, Z0 = Math.floor(bounds[1] / S) * S - S;
const NX = Math.ceil((bounds[2] - X0) / S) + 2, NZ = Math.ceil((bounds[3] - Z0) / S) + 2;
if (ZONES.length > 31) throw new Error('zones.ts: more than 31 zones need a wider mask');
const inside = new Uint32Array(NX * NZ);
const edge = new Uint32Array(NX * NZ);

for (let i = 0; i < NX; i++) {
  for (let j = 0; j < NZ; j++) {
    const ax = X0 + i * S - PAD, bx = X0 + (i + 1) * S + PAD, az = Z0 + j * S - PAD, bz = Z0 + (j + 1) * S + PAD;
    let inn = 0, e = 0;
    ZONES.forEach((z, k) => {
      const bit = 1 << k;
      if (z.box) {
        const [b0, b1, b2, b3] = z.box;
        if (ax >= b0 && bx <= b2 && az >= b1 && bz <= b3) inn |= bit;
        else if (!(bx < b0 || ax > b2 || bz < b1 || az > b3)) e |= bit;
      } else {
        const r = z.r ?? 0;
        const far = Math.max(Math.hypot(ax - z.x, az - z.z), Math.hypot(bx - z.x, az - z.z), Math.hypot(ax - z.x, bz - z.z), Math.hypot(bx - z.x, bz - z.z));
        const nx = Math.max(ax, Math.min(z.x, bx)), nz = Math.max(az, Math.min(z.z, bz));
        const near = Math.hypot(nx - z.x, nz - z.z);
        if (far <= r - EPS) inn |= bit;
        else if (near <= r + EPS) e |= bit;
      }
    });
    inside[i * NZ + j] = inn;
    edge[i * NZ + j] = e;
  }
}

function exact(x: number, z: number, mask: number) {
  let m = 0;
  for (let k = 0; k < ZONES.length; k++) if (mask & (1 << k) && inZone(ZONES[k], x, z)) m |= 1 << k;
  return m;
}

/** Bitmask of the zones among `mask` that contain (x, z). Exactly equal to testing each with inZone. */
export function zoneMask(x: number, z: number, mask = ALL): number {
  const i = Math.floor((x - X0) / S), j = Math.floor((z - Z0) / S);
  if (!(i >= 0 && i < NX && j >= 0 && j < NZ)) return exact(x, z, mask);
  const c = i * NZ + j;
  const e = edge[c] & mask;
  return (inside[c] & mask) | (e ? exact(x, z, e) : 0);
}

export const inZoneId = (x: number, z: number, id: ZoneId) => zoneMask(x, z, ZONE_BIT[id]) !== 0;

/** Zone ids containing (x, z), in ZONES order (same as ZONES.filter(inZone).map(id)). */
export function zoneIdsAt(x: number, z: number): ZoneId[] {
  const m = zoneMask(x, z);
  const out: ZoneId[] = [];
  if (m) for (let k = 0; k < ZONES.length; k++) if (m & (1 << k)) out.push(ZONES[k].id);
  return out;
}

/** Mask for a list of zone ids (unknown ids contribute nothing, as `includes` would find nothing). */
export function maskOf(ids: readonly string[]): number {
  let m = 0;
  for (const id of ids) m |= (ZONE_BIT as Record<string, number>)[id] ?? 0;
  return m;
}
