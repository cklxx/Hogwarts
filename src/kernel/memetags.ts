/**
 * 梗牌 (a Feature; the owner, 2026-09-30: "人物展示要有梗，中文世界的梗"): every wizard wears one line of Chinese-internet
 * slang over the head, beside the title, earned from what they actually do — 卷王 for the one who has felled fifty
 * creatures, 反复去世 for the one knocked out far more than they knock out, 摆烂中 after two still minutes, AI代打 while
 * an agent plays with no browser open. It changes as play changes (recomputed once a second, first rule that fits
 * wins), goes out as the snapshot's `mm` (World.snapshot: the `tag` hook; a static field, sent only when it changes),
 * and shows in MCP look. Nothing political, nothing about real people; a player never picks their own.
 */
import type { Feature } from './feature.js';
import type { Wizard } from './types.js';
import type { World } from './world.js';

declare module './world.js' {
  interface World {
    /** 梗牌 (this module's Feature): each wizard's current tag, and when each last moved or cast (for 摆烂中). */
    memeTags: { of: Map<string, string>; still: Map<string, { x: number; z: number; casts: number; at: number }> };
  }
}

/** Still (not moved, not cast) this long: 摆烂中. */
export const TAG_IDLE_S = 120;
/** Online this long without a word said: i人. */
export const TAG_QUIET_S = 600;

/** A rule: when it fits, and the tag (a few variants, one picked per wizard so a crowd of grinders is not one word). */
interface TagRule { id: string; tags: readonly string[]; fits: (world: World, w: Wizard, x: Facts) => boolean }
interface Facts { online: number; idle: number; chats: number; agentOnly: boolean }

/** In order: the first that fits is worn. */
export const TAG_RULES: readonly TagRule[] = [
  { id: 'minister', tags: ['部长大人', '有权任性'], fits: (world, w) => w.decreeCharges > 0 || world.flags.ministerId === w.id },
  { id: 'jailed', tags: ['踩缝纫机'], fits: (_, w) => w.st.jailedUntil > 0 },
  { id: 'down', tags: ['寄了', '裂开'], fits: (_, w) => !!w.st.stunnedUntil },
  { id: 'npc', tags: ['工具人', 'NPC本C'], fits: (_, w) => !!w.npc },
  { id: 'agent', tags: ['AI代打'], fits: (_, _w, x) => x.agentOnly },
  { id: 'afk', tags: ['摆烂中', '躺平了'], fits: (_, _w, x) => x.idle >= TAG_IDLE_S },
  { id: 'dies', tags: ['反复去世', '脆皮'], fits: (_, w) => w.stats.stunned >= 5 && w.stats.stunned >= 2 * Math.max(1, w.stats.stuns) },
  { id: 'duelist', tags: ['赢麻了', '战神'], fits: (_, w) => w.stats.stuns >= 10 && w.stats.stuns >= 2 * Math.max(1, w.stats.stunned) },
  { id: 'grind', tags: ['卷王', '内卷之王'], fits: (_, w) => w.stats.creatures >= 50 },
  { id: 'coder', tags: ['赛博巫师', '代码成精'], fits: (_, w) => (w.stats.spells ?? 0) >= 3 },
  { id: 'rich', tags: ['富哥', '钞能力'], fits: (_, w) => w.galleons >= 300 },
  { id: 'dodge', tags: ['走位风骚'], fits: (_, w) => (w.stats.dodges ?? 0) >= 30 },
  { id: 'chatty', tags: ['社牛', '话痨'], fits: (_, _w, x) => x.chats >= 20 },
  { id: 'grinding', tags: ['打工人', '内卷中'], fits: (_, w) => w.stats.creatures >= 15 },
  { id: 'quiet', tags: ['i人'], fits: (_, _w, x) => x.online >= TAG_QUIET_S && x.chats === 0 },
  { id: 'new', tags: ['萌新', '小趴菜'], fits: (world, w) => w.year === 1 && world.now - w.createdAt < 600 },
];

/** A stable pick among a rule's variants for this wizard (their handle, never the world's RNG). */
const pick = (tags: readonly string[], handle: string) => {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return tags[h % tags.length];
};

/** The tag this wizard wears now, or '' (pure: tested). */
export function tagOf(world: World, w: Wizard, x: Facts): string {
  for (const r of TAG_RULES) if (r.fits(world, w, x)) return pick(r.tags, w.handle);
  return '';
}

function sweep(world: World) {
  const { of, still } = world.memeTags;
  for (const w of world.wizards.values()) {
    if (!world.online(w)) { of.delete(w.id); still.delete(w.id); continue; }
    const s = still.get(w.id);
    if (!s || Math.hypot(w.pos.x - s.x, w.pos.z - s.z) > 0.5 || w.stats.casts !== s.casts) still.set(w.id, { x: w.pos.x, z: w.pos.z, casts: w.stats.casts, at: world.now });
    const m = world.metrics?.of.get(w.id);
    const facts: Facts = {
      online: m?.online ?? 0, chats: m?.chats ?? 0,
      idle: world.now - (still.get(w.id)?.at ?? world.now),
      agentOnly: !w.npc && w.connections <= 0 && world.online(w),
    };
    const t = tagOf(world, w, facts);
    if (t) of.set(w.id, t); else of.delete(w.id);
  }
}

export const MEMETAGS_FEATURE: Feature = {
  id: 'memetags',
  init(world) { world.memeTags = { of: new Map(), still: new Map() }; },
  sweep,
  tag: (world, w) => world.memeTags.of.get(w.id),
  view: { key: 'meme', look: (world, x) => world.memeTags.of.get(x.id) },
};
