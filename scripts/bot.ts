/**
 * A tiny scripted "agent" that plays over MCP exactly like an LLM agent would:
 *   npm run bot -- "Neville Longbottom"          (enrols a new wizard)
 *   HOGWARTS_TOKEN=... npm run bot                (plays an existing one)
 * It forges its own spell, walks to the creatures, and hunts them, paced to its concentration (专注力).
 *
 * Sharding (issue #27): with no prey it follows the daily Bounty Board to a hunt-zone instead of piling into the
 * Forbidden Forest. The board rotates per day, so the swarm spreads across grounds, greenhouses, dungeons and
 * forest. It only attacks HOSTILE creatures — never a benign unicorn (killing one costs 50 reputation).
 * At year 7 it sits N.E.W.T. as soon as three papers are met, then graduates (prestige) and starts over.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';

const url = new URL(process.env.HOGWARTS_URL ?? 'http://localhost:7777/mcp');
const name = process.argv[2] ?? `Bot ${Math.floor(Math.random() * 1000)}`;
// Persisted key so a restart logs back into the SAME wizard instead of tripping "name taken".
const tokenFile = process.env.HOGWARTS_TOKEN_FILE ?? `/tmp/hogwarts-bot-${name.replace(/[^a-z0-9]+/gi, '_')}.token`;
let token = process.env.HOGWARTS_TOKEN ?? (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');

const c = new Client({ name: 'hogwarts-bot', version: '0.2.0' });
await c.connect(new StreamableHTTPClientTransport(url, token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 专注力: action tools spend concentration (about one a second); a tired wand hand says retry_after=N — rest, then retry
const call = async (tool: string, args: Record<string, unknown> = {}, attempt = 0): Promise<{ ok: boolean; data: any }> => {
  const r = (await c.callTool({ name: tool, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const t = r.content[0]?.text ?? '';
  const wait = r.isError ? /retry_after=(\d+)/.exec(t) : null;
  // honor retry_after repeatedly (up to 10x) — covers enroll's Sorting-Hat cooldown, not just combat
  if (wait && attempt < 10) { await sleep(Number(wait[1]) * 1000 + 200); return call(tool, args, attempt + 1); }
  try { return { ok: !r.isError, data: JSON.parse(t) }; } catch { return { ok: !r.isError, data: t }; }
};

if (token) {
  const l = await call('login', { token });
  if (!l.ok) throw new Error(String(l.data));
  console.log(`Logged in as ${l.data.name}, ${l.data.house}.`);
} else {
  const e = await call('enroll', { name });
  if (!e.ok) throw new Error(String(e.data));
  token = e.data.token;
  if (token) fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  // never print the key (docs/AGENT_LINK.md); the play link carries it, so only the base URL is shown
  console.log(`Enrolled ${e.data.welcome} (${e.data.registry}). Watch it at ${url.origin}/`);
}
const forged = await call('forge_spell', {
  name: 'Finisher', incantation: 'Finite Vita!', slot: 6,
  source: `; weak targets get a big lightning bolt, healthy ones a cheap one
(let t (or target (first (enemies 30))))
(when t (if (< (hp t) 20) (bolt t 16 :lightning) (bolt t 10)))`,
});
console.log('forge_spell:', forged.ok ? forged.data.forged : forged.data);

for (let i = 0; ; i++) {
  const me = (await call('whoami')).data;
  if (i % 10 === 0) console.log(`[${me.name}] year ${me.year} xp ${me.xp} rep ${me.reputation} hp ${me.hp}/${me.maxHp} mana ${me.mana} @ ${me.where}`);
  if (me.state !== 'in the world') { await call('wait', { seconds: 2 }); continue; }
  // out of mana: stop spending and let it regen instead of spinning failed casts
  if (me.mana < 30) { await call('wait', { seconds: 5 }); continue; }
  // endgame: year 7 — sit N.E.W.T. once three papers are met, then graduate and start a new life
  if (me.year >= 7) {
    const nt = (await call('newt', { action: 'status' })).data;
    if (!nt.passed) {
      if (nt.gradeNow) {
        const sit = await call('newt', { action: 'sit' });
        console.log('N.E.W.T.:', sit.ok ? `grade ${sit.data.passed}` : sit.data);
      }
    } else {
      const g = await call('graduate');
      console.log('graduate:', g.ok ? g.data : g.data);
      await sleep(2000);
      continue;
    }
  }
  const look = (await call('look', { radius: 60 })).data;
  // Spread (issue #27): each wizard is ASSIGNED one of today's bounties by a stable hash of its name, so the
  // swarm spreads across the three zones in parallel instead of all chasing the first bounty. It hunts its
  // assigned zone, claims there, then hunts in place once that bounty is done.
  const board = (await call('bounty_board')).data as { bounties: { place: string; claimed: boolean; x: number; z: number }[] };
  let h = 2166136261;
  for (const ch of me.name) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const assigned = board.bounties[Math.abs(h) % board.bounties.length];
  // Always camp at the ASSIGNED hunt-zone, even after someone claimed that bounty: a bot left in a
  // transit spot (e.g. the courtyard) finds no prey and stalls until a random spawn.
  if (assigned && me.where !== assigned.place) {
    await call('move_to', { x: assigned.x, z: assigned.z });
    await call('wait', { seconds: 3, until: 'event' });
    continue;
  }
  // hostile prey only: benign unicorns cost 50 reputation; trolls and dementors stay out of a bot's diet
  const prey = look.creatures.find((x: { faction: string; kind: string }) => x.faction === 'hostile' && x.kind !== 'troll' && x.kind !== 'dementor');
  if (!prey) {
    // hold the bounty zone and wait for spawns
    await call('wait', { seconds: 6, until: 'event' });
    continue;
  }
  if (me.hp < me.maxHp * 0.4) await call('cast', { spell: 'Episkey' });
  if (prey.dist > 22) { await call('move_to', { x: prey.x, z: prey.z }); await call('wait', { seconds: 1 }); continue; }
  await call('stop');
  const weak = prey.weakTo.includes('ice') ? 'Glacius' : prey.weakTo.includes('fire') ? 'Incendio' : 'Finisher';
  const r = (await call('cast', { spell: weak, target: prey.id })).data;
  if (!r.ok) await call('cast', { spell: 'Finisher', target: prey.id });
  await sleep(1200); // at most ~2 action calls a round: stays inside the concentration regen
}
