/**
 * 梗牌 (kernel/memetags.ts): a tag comes from what a wizard does, in the rules' order; the same wizard keeps the same
 * variant; it rides the snapshot as `mm` and MCP look as `meme`; nothing for a wizard offline.
 */
import { describe, expect, it } from 'vitest';
import { TAG_IDLE_S, TAG_RULES, tagOf } from '../src/kernel/memetags.js';
import { World } from '../src/kernel/world.js';
import type { Wizard } from '../src/kernel/types.js';

function mk() {
  const w = new World({ seed: 11, secret: 'memetags' });
  w.rules.creatures.spawnMultiplier = 0;
  w.rules.events.pool = [];
  w.term.endsAt = 1e12;
  return w;
}
function join(w: World, name: string): Wizard {
  const a = w.enroll(name, 'Gryffindor' as never).wizard;
  a.connections = 1; a.createdAt = -1e6;
  return a;
}
const run = (w: World, s: number) => { for (let i = 0; i < Math.round(s * 20); i++) w.tick(); };
const facts = (o: Partial<{ online: number; idle: number; chats: number; agentOnly: boolean }> = {}) => ({ online: 0, idle: 0, chats: 0, agentOnly: false, ...o });
const of = (id: string) => TAG_RULES.find((r) => r.id === id)!.tags;

describe('梗牌', () => {
  it('earned from play, the first rule that fits wins', () => {
    const w = mk(), a = join(w, 'Mia');
    expect(tagOf(w, a, facts())).toBe('');
    a.stats.creatures = 20;
    expect(of('grinding')).toContain(tagOf(w, a, facts()));
    a.stats.creatures = 60;
    expect(of('grind')).toContain(tagOf(w, a, facts()));
    // knocked out outranks the grind; an idle agent outranks everything but the state it is in
    a.st.stunnedUntil = w.now + 5;
    expect(of('down')).toContain(tagOf(w, a, facts()));
    a.st.stunnedUntil = 0;
    expect(tagOf(w, a, facts({ agentOnly: true }))).toBe('AI代打');
    expect(of('afk')).toContain(tagOf(w, a, facts({ idle: TAG_IDLE_S })));
  });

  it('the one knocked out far more than they knock out: 反复去世 / 脆皮; the reverse: 赢麻了 / 战神', () => {
    const w = mk(), a = join(w, 'Jake');
    a.stats.stunned = 6; a.stats.stuns = 1;
    expect(of('dies')).toContain(tagOf(w, a, facts()));
    a.stats.stunned = 2; a.stats.stuns = 12;
    expect(of('duelist')).toContain(tagOf(w, a, facts()));
  });

  it('a new first-year is 萌新 / 小趴菜; the variant is stable for a wizard', () => {
    const w = mk(), a = join(w, 'Lin');
    a.createdAt = w.now;
    const t = tagOf(w, a, facts());
    expect(of('new')).toContain(t);
    for (let i = 0; i < 5; i++) expect(tagOf(w, a, facts())).toBe(t);
  });

  it('rides the snapshot as mm (1 Hz) and look as meme; offline wizards wear none', () => {
    const w = mk(), a = join(w, 'Zoe');
    a.stats.creatures = 60;
    run(w, 1.2);
    const e = w.snapshot().w.find((x: { h: string }) => x.h === a.handle) as { mm?: string };
    expect(of('grind')).toContain(e.mm);
    expect(w.memeTags.of.get(a.id)).toBe(e.mm);
    a.connections = 0;
    run(w, 1.2);
    if (!w.online(a)) expect(w.memeTags.of.has(a.id)).toBe(false);
  });

  it('stays still two minutes: 摆烂中 / 躺平了', () => {
    const w = mk(), a = join(w, 'Kai');
    run(w, TAG_IDLE_S + 2);
    expect(of('afk')).toContain(w.memeTags.of.get(a.id));
    a.pos = { x: a.pos.x + 3, z: a.pos.z };
    run(w, 1.2);
    expect(of('afk')).not.toContain(w.memeTags.of.get(a.id));
  });
});
