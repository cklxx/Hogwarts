/**
 * The HUD corners a reveal charm lights, for an agent: MCP `look` carries a section per corner the wizard has
 * lit (w.ui), made from what the browser draws the corner from (the snapshot's hour/weather/term and wizard list,
 * privateState's measure, the shared map) — and, while some corner is still dark, how to light it. Playtest
 * round 2: an agent that cast Revelio saw nothing new.
 */
import { UI_CHARMS, type UiCharm } from '../shared/constants.js';
import { OBSTACLES } from '../shared/map.js';
import { HOMENUM_RANGE, RADAR_RANGE, UI_CHARM_INFO, compass, homenum } from '../shared/reveal.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

const pad = (n: number) => String(n).padStart(2, '0');
const round = (n: number) => Math.round(n * 10) / 10;

export function revealView(world: World, w: Wizard) {
  const has = (k: UiCharm) => w.ui.includes(k);
  const out: Record<string, unknown> = {};
  if (has('tempus')) {
    const h = world.hour();
    out.tempus = {
      clock: `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`, night: world.isNight(), weather: world.rules.world.weather,
      term: world.term.n, termSecondsLeft: Math.max(0, Math.round(world.term.endsAt - world.now)), proclamation: world.rules.proclamation,
    };
  }
  if (has('revelio')) {
    const t = world.title(w);
    out.revelio = {
      year: w.year, galleons: w.galleons, reputation: Math.round(w.reputation), seals: `${w.seals}/4`,
      title: t.en, nextTitle: t.next ? { title: t.next.en, how: t.next.how } : null,
    };
  }
  if (has('point-me')) out.pointMe = radar(world, w);
  if (has('homenum')) {
    const others = [...world.nearWizards(w.pos, HOMENUM_RANGE)].filter((x) => x !== w && world.online(x)).map((x) => ({ x: x.pos.x, z: x.pos.z, w: x }));
    out.homenum = {
      range: HOMENUM_RANGE,
      near: homenum(w.pos, others).map(({ o, d, a }) => ({
        name: o.w.name, handle: o.w.handle, house: o.w.house, dist: round(d), bearing: compass(a), degrees: Math.round(((a * 180) / Math.PI + 360) % 360),
        ...(o.w.st.stunnedUntil ? { stunned: true } : {}),
      })),
    };
  }
  const dark = (Object.keys(UI_CHARMS) as UiCharm[]).filter((k) => !has(k));
  if (dark.length) {
    out.darkCorners = dark.map((k) => ({
      section: UI_CHARM_INFO[k].look, lights: UI_CHARM_INFO[k].en, cast: UI_CHARM_INFO[k].spell,
      ...(UI_CHARMS[k] > w.year ? { fromYear: UI_CHARMS[k] } : {}),
    }));
  }
  return out;
}

/** The radar grid: RADAR_CELL metres a character, north (−z) up, you in the middle. */
const RADAR_CELL = 10;
const RADAR_N = 2 * Math.round(RADAR_RANGE / RADAR_CELL) + 1;
const HOUSE_CHAR: Record<string, string> = { Gryffindor: 'G', Hufflepuff: 'H', Ravenclaw: 'R', Slytherin: 'S' };
/** What the minimap draws (walls and buildings, water, creatures, wizards by house; trees left out), as text. */
const WALLS = OBSTACLES.filter((o) => o.style !== 'tree');

/** Point Me: the minimap as rows of text. */
function radar(world: World, w: Wizard) {
  const half = (RADAR_N - 1) / 2;
  const x0 = w.pos.x - (half + 0.5) * RADAR_CELL, z0 = w.pos.z - (half + 0.5) * RADAR_CELL;
  const g = Array.from({ length: RADAR_N }, () => Array<string>(RADAR_N).fill('.'));
  const idx = (v: number, o: number) => Math.floor((v - o) / RADAR_CELL);
  const put = (x: number, z: number, ch: string) => {
    const c = idx(x, x0), r = idx(z, z0);
    if (r >= 0 && r < RADAR_N && c >= 0 && c < RADAR_N) g[r][c] = ch;
  };
  for (const o of WALLS) {
    const [bx0, bz0, bx1, bz1] = o.kind === 'box' ? [o.x0, o.z0, o.x1, o.z1] : [o.x - o.r, o.z - o.r, o.x + o.r, o.z + o.r];
    const ch = o.style === 'water' ? '~' : '#';
    for (let r = Math.max(0, idx(bz0, z0)); r <= Math.min(RADAR_N - 1, idx(bz1, z0)); r++) {
      for (let c = Math.max(0, idx(bx0, x0)); c <= Math.min(RADAR_N - 1, idx(bx1, x0)); c++) {
        if (o.kind === 'disc') {
          // the cell's nearest point to the disc's centre must be inside it
          const cx = Math.max(x0 + c * RADAR_CELL, Math.min(o.x, x0 + (c + 1) * RADAR_CELL)), cz = Math.max(z0 + r * RADAR_CELL, Math.min(o.z, z0 + (r + 1) * RADAR_CELL));
          if (Math.hypot(cx - o.x, cz - o.z) > o.r) continue;
        }
        if (g[r][c] !== '#') g[r][c] = ch;
      }
    }
  }
  const reach = RADAR_RANGE * Math.SQRT2 + RADAR_CELL;
  for (const c of world.nearCreatures(w.pos, reach)) put(c.pos.x, c.pos.z, '*');
  for (const x of world.nearWizards(w.pos, reach)) if (x !== w && world.online(x)) put(x.pos.x, x.pos.z, HOUSE_CHAR[x.house] ?? 'W');
  g[half][half] = '@';
  return {
    rows: g.map((r) => r.join('')),
    legend: `north is up (−z), east is right (+x); one character = ${RADAR_CELL} m, you (@) in the middle. G H R S a wizard of that house · * a creature · # wall or building · ~ water · . open ground`,
  };
}
