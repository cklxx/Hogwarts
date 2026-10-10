/**
 * Regional ecology: four hunt regions share renewable resources and visible house pressure.
 * Hunting depletes a region. Quiet regions recover. This changes XP and Galleon yield and gives
 * agents a reason to migrate, contest control, or leave a depleted region to recover.
 */
import { z } from 'zod';
import { inZoneId, ZONES, type ZoneId } from '../shared/map.js';
import { HOUSES, type House } from '../shared/constants.js';
import type { Feature } from './feature.js';
import type { Creature, Wizard } from './types.js';
import type { World } from './world.js';

export const ECOLOGY_ZONES = ['grounds', 'greenhouses', 'dungeons', 'forest'] as const satisfies readonly ZoneId[];
export type EcologyZone = typeof ECOLOGY_ZONES[number];
export const ECOLOGY_RESOURCE_MIN = 20;
export const ECOLOGY_RESOURCE_MAX = 100;
export const ECOLOGY_START = 70;
export const ECOLOGY_HUNT_COST = 7;
export const ECOLOGY_RECOVERY_PER_MIN = 6;
export const ECOLOGY_PRESSURE_GAIN = 10;
export const ECOLOGY_PRESSURE_DECAY_PER_MIN = 6;
export const ECOLOGY_CONTROL_MIN = 18;
export const ECOLOGY_CONTROL_LEAD = 6;

export interface EcologyRegion {
  resources: number;
  pressure: Record<House, number>;
}
export interface EcologyState {
  zones: Record<EcologyZone, EcologyRegion>;
}

declare module './world.js' { interface World { ecology: EcologyState } }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const blankPressure = () => Object.fromEntries(HOUSES.map((h) => [h, 0])) as Record<House, number>;
const blankRegion = (): EcologyRegion => ({ resources: ECOLOGY_START, pressure: blankPressure() });
export const blankEcology = (): EcologyState => ({ zones: Object.fromEntries(ECOLOGY_ZONES.map((z) => [z, blankRegion()])) as EcologyState['zones'] });

/** Resource yield is bounded to 60%..140%. */
export const ecologyYieldPct = (resources: number) => clamp(60 + Math.round((clamp(resources, ECOLOGY_RESOURCE_MIN, ECOLOGY_RESOURCE_MAX) - ECOLOGY_RESOURCE_MIN) * 80 / (ECOLOGY_RESOURCE_MAX - ECOLOGY_RESOURCE_MIN)), 60, 140);
export const ecologyDanger = (resources: number) => clamp(20 + Math.round((ECOLOGY_RESOURCE_MAX - clamp(resources, ECOLOGY_RESOURCE_MIN, ECOLOGY_RESOURCE_MAX)) * 0.75), 20, 80);
export const ecologyAfterHunt = (resources: number) => clamp(resources - ECOLOGY_HUNT_COST, ECOLOGY_RESOURCE_MIN, ECOLOGY_RESOURCE_MAX);
export const ecologyAfterRecovery = (resources: number, seconds: number) => clamp(resources + ECOLOGY_RECOVERY_PER_MIN * Math.max(0, seconds) / 60, ECOLOGY_RESOURCE_MIN, ECOLOGY_RESOURCE_MAX);

export function ecologyZoneAt(x: number, z: number): EcologyZone | null {
  // Specific regions first. The forest lies inside the larger grounds zone.
  for (const zone of ['forest', 'greenhouses', 'dungeons', 'grounds'] as const) if (inZoneId(zone, x, z)) return zone;
  return null;
}

export function ecologyControl(region: EcologyRegion): House | null {
  const ranked = HOUSES.map((house) => ({ house, n: region.pressure[house] ?? 0 })).sort((a, b) => b.n - a.n || a.house.localeCompare(b.house));
  return ranked[0].n >= ECOLOGY_CONTROL_MIN && ranked[0].n - ranked[1].n >= ECOLOGY_CONTROL_LEAD ? ranked[0].house : null;
}

/** Read the yield before this hunt, then commit depletion and house pressure exactly once. */
export function recordEcologyHunt(world: World, creature: Creature, killer: Wizard | undefined) {
  if (!killer || killer.npc || creature.owner || creature.ev) return { zone: null as EcologyZone | null, yieldPct: 100, control: null as House | null };
  const zone = ecologyZoneAt(creature.pos.x, creature.pos.z);
  if (!zone) return { zone: null as EcologyZone | null, yieldPct: 100, control: null as House | null };
  const region = world.ecology.zones[zone];
  const yieldPct = ecologyYieldPct(region.resources);
  region.resources = ecologyAfterHunt(region.resources);
  region.pressure[killer.house] = clamp((region.pressure[killer.house] ?? 0) + ECOLOGY_PRESSURE_GAIN, 0, 100);
  return { zone, yieldPct, control: ecologyControl(region) };
}

function regionView(world: World, zone: EcologyZone) {
  const r = world.ecology.zones[zone];
  const place = ZONES.find((z) => z.id === zone)?.name ?? zone;
  const control = ecologyControl(r);
  return {
    zone, place, resources: Math.round(r.resources), yieldPct: ecologyYieldPct(r.resources), danger: ecologyDanger(r.resources), control,
    pressure: Object.fromEntries(HOUSES.map((h) => [h, Math.round(r.pressure[h])])),
  };
}

function board(world: World, wid: string) {
  const w = world.need(wid);
  return {
    current: ecologyZoneAt(w.pos.x, w.pos.z),
    regions: ECOLOGY_ZONES.map((z) => regionView(world, z)),
    rule: 'Hunting consumes 7 resource. Quiet regions recover 6 resource per minute. Yield stays within 60%..140%. House control needs 18 pressure and a 6-point lead.',
  };
}

function loadRegion(raw: unknown): EcologyRegion {
  const r = raw && typeof raw === 'object' ? raw as Partial<EcologyRegion> : {};
  const p = r.pressure && typeof r.pressure === 'object' ? r.pressure : {} as Record<House, number>;
  return {
    resources: clamp(typeof r.resources === 'number' && Number.isFinite(r.resources) ? r.resources : ECOLOGY_START, ECOLOGY_RESOURCE_MIN, ECOLOGY_RESOURCE_MAX),
    pressure: Object.fromEntries(HOUSES.map((h) => [h, clamp(typeof p[h] === 'number' && Number.isFinite(p[h]) ? p[h] : 0, 0, 100)])) as Record<House, number>,
  };
}

export const ECOLOGY_FEATURE: Feature = {
  id: 'ecology',
  init(world) { world.ecology = blankEcology(); },
  sweep(world) {
    for (const z of ECOLOGY_ZONES) {
      const r = world.ecology.zones[z];
      r.resources = ecologyAfterRecovery(r.resources, 1);
      for (const h of HOUSES) r.pressure[h] = Math.max(0, r.pressure[h] - ECOLOGY_PRESSURE_DECAY_PER_MIN / 60);
    }
  },
  save: (world) => world.ecology,
  load(world, data) {
    const d = data && typeof data === 'object' ? data as { zones?: Partial<Record<EcologyZone, unknown>> } : {};
    world.ecology = { zones: Object.fromEntries(ECOLOGY_ZONES.map((z) => [z, loadRegion(d.zones?.[z])])) as EcologyState['zones'] };
  },
  view: {
    key: 'ecology',
    whoami(world, w) {
      const zone = ecologyZoneAt(w.pos.x, w.pos.z);
      return { current: zone, ...(zone ? regionView(world, zone) : {}), boardTool: 'ecosystem_board' };
    },
    board(world) { return { ecology: ECOLOGY_ZONES.map((z) => regionView(world, z)) }; },
  },
  tools: [{
    name: 'ecosystem_board', title: 'Regional Ecosystem', cost: 0, readOnly: true,
    description: 'Read renewable resources, reward yield, danger, house pressure and control in the four hunt regions. Move when a region is depleted or contest another house for control.',
    input: { zone: z.enum(ECOLOGY_ZONES).optional() },
    run(world, wid, args) {
      const all = board(world, wid);
      return args.zone ? { ...all, regions: all.regions.filter((r) => r.zone === args.zone) } : all;
    },
  }],
};
