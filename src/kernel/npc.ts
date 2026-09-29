import type { House } from '../shared/constants.js';
import { LANDMARKS } from '../shared/map.js';
import { MEME, NPC_LINES, NPC_NIGHT, NPC_RIVAL, NPC_WEATHER, fill, houseLine, type Line } from '../lore/memes.js';
import { CREATURES } from './creatures.js';
import { dist } from './physics.js';
import { derived } from './progression.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';
import { npcStock } from './market.js';

/**
 * Non-player wizards. They are ordinary wizards in the kernel (same spells, same mana, same rules)
 * driven by a small brain that calls the same syscalls a player would. They never become Minister,
 * are worth no duel reputation, and only fight wizards who attack them first.
 */
interface Persona { name: string; house: House; favourite: string; patrol: string[]; lines: Line[] }

/** Their idle chatter lives in lore/memes.ts (NPC_LINES), bilingual. */
export const PERSONAS: Persona[] = [
  { name: 'Seamus Finnigan', house: 'Gryffindor', favourite: 'Incendio', patrol: ['courtyard', 'willow', 'hagrid', 'forest'], lines: NPC_LINES['Seamus Finnigan'] },
  { name: 'Hannah Abbott', house: 'Hufflepuff', favourite: 'Stupefy', patrol: ['greenhouses', 'courtyard', 'hagrid'], lines: NPC_LINES['Hannah Abbott'] },
  { name: 'Padma Patil', house: 'Ravenclaw', favourite: 'Glacius', patrol: ['great_hall', 'seventh_floor', 'courtyard', 'lake'], lines: NPC_LINES['Padma Patil'] },
  { name: 'Gregory Goyle', house: 'Slytherin', favourite: 'Stupefy', patrol: ['dungeons', 'courtyard', 'pitch'], lines: NPC_LINES['Gregory Goyle'] },
];

/**
 * What an NPC might say right now: its own lines, plus a word about the night or the weather, plus a remark to a
 * wizard of another house standing within 10m. (The brain picks from it with the same world RNG draw as ever.)
 */
export function chatterPool(world: World, w: Wizard, p: Persona): Line[] {
  const pool: Line[] = [...p.lines];
  if (world.isNight()) pool.push(...NPC_NIGHT);
  pool.push(...(NPC_WEATHER[world.rules.world.weather] ?? []));
  for (const x of world.nearWizards(w.pos, 10)) {
    if (x === w || x.npc || x.house === w.house || !world.isActive(x) || dist(x.pos, w.pos) > 10) continue;
    pool.push(...NPC_RIVAL[p.house].map((l) => fill(l, { house: houseLine(x.house) })));
    break;
  }
  return pool;
}

const brains = new Map<string, { patrol: number; next: number; lastSay: number; grudge: string | null; grudgeUntil: number }>();

export function ensureNpcs(world: World, count: number) {
  for (const p of PERSONAS.slice(0, Math.max(0, Math.min(PERSONAS.length, count)))) {
    let w = [...world.wizards.values()].find((x) => x.npc && x.name === p.name);
    if (!w) {
      if ([...world.wizards.values()].some((x) => x.name.toLowerCase() === p.name.toLowerCase())) continue; // a player took the name
      w = world.enroll(p.name, p.house).wizard;
      w.npc = true;
      w.createdAt = -1e9;
    }
    w.connections = Math.max(1, w.connections);
    brains.set(w.id, { patrol: 0, next: 0, lastSay: -1e9, grudge: null, grudgeUntil: 0 });
  }
  npcStock(world); // their stalls in the spell market (market.ts)
}

/** Called every tick; each NPC thinks twice a second. */
export function thinkNpcs(world: World) {
  for (const [id, b] of brains) {
    const w = world.wizards.get(id);
    if (!w || !w.npc) { brains.delete(id); continue; }
    if (world.now < b.next) continue;
    b.next = world.now + 0.5;
    if (!world.isActive(w)) continue;
    const p = PERSONAS.find((x) => x.name === w.name)!;
    const d = derived(w, world.rules);

    // 决斗俱乐部 (duelclub.ts): a sparring partner — still until the countdown ends, then only the opponent, gently
    // (no healing, a Stupefy about every other thought), so a first-year can beat a seventh-year NPC
    const m = world.duel.match;
    if (m && (m.a === w.id || m.b === w.id)) {
      if (m.phase !== 'fight') continue;
      const opp = world.wizards.get(m.a === w.id ? m.b : m.a);
      if (opp && world.rand() < 0.5 && w.mana > 10) cast(world, w, 'Stupefy', opp.id);
      continue;
    }

    // remember whoever hurt me recently (wizards only), for 30s
    const attacker = w.lastHurtBy && world.wizards.get(w.lastHurtBy);
    if (attacker && world.now - w.hurtAt < 1) { b.grudge = attacker.id; b.grudgeUntil = world.now + 30; }
    if (world.now > b.grudgeUntil) b.grudge = null;

    // survival first: shake off afflictions, heal, shield
    if (w.year >= 2 && world.afflicted(w.id) && w.mana > 20) { cast(world, w, 'Finite Incantatem'); return; }
    if (w.hp < d.maxHp * 0.35 && w.mana > 25) { cast(world, w, 'Episkey'); return; }
    if (w.year >= 2 && w.hp < d.maxHp * 0.7 && !w.auras.some((x) => x.k === 'regen') && w.mana > 30) { cast(world, w, 'Ferula'); return; }
    if (w.hp < d.maxHp * 0.6 && w.st.shieldUntil < world.now && w.mana > 20) { cast(world, w, 'Protego'); return; }

    // no one is left behind: revive fallen wizards of our house
    const fallen = w.year >= 3 ? world.fallen(w.pos, 6, w.id).find((x) => x.house === w.house) : undefined;
    if (fallen && w.mana > 40) { cast(world, w, 'Rennervate', fallen.id); return; }

    // dementors at night: Patronus if we know it
    const dementor = [...world.creatures.values()].find((c) => c.kind === 'dementor' && dist(c.pos, w.pos) < 12);
    if (dementor && w.year >= 3 && w.st.patronusUntil < world.now) { cast(world, w, 'Expecto Patronum'); return; }

    // retaliate against a wizard who attacked us
    const foe = b.grudge ? world.wizards.get(b.grudge) : undefined;
    if (foe && world.isActive(foe) && dist(foe.pos, w.pos) < 30 && world.canHarm(w.id, foe.id)) {
      world.setGoal(w.id, null);
      cast(world, w, w.year >= 2 && world.rand() < 0.25 ? 'Expelliarmus' : 'Stupefy', foe.id);
      return;
    }

    // hunt the nearest creature, with the right element
    const prey = world.around(w.pos, 22, (e) => world.creatures.has(e.id) && world.canHarm(w.id, e.id), w.id, 1)[0];
    if (prey) {
      world.setGoal(w.id, null);
      const mine = [...world.creatures.values()].some((c) => c.owner === w.id);
      if (w.year >= 2 && !mine && w.mana > 60 && world.rand() < 0.2) { cast(world, w, 'Serpensortia'); return; }
      const kind = world.creatures.get(prey.id)!.kind;
      const weak = CREATURES[kind].weak;
      const spell = (weak.ice ?? 1) > 1 && w.year >= 2 ? 'Glacius' : (weak.fire ?? 1) > 1 ? 'Incendio' : p.favourite;
      if (w.mana > 18) cast(world, w, spell, prey.id);
      return;
    }

    // chatter (all NPCs together at most every MEME.NPC_GAP_S, so the feed stays readable), then patrol
    if (world.now - b.lastSay > 45 && world.rand() < 0.08) {
      const pool = chatterPool(world, w, p);
      const line = pool[Math.floor(world.rand() * pool.length)];
      if (world.banter(['npc', MEME.NPC_GAP_S])) world.say(w, line.en, 'npc', line.zh);
      b.lastSay = world.now;
    }
    if (!w.goal) {
      const lm = LANDMARKS.find((l) => l.id === p.patrol[b.patrol % p.patrol.length]);
      b.patrol++;
      if (lm) {
        try { world.setGoal(w.id, { x: lm.x + (world.rand() - 0.5) * 16, z: lm.z + 6 + (world.rand() - 0.5) * 16 }); } catch { /* unreachable spot: try the next */ }
      }
    }
  }
}

function cast(world: World, w: Wizard, spell: string, target?: string) {
  world.cast(w.id, spell, { target: target ?? null });
}
