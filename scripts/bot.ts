/**
 * A tiny scripted "agent" that plays over MCP exactly like an LLM agent would:
 *   npm run bot -- "Neville Longbottom"          (enrols a new wizard)
 *   HOGWARTS_TOKEN=... npm run bot                (plays an existing one)
 * It forges its own spell, walks to the creatures, and hunts them.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.HOGWARTS_URL ?? 'http://localhost:7777/mcp');
const token = process.env.HOGWARTS_TOKEN;
const name = process.argv[2] ?? `Bot ${Math.floor(Math.random() * 1000)}`;

const c = new Client({ name: 'hogwarts-bot', version: '0.1.0' });
await c.connect(new StreamableHTTPClientTransport(url, token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined));
const call = async (tool: string, args: Record<string, unknown> = {}) => {
  const r = (await c.callTool({ name: tool, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const t = r.content[0]?.text ?? '';
  try { return { ok: !r.isError, data: JSON.parse(t) }; } catch { return { ok: !r.isError, data: t }; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!token) {
  const e = await call('enroll', { name });
  if (!e.ok) throw new Error(String(e.data));
  console.log(`Enrolled ${e.data.welcome} Token: ${e.data.token}\nWatch it: ${e.data.play}`);
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
  const look = (await call('look', { radius: 60 })).data;
  const prey = look.creatures.find((x: { kind: string }) => x.kind !== 'troll' && x.kind !== 'dementor');
  if (!prey) { await call('move_to', { landmark: i % 2 ? 'forest' : 'hagrid' }); await call('wait', { seconds: 6, until: 'event' }); continue; }
  if (me.hp < me.maxHp * 0.4) await call('cast', { spell: 'Episkey' });
  if (prey.dist > 22) { await call('move_to', { x: prey.x, z: prey.z }); await call('wait', { seconds: 1 }); continue; }
  await call('stop');
  const weak = prey.weakTo.includes('ice') ? 'Glacius' : prey.weakTo.includes('fire') ? 'Incendio' : 'Finisher';
  const r = (await call('cast', { spell: weak, target: prey.id })).data;
  if (!r.ok) await call('cast', { spell: 'Finisher', target: prey.id });
  await sleep(450);
}
